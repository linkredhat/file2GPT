// ==UserScript==
// @name         S喵在线大赌场：签到与整点补给
// @namespace    local.casino-rewards
// @version      0.5.0
// @description  签到助手、低频音频保活及极限跳伞安全线统计
// @match        https://casino.soliumbra.com/wallet*
// @match        https://casino.soliumbra.com/sky*
// @run-at       document-idle
// @grant        GM_notification
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.5.0';
  const MINUTE_MS = 60 * 1000;
  const SCAN_INTERVAL_MS = 20 * 1000;
  const RETRY_INTERVAL_MS = 20 * 1000;
  const CLICK_VERIFY_MS = 8 * 1000;
  const RELOAD_SETTLE_MS = 5 * 1000;
  const RECOVERY_TIMEOUT_MS = 45 * 1000;
  const MAX_CLAIM_ATTEMPTS = 3;
  const STATUS_ID = 'casino-rewards-status';
  const SETTINGS_KEY = 'casino-rewards:settings';
  const PLAN_STORAGE_PREFIX = 'casino-rewards:plan:';
  const KEEPALIVE_STORAGE_KEY = 'casino-rewards:keepalive';
  const SKY_STATS_STORAGE_KEY = 'casino-sky-stats:v1';
  const SKY_STATS_MAX_RECORDS = 5000;
  const SKY_SYNC_INTERVAL_MS = 1500;
  const KEEPALIVE_AUDIO_SAMPLE_RATE = 8000;
  const KEEPALIVE_AUDIO_DURATION_SECONDS = 8;
  const KEEPALIVE_AUDIO_FREQUENCY = 16;
  const KEEPALIVE_AUDIO_AMPLITUDE = 64;
  const KEEPALIVE_AUDIO_REWIND_LEAD_SECONDS = 2;
  const KEEPALIVE_AUDIO_REWIND_TARGET_SECONDS = 0.01;
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
  let keepAliveEnabled = loadKeepAlivePreference();
  let keepAliveAudio = null;
  let keepAliveTransitioning = false;
  let keepAliveAudioSource = '';

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

  function loadKeepAlivePreference() {
    try {
      return localStorage.getItem(KEEPALIVE_STORAGE_KEY) === 'audio';
    } catch {
      return false;
    }
  }

  function saveKeepAlivePreference(enabled) {
    try {
      if (enabled) localStorage.setItem(KEEPALIVE_STORAGE_KEY, 'audio');
      else localStorage.removeItem(KEEPALIVE_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
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
        <div class="keepalive-row">
          <span>后台保活</span>
          <select data-field="keepAlive" aria-label="后台保活模式">
            <option value="off">关闭</option>
            <option value="audio">低频音频</option>
          </select>
          <button type="button" class="keepalive-start" data-action="keepalive-start" hidden>启动</button>
        </div>
        <small class="keepalive-status" data-role="keepalive-status" aria-live="polite"></small>
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
      #${STATUS_ID} .keepalive-row { display:grid; grid-template-columns:72px minmax(0,1fr) auto; align-items:center; gap:6px; }
      #${STATUS_ID} .keepalive-row select { min-width:0; width:100%; height:25px; padding:2px 5px; border:1px solid #666; border-radius:4px; background:#303134; color:#f1f3f4; font:11px system-ui,sans-serif; }
      #${STATUS_ID} .keepalive-start { padding:4px 7px; border:0; border-radius:5px; background:#4b647d; }
      #${STATUS_ID} .keepalive-status { color:#bdc1c6; font-size:10px; }
      #${STATUS_ID} .keepalive-status.error { color:#ffb4ab; }
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
    const keepAliveSelect = panel.querySelector('[data-field="keepAlive"]');
    const keepAliveStart = panel.querySelector('[data-action="keepalive-start"]');
    keepAliveSelect.value = keepAliveEnabled ? 'audio' : 'off';
    keepAliveSelect.addEventListener('change', () => {
      if (keepAliveSelect.value === 'audio') {
        void startKeepAliveAudio(true);
      } else {
        stopKeepAliveAudio();
      }
    });
    keepAliveStart.addEventListener('click', () => {
      void startKeepAliveAudio(true);
    });
    applyCollapsedState(panel);
    updateKeepAliveControls();
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

  function setKeepAliveStatus(message, isError = false) {
    const panel = document.getElementById(STATUS_ID);
    const status = panel?.querySelector('[data-role="keepalive-status"]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function createKeepAliveAudioSource() {
    if (keepAliveAudioSource) return keepAliveAudioSource;

    const sampleCount = KEEPALIVE_AUDIO_SAMPLE_RATE * KEEPALIVE_AUDIO_DURATION_SECONDS;
    const dataLength = sampleCount * 2;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const writeText = (offset, value) => {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, KEEPALIVE_AUDIO_SAMPLE_RATE, true);
    view.setUint32(28, KEEPALIVE_AUDIO_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataLength, true);

    for (let i = 0; i < sampleCount; i++) {
      const phase = 2 * Math.PI * KEEPALIVE_AUDIO_FREQUENCY * i / KEEPALIVE_AUDIO_SAMPLE_RATE;
      view.setInt16(44 + i * 2,
        Math.round(KEEPALIVE_AUDIO_AMPLITUDE * Math.sin(phase)), true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    keepAliveAudioSource = 'data:audio/wav;base64,' + btoa(binary);
    return keepAliveAudioSource;
  }

  function setupKeepAliveMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = 'playing';
      if (typeof MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: '赌场签到后台保活',
          artist: '签到助手',
          album: '低频音频保活',
        });
      }
      navigator.mediaSession.setActionHandler('play', () => {
        void startKeepAliveAudio(true);
      });
      navigator.mediaSession.setActionHandler('pause', () => stopKeepAliveAudio());
      navigator.mediaSession.setActionHandler('stop', () => stopKeepAliveAudio());
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    } catch {
      // Media Session is optional; audio playback itself is the keep-alive mechanism.
    }
  }

  function clearKeepAliveMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
    } catch {
      // Ignore unsupported Media Session operations.
    }
  }

  function updateKeepAliveControls() {
    const panel = document.getElementById(STATUS_ID);
    if (!panel) return;
    const select = panel.querySelector('[data-field="keepAlive"]');
    const startButton = panel.querySelector('[data-action="keepalive-start"]');
    if (!select || !startButton) return;

    const playing = Boolean(keepAliveAudio && !keepAliveAudio.paused && !keepAliveAudio.error);
    select.value = keepAliveEnabled ? 'audio' : 'off';
    select.disabled = keepAliveTransitioning;
    startButton.hidden = !keepAliveEnabled || playing;
    startButton.disabled = keepAliveTransitioning;
    startButton.textContent = '点击启动';
    if (!keepAliveEnabled) {
      setKeepAliveStatus('关闭：后台标签页仍可能被 Edge 休眠。');
    } else if (playing) {
      setKeepAliveStatus('正在播放 16 Hz 低频音频 · 保活已启动。');
    } else {
      setKeepAliveStatus('已启用但音频未播放；请点击「点击启动」。', true);
    }
  }

  function configureKeepAliveAudioLoop(audio) {
    let pending = null;
    audio.loop = false;

    const rewind = () => {
      if (keepAliveAudio !== audio || !keepAliveEnabled || audio.error) return;
      const duration = audio.duration;
      if (!Number.isFinite(duration) ||
          duration <= KEEPALIVE_AUDIO_REWIND_LEAD_SECONDS + KEEPALIVE_AUDIO_REWIND_TARGET_SECONDS) return;

      const threshold = duration - KEEPALIVE_AUDIO_REWIND_LEAD_SECONDS;
      if (pending) {
        if (!audio.paused && !audio.seeking &&
            audio.currentTime > KEEPALIVE_AUDIO_REWIND_TARGET_SECONDS + 0.05 &&
            audio.currentTime < threshold) pending = null;
        return;
      }
      if (!audio.ended && (audio.paused || audio.seeking || audio.currentTime < threshold)) return;

      const attempt = {};
      pending = attempt;
      const failed = () => {
        if (keepAliveAudio !== audio || !keepAliveEnabled || pending !== attempt) return;
        pending = null;
        audio.pause();
        setKeepAliveStatus('低频音频保活中断，请点击「点击启动」恢复。', true);
        updateKeepAliveControls();
      };
      try {
        audio.currentTime = KEEPALIVE_AUDIO_REWIND_TARGET_SECONDS;
        Promise.resolve(audio.play()).catch(failed);
      } catch {
        failed();
      }
    };

    audio.addEventListener('timeupdate', rewind);
    audio.addEventListener('ended', rewind);
    audio.addEventListener('pause', () => { pending = null; });
    audio.addEventListener('error', () => { pending = null; });
  }

  function playKeepAliveMedia(media) {
    const playback = media.play();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = window.setTimeout(() => {
        media.pause();
        const error = new Error('音频在 10 秒内未能启动');
        error.name = 'TimeoutError';
        reject(error);
      }, 10000);
    });
    return Promise.race([playback, deadline]).finally(() => window.clearTimeout(timeout));
  }

  async function startKeepAliveAudio(persist = true) {
    if (keepAliveTransitioning) return false;
    keepAliveTransitioning = true;
    keepAliveEnabled = true;
    if (persist) saveKeepAlivePreference(true);
    updateKeepAliveControls();

    let audio = keepAliveAudio;
    if (!audio) {
      audio = document.createElement('audio');
      audio.src = createKeepAliveAudioSource();
      configureKeepAliveAudioLoop(audio);
      audio.preload = 'auto';
      audio.playsInline = true;
      audio.setAttribute('playsinline', 'true');
      audio.volume = 1;
      audio.controls = false;
      audio.className = 'casino-rewards-keepalive-audio';
      audio.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
      for (const eventName of ['pause', 'error']) {
        audio.addEventListener(eventName, () => {
          if (keepAliveAudio !== audio) return;
          if ('mediaSession' in navigator) {
            try { navigator.mediaSession.playbackState = 'paused'; } catch {}
          }
          if (!keepAliveTransitioning && keepAliveEnabled) {
            setKeepAliveStatus('低频音频保活已中断，请点击「点击启动」恢复。', true);
            updateKeepAliveControls();
          }
        });
      }
      document.body.appendChild(audio);
      keepAliveAudio = audio;
    }

    try {
      if (audio.error) audio.load();
      await playKeepAliveMedia(audio);
      if (audio.paused) throw new Error('Audio remained paused after play()');
      setupKeepAliveMediaSession();
      setKeepAliveStatus('正在播放 16 Hz 低频音频 · 保活已启动。');
      log('低频音频后台保活已启动。');
      return true;
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? '浏览器阻止了自动播放；请点击「点击启动」授权音频。'
        : '音频启动失败：' + String(error?.message || error);
      setKeepAliveStatus(message, true);
      log(message);
      return false;
    } finally {
      keepAliveTransitioning = false;
      updateKeepAliveControls();
    }
  }

  function stopKeepAliveAudio() {
    keepAliveTransitioning = true;
    keepAliveEnabled = false;
    saveKeepAlivePreference(false);

    const audio = keepAliveAudio;
    keepAliveAudio = null;
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio.remove();
      } catch {
        // Ignore teardown errors.
      }
    }
    clearKeepAliveMediaSession();
    keepAliveTransitioning = false;
    setKeepAliveStatus('后台保活已关闭。');
    updateKeepAliveControls();
    log('低频音频后台保活已关闭。');
  }

  function resumeKeepAliveIfNeeded() {
    if (!keepAliveEnabled || keepAliveTransitioning) return;
    if (keepAliveAudio && !keepAliveAudio.paused && !keepAliveAudio.error) return;
    void startKeepAliveAudio(false);
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
      const saved = readPlanned(target);
      const hasFuturePlan = (existing?.plan && existing.plan > now) ||
        (saved?.at && saved.at > now.getTime());
      if (!hasFuturePlan) {
        scheduleNextCycle(target, now);
        renderStatus();
      } else if (!existing?.plan) {
        // Restore the already-persisted next-cycle time after a page reload.
        const restoredTime = new Date(saved.at);
        const record = {
          bucket: bucket(target, restoredTime),
          plan: restoredTime,
          timer: window.setTimeout(() => run(target, { catchUp: true }),
            Math.max(0, restoredTime.getTime() - Date.now())),
        };
        state.set(target.key, record);
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
      if (catchUp && !inWindow(target, now)) {
        scheduleNextCycle(target, now);
        renderStatus(`${target.name} 逾期计划已检查，但页面按钮不可领取；已安排下一轮。`);
      } else {
        clearPlanned(target);
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
        } else if (pending.catchUp && !inWindow(target, now)) {
          clearPending(target);
          scheduleNextCycle(target, now);
          renderStatus(target.name + ' 恢复后按钮仍不可领取，已安排下一轮。');
        } else if (pending.catchUp) {
          // The reward window is still open. Keep waiting for the site UI to become claimable.
          renderStatus(target.name + ' 网络已恢复，等待领取按钮变为可用。');
        } else {
          clearPending(target);
          window.setTimeout(() => schedule(target), RETRY_INTERVAL_MS);
          renderStatus(target.name + ' 网络恢复后暂不可领取，稍后复查。');
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
    resumeKeepAliveIfNeeded();
    if (location.pathname.startsWith('/sky')) {
      log('极限跳伞页面恢复活动，继续核对统计记录。');
      syncSkyStats();
      return;
    }
    if (stopped) return;
    log('页面恢复活动，重新核对签到计划。');
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


  // ---------------- 极限跳伞统计 ----------------
  const SKY_STATS_PANEL_ID = STATUS_ID;
  let skyStatsObserver = null;
  let skyStatsTimer = 0;
  let skyStatsLastSync = 0;
  let skyStatsSyncing = false;

  function defaultSkyStats() {
    return {
      active: false,
      startedAt: 0,
      baselineRound: 0,
      records: [],
      pendingRound: null,
      roundStartedAt: {},
    };
  }

  function loadSkyStats() {
    try {
      const saved = JSON.parse(localStorage.getItem(SKY_STATS_STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return defaultSkyStats();
      return {
        ...defaultSkyStats(),
        ...saved,
        active: Boolean(saved.active),
        records: Array.isArray(saved.records) ? saved.records.slice(-SKY_STATS_MAX_RECORDS) : [],
        roundStartedAt: saved.roundStartedAt && typeof saved.roundStartedAt === 'object'
          ? saved.roundStartedAt : {},
      };
    } catch {
      return defaultSkyStats();
    }
  }

  let skyStats = loadSkyStats();

  function saveSkyStats() {
    try {
      skyStats.records = skyStats.records.slice(-SKY_STATS_MAX_RECORDS);
      const keys = Object.keys(skyStats.roundStartedAt);
      if (keys.length > 100) {
        for (const key of keys.slice(0, keys.length - 100)) delete skyStats.roundStartedAt[key];
      }
      localStorage.setItem(SKY_STATS_STORAGE_KEY, JSON.stringify(skyStats));
      return true;
    } catch (error) {
      log('跳伞统计保存失败', error);
      return false;
    }
  }

  function skyNormalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseSkyNumber(value) {
    const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function skyPageText() {
    return document.body?.innerText || '';
  }

  function readCurrentSkyRoundId() {
    const text = skyPageText();
    const match = text.match(/第\s*([\d,]+)\s*班/);
    return match ? parseSkyNumber(match[1]) : null;
  }

  function readSkyHistoryEntries() {
    const text = skyNormalize(skyPageText());
    const pattern = /第\s*([\d,]+)\s*班\s*[·•]\s*(?:安全线\s*([\d,]+(?:\.\d+)?)\s*米|(机毁))/g;
    const entries = [];
    let match;
    while ((match = pattern.exec(text))) {
      entries.push({
        roundId: parseSkyNumber(match[1]),
        safetyLine: match[2] ? parseSkyNumber(match[2]) : null,
        wreck: Boolean(match[3]),
        raw: match[0],
      });
    }
    return entries.filter(item => Number.isFinite(item.roundId));
  }

  function readSkyTokenBalance() {
    const candidates = Array.from(document.querySelectorAll('button[aria-label*="tokens"], [aria-label*="tokens，余额"]'));
    for (const element of candidates) {
      const source = (element.getAttribute('aria-label') || '') + ' ' +
        (element.innerText || element.textContent || '');
      const match = source.match(/余额\s*([\d,]+)/) || source.match(/([\d,]+)\s*tokens/i);
      if (match) return parseSkyNumber(match[1]);
    }
    return null;
  }

  function readSkyStake() {
    const inputs = Array.from(document.querySelectorAll('input[type="number"]'))
      .filter(element => !element.closest('#' + SKY_STATS_PANEL_ID));
    const labelled = inputs.find(element => {
      const parentText = skyNormalize(element.parentElement?.parentElement?.innerText);
      return /押注|tokens/i.test(parentText);
    });
    const input = labelled || inputs[0];
    return input ? parseSkyNumber(input.value) : null;
  }

  function depthFromElement(element) {
    const attrs = ['data-depth', 'data-altitude', 'aria-label', 'title'];
    for (const name of attrs) {
      const raw = element.getAttribute?.(name);
      if (!raw) continue;
      const match = raw.match(/([\d,]+(?:\.\d+)?)\s*(?:米|m)?/i);
      if (match && /深度|下坠|高度|米|m|data-depth|data-altitude/i.test(name + ' ' + raw)) {
        const value = parseSkyNumber(match[1]);
        if (Number.isFinite(value) && value >= 0 && value <= 10000) return value;
      }
    }
    return null;
  }

  function readCurrentSkyDepth() {
    const selectors = [
      '[data-depth]', '[data-altitude]', '[aria-label*="深度"]',
      '[aria-label*="下坠"]', '[aria-label*="高度"]',
      '[title*="深度"]', '[title*="下坠"]', '[title*="高度"]',
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const value = depthFromElement(element);
        if (Number.isFinite(value)) return value;
      }
    }

    const candidates = Array.from(document.querySelectorAll('body *'))
      .filter(element => element.children.length === 0);
    for (const element of candidates) {
      const text = skyNormalize(element.textContent);
      if (!text || text.length > 100 || !/(深度|下坠|高度|跳伞位置)/.test(text)) continue;
      const match = text.match(/([\d,]+(?:\.\d+)?)\s*(?:米|m)\b/i);
      if (match) {
        const value = parseSkyNumber(match[1]);
        if (Number.isFinite(value) && value >= 0 && value <= 10000) return value;
      }
    }
    return null;
  }

  function latestSkyHistoryRound() {
    return readSkyHistoryEntries().reduce((max, item) => Math.max(max, item.roundId), 0);
  }

  function findSkyRecord(roundId) {
    return skyStats.records.find(item => item.roundId === roundId) || null;
  }

  function beginSkyStats() {
    const now = Date.now();
    if (!skyStats.active) {
      skyStats.active = true;
      skyStats.startedAt = now;
      skyStats.baselineRound = Math.max(skyStats.baselineRound || 0, latestSkyHistoryRound());
      skyStats.roundStartedAt = {};
      const currentRound = readCurrentSkyRoundId();
      if (currentRound) skyStats.roundStartedAt[currentRound] = now;
      saveSkyStats();
    }
    updateSkyStatsPanel();
    syncSkyStats();
    skySetMessage('统计已开始；从当前页面之后新公开的班次开始记录。');
  }

  function stopSkyStats() {
    skyStats.active = false;
    saveSkyStats();
    updateSkyStatsPanel();
    skySetMessage(
      skyStats.pendingRound
        ? '已停止新样本采集；当前班次仍会等待安全线公开并完成结算。'
        : '统计已停止，历史数据已保留。',
      false
    );
  }

  function clearSkyStats() {
    if (!window.confirm('确定清空所有极限跳伞统计数据？此操作不可撤销。')) return;
    const baseline = latestSkyHistoryRound();
    skyStats = defaultSkyStats();
    skyStats.baselineRound = baseline;
    saveSkyStats();
    updateSkyStatsPanel();
    syncSkyStats();
  }

  function exportSkyStats() {
    const header = [
      'round_id', 'timestamp_local', 'safety_line_m', 'wreck',
      'jump_height_m', 'jump_timestamp_local', 'stake_tokens',
      'balance_before', 'balance_after', 'net_profit_tokens',
      'roi_percent', 'source',
    ];
    const rows = skyStats.records.map(item => {
      const roi = Number.isFinite(item.netProfit) && item.stake > 0
        ? (item.netProfit / item.stake * 100).toFixed(4) : '';
      return [
        item.roundId,
        new Date(item.timestamp || item.observedAt || Date.now()).toLocaleString(),
        item.safetyLine ?? '',
        item.wreck ? '1' : '0',
        item.jumpHeight ?? '',
        item.jumpAt ? new Date(item.jumpAt).toLocaleString() : '',
        item.stake ?? '',
        item.balanceBefore ?? '',
        item.balanceAfter ?? '',
        item.netProfit ?? '',
        roi,
        item.source || 'page-history',
      ];
    });
    const csv = [header, ...rows].map(row =>
      row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')
    ).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'skydiving-stats-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function skyRecordsForPeriod() {
    const panel = document.getElementById(SKY_STATS_PANEL_ID);
    const period = panel?.querySelector('[data-field="period"]')?.value || 'all';
    const durations = { hour: 3600000, day: 86400000, week: 604800000 };
    const duration = durations[period];
    const after = Number.isFinite(duration) ? Date.now() - duration : 0;
    return skyStats.records.filter(item => (item.timestamp || item.observedAt || 0) >= after);
  }

  function skyHeightGroups(records) {
    const panel = document.getElementById(SKY_STATS_PANEL_ID);
    const width = Math.max(1, parseSkyNumber(panel?.querySelector('[data-field="bucket"]')?.value) || 50);
    const groups = new Map();
    for (const record of records) {
      if (!Number.isFinite(record.jumpHeight) || !Number.isFinite(record.netProfit) ||
          !Number.isFinite(record.stake) || record.stake <= 0) continue;
      const start = Math.floor(record.jumpHeight / width) * width;
      const key = start + ':' + width;
      if (!groups.has(key)) groups.set(key, {
        start, end: start + width - 1, samples: 0, wins: 0,
        profitSum: 0, roiPerThousandSum: 0,
      });
      const group = groups.get(key);
      group.samples += 1;
      group.profitSum += record.netProfit;
      group.roiPerThousandSum += record.netProfit / record.stake * 1000;
      if (record.netProfit > 0) group.wins += 1;
    }
    return Array.from(groups.values()).map(group => ({
      ...group,
      avgProfit: group.profitSum / group.samples,
      avgPerThousand: group.roiPerThousandSum / group.samples,
      winRate: group.wins / group.samples,
    })).sort((a,b) => b.avgPerThousand - a.avgPerThousand);
  }

  function formatSkySigned(value, suffix = '') {
    if (!Number.isFinite(value)) return '—';
    return (value > 0 ? '+' : '') + value.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    }) + suffix;
  }

  function renderSkyStats() {
    const panel = document.getElementById(SKY_STATS_PANEL_ID);
    if (!panel) return;

    const records = skyRecordsForPeriod();
    const personal = records.filter(item =>
      Number.isFinite(item.jumpHeight) && Number.isFinite(item.netProfit) &&
      Number.isFinite(item.stake) && item.stake > 0
    );
    const groups = skyHeightGroups(records);
    const best = groups[0] || null;
    const avgProfit = personal.length
      ? personal.reduce((sum,item) => sum + item.netProfit,0) / personal.length : null;
    const avgRoi = personal.length
      ? personal.reduce((sum,item) => sum + item.netProfit / item.stake,0) / personal.length * 100
      : null;
    const safetyKnown = records.filter(item => Number.isFinite(item.safetyLine));
    const wrecks = records.filter(item => item.wreck).length;

    const summary = panel.querySelector('[data-role="summary"]');
    summary.innerHTML = '';
    const lines = [
      '已记录班次：' + records.length + ' · 已知安全线：' + safetyKnown.length + ' · 机毁：' + wrecks,
      '个人完整跳伞样本：' + personal.length + '（需同时有跳伞高度和结算余额）',
      best
        ? (best.samples < 3 ? '暂定最高均值' : '样本均值最高') + '：' +
          best.start + '–' + best.end + ' 米 · 平均净收益 ' +
          formatSkySigned(best.avgProfit, ' tokens/回合') + ' · 每千押注 ' +
          formatSkySigned(best.avgPerThousand, ' tokens') + ' · n=' + best.samples
        : '最佳跳伞高度：样本不足，尚无完整的个人收益数据。',
      '全部样本平均净收益：' + formatSkySigned(avgProfit, ' tokens/回合') +
        ' · 平均收益率：' + (Number.isFinite(avgRoi) ? formatSkySigned(avgRoi, '%') : '—'),
    ];
    for (const line of lines) {
      const div = document.createElement('div');
      div.textContent = line;
      summary.appendChild(div);
    }

    const body = panel.querySelector('[data-role="groups"]');
    body.innerHTML = '';
    for (const group of groups.slice(0, 12)) {
      const row = document.createElement('tr');
      const cells = [
        group.start + '–' + group.end + 'm',
        String(group.samples),
        formatSkySigned(group.avgProfit),
        formatSkySigned(group.avgPerThousand),
        (group.winRate * 100).toFixed(1) + '%',
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
    if (!groups.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = '还没有完整的个人跳伞收益样本。';
      row.appendChild(cell);
      body.appendChild(row);
    }

    panel.querySelector('[data-role="record-count"]').textContent =
      '本地保存 ' + skyStats.records.length + ' 条班次记录';
    panel.querySelector('[data-role="stats-state"]').textContent =
      skyStats.active ? '统计中' : '已停止';
  }

  function updateSkyStatsPanel() {
    const panel = document.getElementById(SKY_STATS_PANEL_ID);
    if (!panel) return;
    const start = panel.querySelector('[data-action="start-stats"]');
    const stop = panel.querySelector('[data-action="stop-stats"]');
    start.disabled = skyStats.active;
    stop.disabled = !skyStats.active;
    start.textContent = skyStats.active ? '正在统计' : '开始统计';
    panel.querySelector('[data-role="stats-state"]').textContent =
      skyStats.active ? '统计中' : '已停止';
    renderSkyStats();
    updateKeepAliveControls();
  }

  function skySetMessage(message, error = false) {
    const panel = document.getElementById(SKY_STATS_PANEL_ID);
    const node = panel?.querySelector('[data-role="sky-message"]');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  function buildSkyStatsPanel() {
    let panel = document.getElementById(SKY_STATS_PANEL_ID);
    if (panel) panel.remove();

    panel = document.createElement('section');
    panel.id = SKY_STATS_PANEL_ID;
    panel.dataset.panelVersion = VERSION;
    panel.innerHTML =
      '<div class="sky-head"><strong>极限跳伞统计 <small data-role="stats-state">已停止</small></strong></div>' +
      '<div class="sky-controls">' +
      '<button type="button" data-action="start-stats">开始统计</button>' +
      '<button type="button" data-action="stop-stats">停止统计</button>' +
      '<button type="button" data-action="export">导出 CSV</button>' +
      '<button type="button" data-action="clear">清空</button></div>' +
      '<div class="sky-filters">' +
      '<label>统计时间<select data-field="period">' +
      '<option value="all">全部时间</option><option value="hour">最近 1 小时</option>' +
      '<option value="day" selected>最近 24 小时</option><option value="week">最近 7 天</option>' +
      '</select></label>' +
      '<label>高度分组<select data-field="bucket">' +
      '<option value="10">每 10 米</option><option value="25">每 25 米</option>' +
      '<option value="50" selected>每 50 米</option><option value="100">每 100 米</option>' +
      '</select></label></div>' +
      '<div class="sky-summary" data-role="summary"></div>' +
      '<div class="sky-table-wrap"><table><thead><tr>' +
      '<th>跳伞高度</th><th>样本</th><th>均净收益</th><th>每千押注</th><th>盈利率</th>' +
      '</tr></thead><tbody data-role="groups"></tbody></table></div>' +
      '<div class="sky-manual"><label>手动补录本班跳伞高度（米）' +
      '<input type="number" min="0" max="5000" step="1" data-field="manual-height" placeholder="自动识别失败时填写">' +
      '</label><button type="button" data-action="save-height">补录高度</button></div>' +
      '<div class="sky-message" data-role="sky-message"></div>' +
      '<small data-role="record-count"></small>' +
      '<div class="sky-keepalive"><span>后台保活</span>' +
      '<select data-field="keepAlive" aria-label="后台保活模式">' +
      '<option value="off">关闭</option><option value="audio">低频音频</option></select>' +
      '<button type="button" data-action="keepalive-start" hidden>点击启动</button></div>' +
      '<small class="keepalive-status" data-role="keepalive-status"></small>';

    const style = document.createElement('style');
    style.textContent = [
      '#' + SKY_STATS_PANEL_ID + ' {position:fixed;z-index:2147483646;top:76px;right:12px;width:min(370px,calc(100vw - 24px));max-height:calc(100vh - 94px);overflow:auto;box-sizing:border-box;padding:10px;border:1px solid rgba(255,255,255,.22);border-radius:9px;background:rgba(25,28,34,.96);color:#f1f3f4;box-shadow:0 4px 18px rgba(0,0,0,.38);font:12px/1.45 system-ui,sans-serif;}',
      '#' + SKY_STATS_PANEL_ID + ' * {box-sizing:border-box;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-head {display:flex;justify-content:space-between;margin-bottom:7px;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-head small {color:#9fd3ff;margin-left:6px;}',
      '#' + SKY_STATS_PANEL_ID + ' button {padding:5px 7px;border:1px solid #586273;border-radius:5px;background:#344255;color:#f5f7fa;font:inherit;cursor:pointer;}',
      '#' + SKY_STATS_PANEL_ID + ' button:disabled {opacity:.45;cursor:default;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-controls {display:flex;flex-wrap:wrap;gap:5px;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-filters {display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0;}',
      '#' + SKY_STATS_PANEL_ID + ' label {display:flex;flex-direction:column;gap:3px;color:#d8dee9;}',
      '#' + SKY_STATS_PANEL_ID + ' select, #' + SKY_STATS_PANEL_ID + ' input {min-width:0;width:100%;height:27px;padding:3px 5px;border:1px solid #667085;border-radius:4px;background:#20242b;color:#f1f3f4;font:12px system-ui,sans-serif;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-summary {display:grid;gap:4px;margin:8px 0;color:#e6edf3;overflow-wrap:anywhere;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-table-wrap {overflow:auto;max-height:210px;}',
      '#' + SKY_STATS_PANEL_ID + ' table {width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}',
      '#' + SKY_STATS_PANEL_ID + ' th, #' + SKY_STATS_PANEL_ID + ' td {padding:4px 3px;border-bottom:1px solid #454c56;text-align:right;white-space:nowrap;}',
      '#' + SKY_STATS_PANEL_ID + ' th:first-child, #' + SKY_STATS_PANEL_ID + ' td:first-child {text-align:left;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-manual {display:grid;grid-template-columns:1fr auto;align-items:end;gap:6px;margin-top:8px;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-message {margin-top:6px;color:#b8d7ff;overflow-wrap:anywhere;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-message.error, #' + SKY_STATS_PANEL_ID + ' .keepalive-status.error {color:#ffb4ab;}',
      '#' + SKY_STATS_PANEL_ID + ' small[data-role="record-count"] {display:block;color:#9aa4b2;margin-top:5px;}',
      '#' + SKY_STATS_PANEL_ID + ' .sky-keepalive {display:grid;grid-template-columns:72px 1fr auto;align-items:center;gap:6px;margin-top:9px;}',
      '#' + SKY_STATS_PANEL_ID + ' .keepalive-status {display:block;margin-top:4px;color:#aab4c2;font-size:10px;}',
    ].join('');

    panel.appendChild(style);
    document.body.appendChild(panel);

    panel.querySelector('[data-action="start-stats"]').addEventListener('click', beginSkyStats);
    panel.querySelector('[data-action="stop-stats"]').addEventListener('click', stopSkyStats);
    panel.querySelector('[data-action="export"]').addEventListener('click', exportSkyStats);
    panel.querySelector('[data-action="clear"]').addEventListener('click', clearSkyStats);
    panel.querySelector('[data-field="period"]').addEventListener('change', renderSkyStats);
    panel.querySelector('[data-field="bucket"]').addEventListener('change', renderSkyStats);
    panel.querySelector('[data-action="save-height"]').addEventListener('click', saveManualSkyHeight);

    const keepAliveSelect = panel.querySelector('[data-field="keepAlive"]');
    keepAliveSelect.value = keepAliveEnabled ? 'audio' : 'off';
    keepAliveSelect.addEventListener('change', () => {
      if (keepAliveSelect.value === 'audio') void startKeepAliveAudio(true);
      else stopKeepAliveAudio();
    });
    panel.querySelector('[data-action="keepalive-start"]').addEventListener('click', () => {
      void startKeepAliveAudio(true);
    });

    updateSkyStatsPanel();
    return panel;
  }

  function saveManualSkyHeight() {
    const panel = document.getElementById(SKY_STATS_PANEL_ID);
    const input = panel?.querySelector('[data-field="manual-height"]');
    const value = input ? parseSkyNumber(input.value) : null;
    const pending = skyStats.pendingRound;
    if (!pending || !Number.isFinite(value) || value < 0 || value > 5000) {
      skySetMessage('没有待补录的个人班次，或高度不是 0–5000 米的有效数字。', true);
      return;
    }
    pending.jumpHeight = value;
    pending.jumpAt = pending.jumpAt || Date.now();
    pending.heightSource = 'manual';
    saveSkyStats();
    input.value = '';
    skySetMessage('第 ' + pending.roundId + ' 班已补录跳伞高度：' + value + ' 米。');
    updateSkyStatsPanel();
  }

  function handleSkyGameClick(event) {
    if (!skyStats.active) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#' + SKY_STATS_PANEL_ID)) return;

    const button = target.closest('button, [role="button"], [data-action]');
    if (!button) return;
    const label = skyNormalize([
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
      button.innerText,
      button.textContent,
    ].filter(Boolean).join(' '));
    const now = Date.now();
    const roundId = readCurrentSkyRoundId();
    if (!roundId) return;

    if (/登机/.test(label)) {
      if (skyStats.pendingRound && skyStats.pendingRound.roundId !== roundId) {
        skySetMessage('上一班个人记录尚未结算，暂不覆盖，先等待上一班安全线公开。', true);
        return;
      }
      skyStats.pendingRound = {
        roundId,
        timestamp: now,
        boardedAt: now,
        stake: readSkyStake(),
        balanceBefore: readSkyTokenBalance(),
        balanceAfter: null,
        netProfit: null,
        jumpHeight: null,
        jumpAt: null,
        safetyLine: null,
        wreck: false,
        source: 'observed-click',
      };
      skyStats.roundStartedAt[roundId] = skyStats.roundStartedAt[roundId] || now;
      saveSkyStats();
      skySetMessage('已记录第 ' + roundId + ' 班登机；等待你的开伞操作。');
      return;
    }

    if (/开伞/.test(label)) {
      const pending = skyStats.pendingRound;
      if (!pending || pending.roundId !== roundId) {
        skySetMessage('检测到开伞，但没有本班登机记录。请下一班开始前先开启统计。', true);
        return;
      }
      pending.jumpAt = now;
      pending.jumpHeight = readCurrentSkyDepth();
      pending.heightSource = Number.isFinite(pending.jumpHeight) ? 'dom' : 'unreadable';
      saveSkyStats();
      if (Number.isFinite(pending.jumpHeight)) {
        skySetMessage('第 ' + roundId + ' 班已记录开伞高度：' + pending.jumpHeight + ' 米。');
      } else {
        skySetMessage('已记录第 ' + roundId + ' 班开伞时间，但页面未提供可读深度；请在下方补录高度。', true);
      }
      updateSkyStatsPanel();
    }
  }

  function finalizeSkyPending(balanceAfter) {
    const pending = skyStats.pendingRound;
    if (!pending) return;
    const record = {
      roundId: pending.roundId,
      timestamp: pending.timestamp || pending.boardedAt || Date.now(),
      observedAt: Date.now(),
      safetyLine: pending.safetyLine,
      wreck: Boolean(pending.wreck),
      jumpHeight: pending.jumpHeight,
      jumpAt: pending.jumpAt,
      stake: pending.stake,
      balanceBefore: pending.balanceBefore,
      balanceAfter,
      netProfit: Number.isFinite(pending.balanceBefore) && Number.isFinite(balanceAfter)
        ? balanceAfter - pending.balanceBefore : null,
      source: pending.heightSource === 'manual' ? 'manual-height+balance-delta' :
        pending.jumpHeight != null ? 'dom-height+balance-delta' : 'balance-delta',
    };
    if (!findSkyRecord(record.roundId)) skyStats.records.push(record);
    skyStats.baselineRound = Math.max(skyStats.baselineRound || 0, pending.roundId);
    skyStats.pendingRound = null;
    saveSkyStats();
    skySetMessage(
      '第 ' + record.roundId + ' 班结算：安全线 ' +
      (record.wreck ? '机毁（具体米数未公开）' :
        (Number.isFinite(record.safetyLine) ? record.safetyLine + ' 米' : '未读取')) +
      '；跳伞高度 ' + (Number.isFinite(record.jumpHeight) ? record.jumpHeight + ' 米' : '未记录') +
      '；净收益 ' + formatSkySigned(record.netProfit, ' tokens') + '。',
      !Number.isFinite(record.netProfit)
    );
    updateSkyStatsPanel();
  }

  function syncSkyStats() {
    if (skyStatsSyncing) return;
    const now = Date.now();
    if (now - skyStatsLastSync < 500) return;
    skyStatsLastSync = now;
    skyStatsSyncing = true;

    try {
      const currentRound = readCurrentSkyRoundId();
      if (currentRound && (skyStats.active || skyStats.pendingRound) &&
          !skyStats.roundStartedAt[currentRound]) {
        skyStats.roundStartedAt[currentRound] = now;
        saveSkyStats();
      }

      const history = readSkyHistoryEntries();
      if (skyStats.active) {
        for (const entry of history) {
          if (entry.roundId <= (skyStats.baselineRound || 0) || findSkyRecord(entry.roundId)) continue;

          const pending = skyStats.pendingRound;
          if (pending && pending.roundId === entry.roundId) {
            pending.safetyLine = entry.safetyLine;
            pending.wreck = entry.wreck;
            pending.settlementStartedAt = pending.settlementStartedAt || now;
            pending.lastBalance = null;
            pending.stableBalanceReads = 0;
            saveSkyStats();
          } else {
            skyStats.records.push({
              roundId: entry.roundId,
              timestamp: skyStats.roundStartedAt[entry.roundId] || now,
              observedAt: now,
              safetyLine: entry.safetyLine,
              wreck: entry.wreck,
              jumpHeight: null,
              jumpAt: null,
              stake: null,
              balanceBefore: null,
              balanceAfter: null,
              netProfit: null,
              source: 'public-round-history',
            });
            skyStats.baselineRound = Math.max(skyStats.baselineRound || 0, entry.roundId);
            saveSkyStats();
          }
        }
      }

      const pending = skyStats.pendingRound;
      if (pending && (pending.safetyLine != null || pending.wreck)) {
        const balance = readSkyTokenBalance();
        if (Number.isFinite(balance)) {
          if (pending.lastBalance === balance) {
            pending.stableBalanceReads = (pending.stableBalanceReads || 0) + 1;
          } else {
            pending.lastBalance = balance;
            pending.stableBalanceReads = 0;
          }
          pending.balanceAfter = balance;
        }
        const age = now - (pending.settlementStartedAt || now);
        if (((pending.stableBalanceReads || 0) >= 2 && age >= 2000) || age >= 15000) {
          finalizeSkyPending(Number.isFinite(pending.balanceAfter) ? pending.balanceAfter : null);
        } else {
          saveSkyStats();
        }
      }
      if (skyStats.active) renderSkyStats();
    } finally {
      skyStatsSyncing = false;
    }
  }

  function scheduleSkySync() {
    if (skyStatsTimer) return;
    skyStatsTimer = window.setTimeout(() => {
      skyStatsTimer = 0;
      syncSkyStats();
    }, 350);
  }

  function startSkyStats() {
    if (!document.body) {
      window.setTimeout(startSkyStats, 500);
      return;
    }
    buildSkyStatsPanel();
    document.addEventListener('click', handleSkyGameClick, true);

    skyStatsObserver = new MutationObserver(records => {
      const onlyPanel = records.length > 0 && records.every(record => {
        const node = record.target;
        const element = node?.nodeType === 1 ? node : node?.parentElement;
        return Boolean(element?.closest?.('#' + SKY_STATS_PANEL_ID));
      });
      if (!onlyPanel && skyStats.active) scheduleSkySync();
    });
    skyStatsObserver.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
    });
    window.setInterval(syncSkyStats, SKY_SYNC_INTERVAL_MS);
    window.addEventListener('online', wakePage);
    window.addEventListener('pageshow', wakePage);
    window.addEventListener('focus', wakePage);
    document.addEventListener('resume', wakePage);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') wakePage();
    });

    if (document.wasDiscarded) log('检测到极限跳伞标签页被 Edge 丢弃，恢复本地统计状态。');
    syncSkyStats();
    if (keepAliveEnabled) void startKeepAliveAudio(false);
    else updateKeepAliveControls();
    updateSkyStatsPanel();
    log('极限跳伞统计模块已启动。');
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
    window.addEventListener('focus', wakePage);
    document.addEventListener('resume', wakePage);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') wakePage();
    });
    if (document.wasDiscarded) {
      log('检测到标签页曾被 Edge 丢弃，正在从本地保存的计划恢复。');
    }
    scan();
    if (keepAliveEnabled) {
      // Reloads are not user gestures; autoplay may be blocked and then require a click.
      void startKeepAliveAudio(false);
    } else {
      updateKeepAliveControls();
    }
    log('已启动，按配置排程、核对领取结果并支持低频音频保活。');
  }

  if (location.pathname.startsWith('/sky')) {
    startSkyStats();
  } else {
    start();
  }
})();
