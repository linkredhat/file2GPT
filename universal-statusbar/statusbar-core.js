// statusbar-core.js — 状态栏核心数据适配与业务聚合层
// 将 12 张核心数据库表转化为面向 UI 呈现的高内聚领域状态模型（纯净无 emoji，沉浸式视觉）
(function () {
  'use strict';

  if (window.STATUSBAR_CORE) return;

  const db = () => window.STATUSBAR_DB_BRIDGE;
  const store = () => window.STATUSBAR_STORE;

  /**
   * 提取环境时空状态（全局数据表）
   * 模板标准列：当前详细地点, 上轮场景时间, 经过的时间, 当前时间, 是否色色, 天气, 温度, 隐私等级, 被注视情况, 在场角色
   */
  function getEnvironmentState() {
    const bridge = db();
    const time = bridge?.getCell('全局数据表', 1, '当前时间') || '';
    const location = bridge?.getCell('全局数据表', 1, '当前详细地点') || '';
    const weather = bridge?.getCell('全局数据表', 1, '天气') || '';
    const temperature = bridge?.getCell('全局数据表', 1, '温度') || '';
    const privacyLevel = bridge?.getCell('全局数据表', 1, '隐私等级') || '';
    const watchedStatus = bridge?.getCell('全局数据表', 1, '被注视情况') || '';
    const timePassed = bridge?.getCell('全局数据表', 1, '经过的时间') || '';
    const presentCharsRaw = bridge?.getCell('全局数据表', 1, '在场角色') || '';
    const prevPlotTime = bridge?.getCell('全局数据表', 1, '上轮场景时间') || '';
    const nsfwRaw = bridge?.getCell('全局数据表', 1, '是否色色') || '';
    const isNsfwActive = String(nsfwRaw ?? '').trim() === '是';

    return {
      time,
      location,
      weather,
      temperature,
      privacyLevel,
      safetyLevel: watchedStatus,
      watchedStatus,
      timePassed,
      presentCharsRaw,
      prevPlotTime,
      isNsfwActive
    };
  }

  /**
   * 提取主角状态（主角信息表 · 完整 66 列 · 杜绝一切主观硬编码兜底）
   */
  function getProtagonistState() {
    const bridge = db();
    const pTable = bridge?.getTable('主角信息表');

    // 1. 核心身份与外貌
    let name = bridge?.getCell('主角信息表', 1, '姓名') || '';
    const gender = bridge?.getCell('主角信息表', 1, '性别') || '';
    const age = bridge?.getCell('主角信息表', 1, '年龄') || '';
    const appearance = bridge?.getCell('主角信息表', 1, '外貌特征') || '';
    const identity = bridge?.getCell('主角信息表', 1, '身份背景') || '';
    const condition = bridge?.getCell('主角信息表', 1, '近况') || '';
    const temperament = bridge?.getCell('主角信息表', 1, '气质') || '';

    // 2. 体格体态与居所不动产
    const height = bridge?.getCell('主角信息表', 1, '身高') || '';
    const weight = bridge?.getCell('主角信息表', 1, '体重') || '';
    const figure = bridge?.getCell('主角信息表', 1, '身材') || '';
    const vehicle = bridge?.getCell('主角信息表', 1, '座驾') || '';
    const pastAddress = bridge?.getCell('主角信息表', 1, '历史住址') || '';
    const houseType = bridge?.getCell('主角信息表', 1, '房屋属性') || '';
    const cohabitants = bridge?.getCell('主角信息表', 1, '同住人') || '';
    const addressLocation = bridge?.getCell('主角信息表', 1, '地理位置') || '';
    const houseInside = bridge?.getCell('主角信息表', 1, '房屋内部') || '';
    const ownBedroom = bridge?.getCell('主角信息表', 1, '自己卧室') || '';

    // 3. 通用身心状态
    const mood = bridge?.getCell('主角信息表', 1, '情绪') || '';
    const exposure = bridge?.getCell('主角信息表', 1, '暴露状态') || '';
    const wetStatus = bridge?.getCell('主角信息表', 1, '湿透情况') || '';
    const arousal = bridge?.getCell('主角信息表', 1, '兴奋度') || '';
    const consciousness = bridge?.getCell('主角信息表', 1, '意识状态') || '';
    const fetishes = bridge?.getCell('主角信息表', 1, '性癖') || '';
    const bodyStatus = bridge?.getCell('主角信息表', 1, '身体状态') || '';

    // 4. 后穴体系
    const anusWidth = bridge?.getCell('主角信息表', 1, '后穴宽度') || '';
    const anusDepth = bridge?.getCell('主角信息表', 1, '后穴深度') || '';
    const anusDev = bridge?.getCell('主角信息表', 1, '后穴开发度') || '';

    // 5. 男性特有生理指标 (真实提取，绝不强行加默认值)
    const dickLength = bridge?.getCell('主角信息表', 1, '肉棒长度') || '';
    const dickDiameter = bridge?.getCell('主角信息表', 1, '肉棒直径') || '';
    const dickStatus = bridge?.getCell('主角信息表', 1, '肉棒状态') || '';
    const dickExposed = bridge?.getCell('主角信息表', 1, '是否外露') || '';

    // 6. 女性特有生理与受孕系统 (真实提取，绝不强行加默认值)
    const fluidAmount = bridge?.getCell('主角信息表', 1, '爱液量') || '';
    const nipples = bridge?.getCell('主角信息表', 1, '乳头') || '';
    const clitoris = bridge?.getCell('主角信息表', 1, '阴蒂') || '';
    const pussyWidth = bridge?.getCell('主角信息表', 1, '小穴宽度') || '';
    const pussyDepth = bridge?.getCell('主角信息表', 1, '小穴深度') || '';
    const pussyHymen = bridge?.getCell('主角信息表', 1, '处女膜') || '';
    const uterus = bridge?.getCell('主角信息表', 1, '子宫') || '';
    const squirtCount = bridge?.getCell('主角信息表', 1, '潮吹') || '';
    const periodDate = bridge?.getCell('主角信息表', 1, '月经日期') || '';
    const periodPhase = bridge?.getCell('主角信息表', 1, '当前生理期') || '';
    const pregnantStatus = bridge?.getCell('主角信息表', 1, '怀孕状态') || '';
    const pregnantNote = bridge?.getCell('主角信息表', 1, '怀孕备注') || '';
    const pregRisk = bridge?.getCell('主角信息表', 1, '怀孕风险') || '';
    const pregProbability = bridge?.getCell('主角信息表', 1, '怀孕概率') || '';

    // 7. 当前着装与脱下服装
    const top = bridge?.getCell('主角信息表', 1, '上装') || '';
    const bottom = bridge?.getCell('主角信息表', 1, '下装') || '';
    const bra = bridge?.getCell('主角信息表', 1, '内衣') || '';
    const panties = bridge?.getCell('主角信息表', 1, '内裤') || '';
    const legs = bridge?.getCell('主角信息表', 1, '腿部') || '';
    const shoes = bridge?.getCell('主角信息表', 1, '鞋子') || '';
    const accessories = bridge?.getCell('主角信息表', 1, '配饰') || '';
    const sexToys = bridge?.getCell('主角信息表', 1, '情趣道具') || '';

    const takenTop = bridge?.getCell('主角信息表', 1, '脱下上装') || '';
    const takenBottom = bridge?.getCell('主角信息表', 1, '脱下下装') || '';
    const takenBra = bridge?.getCell('主角信息表', 1, '脱下内衣') || '';
    const takenPanties = bridge?.getCell('主角信息表', 1, '脱下内裤') || '';
    const takenSocks = bridge?.getCell('主角信息表', 1, '脱下鞋袜') || '';
    const takenAccessories = bridge?.getCell('主角信息表', 1, '脱下配饰') || '';

    // 8. 随身资产与通讯工具
    const bankBalance = bridge?.getCell('主角信息表', 1, '银行卡余额') || '';
    const ewalletBalance = bridge?.getCell('主角信息表', 1, '微信支付宝余额') || '';
    const cash = bridge?.getCell('主角信息表', 1, '现金') || '';
    const phone1 = bridge?.getCell('主角信息表', 1, '随身手机1') || '';
    const phone2 = bridge?.getCell('主角信息表', 1, '随身手机2') || '';
    const phone = phone1 || phone2;
    const tempItems = bridge?.getCell('主角信息表', 1, '临时物品') || '';

    const raw = {};
    if (pTable && Array.isArray(pTable.content) && pTable.content.length > 1) {
      const headers = pTable.content[0] || [];
      const row = pTable.content[1] || [];
      headers.forEach((col, idx) => {
        raw[col] = row[idx] ?? '';
      });
    }

    const numBank = parseInt(String(bankBalance).replace(/[^0-9.-]/g, ''), 10) || 0;
    const numEwallet = parseInt(String(ewalletBalance).replace(/[^0-9.-]/g, ''), 10) || 0;
    const numCash = parseInt(String(cash).replace(/[^0-9.-]/g, ''), 10) || 0;
    const totalCash = numBank + numEwallet + numCash;

    const hasDick = dickLength && dickLength !== '-' && dickLength !== '无' && dickLength !== '0';
    const hasPussy = (pussyWidth && pussyWidth !== '-' && pussyWidth !== '无') || (fluidAmount && fluidAmount !== '-' && fluidAmount !== '无') || (pussyHymen && pussyHymen !== '-' && pussyHymen !== '无');
    const hasPeriod = periodPhase && periodPhase !== '-' && periodPhase !== '无';
    const hasPregnancy = pregnantStatus && pregnantStatus !== '-' && pregnantStatus !== '否' && pregnantStatus !== '无';

    return {
      name,
      gender,
      age,
      identity,
      condition,
      appearance,
      temperament,
      height,
      weight,
      figure,
      vehicle,
      pastAddress,
      houseType,
      cohabitants,
      addressLocation,
      houseInside,
      ownBedroom,
      mood,
      exposure,
      wetStatus,
      arousal,
      consciousness,
      fetishes,
      bodyStatus,
      anusWidth,
      anusDepth,
      anusDev,
      dickLength,
      dickDiameter,
      dickStatus,
      dickExposed,
      fluidAmount,
      nipples,
      clitoris,
      pussyWidth,
      pussyDepth,
      pussyHymen,
      uterus,
      squirtCount,
      periodDate,
      periodPhase,
      pregnantStatus,
      pregnantNote,
      pregRisk,
      pregProbability,
      hasDick,
      hasPussy,
      hasPeriod,
      hasPregnancy,
      top,
      bottom,
      bra,
      panties,
      legs,
      shoes,
      accessories,
      sexToys,
      takenTop,
      takenBottom,
      takenBra,
      takenPanties,
      takenSocks,
      takenAccessories,
      bankBalance,
      ewalletBalance,
      cash,
      totalCash,
      phone1,
      phone2,
      phone,
      tempItems,
      raw
    };
  }

  /**
   * 将单行角色数据映射为全量 45 列对象 (角色信息表)
   */
  function mapFullCharacterRow(r, i) {
    const rawP = r['是否在场'];
    const isPresent = String(rawP ?? '').trim() === '1';
    const outfitParts = [r['上装'], r['下装']].filter(Boolean);
    const outfit = outfitParts.join(' / ');

    return {
      _sourceTable: '角色信息表',
      _rowIndex: r._rowIndex || (i + 1),
      rowId: r['row_id'] || (i + 1),
      name: String(r['姓名'] || '').trim(),
      charType: r['角色类型'] || '',
      isPresent: isPresent,
      gender: r['性别'] || '',
      age: r['年龄'] || '',
      intro: r['一句话介绍'] || '',
      appearance: r['外貌特征'] || '',
      identity: r['身份背景'] || '',
      speechStyle: r['语言风格和口癖'] || '',

      // 心理与偏移
      favor: r['好感'] || '',
      affection: r['好感'] || '',
      attitude: r['对主角态度'] || '',
      shift: r['近期心境与性格偏移'] || '',
      innerThought: r['内心想法'] || '',

      // 关系与里程碑
      milestones: r['里程碑事件'] || '',
      relationState: r['人际关系'] || '',
      pastExperience: r['过往经历'] || '',
      personalAffairs: r['个人事务'] || '',
      recentInteractions: r['最近亲密互动'] || '',

      // 状态与在场
      status: r['当前状态'] || '',
      location: r['所在位置'] || '',
      exposure: r['暴露状态'] || '',
      arousal: r['即时生理唤起'] || '',
      bodyMarks: r['身体痕迹'] || '',

      // 衣着 6 部位与道具
      top: r['上装'] || '',
      bottom: r['下装'] || '',
      bra: r['内衣'] || '',
      panties: r['内裤'] || '',
      shoesSocks: r['鞋袜'] || '',
      accessories: r['配饰'] || '',
      sexToys: r['情趣道具'] || '',
      outfit: outfit,
      underwear: [r['内衣'], r['内裤']].filter(Boolean).join(' / '),

      // 财产与住所
      residence: r['住所'] || '',
      money: r['金钱'] || '',
      playerGiftItems: r['主角赠送物品'] || '',
      carryItems: r['随身物品'] || '',
      tempItems: r['临时物品'] || '',

      // NSFW身体基线与性档案
      fetishes: r['性癖'] || '',
      measurements: r['三围罩杯'] || '',
      bodyNsfwBaseline: r['隐私身体基线'] || '',
      eroticMindset: r['性经验与防线'] || '',
      bedStyle: r['床上风格与称呼'] || '',
      trainingValue: r['调教值'] || '',
      sexCount: r['性爱次数'] || '',
      periodCycle: r['生理周期'] || '',
      pregnancyStatus: r['生育避孕状态'] || '',

      // 提取属于该角色的恋爱日记（恋爱日记）
      diaries: (function () {
        const charName = (r['姓名'] || '').trim();
        const allDiaries = getAllRomanceDiaries();
        return allDiaries.filter(d => {
          const w = d.writer;
          return w && (w === charName || charName.includes(w) || w.includes(charName));
        });
      })(),
      raw: r
    };
  }

  /**
   * 提取所有角色列表
   */
  function getAllCharactersState() {
    const bridge = db();
    const allChars = bridge?.getAllRows('角色信息表') || [];
    return allChars.map(mapFullCharacterRow);
  }

  /**
   * 提取在场角色列表（角色信息表 characters, 是否在场 = 1）
   */
  function getPresentCharactersState() {
    const all = getAllCharactersState();
    return all.filter(c => c.isPresent);
  }

  /**
   * 提取离场角色列表（角色信息表 characters, 是否在场 = 0）
   */
  function getOffscreenCharactersState() {
    const all = getAllCharactersState();
    return all.filter(c => !c.isPresent);
  }

  /**
   * 提取随身物品（物品表 · 严格 5 列）
   * 标准列：row_id, 物品名称, 类型, 数量, 描述
   */
  function getInventoryState() {
    const bridge = db();
    const rows = bridge?.getAllRows('物品表') || [];
    return rows.map((r, i) => ({
      _rowIndex: r._rowIndex || (i + 1),
      name: String(r['物品名称'] || '').trim(),
      type: r['类型'] || '',
      quantity: r['数量'] || '',
      description: r['描述'] || ''
    }));
  }

  /**
   * 提取任务驱动栏（瑟瑟任务表 · 严格 6 列）
   * 标准列：row_id, 任务名称, 任务描述, 任务目标, 完成情况, 任务类别
   */
  function getTasksState() {
    const bridge = db();
    const rows = bridge?.getAllRows('瑟瑟任务表') || [];
    return rows.map((r, i) => {
      const obj = r['任务目标'] || '';
      const progMatch = obj.match(/[（(]([^）)]+)[）)]\s*$/);
      const cleanObjective = progMatch ? obj.replace(/[（(][^）)]+[）)]\s*$/, '').trim() : obj;
      const progressHint = progMatch ? progMatch[1] : '';

      return {
        _rowIndex: r._rowIndex || (i + 1),
        type: r['任务类别'] || '',
        title: String(r['任务名称'] || '').trim(),
        desc: r['任务描述'] || '',
        objective: cleanObjective || obj,
        fullObjective: obj,
        progress: progressHint || (r['完成情况'] === '已完成' ? '已达成' : (r['完成情况'] || '')),
        status: r['完成情况'] || ''
      };
    });
  }

  /**
   * 提取备忘与日程清单（备忘录 · 严格 9 列）
   * 标准列：row_id, 备忘标题, 类型, 相关角色, 详细内容, 当前状态, 记录时间, 约定时间, 后续结果
   */
  function getMemoState() {
    const bridge = db();
    const rows = bridge?.getAllRows('备忘录') || [];
    return rows.map((r, i) => ({
      _rowIndex: r._rowIndex || (i + 1),
      title: String(r['备忘标题'] || '').trim(),
      type: r['类型'] || '',
      character: r['相关角色'] || '',
      appointedTime: r['约定时间'] || '',
      recordTime: r['记录时间'] || '',
      detail: r['详细内容'] || '',
      result: r['后续结果'] || '',
      status: r['当前状态'] || ''
    }));
  }

  /**
   * 提取世界全景看板（世界 · 严格 7 列）
   * 标准列：row_id, 世界大势与总览, 核心推进事项, 风声流言, 势力格局与阵营态势, 外部敌对与危机应对, 突发异动与倒计时
   */
  function getWorldState() {
    const bridge = db();
    const row = bridge?.getRow('世界', 1) || {};
    return {
      worldDigest: row['世界大势与总览'] || '',
      eventChains: row['核心推进事项'] || '',
      windsRumors: row['风声流言'] || '',
      factionsState: row['势力格局与阵营态势'] || '',
      hostileConflicts: row['外部敌对与危机应对'] || '',
      regionalIncident: row['突发异动与倒计时'] || ''
    };
  }

  /**
   * 提取次主角高精人设与动态剧情线（次主角表 · 严格 24 列全景架构）
   */
  function getDeuteragonistState() {
    const bridge = db();
    const row = bridge?.getRow('次主角表', 1) || {};
    return {
      rowId: row.row_id || 1,
      name: row['姓名'] || '',
      gender: row['性别'] || '',
      age: row['年龄'] || '',
      identity: row['身份背景与职业'] || '',
      appellations: row['称谓系统'] || '',
      personality: row['性格特质'] || '',
      appearance: row['精细面貌'] || '',
      measurements: row['身体数据'] || '',
      voiceScent: row['声音与气味'] || '',
      clothing: row['服装风格与着装'] || '',
      interactionHabit: row['交互模式与习惯'] || '',
      uniqueMarksItems: row['独特标记与随身物品'] || '',
      socialRelations: row['人际关系网络'] || '',
      nsfwProfile: row['NSFW私密档案'] || '',
      chronicleResume: row['生平履历时间线'] || '',
      otherNotes: row['其他备注'] || '',
      location: row['当前物理位置'] || '',
      status: row['身心现状'] || '',
      attitude: row['对主角态度'] || '',
      agenda: row['个人核心目标'] || '',
      progress: row['个人剧情线进度'] || '',
      currentPlotEvent: row['当前独立遭遇事件'] || '',
      crossoverImpact: row['与主线交集'] || ''
    };
  }

  let isExecutingPostUpdatePurge = false;
  /**
   * 数据库更新完毕并分发通知后的静默容量超限清理
   * 严格遵循用户自定义配置（次主角纪要默认100条、离场NPC默认30条、恋爱日记默认50条）
   */
  async function performPostUpdatePurge() {
    if (isExecutingPostUpdatePurge) return;
    isExecutingPostUpdatePurge = true;
    try {
      const bridge = db();
      if (!bridge) return;
      const settings = (window.STATUSBAR_STORE && window.STATUSBAR_STORE.getSettings()) || {};

      // 1. 次主角纪要表清理（用户设置 maxDeuteragonistChronicles，默认 100）
      const maxChronicles = parseInt(settings.maxDeuteragonistChronicles, 10) || 100;
      const cRows = bridge.getAllRows('次主角纪要表') || [];
      if (cRows.length > maxChronicles) {
        const overflow = cRows.length - maxChronicles;
        console.log(`[通用状态栏] 数据库更新完毕：次主角纪要共 ${cRows.length} 条，超出自定义上限 ${maxChronicles}，开始静默清理最早 ${overflow} 条...`);
        for (let i = 0; i < overflow; i++) {
          await bridge.deleteRow('次主角纪要表', 1);
        }
      }

      // 2. 离场NPC活动表清理（用户设置 maxOffscreenNpc，默认 30）
      const maxNpc = parseInt(settings.maxOffscreenNpc, 10) || 30;
      const nRows = bridge.getAllRows('离场NPC活动表') || [];
      if (nRows.length > maxNpc) {
        const overflow = nRows.length - maxNpc;
        console.log(`[通用状态栏] 数据库更新完毕：离场NPC记录共 ${nRows.length} 条，超出自定义上限 ${maxNpc}，开始静默清理最早 ${overflow} 条...`);
        for (let i = 0; i < overflow; i++) {
          await bridge.deleteRow('离场NPC活动表', 1);
        }
      }

      // 3. 恋爱日记清理（用户设置 maxRomanceDiaries，默认 50）
      const maxDiaries = parseInt(settings.maxRomanceDiaries, 10) || 50;
      const dRows = bridge.getAllRows('恋爱日记') || [];
      if (dRows.length > maxDiaries) {
        const overflow = dRows.length - maxDiaries;
        console.log(`[通用状态栏] 数据库更新完毕：恋爱日记共 ${dRows.length} 条，超出自定义上限 ${maxDiaries}，开始静默清理最早 ${overflow} 条...`);
        for (let i = 0; i < overflow; i++) {
          await bridge.deleteRow('恋爱日记', 1);
        }
      }
    } catch (e) {
      console.error('[通用状态栏] 数据库更新后容量清理异常:', e);
    } finally {
      isExecutingPostUpdatePurge = false;
    }
  }

  let isSyncingDeuteragonistLifecycle = false;
  /**
   * 次主角生命周期联动检查：若次主角死亡/被移除，或换了新次主角，自动清空旧纪要表
   */
  async function syncDeuteragonistLifecycle() {
    if (isSyncingDeuteragonistLifecycle) return;
    const bridge = db();
    const dRow = bridge?.getRow('次主角表', 1);
    const cRows = bridge?.getAllRows('次主角纪要表') || [];
    if (!cRows || cRows.length === 0) return;

    const hasLivingDeuteragonist = Boolean(dRow && dRow['姓名'] && String(dRow['姓名']).trim() !== '');
    const currentName = hasLivingDeuteragonist ? String(dRow['姓名']).trim() : '';
    const firstRecordName = String(cRows[0]['次主角姓名'] || '').trim();

    const shouldPurge = !hasLivingDeuteragonist || (currentName && firstRecordName && currentName !== firstRecordName);

    if (shouldPurge) {
      isSyncingDeuteragonistLifecycle = true;
      try {
        console.warn(`[通用状态栏] 次主角生命周期变更（存活=${hasLivingDeuteragonist}，当前=${currentName}，旧记录=${firstRecordName}），插件自动清空次主角纪要表...`);
        const api = (window.parent && window.parent.AutoCardUpdaterAPI) || window.AutoCardUpdaterAPI;
        if (api && typeof api.executeSqlMutation === 'function') {
          await api.executeSqlMutation('DELETE FROM `次主角纪要表`;');
          await bridge.refreshSnapshot();
        } else {
          for (let i = 0; i < cRows.length; i++) {
            await bridge.deleteRow('次主角纪要表', 1);
          }
        }
      } catch (e) {
        console.error('[通用状态栏] 自动清空次主角纪要表失败:', e);
      } finally {
        isSyncingDeuteragonistLifecycle = false;
      }
    }
  }

  /**
   * 获取次主角当前即时状态（次主角表 · 严格 23 列，始终唯独 1 行）
   */
  function getDeuteragonistState() {
    const bridge = db();
    const row = bridge?.getRow('次主角表', 1);
    if (!row || !row['姓名'] || String(row['姓名']).trim() === '') return null;
    return {
      _rowIndex: 1,
      rowId: parseInt(row['row_id'] || 1, 10),
      name: String(row['姓名'] || '').trim(),
      alias: row['称谓系统'] || '',
      gender: row['性别'] || '',
      age: row['年龄'] || '',
      identity: row['身份背景与职业'] || '',
      location: row['当前物理位置'] || '',
      personalStatus: row['身心现状'] || '',
      personality: row['性格特质'] || '',
      appearanceDetail: row['精细面貌'] || '',
      bodyMeasurements: row['身体数据'] || '',
      voiceScent: row['声音与气味'] || '',
      clothingStyle: row['服装风格与着装'] || '',
      interactionHabit: row['交互模式与习惯'] || '',
      uniqueMarksItems: row['独特标记与随身物品'] || '',
      socialRelations: row['人际关系网络'] || '',
      nsfwProfile: row['NSFW私密档案'] || '',
      chronicleResume: row['生平履历时间线'] || '',
      otherNotes: row['其他备注'] || '',
      hasCrossover: String(row['是否与主角交集'] || '否').trim(),
      attitude: row['对主角态度'] || '素未谋面',
      personalAgenda: row['个人核心目标'] || '',
      storylineProgress: row['个人剧情线进度'] || ''
    };
  }

  /**
   * 获取次主角历史暗线纪要列表（次主角纪要表 · 严格 6 列，从新到旧排布）
   */
  function getDeuteragonistChronicles() {
    const bridge = db();
    const rows = bridge?.getAllRows('次主角纪要表') || [];
    setTimeout(() => syncDeuteragonistLifecycle(), 500);

    const mapped = rows.map(r => ({
      _rowIndex: r._rowIndex,
      rowId: parseInt(r['row_id'] || r._rowIndex, 10),
      charName: String(r['次主角姓名'] || '').trim(),
      timeSpan: r['发生时间'] || '',
      chronicleText: r['本轮独立剧情'] || '',
      growthGain: r['实力变动收获'] || '',
      crossoverTrace: r['主线交织痕迹'] || ''
    }));
    return mapped.reverse();
  }

  /**
   * 提取离场角色活动轮换池（离场NPC活动表 · 严格 7 列）
   */
  function getOffscreenNpcState() {
    const bridge = db();
    const rows = bridge?.getAllRows('离场NPC活动表') || [];
    return rows.map((r, i) => ({
      _rowIndex: r._rowIndex || (i + 1),
      rowId: parseInt(r['row_id'] || (i + 1), 10),
      name: String(r['NPC姓名'] || '').trim(),
      identity: r['身份定位'] || '',
      location: r['当前所在地点'] || '',
      activity: r['独立日常与活动事件'] || '',
      mood: r['心境与生活态势'] || '',
      activityCount: parseInt(r['轮换推演计数'] || 0, 10)
    }));
  }

  /**
   * 获取全部恋爱日记记录（恋爱日记 · 严格 6 列，从新到旧排布）
   */
  function getAllRomanceDiaries() {
    const bridge = db();
    const rows = bridge?.getAllRows('恋爱日记') || [];
    const mapped = rows.map(d => ({
      _rowIndex: d._rowIndex,
      rowId: parseInt(d['row_id'] || d._rowIndex, 10),
      writer: (d['写作角色'] || '').trim(),
      targetChar: (d['关联角色'] || '').trim(),
      time: d['发生时间'] || '',
      content: d['日记内容'] || '',
      summary: d['日记内容'] || '',
      eventType: d['事件类型'] || ''
    }));
    // 从新到旧排序
    return mapped.reverse();
  }

  /**
   * 提取纪要与手帐心声
   */
  function getChronicleState() {
    const bridge = db();
    const summaries = bridge?.getAllRows('纪要表') || [];
    const diaries = bridge?.getAllRows('恋爱日记') || [];

    const latestSummaries = summaries.slice(-8).reverse().map(r => ({
      codeIndex: r['编码索引'] || '',
      turnRange: r['时间跨度'] || '',
      overview: r['概览'] || '',
      summary: r['纪要'] || '',
      keyDialogue: r['重要对话'] || ''
    }));

    const latestDiaries = diaries.slice(-8).reverse().map(r => ({
      writer: r['写作角色'] || '',
      targetChar: r['关联角色'] || '',
      date: r['发生时间'] || '',
      content: r['日记内容'] || '',
      summary: r['日记内容'] || '',
      eventType: r['事件类型'] || ''
    }));

    return {
      latestSummaries,
      latestDiaries
    };
  }

  /**
   * 聚合全景状态快照
   */
  function getFullSnapshot() {
    const isDbReady = Boolean(db()?.isConnected());
    const env = getEnvironmentState();
    const protagonist = getProtagonistState();
    const characters = getPresentCharactersState();
    const offscreenCharacters = getOffscreenCharactersState();
    const inventory = getInventoryState();
    const tasks = getTasksState();
    const memos = getMemoState();
    const world = getWorldState();
    const deuteragonist = getDeuteragonistState();
    const offscreenNpc = getOffscreenNpcState();
    const chronicle = getChronicleState();

    return {
      isDbReady,
      env,
      protagonist,
      characters,
      offscreenCharacters,
      allCharacters: getAllCharactersState(),
      inventory,
      tasks,
      memos,
      world,
      deuteragonist,
      deuteragonistChronicles: getDeuteragonistChronicles(),
      offscreenNpc,
      chronicle,
      romanceDiaries: getAllRomanceDiaries(),
      timestamp: Date.now()
    };
  }

  // --- 随身物品增删改 (物品表) ---
  async function addInventoryItem(item = {}) {
    const bridge = db();
    if (!bridge) throw new Error('数据库桥未连接');
    const name = String(item.name || '').trim();
    if (!name) throw new Error('物品名称不能为空');

    const rowData = {
      '物品名称': name,
      '类型': String(item.type || '').trim(),
      '数量': String(item.quantity ?? '1').trim(),
      '描述': String(item.description || '').trim()
    };
    return await bridge.insertRow('物品表', rowData);
  }

  async function updateInventoryQty(rowIndex, delta = 1) {
    const bridge = db();
    if (!bridge) return false;
    const curVal = bridge.getCell('物品表', rowIndex, '数量');
    const curNum = parseInt(curVal, 10) || 1;
    const nextNum = Math.max(0, curNum + delta);
    if (nextNum === 0) {
      return await bridge.deleteRow('物品表', rowIndex);
    }
    return await bridge.updateCell('物品表', rowIndex, '数量', String(nextNum));
  }

  async function deleteInventoryItem(rowIndex) {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.deleteRow('物品表', rowIndex);
  }

  async function updateInventoryItem(rowIndex, field = '数量', value = '1') {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.updateCell('物品表', rowIndex, field, value);
  }

  // --- 任务驱动栏增删改 (瑟瑟任务表) ---
  async function addTaskItem(task = {}) {
    const bridge = db();
    if (!bridge) throw new Error('数据库桥未连接');
    const title = String(task.title || '').trim();
    if (!title) throw new Error('任务名称不能为空');

    const rowData = {
      '任务名称': title,
      '任务描述': String(task.description || '').trim(),
      '任务目标': String(task.objective || '').trim(),
      '完成情况': String(task.status || '未完成').trim(),
      '任务类别': String(task.type || '日常').trim()
    };
    return await bridge.insertRow('瑟瑟任务表', rowData);
  }

  async function updateTaskItem(rowIndex, field = '完成情况', value = '已完成') {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.updateCell('瑟瑟任务表', rowIndex, field, value);
  }

  async function deleteTaskItem(rowIndex) {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.deleteRow('瑟瑟任务表', rowIndex);
  }

  // --- 备忘与日程清单增删改 (备忘录) ---
  async function addMemoItem(memo = {}) {
    const bridge = db();
    if (!bridge) throw new Error('数据库桥未连接');
    const title = String(memo.title || '').trim();
    if (!title) throw new Error('备忘标题不能为空');

    const rowData = {
      '备忘标题': title,
      '类型': String(memo.type || '').trim(),
      '相关角色': String(memo.character || '').trim(),
      '详细内容': String(memo.detail || '').trim(),
      '当前状态': String(memo.status || '进行中').trim(),
      '记录时间': String(memo.recordTime || (new Date().toISOString().slice(0, 10))).trim(),
      '约定时间': String(memo.appointedTime || '').trim(),
      '后续结果': String(memo.result || '').trim()
    };
    return await bridge.insertRow('备忘录', rowData);
  }

  async function updateMemoItem(rowIndex, field = '当前状态', value = '已完成') {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.updateCell('备忘录', rowIndex, field, value);
  }

  async function deleteMemoItem(rowIndex) {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.deleteRow('备忘录', rowIndex);
  }

  // --- 主角信息表字段更新 ---
  async function updateProtagonistField(field, value) {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.updateCell('主角信息表', 1, field, value);
  }

  // --- 角色信息表字段更新 ---
  async function updateCharacterField(rowIndex, field, value) {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.updateCell('角色信息表', rowIndex, field, value);
  }

  // --- 恋爱日记字段更新 ---
  async function updateDiaryField(rowIndex, field, value) {
    const bridge = db();
    if (!bridge) return false;
    return await bridge.updateCell('恋爱日记', rowIndex, field, value);
  }

  window.STATUSBAR_CORE = {
    getEnvironmentState,
    getProtagonistState,
    getAllCharactersState,
    getPresentCharactersState,
    getOffscreenCharactersState,
    getInventoryState,
    getTasksState,
    getMemoState,
    getWorldState,
    getDeuteragonistState,
    getOffscreenNpcState,
    getChronicleState,
    getAllRomanceDiaries,
    getFullSnapshot,
    addInventoryItem,
    updateInventoryQty,
    updateInventoryItem,
    deleteInventoryItem,
    addTaskItem,
    updateTaskItem,
    deleteTaskItem,
    addMemoItem,
    updateMemoItem,
    deleteMemoItem,
    updateProtagonistField,
    updateCharacterField,
    updateDiaryField,
    performPostUpdatePurge
  };

  // 订阅数据库更新通知：当数据库更新完毕发了通知后，统一执行容量超限清理
  setTimeout(() => {
    const bridge = db();
    if (bridge && typeof bridge.onDatabaseChange === 'function') {
      bridge.onDatabaseChange((meta) => {
        if (meta && (meta.source === 'acu_update_callback' || meta.persisted === true)) {
          setTimeout(() => performPostUpdatePurge(), 800);
        }
      });
    }
  }, 1000);
})();
