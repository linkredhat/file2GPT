// 怀孕后续反应：使用酒馆世界书加载事件注入临时蓝灯条目，不保存到用户世界书。
(function () {
  'use strict';

  if (window.STATUSBAR_PREGNANCY) return;

  const WORLD_NAME = '__universal_statusbar_pregnancy_reactions__';
  const OWNER_KEY = 'universalStatusbarPregnancy';
  const LORE_KEYS = ['globalLore', 'characterLore', 'chatLore', 'personaLore'];
  const RULE_CONTENT = `<高危行为与怀孕后续>
【定位与依据】
这是成年角色的背景小机制。读取人物表的怀孕状态 pregnancyStatus、怀孕备注 pregnancyNote、避孕措施 contraception、怀孕风险 pregnancyRisk、怀孕概率 pregnancyProbability，以及剧情时间 currentTime、月经日期 periodDate、当前生理期 periodPhase 和原有人设。中文列名与对应字段指同一份数据。数据库决定已结算的生理事实；本规则决定人物表现。正文不另掷骰、不改变概率或结算结果。

【事后反应】
人物得知发生无套内射、破套等高危行为后，当场即可反应，无须等填表或确认怀孕。结合她是否愿意现在怀孕、具体性格、双方此前约定、现实顾虑与对方事后态度，推演情绪和行动。明确不接受当前怀孕者，可主动咨询紧急避孕、寻找药店、要求协助或自行处理，不必等待玩家提醒。
共同接受风险与违背避孕约定应有不同后果；后者可引出责怪、失望、疏远或重新强调边界。性格传统不等于固定发怒；亲密与高好感也不自动表示接受怀孕。补救不等于原谅，道歉不等于已经补救；询问、准备购买、买到、实际服用分别承接。采取补救后仍按原机制处理结果，不直接判定未孕。

【阶段联动】
未孕：维持普通日常，本轮新发生的风险仍可有事后反应；未孕结算不抹去关系后果。
待定观察：仅推演知情后的担忧、补救与适时检查意向；风险不是受孕事实，不靠高概率指定孕吐，不写事后立即出现受孕症状。
孕早期·未察觉：结合备注孕周和当前场景，可主动引入轻微、个体化的反胃、气味敏感、疲倦等线索，不要求表中事先已有该症状。角色可察觉不适、误认原因或逐渐起疑，但不能直接知道已怀孕；没有症状也成立。
孕早期·已确认：须有剧情中的实际验孕或就医确认。继续承接早期身体变化，按人设与生育意愿表现反应，并自然承接咨询、是否告知和近期安排；不一律喜悦或惊慌。
孕中期·显怀：沿用模板孕13周起的分期，逐步承接体态、衣着和活动习惯变化，已有检查安排可适时出现；显怀不自动让所有人知情。
孕晚期·临产：沿用模板孕28周起的分期，适时表现行动负担、休息与待产安排；标签不等于立刻分娩，不凭状态自动制造阵痛、破水或生产。
产后哺乳：仅在既有记录或剧情已确定分娩后承接恢复、哺乳与照护对生活的影响，不自动展开长期育儿主线。
以上阶段的具体表现按孕周、个体及实际场景选择，不把候选症状写成必选清单。

【自然出现与控制篇幅】
相关人物出场、剧情时间有意义地推进或跨阶段、日常情境适合出现变化、已有后续安排需要承接时，自主判断是否增加一个新细节，无须等待玩家询问怀孕。早餐气味、通勤、试衣、工作休息等普通场景可以承载线索。通常用一个动作、几句对话或一处习惯变化体现，然后继续原剧情；没有新变化时不重复担忧、责怪或孕吐，不轮流给所有相关人物安排症状。
数据库的受孕事实、孕周与骰值属于作者资料，不等于人物认知。只呈现当前视角能观察或得知的内容，不直接用旁白揭穿未察觉的怀孕，也不替玩家解释伏笔、强行回忆或作决定。人物可以逐步从不适走向怀疑，再通过实际检查确认；告知谁以实际交流为准。
离场人物沿用已有离场活动与召回规则，不瞬移到主场景；主角须通过见面、消息等合理途径得知变化。只有剧情自然发展或玩家继续追问时才适当展开重大后续。
</高危行为与怀孕后续>`;

  let boundSource = null;
  let boundEvent = null;
  let extensionName = '';

  function getContext() {
    return window.SillyTavern?.getContext?.() || {};
  }

  function getExtensionName(baseUrl) {
    try {
      const path = decodeURIComponent(new URL(baseUrl, window.location.href).pathname);
      const relative = path.split('/scripts/extensions/')[1];
      if (!relative) return '';
      const parts = relative.split('/').filter(Boolean);
      return parts.slice(0, parts[0] === 'third-party' ? 2 : 1).join('/');
    } catch (err) {
      return '';
    }
  }

  function isEnabled() {
    const ctx = getContext();
    const settings = ctx.extensionSettings || ctx.extension_settings || window.extension_settings;
    if (extensionName && settings?.disabledExtensions?.includes(extensionName)) return false;
    return window.STATUSBAR_STORE?.getSettings?.().pregnancyReactionsEnabled !== false;
  }

  function removeManagedEntries(payload) {
    for (const key of LORE_KEYS) {
      const entries = payload?.[key];
      if (!Array.isArray(entries)) continue;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry?.world === WORLD_NAME && entry?.extensions?.[OWNER_KEY] === true) {
          entries.splice(i, 1);
        }
      }
    }
  }

  function createEntry() {
    return {
      uid: 0,
      world: WORLD_NAME,
      comment: '通用状态栏：高危行为与怀孕后续',
      content: RULE_CONTENT,
      key: [],
      keysecondary: [],
      constant: true,
      selective: false,
      disable: false,
      addMemo: true,
      // 规则放在常规条目之后扫描，避免挤掉已有设定；自身不因世界书预算而丢失。
      order: 0,
      position: 0,
      ignoreBudget: true,
      probability: 100,
      useProbability: true,
      excludeRecursion: true,
      preventRecursion: true,
      delayUntilRecursion: false,
      vectorized: false,
      group: '',
      sticky: 0,
      cooldown: 0,
      delay: 0,
      triggers: [],
      extensions: { [OWNER_KEY]: true },
    };
  }

  function onWorldInfoLoaded(payload) {
    // 同一份候选集合再次处理时也只保留一条；只清理带本模块标记的条目。
    removeManagedEntries(payload);
    if (!isEnabled() || !Array.isArray(payload?.globalLore)) return;
    payload.globalLore.push(createEntry());
  }

  function dispose() {
    if (boundSource && boundEvent) {
      if (typeof boundSource.removeListener === 'function') {
        boundSource.removeListener(boundEvent, onWorldInfoLoaded);
      } else {
        boundSource.off?.(boundEvent, onWorldInfoLoaded);
      }
    }
    boundSource = null;
    boundEvent = null;
  }

  function init(baseUrl = '') {
    extensionName = getExtensionName(baseUrl);
    const ctx = getContext();
    const source = ctx.eventSource;
    const event = (ctx.eventTypes || ctx.event_types)?.WORLDINFO_ENTRIES_LOADED;
    if (source && source === boundSource && event === boundEvent) return true;
    dispose();
    if (!source || typeof source.on !== 'function' || !event) {
      console.warn('[怀孕后续反应] 当前酒馆未提供世界书加载事件，未注入规则。');
      return false;
    }
    source.on(event, onWorldInfoLoaded);
    boundSource = source;
    boundEvent = event;
    return true;
  }

  function setEnabled(enabled) {
    window.STATUSBAR_STORE.saveSettings({ pregnancyReactionsEnabled: Boolean(enabled) });
  }

  window.STATUSBAR_PREGNANCY = {
    init,
    dispose,
    setEnabled,
    getRuleContent: () => RULE_CONTENT,
    getStatus: () => ({ ready: Boolean(boundSource), enabled: isEnabled() }),
  };
})();
