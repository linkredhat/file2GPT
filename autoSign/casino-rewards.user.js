// ==UserScript==
// @name         S喵在线大赌场：签到与整点补给
// @namespace    local.casino-rewards
// @version      0.4.3
// @description  后台恢复后自动补执行逾期签到计划，并核验到账与游戏赠金余额
// @match        https://casino.soliumbra.com/wallet*
// @run-at       document-idle
// @grant        GM_notification
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.4.3';
  const MINUTE_MS = 60 * 1000;
  const SCAN_INTERVAL_MS = 20 * 1000;
  const RETRY_INTERVAL_MS = 20 * 1000;
  const CLICK_VERIFY_MS = 8 * 1000;
  const RELOAD_SETTLE_MS = 5 * 1000;
  const RECOVERY_TIMEOUT_MS = 45 * 1000;
  const MAX_CLAIM_ATTEMPTS = 3;
  const STATUS_ID = 'casino-rewards-status';
  const SETTINGS_KEY = 'casino-rewards:settings';
  const PLAN_STORAGE_PREFIX = 'casino-rewards:plan:'
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

  function markExhausted(target, pending, reason = '') {
    try {
      sessionStorage.setItem(failedStorageKey(pending.bucket), '1');
    } catch {
      // The status message still prevents a tight retry loop in this page.
    }
    clearPending(target);
    clearPlanned(target);
    const message = reason || (target.name + ' 连续 ' + MAX_CLAIM_ATTEMPTS + ' 次仍未确认，已停止本轮自动重试。');
    notify(target.name + '未能确认', message);
    renderStatus(message);
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

  function nextCycleWindowTime(target, value) {
    const cycleStart = windowStart(target, value);
    if (target.daily) {
      cycleStart.setDate(cycleStart.getDate() + 1);
    } else {
      cycleStart.setHours(cycleStart.getHours() + 1);
    }

    const bounds = windowBounds(target, cycleStart);
    return new Date(bounds.start.getTime() +
      randomInt(bounds.end.getTime() - bounds.start.getTime()));
  }

  function scheduleNextCycle(target, value = new Date()) {
    if (stopped) return null;

    const targetTime = nextCycleWindowTime(target, value);
    const existing = state.get(target.key);
    if (existing?.timer) window.clearTimeout(existing.timer);
    writePlanned(target, targetTime);

    const record = {
      bucket: bucket(target, targetTime),
      plan: targetTime,
      timer: window.setTimeout(() => run(target, { catchUp: true }),
        Math.max(0, targetTime.getTime() - Date.now())),
    };
    state.set(target.key, record);
    log(`${target.name} 下一轮计划在 ${formatTime(targetTime)} 检查`);
    return targetTime;
  }

  function plannedStorageKey(target) {
    return PLAN_STORAGE_PREFIX + target.key;
  }

  function readPlanned(target) {
    try {
      const value = JSON.parse(localStorage.getItem(plannedStorageKey(target)) || 'null');
      return value && Number.isFinite(value.at) ? value : null;
    } catch {
      return null;
    }
  }

  function writePlanned(target, targetTime) {
    try {
      localStorage.setItem(plannedStorageKey(target), JSON.stringify({
        at: targetTime.getTime(),
        bucket: bucket(target, targetTime),
      }));
      return true;
    } catch {
      return false;
    }
  }

  function clearPlanned(target) {
    try {
      localStorage.removeItem(plannedStorageKey(target));
    } catch {
      // In-memory scheduling remains available for this page lifetime.
    }
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
      const planLabel = wasClaimed(target, now) ? '下轮计划' : '计划';
      const plan = !sameCycle && current?.plan
        ? ` · ${planLabel} ${formatTime(current.plan)}`
        : '';
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
    if (wasClaimed(target, now)) {
      const existing = state.get(target.key);
      if (!existing?.plan || existing.plan <= now) {
        scheduleNextCycle(target, now);
        renderStatus();
      }
      return;
    }
    const pending = readPending(target);
    if (pending?.bucket === bucket(target, now)) return;
    if (pending) clearPending(target);
    if (wasExhausted(bucket(target, now))) {
      clearPlanned(target);
      return;
    }

    const existing = state.get(target.key);
    const saved = readPlanned(target);
    let targetTime;
    let catchUp = false;

    if (existing?.plan && existing.plan > now) {
      targetTime = existing.plan;
    } else if (saved?.at > now.getTime()) {
      targetTime = new Date(saved.at);
    } else if ((existing?.plan && existing.plan <= now) ||
               (saved && saved.at <= now.getTime())) {
      // The browser may have frozen this tab after the planned time.
      // Keep the missed plan due and run it immediately when execution resumes.
      targetTime = new Date(now.getTime() + 100);
      catchUp = true;
    } else {
      targetTime = nextWindowTime(target, now);
    }

    if (existing?.bucket === bucket(target, targetTime) &&
        existing.timer && existing.plan.getTime() === targetTime.getTime()) return;

    const delay = Math.max(0, targetTime.getTime() - now.getTime());
    writePlanned(target, targetTime);
    const record = {
      bucket: bucket(target, targetTime),
      plan: targetTime,
      timer: window.setTimeout(() => run(target, { catchUp }), delay),
    };
    state.set(target.key, record);
    log(catchUp
      ? `${target.name} 发现逾期计划，页面恢复后立即补执行`
      : `${target.name} 计划在 ${formatTime(targetTime)} 检查`);
    renderStatus();
  }



  function run(target, options = {}) {
    state.delete(target.key);
    if (stopped) return;

    const now = new Date();
    const saved = readPlanned(target);
    const catchUp = Boolean(options.catchUp) ||
      Boolean(saved && saved.at <= now.getTime());

    if (!inWindow(target, now) && !catchUp) {
      schedule(target);
      return;
    }

    if (wasClaimed(target, now)) {
      scheduleNextCycle(target, now);
      renderStatus();
      return;
    }
    if (!navigator.onLine) {
      const pending = {
        bucket: bucket(target, now),
        attempts: 0,
        phase: 'waiting-online',
        catchUp,
      };
      if (!writePending(target, pending)) {
        renderStatus('浏览器无法保存待办状态，本次未点击领取。');
        return;
      }
      renderStatus(`${target.name} 等待网络恢复。`);
      return;
    }

    const button = findButton(target);
    if (!isEnabled(button)) {
      if (catchUp) {
        scheduleNextCycle(target, now);
        renderStatus(`${target.name} 逾期计划已检查，但页面按钮不可领取；已安排下一轮。`);
      } else {
        renderStatus(`${target.name} 当前不可领取，稍后复查`);
        window.setTimeout(() => schedule(target), RETRY_INTERVAL_MS);
      }
      return;
    }

    if (catchUp && !inWindow(target, now)) {
      startAttempt(target, {
        bucket: bucket(target, now),
        attempts: 0,
        catchUp: true,
      });
    } else {
      startAttempt(target, null);
    }
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

  function parseAmount(value) {
    const match = String(value || '').replace(/,/g, '').match(/-?\d+/);
    return match ? Number(match[0]) : null;
  }

  function formatAmount(value) {
    return Number.isFinite(value) ? Math.abs(value).toLocaleString('en-US') : '未知';
  }

  function smallestTextContainer(predicate, maxLength = 700) {
    const candidates = Array.from(document.querySelectorAll('div, section, article, li, tr, button'));
    let best = '';
    for (const element of candidates) {
      const text = normalize(element.innerText || element.textContent);
      if (!text || text.length > maxLength || !predicate(text)) continue;
      if (!best || text.length < best.length) best = text;
    }
    return best;
  }

  // 读取账房顶部「游戏赠金」余额，不使用总余额或模型可用额度。
  function readGameBonusBalance() {
    const labels = Array.from(document.querySelectorAll('body *'))
      .filter((element) => element.children.length === 0 && normalize(element.textContent) === '游戏赠金');
    let bestLength = Infinity;
    let bestValue = null;
    for (const label of labels) {
      let ancestor = label.parentElement;
      for (let depth = 0; ancestor && depth < 7; depth++, ancestor = ancestor.parentElement) {
        const text = normalize(ancestor.innerText || ancestor.textContent);
        if (!text || text.length > 700) continue;
        const match = /游戏赠金\s*([\d,]+)/.exec(text);
        if (match && text.length < bestLength) {
          bestLength = text.length;
          bestValue = parseAmount(match[1]);
        }
      }
    }
    return bestValue;
  }

  // 读取签到/补给卡片上当前实际展示的加成后金额，例如 160,000，而非基础 20,000。
  function readExpectedReward(target) {
    const text = smallestTextContainer((value) =>
      value.includes(target.name) && value.includes('赠金') && value.includes('只能下注')
    );
    if (!text) return null;
    const position = text.indexOf(target.name);
    const tail = text.slice(position + target.name.length);
    const match = /\s*([\d,]+)\s*赠金/.exec(tail) || /([\d,]+)\s*赠金/.exec(text);
    return match ? parseAmount(match[1]) : null;
  }

  // 只识别账本流水行：必须同时含事由、变动、正向金额、赠金和结余。
  // 签到卡片上的奖励金额不会满足「变动 +金额 / 结余」条件。
  function findLedgerEntries(target) {
    const candidates = [];
    const elements = document.querySelectorAll('div, li, article, section, tr, button');
    for (const element of elements) {
      const text = normalize(element.innerText || element.textContent);
      if (text.length < 12 || text.length > 420) continue;
      if (!text.includes(target.name) || !text.includes('变动') ||
          !text.includes('赠金') || !/变动\s*\+\s*[\d,]+/.test(text) ||
          !/余\s*[\d,]+/.test(text)) continue;
      candidates.push({ element, text });
    }

    // 丢弃同时包含另一个匹配节点的外层容器，保留最接近单条流水的元素。
    const leafMatches = candidates.filter((candidate) =>
      !candidates.some((other) =>
        other.element !== candidate.element && candidate.element.contains(other.element)
      )
    );
    const unique = [];
    for (const candidate of leafMatches) {
      if (!unique.includes(candidate.text)) unique.push(candidate.text);
    }
    return unique.slice(0, 40);
  }

  function findNewLedgerEntry(target, baseline) {
    const counts = new Map();
    for (const value of baseline || []) counts.set(value, (counts.get(value) || 0) + 1);
    const seen = new Map();
    for (const value of findLedgerEntries(target)) {
      const count = (seen.get(value) || 0) + 1;
      seen.set(value, count);
      if (count > (counts.get(value) || 0)) return value;
    }
    return '';
  }

  function inspectClaim(target, pending) {
    const entry = findNewLedgerEntry(target, pending.ledgerBaseline);
    const creditMatch = entry.match(/变动\s*\+\s*([\d,]+)\s*赠金/) ||
      entry.match(/\+\s*([\d,]+)\s*赠金/);
    const credit = creditMatch ? parseAmount(creditMatch[1]) : null;
    const balanceAfter = readGameBonusBalance();
    const balanceDelta = Number.isFinite(pending.balanceBefore) && Number.isFinite(balanceAfter)
      ? balanceAfter - pending.balanceBefore
      : null;
    const newSuccessText = hasNewSuccess(target, pending);

    if (entry && credit > 0) {
      return {
        confirmed: true,
        source: 'ledger',
        entry,
        credit,
        balanceBefore: pending.balanceBefore,
        balanceAfter,
        balanceDelta,
        balanceMatched: balanceDelta === credit,
      };
    }

    // 余额差额单独作为第二条确认路径，但要求同时出现本次新的成功反馈。
    if (newSuccessText && Number.isFinite(pending.expectedReward) &&
        pending.expectedReward > 0 && balanceDelta === pending.expectedReward) {
      return {
        confirmed: true,
        source: 'balance',
        entry: '',
        credit: pending.expectedReward,
        balanceBefore: pending.balanceBefore,
        balanceAfter,
        balanceDelta,
        balanceMatched: true,
      };
    }

    return {
      confirmed: false,
      source: '',
      entry,
      credit,
      balanceBefore: pending.balanceBefore,
      balanceAfter,
      balanceDelta,
      balanceMatched: false,
    };
  }

  function claimAuditMessage(target, result) {
    const amount = formatAmount(result.credit);
    const before = formatAmount(result.balanceBefore);
    const after = formatAmount(result.balanceAfter);
    const delta = Number.isFinite(result.balanceDelta)
      ? (result.balanceDelta >= 0 ? '+' : '-') + formatAmount(result.balanceDelta)
      : '无法读取';
    if (result.source === 'ledger') {
      if (result.balanceMatched) {
        return target.name + '到账已确认：账本新增 +' + amount +
          ' 赠金；游戏赠金余额 ' + before + ' → ' + after + '（差额 +' + amount + '），核对一致。';
      }
      return target.name + '账本已确认到账 +' + amount +
        ' 赠金；游戏赠金余额 ' + before + ' → ' + after + '（差额 ' + delta +
        '），与账本金额不一致。可能存在并发下注/赢回或余额界面延迟，请检查账房。';
    }
    return target.name + '已确认：游戏赠金余额 ' + before + ' → ' + after +
      '（增加 +' + amount + '），且页面出现新的成功反馈；尚未找到对应账本行。';
  }

  function completeClaim(target, pending, result) {
    rememberBucketClaim(target, pending.bucket);
    try {
      sessionStorage.removeItem(failedStorageKey(pending.bucket));
    } catch {
      // Ignore unavailable session storage.
    }
    clearPending(target);
    const message = claimAuditMessage(target, result);
    scheduleNextCycle(target, new Date());
    notify(target.name + '已核验', message);
    renderStatus(message);
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
      const waiting = previous || {
        bucket: currentBucket,
        attempts: 0,
        balanceBefore: null,
        expectedReward: null,
        ledgerBaseline: [],
        successBaseline: [],
      };
      waiting.phase = 'waiting-online';
      writePending(target, waiting);
      renderStatus(target.name + ' 等待网络恢复。');
      return;
    }

    const button = findButton(target);
    if (!isEnabled(button)) {
      if (previous?.attempts > 0) {
        renderStatus(target.name + ' 暂不可重新领取，等待页面状态与账本核验。');
        if (!previous.reloadAt) {
          previous.reloadAt = Date.now();
          previous.phase = 'reload-check';
          writePending(target, previous);
        }
        window.setTimeout(() => recoverPending(target), RELOAD_SETTLE_MS);
      } else {
        clearPending(target);
        renderStatus(target.name + ' 当前不可领取，稍后复查');
        window.setTimeout(() => schedule(target), RETRY_INTERVAL_MS);
      }
      return;
    }

    const attempts = (previous?.attempts || 0) + 1;
    if (attempts > MAX_CLAIM_ATTEMPTS) {
      markExhausted(target, previous, target.name + '连续 ' + MAX_CLAIM_ATTEMPTS +
        ' 次点击后仍没有账本或余额证据，已停止本轮重试；请人工核对，避免重复领取。');
      return;
    }

    const pending = {
      bucket: currentBucket,
      attempts,
      phase: 'awaiting-confirmation',
      clickedAt: Date.now(),
      verifyAt: Date.now() + CLICK_VERIFY_MS,
      balanceBefore: previous && Number.isFinite(previous.balanceBefore)
        ? previous.balanceBefore : readGameBonusBalance(),
      expectedReward: previous && Number.isFinite(previous.expectedReward)
        ? previous.expectedReward : readExpectedReward(target),
      ledgerBaseline: previous?.ledgerBaseline || findLedgerEntries(target),
      successBaseline: previous?.successBaseline || successTexts(target),
      reloadAt: 0,
    };
    if (!writePending(target, pending)) {
      renderStatus('无法保存领取核对状态，本次未点击。');
      return;
    }

    try {
      button.click();
      notify(target.name + '已点击', '等待页面确认并核对游戏赠金余额（第 ' +
        attempts + '/' + MAX_CLAIM_ATTEMPTS + ' 次）。');
    } catch (error) {
      log(target.name + ' 点击异常', error);
    }
    renderStatus(target.name + ' 已点击，核对中；核对期间不会重复点击。');
    window.setTimeout(() => verifyAfterClick(target), Math.max(0, pending.verifyAt - Date.now()));
  }

  function verifyAfterClick(target) {
    if (stopped) return;
    if (hasRiskPrompt()) {
      stop('检测到验证码、登录失效或限流提示。');
      return;
    }

    const pending = readPending(target);
    if (!pending || pending.bucket !== bucket(target, new Date()) ||
        pending.phase !== 'awaiting-confirmation') return;

    pending.phase = 'checking-result';
    writePending(target, pending);
    const result = inspectClaim(target, pending);
    if (result.confirmed) {
      completeClaim(target, pending, result);
      return;
    }

    if (!navigator.onLine) {
      pending.phase = 'waiting-online';
      writePending(target, pending);
      renderStatus(target.name + ' 请求结果尚未确认，等待网络恢复。');
      return;
    }

    // 先刷新读取服务器状态；没有新流水且余额未增加时，才考虑重新点击。
    pending.phase = 'reload-check';
    pending.reloadAt = Date.now();
    writePending(target, pending);
    renderStatus(target.name + ' 尚无到账证据，刷新账房核对服务器状态。');
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

    // 点击后的核对窗口尚未结束：任何 DOM 扫描都不得启动第二次点击或提前恢复。
    if (pending.phase === 'awaiting-confirmation') {
      const remaining = (pending.verifyAt || 0) - Date.now();
      if (remaining > 0) return true;
      verifyAfterClick(target);
      return true;
    }
    if (pending.phase === 'checking-result') {
      // 该阶段只在同步核验期间存在；若页面恢复时遗留，则转入刷新核验。
      pending.phase = 'reload-check';
      pending.reloadAt = pending.reloadAt || Date.now();
      writePending(target, pending);
    }

    if (!navigator.onLine) {
      pending.phase = 'waiting-online';
      writePending(target, pending);
      renderStatus(target.name + ' 等待网络恢复。');
      return true;
    }

    if (pending.phase === 'waiting-online') {
      if (pending.attempts === 0) {
        const button = findButton(target);
        if (isEnabled(button)) {
          startAttempt(target, pending);
        } else {
          // Keep the overdue task pending. The regular scan and online event will retry.
          renderStatus(target.name + ' 网络已恢复，等待领取按钮变为可用。');
        }
        return true;
      }
      pending.phase = 'reload-check';
      pending.reloadAt = Date.now();
      writePending(target, pending);
    }

    if (activeRecovery.has(target.key)) return true;
    activeRecovery.add(target.key);
    const startedAt = pending.reloadAt || Date.now();

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
      if (!navigator.onLine) {
        current.phase = 'waiting-online';
        writePending(target, current);
        activeRecovery.delete(target.key);
        renderStatus(target.name + ' 等待网络恢复。');
        return;
      }

      const result = inspectClaim(target, current);
      if (result.confirmed) {
        activeRecovery.delete(target.key);
        completeClaim(target, current, result);
        return;
      }

      const button = findButton(target);
      if (isEnabled(button)) {
        activeRecovery.delete(target.key);
        startAttempt(target, current);
        return;
      }

      if (Date.now() - startedAt >= RECOVERY_TIMEOUT_MS) {
        activeRecovery.delete(target.key);
        markExhausted(target, current, target.name +
          '刷新后仍没有找到新增账本记录或游戏赠金余额增量，按钮也未恢复可领取；已停止自动重试，请人工核对。');
        return;
      }

      renderStatus(target.name + ' 等待账本、游戏赠金余额或领取按钮状态同步。');
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

  function queueScan(records = []) {
    // 状态面板自身的文本、输入框和样式变化不触发业务扫描。
    const onlyPanelChanges = records.length > 0 && records.every((record) => {
      const node = record.target;
      const element = node && node.nodeType === 1 ? node : node?.parentElement;
      return Boolean(element?.closest?.('#' + STATUS_ID));
    });
    if (onlyPanelChanges) return;

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
