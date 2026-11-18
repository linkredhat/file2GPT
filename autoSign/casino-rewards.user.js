// ==UserScript==
// @name         S喵在线大赌场：签到与整点补给
// @namespace    local.casino-rewards
// @version      0.4.0
// @description  在账房页按可配置的时间段领取每日签到和整点补给，并确认领取结果
// @match        https://casino.soliumbra.com/wallet*
// @run-at       document-idle
// @grant        GM_notification
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.4.0';
  const MINUTE_MS = 60 * 1000;
  const SCAN_INTERVAL_MS = 20 * 1000;
  const RETRY_INTERVAL_MS = 20 * 1000;
  const CLICK_VERIFY_MS = 8 * 1000;
  const RELOAD_SETTLE_MS = 3 * 1000;
  const MAX_CLAIM_ATTEMPTS = 3;
  const STATUS_ID = 'casino-rewards-status';
  const SETTINGS_KEY = 'casino-rewards:settings';
  const DEFAULT_SETTINGS = {
    daily: { start: 0, end: 30 },
    hourly: { start: 0, end: 30 },
    collapsed: false,
  };

  const TARGETS = [
    {
      key: 'daily',
      name: '每日签到',
      prefixes: ['领取每日签到', '每日签到'],
      daily: true,
    },
    {
      key: 'hourly',
      name: '整点补给',
      prefixes: ['领取整点补给', '整点补给'],
      daily: false,
    },
  ];

  const state = new Map();
  const activeRecovery = new Set();
  let stopped = false;
  let scanTimer = 0;
  let observer;
  let settings = loadSettings();

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function minuteValue(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 59 ? number : fallback;
  }

  function normalizedRange(value, fallback) {
    const start = minuteValue(value?.start, fallback.start);
    const end = minuteValue(value?.end, fallback.end);
    return start <= end ? { start, end } : { ...fallback };
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        daily: normalizedRange(saved.daily, DEFAULT_SETTINGS.daily),
        hourly: normalizedRange(saved.hourly, DEFAULT_SETTINGS.hourly),
        collapsed: Boolean(saved.collapsed),
      };
    } catch {
      return {
        daily: { ...DEFAULT_SETTINGS.daily },
        hourly: { ...DEFAULT_SETTINGS.hourly },
        collapsed: DEFAULT_SETTINGS.collapsed,
      };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  }

  function allButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"]'));
  }

  function buttonLabels(button) {
    return [button.getAttribute('aria-label'), button.innerText, button.textContent]
      .map(normalize)
      .filter(Boolean);
  }

  function findButton(target) {
    return allButtons().find((element) => {
      const labels = buttonLabels(element);
      return target.prefixes.some((prefix) => labels.some((label) => label.includes(prefix)));
    }) || null;
  }

  function buttonState(button) {
    if (!button) return '未找到';
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return '冷却中';
    return '可领取';
  }

  function isEnabled(button) {
    return Boolean(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }

  function randomInt(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    const maxUint32 = 0x100000000;
    const limit = Math.floor(maxUint32 / maxExclusive) * maxExclusive;
    const value = new Uint32Array(1);
    do {
      window.crypto.getRandomValues(value);
    } while (value[0] >= limit);
    return value[0] % maxExclusive;
  }

  function windowStart(target, value) {
    const start = new Date(value);
    if (target.daily) {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setMinutes(0, 0, 0);
    }
    return start;
  }

  function bucket(target, value) {
    const start = windowStart(target, value);
    return `${target.key}:${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}-${start.getHours()}`;
  }

  function wasClaimed(target, value) {
    try {
      return sessionStorage.getItem(`casino-rewards:claimed:${bucket(target, value)}`) === '1';
    } catch {
      return false;
    }
  }

  function rememberBucketClaim(target, bucketValue) {
    try {
      sessionStorage.setItem(`casino-rewards:claimed:${bucketValue}`, '1');
    } catch {
      // The refreshed page state remains the second duplicate-click guard.
    }
  }

  function pendingStorageKey(target) {
    return `casino-rewards:pending:${target.key}`;
  }

  function failedStorageKey(bucketValue) {
    return `casino-rewards:failed:${bucketValue}`;
  }

  function readPending(target) {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingStorageKey(target)) || 'null');
      return value && typeof value.bucket === 'string' && Number.isInteger(value.attempts)
        ? value
        : null;
    } catch {
      return null;
    }
  }

  function writePending(target, value) {
    try {
      sessionStorage.setItem(pendingStorageKey(target), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function clearPending(target) {
    activeRecovery.delete(target.key);
    try {
      sessionStorage.removeItem(pendingStorageKey(target));
    } catch {
      // Ignore unavailable session storage.
    }
  }

  function wasExhausted(bucketValue) {
    try {
      return sessionStorage.getItem(failedStorageKey(bucketValue)) === '1';
    } catch {
      return false;
    }
  }

  function markExhausted(target, pending) {
    try {
      sessionStorage.setItem(failedStorageKey(pending.bucket), '1');
    } catch {
      // The status message still prevents a tight retry loop in this page.
    }
    clearPending(target);
    renderStatus(`${target.name} 连续 ${MAX_CLAIM_ATTEMPTS} 次仍未确认，已停止本轮自动重试。`);
  }

  function windowBounds(target, value) {
    const cycleStart = windowStart(target, value);
    const range = settings[target.key];
    return {
      start: new Date(cycleStart.getTime() + range.start * MINUTE_MS),
      end: new Date(cycleStart.getTime() + (range.end + 1) * MINUTE_MS),
    };
  }

  function inWindow(target, value) {
    const { start, end } = windowBounds(target, value);
    return value >= start && value < end;
  }

  function nextWindowTime(target, value) {
    const now = new Date(value);
    let cycleStart = windowStart(target, now);
    let bounds = windowBounds(target, cycleStart);

    if (now < bounds.end) {
      const lowerBound = Math.max(now.getTime(), bounds.start.getTime());
      return new Date(lowerBound + randomInt(bounds.end.getTime() - lowerBound));
    }

    if (target.daily) {
      cycleStart.setDate(cycleStart.getDate() + 1);
    } else {
      cycleStart.setHours(cycleStart.getHours() + 1);
    }

    bounds = windowBounds(target, cycleStart);
    return new Date(bounds.start.getTime() + randomInt(bounds.end.getTime() - bounds.start.getTime()));
  }

  function formatTime(value) {
    return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function ensureStatusPanel() {
    let panel = document.getElementById(STATUS_ID);
    if (panel?.dataset.panelVersion === VERSION) return panel;
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = STATUS_ID;
    panel.dataset.panelVersion = VERSION;
    panel.innerHTML = `
      <div class="head">
        <strong data-role="title">签到助手</strong>
        <button type="button" class="toggle" data-action="toggle" aria-label="折叠设置">−</button>
      </div>
      <div class="body">
        <div class="range-row">
          <span>每日签到</span>
          <div class="range-inputs">
            <input type="number" min="0" max="59" step="1" data-field="dailyStart" aria-label="每日签到开始分钟">
            <span>至</span>
            <input type="number" min="0" max="59" step="1" data-field="dailyEnd" aria-label="每日签到结束分钟">
            <span>分</span>
          </div>
        </div>
        <div class="range-row">
          <span>整点补给</span>
          <div class="range-inputs">
            <input type="number" min="0" max="59" step="1" data-field="hourlyStart" aria-label="整点补给开始分钟">
            <span>至</span>
            <input type="number" min="0" max="59" step="1" data-field="hourlyEnd" aria-label="整点补给结束分钟">
            <span>分</span>
          </div>
        </div>
        <small class="hint">从 00:00 或整点起算，首尾分钟都包含</small>
        <button type="button" class="save" data-action="save">保存时间段</button>
        <div class="message" data-role="message" role="status" aria-live="polite"></div>
        <div class="status-line" data-status="daily"></div>
        <div class="status-line" data-status="hourly"></div>
      </div>`;

    const style = document.createElement('style');
    style.textContent = `
      #${STATUS_ID} {
        position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
        box-sizing: border-box; width: 258px; max-width: calc(100vw - 24px);
        padding: 7px 9px; border: 1px solid rgba(255,255,255,.24); border-radius: 8px;
        background: rgba(32,33,36,.96); color: #f1f3f4;
        font: 12px/1.4 system-ui,sans-serif; white-space: normal;
        box-shadow: 0 2px 10px rgba(0,0,0,.3);
      }
      #${STATUS_ID} * { box-sizing: border-box; }
      #${STATUS_ID} .head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      #${STATUS_ID} .head strong { font-size:12px; font-weight:600; }
      #${STATUS_ID} button { color:inherit; font:inherit; cursor:pointer; }
      #${STATUS_ID} .toggle { width:22px; height:22px; padding:0; border:0; border-radius:5px; background:rgba(255,255,255,.12); }
      #${STATUS_ID} .body { display:flex; flex-direction:column; gap:6px; margin-top:5px; }
      #${STATUS_ID} .range-row { display:grid; grid-template-columns:72px 1fr; align-items:center; gap:6px; }
      #${STATUS_ID} .range-inputs { display:flex; align-items:center; gap:4px; }
      #${STATUS_ID} input { width:42px; height:24px; padding:2px 3px; border:1px solid #666; border-radius:4px; background:#303134; color:#f1f3f4; font:12px system-ui,sans-serif; text-align:center; }
      #${STATUS_ID} .hint { color:#bdc1c6; font-size:10px; }
      #${STATUS_ID} .save { width:100%; padding:4px 6px; border:0; border-radius:5px; background:#4b647d; }
      #${STATUS_ID} .save:hover, #${STATUS_ID} .toggle:hover { background:#617b95; }
      #${STATUS_ID} .message { min-height:1em; color:#b8d7ff; font-size:10px; }
      #${STATUS_ID} .message.error { color:#ffb4ab; }
      #${STATUS_ID} .status-line { color:#e8eaed; font-size:10px; overflow-wrap:anywhere; }
      #${STATUS_ID}.is-collapsed { width:112px; padding:5px 7px; }
      #${STATUS_ID}.is-collapsed .body { display:none; }`;
    panel.appendChild(style);
    document.body.appendChild(panel);

    const fieldValues = {
      dailyStart: settings.daily.start,
      dailyEnd: settings.daily.end,
      hourlyStart: settings.hourly.start,
      hourlyEnd: settings.hourly.end,
    };
    for (const [field, value] of Object.entries(fieldValues)) {
      panel.querySelector(`[data-field="${field}"]`).value = String(value);
    }

    panel.querySelector('[data-action="toggle"]').addEventListener('click', () => {
      settings.collapsed = !settings.collapsed;
      saveSettings();
      applyCollapsedState(panel);
    });
    panel.querySelector('[data-action="save"]').addEventListener('click', () => saveTimeRanges(panel));
    applyCollapsedState(panel);
    return panel;
  }

  function applyCollapsedState(panel) {
    const button = panel.querySelector('[data-action="toggle"]');
    panel.classList.toggle('is-collapsed', settings.collapsed);
    button.textContent = settings.collapsed ? '＋' : '−';
    button.setAttribute('aria-label', settings.collapsed ? '展开设置' : '折叠设置');
    button.setAttribute('aria-expanded', String(!settings.collapsed));
  }

  function panelMessage(panel, message, isError = false) {
    const element = panel.querySelector('[data-role="message"]');
    if (element.textContent !== message) element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function saveTimeRanges(panel) {
    const value = (field) => {
      const input = panel.querySelector(`[data-field="${field}"]`);
      return input.value.trim() === '' ? NaN : Number(input.value);
    };
    const daily = { start: value('dailyStart'), end: value('dailyEnd') };
    const hourly = { start: value('hourlyStart'), end: value('hourlyEnd') };
    const ranges = [daily, hourly];

    if (ranges.some(({ start, end }) =>
      !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || start > 59 || end < 0 || end > 59)) {
      panelMessage(panel, '请输入 0 至 59 的整数分钟。', true);
      return;
    }
    if (ranges.some(({ start, end }) => start > end)) {
      panelMessage(panel, '结束分钟不能早于开始分钟。', true);
      return;
    }

    settings = { ...settings, daily, hourly };
    const stored = saveSettings();
    for (const record of state.values()) window.clearTimeout(record.timer);
    state.clear();
    if (!stopped) scan();
    renderStatus(stored ? '时间段已保存。' : '时间段已应用，但浏览器未能保存设置。');
  }

  function renderStatus(extra = '') {
    const panel = ensureStatusPanel();
    const now = new Date();
    const title = `签到助手 ${VERSION}${stopped ? '（已暂停）' : ''}`;
    const titleElement = panel.querySelector('[data-role="title"]');
    if (titleElement.textContent !== title) titleElement.textContent = title;

    for (const target of TARGETS) {
      const current = state.get(target.key);
      const button = findButton(target);
      const pending = readPending(target);
      const sameCycle = pending?.bucket === bucket(target, now);
      const exhausted = wasExhausted(bucket(target, now));
      const status = wasClaimed(target, now)
        ? '已完成'
        : exhausted
        ? '本轮已停止重试'
        : sameCycle
        ? pending.phase === 'waiting-online'
          ? '等待网络恢复'
          : `核对/重试 ${pending.attempts}/${MAX_CLAIM_ATTEMPTS}`
        : buttonState(button);
      const plan = !sameCycle && current?.plan ? ` · 计划 ${formatTime(current.plan)}` : '';
      const line = `${target.name}：${status}${plan}`;
      const statusElement = panel.querySelector(`[data-status="${target.key}"]`);
      if (statusElement.textContent !== line) statusElement.textContent = line;
    }
    panelMessage(panel, extra);
  }

  function log(message, ...args) {
    console.info(`[casino-rewards] ${message}`, ...args);
  }

  function notify(title, message) {
    log(`${title}: ${message}`);
    if (typeof GM_notification === 'function') {
      GM_notification({ title, text: message, timeout: 10000 });
    }
  }

  function hasRiskPrompt() {
    const text = document.body?.innerText || '';
    return /验证码|人机验证|captcha|登录已过期|请求过于频繁|rate limit|too many requests/i.test(text);
  }

  function schedule(target) {
    if (stopped) return;

    const now = new Date();
    if (wasClaimed(target, now)) return;
    const pending = readPending(target);
    if (pending?.bucket === bucket(target, now)) return;
    if (pending) clearPending(target);
    if (wasExhausted(bucket(target, now))) return;

    const existing = state.get(target.key);
    const targetTime = existing?.plan && existing.plan > now
      ? existing.plan
      : nextWindowTime(target, now);

    if (existing?.bucket === bucket(target, targetTime) && existing.timer) return;

    const delay = Math.max(0, targetTime.getTime() - now.getTime());
    const record = {
      bucket: bucket(target, targetTime),
      plan: targetTime,
      timer: window.setTimeout(() => run(target), delay),
    };
    state.set(target.key, record);
    log(`${target.name} 计划在 ${formatTime(targetTime)} 检查`);
    renderStatus();
  }

  function run(target) {
    state.delete(target.key);
    if (stopped) return;

    const now = new Date();
    if (!inWindow(target, now)) {
      schedule(target);
      return;
    }

    if (wasClaimed(target, now)) return;
    if (!navigator.onLine) {
      const pending = { bucket: bucket(target, now), attempts: 0, phase: 'waiting-online', baseline: [] };
      if (!writePending(target, pending)) {
        renderStatus('浏览器无法保存待办状态，本次未点击领取。');
        return;
      }
      renderStatus(`${target.name} 等待网络恢复。`);
      return;
    }

    const button = findButton(target);
    if (!isEnabled(button)) {
      renderStatus(`${target.name} 当前不可领取，稍后复查`);
      window.setTimeout(() => schedule(target), RETRY_INTERVAL_MS);
      return;
    }

    startAttempt(target, null);
  }

  function successTexts(target) {
    const targetPattern = target.daily ? /签到/ : /补给/;
    const successPattern = /成功|已领取|已签到|已完成|领取完成/;
    const texts = new Set();
    const feedback = document.querySelectorAll('[role="alert"], [role="status"], [aria-live]');
    for (const element of feedback) {
      const text = normalize(element.innerText || element.textContent);
      if (text && targetPattern.test(text) && successPattern.test(text)) texts.add(text);
    }
    for (const line of (document.body?.innerText || '').split(/[\r\n]+/)) {
      const text = normalize(line);
      if (text && text.length <= 120 && targetPattern.test(text) && successPattern.test(text)) texts.add(text);
    }
    return Array.from(texts).slice(0, 12);
  }

  function hasNewSuccess(target, pending) {
    const baseline = new Set(pending?.baseline || []);
    return successTexts(target).some((text) => !baseline.has(text));
  }

  function completeClaim(target, pending, message) {
    rememberBucketClaim(target, pending.bucket);
    try {
      sessionStorage.removeItem(failedStorageKey(pending.bucket));
    } catch {
      // Ignore unavailable session storage.
    }
    clearPending(target);
    notify(`${target.name}已确认`, message);
    renderStatus(`${target.name} 已确认成功。`);
    window.setTimeout(() => schedule(target), RETRY_INTERVAL_MS);
  }

  function startAttempt(target, previous) {
    if (stopped) return;
    const now = new Date();
    const currentBucket = bucket(target, now);

    if (previous && previous.bucket !== currentBucket) {
      clearPending(target);
      schedule(target);
      return;
    }
    if (!previous && !inWindow(target, now)) {
      schedule(target);
      return;
    }
    if (wasClaimed(target, now)) {
      clearPending(target);
      return;
    }

    if (!navigator.onLine) {
      const waiting = {
        bucket: currentBucket,
        attempts: previous?.attempts || 0,
        phase: 'waiting-online',
        baseline: previous?.baseline || [],
      };
      if (!writePending(target, waiting)) {
        renderStatus('浏览器无法保存待办状态，未继续重试。');
        return;
      }
      renderStatus(`${target.name} 等待网络恢复。`);
      return;
    }

    const button = findButton(target);
    if (!isEnabled(button)) {
      if (previous?.attempts > 0 && button) {
        completeClaim(target, previous, '刷新后按钮已不可领取。');
      } else if (previous?.attempts > 0) {
        recoverPending(target);
      } else {
        clearPending(target);
        renderStatus(`${target.name} 当前不可领取，稍后复查`);
        window.setTimeout(() => schedule(target), RETRY_INTERVAL_MS);
      }
      return;
    }

    const attempts = (previous?.attempts || 0) + 1;
    if (attempts > MAX_CLAIM_ATTEMPTS) {
      markExhausted(target, previous);
      return;
    }

    const pending = {
      bucket: currentBucket,
      attempts,
      phase: 'clicked',
      clickedAt: Date.now(),
      baseline: successTexts(target),
    };
    if (!writePending(target, pending)) {
      renderStatus('无法保存领取核对状态，本次未点击。');
      return;
    }

    try {
      button.click();
      notify(`${target.name}已点击`, `正在核对结果（第 ${attempts}/${MAX_CLAIM_ATTEMPTS} 次）。`);
    } catch (error) {
      log(`${target.name} 点击异常`, error);
    }
    renderStatus(`${target.name} 已点击，等待页面确认。`);
    window.setTimeout(() => verifyAfterClick(target), CLICK_VERIFY_MS);
  }

  function verifyAfterClick(target) {
    if (stopped) return;
    if (hasRiskPrompt()) {
      stop('检测到验证码、登录失效或限流提示。');
      return;
    }

    const pending = readPending(target);
    if (!pending || pending.bucket !== bucket(target, new Date())) return;
    if (wasClaimed(target, new Date())) {
      clearPending(target);
      return;
    }
    if (hasNewSuccess(target, pending)) {
      completeClaim(target, pending, '页面显示了成功反馈。');
      return;
    }
    if (!navigator.onLine) {
      pending.phase = 'waiting-online';
      writePending(target, pending);
      renderStatus(`${target.name} 请求结果待核对，等待网络恢复。`);
      return;
    }

    pending.phase = 'reload-check';
    writePending(target, pending);
    renderStatus(`${target.name} 尚未确认，正在刷新页面核对。`);
    window.location.reload();
  }

  function recoverPending(target) {
    const pending = readPending(target);
    if (!pending) return false;

    const now = new Date();
    if (pending.bucket !== bucket(target, now)) {
      clearPending(target);
      return false;
    }
    if (wasClaimed(target, now)) {
      clearPending(target);
      return true;
    }
    if (activeRecovery.has(target.key)) return true;
    if (!navigator.onLine) {
      pending.phase = 'waiting-online';
      writePending(target, pending);
      renderStatus(`${target.name} 等待网络恢复。`);
      return true;
    }

    pending.phase = 'reload-check';
    writePending(target, pending);
    activeRecovery.add(target.key);
    const startedAt = Date.now();

    function checkPage() {
      if (stopped) {
        activeRecovery.delete(target.key);
        return;
      }
      const current = readPending(target);
      if (!current || current.bucket !== bucket(target, new Date())) {
        activeRecovery.delete(target.key);
        if (current) clearPending(target);
        return;
      }
      if (wasClaimed(target, new Date())) {
        clearPending(target);
        return;
      }
      if (!navigator.onLine) {
        current.phase = 'waiting-online';
        writePending(target, current);
        activeRecovery.delete(target.key);
        renderStatus(`${target.name} 等待网络恢复。`);
        return;
      }

      const button = findButton(target);
      if (hasNewSuccess(target, current) || (current.attempts > 0 && button && !isEnabled(button))) {
        completeClaim(target, current, '刷新后页面状态确认已领取。');
        return;
      }
      if (isEnabled(button)) {
        activeRecovery.delete(target.key);
        startAttempt(target, current);
        return;
      }
      if (current.attempts === 0 && button) {
        clearPending(target);
        window.setTimeout(() => schedule(target), RETRY_INTERVAL_MS);
        return;
      }
      if (Date.now() - startedAt > 30 * 1000) {
        markExhausted(target, current);
        return;
      }

      renderStatus(`${target.name} 等待页面按钮加载后核对。`);
      window.setTimeout(checkPage, RELOAD_SETTLE_MS);
    }

    window.setTimeout(checkPage, RELOAD_SETTLE_MS);
    return true;
  }

  function stop(reason) {
    if (stopped) return;
    stopped = true;
    notify('签到脚本已暂停', reason);
    renderStatus(reason);
  }

  function scan() {
    if (stopped) return;
    if (hasRiskPrompt()) {
      stop('检测到验证码、登录失效或限流提示。');
      return;
    }

    for (const target of TARGETS) {
      if (!recoverPending(target)) schedule(target);
    }
    renderStatus();
  }

  function wakePage() {
    if (stopped) return;
    scan();
  }

  function queueScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scan();
    }, 250);
  }

  function start() {
    if (!document.body) {
      window.setTimeout(start, 500);
      return;
    }

    ensureStatusPanel();
    observer = new MutationObserver(queueScan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.setInterval(scan, SCAN_INTERVAL_MS);
    window.addEventListener('online', wakePage);
    window.addEventListener('pageshow', wakePage);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') wakePage();
    });
    scan();
    log('已启动，按配置排程并核对领取结果。');
  }

  start();
})();
