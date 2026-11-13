// statusbar-db-bridge.js — 数据库交互桥梁
// 深度打通 AutoCardUpdaterAPI (SP·数据库 IX)
// 提供响应式变更监听、高可靠表格读取、单项单元格修改、行级别 CRUD 与 SQL 操作
(function() {
  'use strict';

  if (window.STATUSBAR_DB_BRIDGE) return;

  let cachedApi = null;
  let isConnected = false;
  let tablesCache = null;
  let tablesMap = new Map(); // 包含通过表名、sheetKey、DDL物理名等多重别名索引
  const listeners = new Set();

  /**
   * 探测 AutoCardUpdaterAPI 实例
   * 跨越不同 iframe、父子窗口与命名空间进行安全全局探测
   */
  function detectApi() {
    if (cachedApi && typeof cachedApi.exportTableAsJson === 'function') {
      return cachedApi;
    }
    const api = window.AutoCardUpdaterAPI || window.parent?.AutoCardUpdaterAPI || window.top?.AutoCardUpdaterAPI;
    if (api && typeof api.exportTableAsJson === 'function') {
      cachedApi = api;
      return cachedApi;
    }
    return null;
  }

  /**
   * 规范化并重建表格别名索引
   */
  function indexTables(rawJson) {
    if (!rawJson) return;
    if (typeof rawJson === 'string') {
      try { rawJson = JSON.parse(rawJson); } catch (e) { return; }
    }
    if (typeof rawJson !== 'object') return;

    // 统计有效表格（允许完全清空，严禁阻断）
    const sheetEntries = Object.entries(rawJson).filter(([k, v]) => k.startsWith('sheet_') && v && typeof v === 'object');
    if (sheetEntries.length === 0) {
      tablesCache = rawJson;
      tablesMap.clear();
      return;
    }

    tablesCache = rawJson;
    tablesMap.clear();

    for (const [key, sheet] of Object.entries(tablesCache)) {
      if (!sheet || typeof sheet !== 'object') continue;
      // 1. sheet key 索引 (如 sheet_inventory, sheet_memo)
      tablesMap.set(key, sheet);

      // 2. 表名称索引 (如 "物品表", "全局数据表", "角色信息表", "世界")
      if (sheet.name) {
        tablesMap.set(sheet.name, sheet);
        tablesMap.set(sheet.name.trim(), sheet);
      }

      // 3. uid 索引
      if (sheet.uid) {
        tablesMap.set(sheet.uid, sheet);
      }

      // 4. DDL 物理表名提取 (如 wupinbiao, beiwanglu, npc_activities)
      const ddl = sheet.sourceData?.ddl || '';
      const match = ddl.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
      if (match && match[1]) {
        tablesMap.set(match[1].toLowerCase(), sheet);
      }
    }
  }

  /**
   * 绑定 API 及其更新回调
   */
  function bindApi(api) {
    if (!api) return;
    try {
      if (typeof api.registerTableUpdateCallback === 'function') {
        api.registerTableUpdateCallback((updatedData, meta) => {
          if (updatedData && typeof updatedData === 'object' && Object.keys(updatedData).length > 0) {
            indexTables(updatedData);
          } else {
            refreshSnapshot();
          }
          notifyListeners(meta || { source: 'acu_update_callback' });
        });
        console.log('[状态栏DB桥] [OK] 已成功注册 AutoCardUpdaterAPI.registerTableUpdateCallback 监听');
      }
      if (typeof api.registerTableFillStartCallback === 'function') {
        api.registerTableFillStartCallback(() => {
          notifyListeners({ status: 'filling_started' });
        });
      }
    } catch (e) {
      console.warn('[状态栏DB桥] 注册更新监听失败:', e);
    }
  }

  let hasBoundApi = false;

  /**
   * 刷新本地表格快照 (支持从运行时与预设模板多级提取)
   */
  function refreshSnapshot() {
    const api = detectApi();
    if (!api) {
      isConnected = false;
      return false;
    }
    if (!hasBoundApi) {
      hasBoundApi = true;
      bindApi(api);
    }
    try {
      let data = api.exportTableAsJson();
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) {}
      }

      if (data && typeof data === 'object') {
        indexTables(data);
        isConnected = true;
        return true;
      } else {
        tablesCache = {};
        tablesMap.clear();
        return false;
      }
    } catch (e) {
      console.warn('[状态栏DB桥] 导出表格快照异常:', e);
      return false;
    }
  }

  /**
   * 通知所有订阅者数据库变动
   */
  function notifyListeners(meta = {}) {
    for (const fn of listeners) {
      try {
        fn(meta, tablesCache);
      } catch (err) {
        console.error('[状态栏DB桥] 监听回调执行出错:', err);
      }
    }
  }

  /**
   * 初始化数据库桥连接与监听
   */
  function init() {
    refreshSnapshot();
  }

  function onDatabaseChange(callback) {
    if (typeof callback === 'function') {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
    return () => {};
  }

  /**
   * 获取指定表对象
   */
  function getTable(tableName) {
    if (!tableName) return null;
    if (!tablesCache) refreshSnapshot();
    return tablesMap.get(tableName) || tablesMap.get(String(tableName).trim()) || null;
  }

  /**
   * 获取某表某行某列的单元格值
   * @param {string} tableName 表名或 sheetKey
   * @param {number} rowIndex 行号 (1 对应首行数据，0 为表头)
   * @param {string|number} colIdentifier 列名 (中文/英文) 或 列索引
   */
  function getCell(tableName, rowIndex, colIdentifier) {
    const table = getTable(tableName);
    if (!table || !Array.isArray(table.content) || rowIndex < 0 || rowIndex >= table.content.length) {
      return '';
    }
    const headers = table.content[0] || [];
    let colIdx = -1;

    if (typeof colIdentifier === 'number') {
      colIdx = colIdentifier;
    } else if (typeof colIdentifier === 'string') {
      const targetCol = colIdentifier.trim();
      colIdx = headers.indexOf(targetCol);
      if (colIdx === -1) {
        colIdx = headers.findIndex(h => String(h).trim() === targetCol);
      }
    }

    if (colIdx === -1 || colIdx >= headers.length) {
      return '';
    }

    const row = table.content[rowIndex];
    return row ? (row[colIdx] ?? '') : '';
  }

  /**
   * 获取指定表格的某一行数据并以对象形式返回
   */
  function getRow(tableName, rowIndex) {
    const table = getTable(tableName);
    if (!table || !Array.isArray(table.content) || rowIndex < 0 || rowIndex >= table.content.length) {
      return null;
    }
    const headers = table.content[0] || [];
    const rowArr = table.content[rowIndex] || [];
    const obj = { _rowIndex: rowIndex };
    headers.forEach((col, idx) => {
      obj[col] = rowArr[idx] ?? '';
    });
    return obj;
  }

  /**
   * 获取指定表格的所有数据行
   */
  function getAllRows(tableName) {
    const table = getTable(tableName);
    if (!table || !Array.isArray(table.content) || table.content.length <= 1) {
      return [];
    }
    const headers = table.content[0] || [];
    const rows = [];
    for (let r = 1; r < table.content.length; r++) {
      const rowArr = table.content[r];
      if (!rowArr) continue;
      const obj = { _rowIndex: r };
      headers.forEach((col, idx) => {
        obj[col] = rowArr[idx] ?? '';
      });
      rows.push(obj);
    }
    return rows;
  }

  /**
   * 根据列值寻找行号
   */
  function findRowIndex(tableName, colName, value) {
    const table = getTable(tableName);
    if (!table || !Array.isArray(table.content)) return -1;
    const headers = table.content[0] || [];
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) return -1;
    for (let r = 1; r < table.content.length; r++) {
      if (String(table.content[r]?.[colIdx]) === String(value)) {
        return r;
      }
    }
    return -1;
  }

  /**
   * 执行原生 SQL 查询 (纯只读查询)
   */
  async function querySql(sql, params = []) {
    const api = detectApi();
    if (!api || typeof api.executeSqlQuery !== 'function') return [];
    try {
      return await api.executeSqlQuery(sql, params);
    } catch (e) {
      console.warn('[状态栏DB桥] querySql 异常:', e);
      return [];
    }
  }

  /**
   * 触发数据库 AI 增量更新 (调用 AutoCardUpdater 核心管线)
   */
  async function triggerUpdate() {
    const api = detectApi();
    if (!api || typeof api.triggerUpdate !== 'function') return false;
    try {
      return await api.triggerUpdate();
    } catch (e) {
      console.error('[状态栏DB桥] triggerUpdate 异常:', e);
      return false;
    }
  }

  /**
   * 打开 AutoCardUpdater 可视化编辑器
   */
  async function openVisualizer() {
    const api = detectApi();
    if (!api || typeof api.openVisualizer !== 'function') return false;
    try {
      return await api.openVisualizer();
    } catch (e) {
      console.error('[状态栏DB桥] openVisualizer 异常:', e);
      return false;
    }
  }

  /**
   * 强制刷新数据并同步世界书条目
   */
  async function refreshDataAndWorldbook() {
    const api = detectApi();
    if (!api || typeof api.refreshDataAndWorldbook !== 'function') return false;
    try {
      return await api.refreshDataAndWorldbook();
    } catch (e) {
      console.error('[状态栏DB桥] refreshDataAndWorldbook 异常:', e);
      return false;
    }
  }

  /**
   * 更新指定表的单元格并持久化保存
   */
  async function updateCell(tableName, rowIndex, colIdentifier, value) {
    const api = detectApi();
    if (!api || typeof api.updateCell !== 'function') {
      throw new Error('[状态栏DB桥] AutoCardUpdaterAPI.updateCell 接口不可用');
    }
    const table = getTable(tableName);
    const targetName = table?.name || tableName;
    const ok = await api.updateCell(targetName, rowIndex, colIdentifier, value);
    if (ok === false) {
      throw new Error(`[状态栏DB桥] 更新单元格失败: table=${targetName}, rowIndex=${rowIndex}, col=${colIdentifier}`);
    }
    await refreshSnapshot();
    notifyListeners({ source: 'internal_update_cell', tableName, rowIndex });
    return true;
  }

  /**
   * 删除指定表格的一行数据并持久化保存
   */
  async function deleteRow(tableName, rowIndex) {
    const api = detectApi();
    if (!api || typeof api.deleteRow !== 'function') {
      throw new Error('[状态栏DB桥] AutoCardUpdaterAPI.deleteRow 接口不可用');
    }
    const table = getTable(tableName);
    const targetName = table?.name || tableName;
    const ok = await api.deleteRow(targetName, rowIndex);
    if (ok === false) {
      throw new Error(`[状态栏DB桥] 删除行失败: table=${targetName}, rowIndex=${rowIndex}`);
    }
    await refreshSnapshot();
    notifyListeners({ source: 'internal_delete_row', tableName, rowIndex });
    return true;
  }

  /**
   * 向指定表格插入一行数据并持久化保存
   */
  async function insertRow(tableName, rowData) {
    const api = detectApi();
    if (!api || typeof api.insertRow !== 'function') {
      throw new Error('[状态栏DB桥] AutoCardUpdaterAPI.insertRow 接口不可用');
    }
    const table = getTable(tableName);
    const targetName = table?.name || tableName;
    const newIndex = await api.insertRow(targetName, rowData);
    if (newIndex === -1 || newIndex === false || newIndex === null || newIndex === undefined) {
      throw new Error(`[状态栏DB桥] 插入行失败: table=${targetName}`);
    }
    await refreshSnapshot();
    notifyListeners({ source: 'internal_insert_row', tableName, rowIndex: newIndex });
    return newIndex;
  }


  window.STATUSBAR_DB_BRIDGE = {
    init,
    detectApi,
    isConnected: () => isConnected,
    refreshSnapshot,
    onDatabaseChange,
    getTable,
    getCell,
    getRow,
    getAllRows,
    findRowIndex,
    querySql,
    updateCell,
    deleteRow,
    insertRow,
    triggerUpdate,
    openVisualizer,
    refreshDataAndWorldbook,
    rawTables: () => tablesCache
  };
})();
