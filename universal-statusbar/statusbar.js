// statusbar.js — 通用状态栏插件主入口
// 遵循 SillyTavern-1.18.0 规范化插件架构
(function() {
  'use strict';

  if (window.__UNIVERSAL_STATUSBAR_LOADED__) return;
  window.__UNIVERSAL_STATUSBAR_LOADED__ = true;

  console.log('[通用状态栏] 插件启动中...');

  const REQUIRED_MODULES = [
    'statusbar-store.js',
    'statusbar-api.js',
    'statusbar-db-bridge.js',
    'statusbar-core.js',
    'statusbar-draw.js',
    'statusbar-investigation.js',
    'statusbar-guidance.js',
    'statusbar-ui.js'
  ];

  const MODULE_CONTRACTS = {
    STATUSBAR_STORE: ['hydrate', 'getSettings', 'saveSettings'],
    STATUSBAR_API: ['getPresets', 'getEffectiveApiForFeature', 'savePreset', 'updatePreset', 'deletePreset'],
    STATUSBAR_DB_BRIDGE: ['init', 'onDatabaseChange', 'getTable', 'getCell'],
    STATUSBAR_CORE: ['getFullSnapshot'],
    STATUSBAR_DRAW: ['fetchModelList', 'generateImage'],
    STATUSBAR_INVESTIGATION: ['openInvestigation', 'openInterview', 'generateInvestigation', 'generateInterview'],
    STATUSBAR_GUIDANCE: ['generateGuidance', 'bindInputButton'],
    STATUSBAR_UI: ['render', 'openModal', 'buildGear']
  };

  /**
   * 自动探测当前扩展的基础加载路径
   */
  function getBaseUrl() {
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src || '';
      if (src.includes('statusbar.js')) {
        return src.substring(0, src.lastIndexOf('/'));
      }
    }
    return './scripts/extensions/third-party/universal-statusbar';
  }

  /**
   * 顺序动态注入脚本模块
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('加载模块失败: ' + src));
      document.head.appendChild(s);
    });
  }

  /**
   * 契约校验
   */
  function validateContracts(contracts) {
    const missing = [];
    for (const [globalName, methods] of Object.entries(contracts)) {
      const target = window[globalName];
      if (!target) {
        missing.push(globalName);
        continue;
      }
      for (const m of methods) {
        if (typeof target[m] !== 'function') {
          missing.push(`${globalName}.${m}()`);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(`通用状态栏契约校验未通过: ${missing.join(', ')}`);
    }
  }

  /**
   * 插件主初始化流程
   */
  async function init() {
    const baseUrl = getBaseUrl();
    try {
      // 0. 强制加载带时间戳的最新样式表，彻底击穿浏览器对 style.css 的强缓存
      const cssId = 'universal-statusbar-fresh-style';
      let cssLink = document.getElementById(cssId);
      if (!cssLink) {
        cssLink = document.createElement('link');
        cssLink.id = cssId;
        cssLink.rel = 'stylesheet';
        cssLink.type = 'text/css';
        document.head.appendChild(cssLink);
      }
      cssLink.href = `${baseUrl}/style.css?t=${Date.now()}`;

      // 1. 动态按序加载各子模块 (加入时间戳防浏览器旧缓存)
      const cacheBust = `?v=${Date.now()}`;
      for (const mod of REQUIRED_MODULES) {
        await loadScript(`${baseUrl}/${mod}${cacheBust}`);
        console.log('[通用状态栏] 已加载模块:', mod);
      }

      // 2. 契约校验
      validateContracts(MODULE_CONTRACTS);

      // 3. 存储层水合灌入镜像 (IndexedDB -> Memory Mirror)
      await window.STATUSBAR_STORE.hydrate();

      // 4. 初始化数据库交互桥梁 (AutoCardUpdater 探测与监听)
      window.STATUSBAR_DB_BRIDGE.init();

      // 5. 注册数据库变动回调：任何表更新均触发状态栏响应式重绘，并自动核验在场角色立绘补全
      window.STATUSBAR_DB_BRIDGE.onDatabaseChange((meta) => {
        window.STATUSBAR_UI.render();
        if (window.STATUSBAR_DRAW?.triggerAutoPortraitUpdate) {
          window.STATUSBAR_DRAW.triggerAutoPortraitUpdate();
        }
      });

      // 6. 构建并挂载 UI 界面与悬浮手柄
      window.STATUSBAR_UI.buildGear();
      window.STATUSBAR_UI.render();
      window.STATUSBAR_GUIDANCE?.bindInputButton?.();

      // 7. 绑定 SillyTavern 事件总线
      bindSillyTavernEvents();

      // 8. 绑定 #chat 守卫 (防止 follow-bottom 模式下切聊天被 clearChat 清理丢失)
      setupChatGuard();

      // 暴露对外调试与操作命名空间
      window.UNIVERSAL_STATUSBAR = {
        refresh: () => {
          window.STATUSBAR_DB_BRIDGE.refreshSnapshot();
          window.STATUSBAR_UI.render();
        },
        openSettings: () => window.STATUSBAR_UI.openModal('settings'),
        openModal: (tab) => window.STATUSBAR_UI.openModal(tab),
        getSnapshot: () => window.STATUSBAR_CORE.getFullSnapshot(),
        triggerAutoPortrait: () => window.STATUSBAR_DRAW?.triggerAutoPortraitUpdate(),
        version: '1.0.0'
      };

      console.log('[通用状态栏] [OK] 初始化完成，已进入实时监听状态');
    } catch (err) {
      console.error('[通用状态栏] 插件启动异常:', err);
    }
  }

  /**
   * 绑定 SillyTavern 标准事件
   */
  function bindSillyTavernEvents() {
    try {
      const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
      if (ctx && ctx.eventSource) {
        const events = ctx.event_types || ctx.eventTypes || {};
        const onChatChange = (reason) => {
          setTimeout(() => {
            try {
              const liveCtx = (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null) || ctx || {};
              const chat = liveCtx.chat || window.chat || [];
              // 如果用户清空了聊天记录 (chat 消息长度为 0)，彻底清空当前会话的头像缓存
              if (!Array.isArray(chat) || chat.length === 0) {
                window.STATUSBAR_STORE?.clearCurrentChatAvatars?.();
              }
            } catch (e) {}

            window.STATUSBAR_DB_BRIDGE.refreshSnapshot();
            window.STATUSBAR_UI.render();
          }, 200);
        };

        const boundEvents = new Set();
        const bindEvent = (evtKey, fn) => {
          const name = events[evtKey] || evtKey.toLowerCase();
          if (!name || boundEvents.has(name)) return;
          boundEvents.add(name);
          ctx.eventSource.on(name, fn);
        };

        // 监听聊天切换、加载、清空与消息删除
        bindEvent('CHAT_CHANGED', () => onChatChange('chat_changed'));
        bindEvent('CHAT_LOADED', () => onChatChange('chat_loaded'));
        bindEvent('CHAT_CLEARED', () => onChatChange('chat_cleared'));
        bindEvent('MESSAGE_DELETED', () => onChatChange('message_deleted'));

        // 核心注入拦截器：单次按需注入次主角（表里有了即固定，绝对不再注入）
        const onPromptReadyInjectDeuteragonist = (eventData) => {
          try {
            const s = window.STATUSBAR_STORE?.getSettings?.() || {};
            if (s.deuteragonistEnabled === false) return;
            if (!eventData || !Array.isArray(eventData.chat)) return;

            // 1. 判定当前请求是否涉及次主角表 (deuteragonist_state / 次主角表)
            const isDeuteragonistFill = eventData.chat.some(m => 
              typeof m.content === 'string' && (
                m.content.includes('deuteragonist_state') || 
                m.content.includes('次主角表') ||
                m.content.includes('sheet_deuteragonist')
              )
            );
            if (!isDeuteragonistFill) return;

            // 2. 检查数据库中次主角是否已经创建（表里有了就不再注入，次要主角是固定的）
            const bridge = window.STATUSBAR_DB_BRIDGE;
            const deutRow = bridge?.getRow?.('次主角表', 1) || 
                            bridge?.getRow?.('sheet_deuteragonist', 1) || 
                            bridge?.getRow?.('deuteragonist_state', 1);

            const isAlreadyCreated = Boolean(
              deutRow && 
              deutRow.name && 
              typeof deutRow.name === 'string' &&
              deutRow.name.trim() !== '' && 
              deutRow.name !== '-' && 
              deutRow.name !== '未交代' &&
              deutRow.name !== '无'
            );

            if (isAlreadyCreated) {
              // 表中已有次主角建档数据，后续轮次由大模型结合剧情持续演化推演，不再重复注入初始化建档指令
              return;
            }

            // 3. 检查上下文是否已经包含了次主要主角设定块
            const alreadyHasInContext = eventData.chat.some(m => 
              typeof m.content === 'string' && (
                m.content.includes('<副主角设定>') || 
                m.content.includes('<次要主角设定>') ||
                m.content.includes('<次主角档案')
              )
            );
            if (alreadyHasInContext) {
              return;
            }

            // 4. 仅在库中未建档且上下文无设定时，执行首次按需注入建档指令
            const promptText = window.STATUSBAR_STORE?.getDeuteragonistPrompt?.() || '';
            if (promptText && promptText.trim()) {
              // 优先在包含 <背景设定> 的消息中注入，否则放在最后一条 user 消息最前部
              const bgMsg = eventData.chat.find(m => typeof m.content === 'string' && m.content.includes('<背景设定>'));
              if (bgMsg) {
                bgMsg.content = bgMsg.content.replace('<背景设定>', `<背景设定>\n${promptText}\n`);
              } else {
                const lastUser = [...eventData.chat].reverse().find(m => m.role === 'user');
                if (lastUser) {
                  lastUser.content = `${promptText}\n\n${lastUser.content}`;
                }
              }
              console.log('[通用状态栏] 次主角表尚未建档，已成功向填表 AI 执行首次按需建档注入！');
            }
          } catch (err) {
            console.warn('[通用状态栏] 注入副主角设定出现异常:', err);
          }
        };

        if (events.CHAT_COMPLETION_PROMPT_READY) {
          ctx.eventSource.on(events.CHAT_COMPLETION_PROMPT_READY, onPromptReadyInjectDeuteragonist);
        }
        ctx.eventSource.on('chat_completion_prompt_ready', onPromptReadyInjectDeuteragonist);

        // 严苛流式状态锁与自动插图调度器 (100% 确保流式彻底结束定格后才开始生图)
        let autoDrawDebounceTimer = null;
        let isAutoDrawingNow = false;
        let isAiGenerating = false;

        // 探测酒馆当前是否仍在流式生成或打字中
        const checkIsStreamingOrGenerating = () => {
          if (isAiGenerating) return true;
          try {
            const doc = window.parent?.document || document;
            const stopBtn = doc.getElementById('mes_stop');
            if (stopBtn && (stopBtn.offsetParent !== null || window.getComputedStyle(stopBtn).display !== 'none')) {
              return true;
            }
          } catch (e) {}
          return false;
        };

        const triggerAutoDrawIfNeeded = (mesId, triggerSource = 'unknown') => {
          const s = window.STATUSBAR_STORE?.getSettings() || {};
          if (!s.autoDrawEnabled) return;

          // 核心铁律：如果仍在流式生成中，绝不生图，仅记录日志并等待完成事件
          if (checkIsStreamingOrGenerating()) {
            console.log(`[通用状态栏] 检测到 AI 仍处于流式生成打字中 (触发源: ${triggerSource})，暂缓自动生图，等待流式彻底结束`);
            return;
          }

          if (autoDrawDebounceTimer) clearTimeout(autoDrawDebounceTimer);
          autoDrawDebounceTimer = setTimeout(async () => {
            // 二次确认：执行前再次核验流式是否已真正结束
            if (checkIsStreamingOrGenerating()) {
              console.log('[通用状态栏] 流式打字尚未结束，取消本次执行');
              return;
            }

            if (isAutoDrawingNow) {
              console.log('[通用状态栏] 当前已有正在执行的正文插图任务，避免并发');
              return;
            }

            try {
              const liveCtx = (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null) || ctx || {};
              const currentChat = liveCtx.chat || window.chat || [];
              if (!Array.isArray(currentChat) || currentChat.length <= 1) {
                console.log(`[通用状态栏] 当前聊天仅有首层开局问候语或为空 (消息数: ${currentChat?.length || 0})，跳过自动正文插图`);
                return;
              }
              
              // 获取最新一条 AI 消息 (优先考虑指定的 mesId)
              let targetMes = null;
              let targetIdx = -1;
              if (mesId !== undefined && mesId !== null && currentChat[mesId]) {
                targetMes = currentChat[mesId];
                targetIdx = mesId;
              } else {
                for (let i = currentChat.length - 1; i >= 0; i--) {
                  if (currentChat[i] && !currentChat[i].is_user) {
                    targetMes = currentChat[i];
                    targetIdx = i;
                    break;
                  }
                }
              }

              if (!targetMes || targetMes.is_user) return;

              // 核心铁律：首层 (0 楼开局问候语) 绝对禁止自动正文插图！
              // 用户明确要求：插图应该只插新回复，严禁在首层绘图
              if (targetIdx <= 0) {
                console.log(`[通用状态栏] 目标消息为首层开局问候语 (楼层 ${targetIdx})，坚决跳过自动正文插图，仅在新回复时生成`);
                return;
              }

              const rawText = targetMes.mes || targetMes.message || '';
              if (!rawText.trim()) return;

              // 如果本条消息已经包含插图 Markdown，则不再重复生成
              if (rawText.includes('![正文插图](') || /!\[[^\]]*\]\([^)]+\)/.test(rawText)) {
                console.log('[通用状态栏] 本条消息已包含插图，跳过自动生成');
                return;
              }

              isAutoDrawingNow = true;
              console.log(`[通用状态栏] 【流式已彻底结束】正式启动自动正文插图 (来源: ${triggerSource}), 楼层: ${targetIdx}, 正文字数: ${rawText.length}`);
              const snapshot = window.STATUSBAR_CORE?.getFullSnapshot() || {};
              const chars = snapshot.characters || [];
              await window.STATUSBAR_DRAW?.generateStoryImages(rawText, chars, {
                mesId: targetIdx,
                autoWriteBack: true
              });
            } catch (err) {
              console.error('[通用状态栏] 自动正文绘图异常:', err);
            } finally {
              isAutoDrawingNow = false;
            }
          }, 600);
        };

        // 角色专属立绘自动更新调度器 (串行防拥堵排队，避让流式与正文插图)
        let autoPortraitDebounceTimer = null;

        const triggerAutoPortraitIfNeeded = (triggerSource = 'unknown') => {
          const s = window.STATUSBAR_STORE?.getSettings() || {};
          if (!s.portraitEnabled || s.portraitAutoUpdateMode === 'off') return;

          // 核心铁律：若 AI 仍在流式生成中，暂缓执行
          if (checkIsStreamingOrGenerating()) {
            console.log(`[通用状态栏立绘] 检测到 AI 仍处于流式生成中 (触发源: ${triggerSource})，暂缓自动立绘更新`);
            return;
          }

          if (autoPortraitDebounceTimer) clearTimeout(autoPortraitDebounceTimer);
          autoPortraitDebounceTimer = setTimeout(async () => {
            if (checkIsStreamingOrGenerating()) {
              console.log('[通用状态栏立绘] 流式打字尚未结束，取消本次立绘更新');
              return;
            }

            // 严防生图 API 冲突：若正文插图正在生成中，轮询等待其完成（最多等待 15 秒）
            let waitRounds = 0;
            while (isAutoDrawingNow && waitRounds < 15) {
              await new Promise(r => setTimeout(r, 1000));
              waitRounds++;
            }

            try {
              console.log(`[通用状态栏立绘] 触发角色专属立绘自动更新调度 (触发源: ${triggerSource})`);
              await window.STATUSBAR_DRAW?.triggerAutoPortraitUpdate();
            } catch (err) {
              console.error('[通用状态栏立绘] 自动立绘更新异常:', err);
            }
          }, 1000);
        };

        // 1. 监听生成开始与流式 Token 接收 -> 强制加锁，禁止任何生图抢跑
        const onGenerationStartLock = () => {
          isAiGenerating = true;
          if (autoDrawDebounceTimer) {
            clearTimeout(autoDrawDebounceTimer);
            autoDrawDebounceTimer = null;
          }
          if (autoPortraitDebounceTimer) {
            clearTimeout(autoPortraitDebounceTimer);
            autoPortraitDebounceTimer = null;
          }
          console.log('[通用状态栏] AI 开始生成/流式输出中，自动插图与立绘更新锁已锁定');
        };

        if (events.GENERATION_STARTED) ctx.eventSource.on(events.GENERATION_STARTED, onGenerationStartLock);
        ctx.eventSource.on('generation_started', onGenerationStartLock);

        if (events.STREAM_TOKEN_RECEIVED) {
          ctx.eventSource.on(events.STREAM_TOKEN_RECEIVED, () => {
            isAiGenerating = true;
          });
        }
        ctx.eventSource.on('stream_token_received', () => {
          isAiGenerating = true;
        });

        // 2. 监听流式生成彻底结束 (GENERATION_ENDED & GENERATION_STOPPED) -> 解锁并触发定格插图与立绘更新
        const onGenerationEndUnlock = (source) => {
          isAiGenerating = false;
          console.log(`[通用状态栏] AI 生成已结束 (${source})，准备检查正文插图与角色立绘`);
          onChatChange('generation_ended');
          triggerAutoDrawIfNeeded(undefined, source);
          triggerAutoPortraitIfNeeded(source);
        };

        bindEvent('GENERATION_ENDED', () => onGenerationEndUnlock('GENERATION_ENDED'));
        bindEvent('GENERATION_STOPPED', () => onGenerationEndUnlock('GENERATION_STOPPED'));

        // 3. 监听 AI 消息完全渲染定格 (CHARACTER_MESSAGE_RENDERED，流式打字完成最后落槌事件)
        bindEvent('CHARACTER_MESSAGE_RENDERED', (mesId) => {
          isAiGenerating = false;
          onChatChange('character_message_rendered');
          if (Number(mesId) > 0) {
            triggerAutoDrawIfNeeded(mesId, 'character_message_rendered');
          } else {
            console.log(`[通用状态栏] 首层开局消息渲染 (mesId: ${mesId})，跳过自动正文插图`);
          }
          triggerAutoPortraitIfNeeded('character_message_rendered');
        });

        // 4. 监听消息接收与更新 (流式中途不触发，仅刷新状态栏)
        bindEvent('MESSAGE_RECEIVED', () => onChatChange('message_received'));
        bindEvent('MESSAGE_UPDATED', () => onChatChange('message_updated'));

        // 监听分支切换与卡片加载
        bindEvent('MESSAGE_SWIPED', () => onChatChange('message_swiped'));
        bindEvent('CHARACTER_PAGE_LOADED', () => onChatChange('char_loaded'));

        console.log('[通用状态栏] [OK] SillyTavern 事件监听绑定成功');
      }
    } catch (e) {
      console.warn('[通用状态栏] 无法订阅 SillyTavern 内部事件总线 (可能运行于独立页面):', e);
    }
  }

  /**
   * 设立 #chat 节点变动观察守卫
   */
  function setupChatGuard() {
    const chat = document.getElementById('chat');
    if (!chat || !window.MutationObserver) return;
    const observer = new MutationObserver(() => {
      const settings = window.STATUSBAR_STORE?.getSettings();
      const pos = settings?.position || 'follow-bottom';
      if (pos === 'follow-bottom') {
        const wrapper = document.getElementById('universal-statusbar-wrapper');
        if (!wrapper || wrapper.parentElement !== chat || chat.lastElementChild !== wrapper) {
          window.STATUSBAR_UI.render();
        }
      }
    });
    observer.observe(chat, { childList: true });
  }


  // 页面就绪后立即启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
