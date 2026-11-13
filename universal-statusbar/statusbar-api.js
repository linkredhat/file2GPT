// statusbar-api.js — 通用状态栏 API 管理器与预设系统
// 支持【酒馆API】/【全局自定义预设】/【按功能独立分配】三种路由模式，
// 并提供直接选择预设、预设增删改查、模型自动拉取、连通性测试与严格的铁律遵循（unset 不传 max_tokens）。
(function() {
  'use strict';

  if (window.STATUSBAR_API) return;

  /**
   * 生成唯一预设 ID
   */
  function generatePresetId() {
    return 'ap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * 获取当前所有保存的预设
   */
  function getPresets() {
    if (!window.STATUSBAR_STORE) return [];
    const s = window.STATUSBAR_STORE.getSettings();
    return Array.isArray(s.customApiPresets) ? s.customApiPresets : [];
  }

  /**
   * 根据 ID 查找指定预设
   */
  function getPresetById(id) {
    if (!id) return null;
    const presets = getPresets();
    return presets.find(p => p.id === id) || null;
  }

  /**
   * 获取当前生效的路由模式
   * @returns {'custom' | 'per-feature'}
   */
  function getApiMode() {
    if (!window.STATUSBAR_STORE) return 'custom';
    const s = window.STATUSBAR_STORE.getSettings();
    return s.apiMode || 'custom';
  }

  /**
   * 获取指定文本 LLM 功能在当前模式下对应的预设 ID
   * 严格隔离铁律：生图 (draw) 属于统一生图 API 独立管理，绝不走文本 LLM 预设系统
   * @param {string} featureName - 'investigation' | 'interview' | 'imagePrompt' | 'portrait' | 'guidance'
   */
  function getEffectivePresetId(featureName) {
    if (!window.STATUSBAR_STORE) return '';
    if (featureName === 'draw') return ''; // 绝不走文本 LLM 预设

    const s = window.STATUSBAR_STORE.getSettings();
    const mode = s.apiMode || 'custom';

    if (mode === 'per-feature') {
      let featurePresetId = '';
      switch (featureName) {
        case 'investigation':
          featurePresetId = s.investigationApiPresetId || '';
          break;
        case 'interview':
          featurePresetId = s.interviewApiPresetId || '';
          break;
        case 'guidance':
          featurePresetId = s.guidanceApiPresetId || '';
          break;
        case 'imagePrompt':
        case 'portrait':
          featurePresetId = s.imagePromptApiPresetId || s.portraitApiPresetId || '';
          break;
        default:
          featurePresetId = s[`${featureName}ApiPresetId`] || '';
          break;
      }
      if (featurePresetId) return featurePresetId;
    }

    // 默认或 per-feature 未单独指定时，统一继承全局生效预设
    return s.activeApiPresetId || '';
  }

  /**
   * 将预设对象转换为 TavernHelper.generateRaw / 请求调用所需的标准参数
   * 严格遵守铁律：unset 字段绝不传递，服务端自主决定！
   */
  function formatPresetToRequestParams(preset) {
    if (!preset) return null;
    const out = {};
    if (preset.url && typeof preset.url === 'string' && preset.url.trim()) {
      out.apiurl = preset.url.trim();
    }
    if (preset.key && typeof preset.key === 'string' && preset.key.trim()) {
      out.key = preset.key.trim();
    }
    if (preset.model && typeof preset.model === 'string' && preset.model.trim()) {
      out.model = preset.model.trim();
    }

    // 高级参数：若为 unset 或未填则严禁传递，保持原汁原味
    if (preset.maxTokens !== 'unset' && preset.maxTokens !== '' && preset.maxTokens != null) {
      const mt = Number(preset.maxTokens);
      if (!isNaN(mt) && mt > 0) out.max_tokens = mt;
    }
    if (preset.temperature !== 'unset' && preset.temperature !== '' && preset.temperature != null) {
      const temp = Number(preset.temperature);
      if (!isNaN(temp)) out.temperature = temp;
    }
    if (preset.topP !== 'unset' && preset.topP !== '' && preset.topP != null) {
      const tp = Number(preset.topP);
      if (!isNaN(tp)) out.top_p = tp;
    }
    if (preset.topK !== 'unset' && preset.topK !== '' && preset.topK != null) {
      const tk = Number(preset.topK);
      if (!isNaN(tk)) out.top_k = tk;
    }
    if (preset.frequencyPenalty !== 'unset' && preset.frequencyPenalty !== '' && preset.frequencyPenalty != null) {
      const fp = Number(preset.frequencyPenalty);
      if (!isNaN(fp)) out.frequency_penalty = fp;
    }
    if (preset.presencePenalty !== 'unset' && preset.presencePenalty !== '' && preset.presencePenalty != null) {
      const pp = Number(preset.presencePenalty);
      if (!isNaN(pp)) out.presence_penalty = pp;
    }

    return out;
  }

  /**
   * 获取指定功能当前生效的 API 配置（核心入口）
   * 生图 (draw) 统一走 STATUSBAR_DRAW 的统一生图 API 独立配置，不走此处预设
   * @param {string} featureName - 功能标识 ('investigation', 'interview', 'imagePrompt', 'portrait', 'guidance' 等)
   * @returns {Object|null} 格式化后的参数对象；若未指定或生图则返回 null
   */
  function getEffectiveApiForFeature(featureName) {
    if (featureName === 'draw') return null; // 绘图不走文本 LLM 预设
    const presetId = getEffectivePresetId(featureName);
    if (!presetId) return null;

    const preset = getPresetById(presetId);
    if (!preset) return null;

    return formatPresetToRequestParams(preset);
  }

  /**
   * 校验指定功能在当前配置下的可用性 (Fail-Fast，严禁伪降级与假兜底)
   * @param {string} featureName
   * @returns {string|null} 错误信息；正常返回 null
   */
  function validateApiForFeature(featureName) {
    if (featureName === 'draw') return null; // 绘图由生图引擎独立校验

    const presetId = getEffectivePresetId(featureName);
    if (!presetId) {
      return '未指定生效的文本 LLM 预设。请前往 设置 → API设置 中选择或添加一个有效预设。';
    }

    const preset = getPresetById(presetId);
    if (!preset) {
      return '当前功能绑定的 API 预设已被删除，请前往 设置 → API设置 重新选择。';
    }

    if (!preset.url || !preset.url.trim()) {
      return `预设「${preset.name}」缺少 API URL 端点，请前往 设置 → API设置 补全。`;
    }

    if (!preset.model || !preset.model.trim()) {
      return `预设「${preset.name}」缺少模型名称 (Model)，请前往 设置 → API设置 补全。`;
    }

    return null;
  }

  /**
   * 保存新预设
   */
  function savePreset(presetData) {
    if (!window.STATUSBAR_STORE) throw new Error('存储层未就绪');
    const s = window.STATUSBAR_STORE.getSettings();
    const presets = Array.isArray(s.customApiPresets) ? [...s.customApiPresets] : [];

    const name = (presetData.name || '').trim() || '未命名预设';
    if (presets.some(p => p.name === name)) {
      throw new Error(`已存在同名预设「${name}」，请换一个名称`);
    }

    const newPreset = {
      id: generatePresetId(),
      name,
      url: (presetData.url || '').trim(),
      key: (presetData.key || '').trim(),
      model: (presetData.model || '').trim(),
      maxTokens: presetData.maxTokens ?? 'unset',
      temperature: presetData.temperature ?? 0.7,
      topP: presetData.topP ?? 0.95,
      topK: presetData.topK ?? 'unset',
      frequencyPenalty: presetData.frequencyPenalty ?? 0,
      presencePenalty: presetData.presencePenalty ?? 0,
      createdAt: Date.now()
    };

    presets.push(newPreset);
    window.STATUSBAR_STORE.saveSettings({ customApiPresets: presets });
    return newPreset;
  }

  /**
   * 更新已有预设
   */
  function updatePreset(id, presetData) {
    if (!window.STATUSBAR_STORE) throw new Error('存储层未就绪');
    const s = window.STATUSBAR_STORE.getSettings();
    const presets = Array.isArray(s.customApiPresets) ? [...s.customApiPresets] : [];
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) throw new Error('未找到指定预设，可能已被删除');

    const updated = {
      ...presets[idx],
      ...presetData,
      id, // 保持 ID 不变
      url: (presetData.url !== undefined ? presetData.url : presets[idx].url || '').trim(),
      key: (presetData.key !== undefined ? presetData.key : presets[idx].key || '').trim(),
      model: (presetData.model !== undefined ? presetData.model : presets[idx].model || '').trim(),
      updatedAt: Date.now()
    };

    presets[idx] = updated;
    window.STATUSBAR_STORE.saveSettings({ customApiPresets: presets });
    return updated;
  }

  /**
   * 删除预设（自动清理所有绑定引用，防止悬空）
   */
  function deletePreset(id) {
    if (!window.STATUSBAR_STORE) return;
    const s = window.STATUSBAR_STORE.getSettings();
    let presets = Array.isArray(s.customApiPresets) ? [...s.customApiPresets] : [];
    presets = presets.filter(p => p.id !== id);

    const patch = { customApiPresets: presets };
    if (s.activeApiPresetId === id) patch.activeApiPresetId = '';
    if (s.investigationApiPresetId === id) patch.investigationApiPresetId = '';
    if (s.interviewApiPresetId === id) patch.interviewApiPresetId = '';
    if (s.imagePromptApiPresetId === id) patch.imagePromptApiPresetId = '';
    if (s.drawApiPresetId === id) patch.drawApiPresetId = '';
    if (s.portraitApiPresetId === id) patch.portraitApiPresetId = '';

    window.STATUSBAR_STORE.saveSettings(patch);
  }

  /**
   * 设置全局激活预设 (custom 模式)
   */
  function setActivePresetId(id) {
    if (!window.STATUSBAR_STORE) return;
    window.STATUSBAR_STORE.saveSettings({ activeApiPresetId: id || '' });
  }

  /**
   * 设置特定功能绑定的预设 (per-feature 模式)
   */
  function setFeaturePresetId(featureKey, presetId) {
    if (!window.STATUSBAR_STORE) return;
    const patch = {};
    if (featureKey === 'imagePrompt' || featureKey === 'portrait') {
      patch.imagePromptApiPresetId = presetId || '';
      patch.portraitApiPresetId = presetId || '';
    } else {
      patch[`${featureKey}ApiPresetId`] = presetId || '';
    }
    window.STATUSBAR_STORE.saveSettings(patch);
  }

  /**
   * 设置 API 路由模式
   */
  function setApiMode(mode) {
    if (!window.STATUSBAR_STORE) return;
    window.STATUSBAR_STORE.saveSettings({ apiMode: mode });
  }

  /**
   * 自动从 API 端点拉取可用模型列表 (直接探测用户指定的端点)
   */
  async function fetchModelList(apiUrl, apiKey) {
    let ep = (apiUrl || '').trim().replace(/\/+$/, '');
    if (!ep) throw new Error('API 端点 URL 不能为空');

    // 清理可能误带的 API 动作后缀
    ep = ep.replace(/\/(?:chat\/completions|completions|models)$/i, '');

    // 原生 Fetch 探测标准 /models 端点
    const candidates = [];
    if (ep.endsWith('/v1')) {
      candidates.push(`${ep}/models`);
      candidates.push(`${ep.slice(0, -3)}/models`);
    } else {
      candidates.push(`${ep}/v1/models`);
      candidates.push(`${ep}/models`);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    let list = [];
    let lastErr = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, { method: 'GET', headers });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          if (data) {
            if (Array.isArray(data.data)) {
              list = data.data.map(m => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
            } else if (Array.isArray(data)) {
              list = data.map(m => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
            } else if (Array.isArray(data.models)) {
              list = data.models.map(m => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
            }
            if (list.length > 0) break;
          }
        } else {
          const errBody = await response.text().catch(() => '');
          lastErr = new Error(`HTTP ${response.status} (${url}): ${errBody.slice(0, 150) || response.statusText}`);
        }
      } catch (e) {
        lastErr = e;
      }
    }

    if (list.length === 0) {
      const reason = lastErr ? (lastErr.message || String(lastErr)) : '未返回有效模型列表';
      throw new Error(`无法从端点获取模型列表: ${reason}。请检查 API 端点 URL、密钥与网络连接。`);
    }

    // 字母排序
    return list.sort((a, b) => a.localeCompare(b));
  }

  /**
   * 测试 API 预设/连接连通性 (直接针对用户配置的端点进行真实连通性测试)
   */
  async function testConnection(config) {
    const start = Date.now();
    const ep = (config.url || config.apiurl || '').trim().replace(/\/+$/, '');
    const key = (config.key || '').trim();
    const model = (config.model || '').trim();

    if (!ep) throw new Error('API 端点 URL 不能为空');
    if (!model) throw new Error('模型名称 (Model) 不能为空，请填写或选取模型');

    // 原生 fetch 发送真实测试请求，严格测试用户输入的端点
    let chatUrl = ep.endsWith('/v1') ? `${ep}/chat/completions` : `${ep}/v1/chat/completions`;
    if (ep.endsWith('/chat/completions')) chatUrl = ep;

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      })
    });

    const duration = Date.now() - start;
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 120) || resp.statusText}`);
    }

    const data = await resp.json().catch(() => ({}));
    const reply = data.choices?.[0]?.message?.content || '连接正常';

    return {
      success: true,
      duration,
      reply,
      model
    };
  }

  /**
   * 获取当前配置的顶层 System 破限提示词
   */
  function getJailbreakPrompt() {
    if (!window.STATUSBAR_STORE) return '';
    const s = window.STATUSBAR_STORE.getSettings();
    if (s.jailbreakEnabled === false) return '';
    return (s.jailbreakSystemPrompt || '').trim();
  }

  /**
   * 为 messages 数组注入 System 破限并进行标准化兼容处理：
   * 1. 首部合并所有 system 消息（破限词 + 初始专家设定），确保首部只有一个规范的 system 消息；
   * 2. 中间与末尾出现的 system 消息（如 Message 4 契约模板）安全转为 user 角色，避免 Claude/第三方中转抛出 400 错误或被代理直接丢弃；
   * 3. 彻底杜绝 API 抛弃格式模板导致的偷工减料与输出错乱。
   */
  function injectJailbreakToMessages(messages) {
    if (!Array.isArray(messages)) return [];
    const list = [...messages];
    const jb = getJailbreakPrompt();
    const systemTexts = [];

    if (jb && jb.trim()) {
      systemTexts.push(jb.trim());
    }

    // 提取开头所有连续的 system 消息并合并
    while (list.length > 0 && list[0].role === 'system') {
      const s = list.shift();
      if (s.content && s.content.trim()) {
        systemTexts.push(s.content.trim());
      }
    }

    const result = [];
    if (systemTexts.length > 0) {
      result.push({ role: 'system', content: systemTexts.join('\n\n') });
    }

    // 处理后续消息：若出现非首部的 system 消息（如 Message 4 的格式契约），安全转为 user 角色
    for (const m of list) {
      if (m.role === 'system') {
        result.push({ role: 'user', content: m.content });
      } else {
        result.push(m);
      }
    }

    return result;
  }

  /**
   * 为单一 prompt 字符串在最顶层注入 System 破限
   */
  function injectJailbreakToText(promptText) {
    const jb = getJailbreakPrompt();
    if (!jb) return promptText || '';
    return `${jb}\n\n${promptText || ''}`.trim();
  }

  /**
   * 为 TavernHelper.generateRaw 的 ordered_prompts 注入顶层 System 破限
   */
  function injectJailbreakToOrderedPrompts(orderedPrompts) {
    const jb = getJailbreakPrompt();
    if (!jb) return Array.isArray(orderedPrompts) ? [...orderedPrompts] : [];
    const list = Array.isArray(orderedPrompts) ? [...orderedPrompts] : [];
    return [{ role: 'system', content: jb }, ...list];
  }

  // 注册全局 API 管理器
  
  /**
   * 核心 LLM 调用驱动 (100% 原生 Fetch 直连自定义 API，绝对禁止调用酒馆主 API)
   * @param {Array<{role: string, content: string}>} messages - 消息列表
   * @param {Object} options - 调用选项 (包含 featureName: 'investigation' | 'interview' | 'imagePrompt' 等)
   * @returns {Promise<string>} 模型生成的文本回复
   */
  async function callLLM(messages, options = {}) {
    const featureName = options.featureName || options.feature || 'investigation';
    let preset = null;

    // 1. 获取对应功能的有效 API 预设
    const s = window.STATUSBAR_STORE ? window.STATUSBAR_STORE.getSettings() : {};
    const mode = s.apiMode || 'custom';

    if (mode === 'per-feature') {
      const presetId = getEffectivePresetId(featureName);
      if (presetId) preset = getPresetById(presetId);
    }

    if (!preset) {
      if (s.activeApiPresetId) {
        preset = getPresetById(s.activeApiPresetId);
      }
    }

    if (!preset) {
      const presets = getPresets();
      if (presets.length > 0) {
        preset = presets[0];
      }
    }

    let endpoint = preset?.url || '';
    let apiKey = preset?.key || '';
    let model = preset?.model || '';

    endpoint = (endpoint || '').trim().replace(/\/+$/, '');
    apiKey = (apiKey || '').trim();
    model = (model || '').trim();

    if (!endpoint) {
      const err = '【通用状态栏】未配置自定义 LLM API 端点！请点击右下角齿轮 -> API设置，添加并选择有效的 API 预设。';
      window.toastr?.error?.(err, 'API 配置缺失');
      throw new Error(err);
    }
    if (!model) {
      const err = '【通用状态栏】未配置自定义 LLM 模型名称！请点击右下角齿轮 -> API设置，填写或选取模型名称。';
      window.toastr?.error?.(err, '模型配置缺失');
      throw new Error(err);
    }

    // 2. 规范化 OpenAI 兼容 URL
    let chatUrl = endpoint;
    if (!chatUrl.endsWith('/chat/completions')) {
      if (chatUrl.endsWith('/v1')) {
        chatUrl = `${chatUrl}/chat/completions`;
      } else {
        chatUrl = `${chatUrl}/v1/chat/completions`;
      }
    }

    // 3. 装配消息并注入顶层独立 System 破限
    const finalMessages = injectJailbreakToMessages(messages);

    // 4. 构建请求体 (严守铁律：unset 绝不传 max_tokens，绝不人为截断)
    const requestBody = {
      model,
      messages: finalMessages,
      stream: false
    };

    if (preset) {
      if (preset.maxTokens !== 'unset' && preset.maxTokens !== '' && preset.maxTokens != null) {
        const mt = Number(preset.maxTokens);
        if (!isNaN(mt) && mt > 0) requestBody.max_tokens = mt;
      }
      if (preset.temperature !== 'unset' && preset.temperature !== '' && preset.temperature != null) {
        const temp = Number(preset.temperature);
        if (!isNaN(temp)) requestBody.temperature = temp;
      }
      if (preset.topP !== 'unset' && preset.topP !== '' && preset.topP != null) {
        const tp = Number(preset.topP);
        if (!isNaN(tp)) requestBody.top_p = tp;
      }
      if (preset.topK !== 'unset' && preset.topK !== '' && preset.topK != null) {
        const tk = Number(preset.topK);
        if (!isNaN(tk)) requestBody.top_k = tk;
      }
      if (preset.frequencyPenalty !== 'unset' && preset.frequencyPenalty !== '' && preset.frequencyPenalty != null) {
        const fp = Number(preset.frequencyPenalty);
        if (!isNaN(fp)) requestBody.frequency_penalty = fp;
      }
      if (preset.presencePenalty !== 'unset' && preset.presencePenalty !== '' && preset.presencePenalty != null) {
        const pp = Number(preset.presencePenalty);
        if (!isNaN(pp)) requestBody.presence_penalty = pp;
      }
    }

    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    console.log(`[通用状态栏 API] 正在向自定义端点发送请求: ${chatUrl} (模型: ${model})`);

    // 5. 发送原生 Fetch 请求
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`LLM API 响应错误 (HTTP ${response.status}): ${errText.slice(0, 300) || response.statusText}`);
    }

    const data = await response.json();
    const replyContent = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
    if (!replyContent) {
      throw new Error('LLM API 响应成功但内容为空');
    }

    return replyContent;
  }

  function isCustomApiConfigured() {
    const s = window.STATUSBAR_STORE ? window.STATUSBAR_STORE.getSettings() : {};
    const presets = getPresets();
    return presets.length > 0 || !!(s.customApiEndpoint || s.llmApiEndpoint);
  }

  window.STATUSBAR_API = {
    callLLM,
    isCustomApiConfigured,
    generatePresetId,
    getPresets,
    getPresetById,
    getApiMode,
    setApiMode,
    getEffectivePresetId,
    getEffectiveApiForFeature,
    validateApiForFeature,
    formatPresetToRequestParams,
    savePreset,
    updatePreset,
    deletePreset,
    setActivePresetId,
    setFeaturePresetId,
    fetchModelList,
    testConnection,
    getJailbreakPrompt,
    injectJailbreakToMessages,
    injectJailbreakToText,
    injectJailbreakToOrderedPrompts
  };
})();
