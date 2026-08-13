/**
 * tests/presentation/visualizer-main-config.test.ts
 * DDL 校验纯函数单元测试
 *
 * 策略：零 mock，直接测试 validateDDLText 纯函数
 */
import { describe, it, expect } from 'vitest';

// validateDDLText 是纯函数，不依赖任何外部模块
// 但 visualizer-main-config.ts 的顶层 import 会触发大量模块加载
// 所以需要 mock 掉所有依赖

import { vi } from 'vitest';

vi.mock('../../src/shared/defaults-json.js', () => ({
  TABLE_TEMPLATE_ACU: {},
}));

vi.mock('../../src/shared/template-preset-utils', () => ({
  isDefaultTemplatePresetSelection_ACU: vi.fn(),
  normalizeTemplatePresetSelectionValue_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/pages/visualizer-sidebar', () => ({
  getOrderedSheetKeys_ACU: vi.fn(() => []),
}));

vi.mock('../../src/presentation/theme/toast', () => ({
  showToastr_ACU: vi.fn(),
}));

vi.mock('../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  settings_ACU: {},
  _set_currentJsonTableData_ACU: vi.fn(),
}));

vi.mock('../../src/service/template/chat-scope', () => ({
  buildChatSheetGuideDataFromData_ACU: vi.fn(),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn(),
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
  getSortedSheetKeys_ACU: vi.fn(() => []),
  materializeDataFromSheetGuide_ACU: vi.fn(() => ({})),
}));

vi.mock('../../src/service/worldbook/pipeline', () => ({
  updateReadableLorebookEntry_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: vi.fn(),
}));

vi.mock('../../src/shared/constants', () => ({
  SCRIPT_ID_PREFIX_ACU: 'acu',
  TABLE_ORDER_FIELD_ACU: 'orderNo',
}));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: {},
}));

vi.mock('../../src/shared/html-helpers', () => ({
  escapeHtml_ACU: vi.fn((s: string) => s),
}));

vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonStringify_ACU: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({
  applySheetOrderNumbers_ACU: vi.fn(),
  ensureSheetOrderNumbers_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: vi.fn(() => null),
}));

vi.mock('../../src/service/table/table-service', () => ({
  saveIndependentTableToChatHistory_ACU: vi.fn(),
}));

vi.mock('../../src/service/template/template-preset-service', () => ({
  applyTemplatePresetToCurrent_ACU: vi.fn(),
  resolveActiveTemplatePresetName_ACU: vi.fn(),
  upsertTemplatePreset_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/components/template-preset-ui', () => ({
  loadTemplatePresetSelect_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/components/update-status-display', () => ({
  updateCardUpdateStatusDisplay_ACU: vi.fn(),
}));

vi.mock('../../src/service/runtime/helpers-remaining', () => ({
  applySpecialIndexSequenceToSummaryTables_ACU: vi.fn(),
  getSummaryIndexColumnIndex_ACU: vi.fn(() => -1),
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: new Set(), cols: new Set(), cells: new Set() })),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => false),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
  toggleCellLock_ACU: vi.fn(),
  toggleColLock_ACU: vi.fn(),
  toggleRowLock_ACU: vi.fn(),
}));

vi.mock('../../src/service/worldbook/injection-engine', () => ({
  DEFAULT_ENTRY_PLACEMENT_ACU: { position: 'at_depth_as_system', depth: 4, order: 100 },
  DEFAULT_EXTRA_INDEX_PLACEMENT_ACU: { position: 'at_depth_as_system', depth: 4, order: 101 },
  buildDefaultGlobalInjectionConfig_ACU: vi.fn(),
  ensureSheetExportConfigDefaults_ACU: vi.fn(() => ({})),
  getFixedPlacementDefaultsForTable_ACU: vi.fn(() => ({ entry: {}, index: {} })),
  getGlobalInjectionConfigFromData_ACU: vi.fn(),
  isImportantPersonsTableName_ACU: vi.fn(() => false),
  isOutlineTableName_ACU: vi.fn(() => false),
  isSummaryTableName_ACU: vi.fn(() => false),
  normalizeLorebookPosition_ACU: vi.fn(),
  normalizePlacementConfig_ACU: vi.fn((c: any) => c),
  purgeSheetKeysFromChatHistoryHard_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/dom-utils', () => ({
  jQuery_API_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/pages/visualizer', () => ({
  _acuVisState: { currentSheetKey: 'sheet_0' },
}));

vi.mock('../../src/presentation/state/ui-refs', () => ({
  $popupInstance_ACU: null,
}));

vi.mock('../../src/presentation/window/window-system', () => ({
  closeACUWindow: vi.fn(),
}));

vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => true),
}));

vi.mock('../../src/presentation/pages/visualizer-main-render', () => ({
  renderVisualizerMain_ACU: vi.fn(),
}));

vi.mock('../../src/service/settings/settings-service', () => ({
  saveSettingsAndNotify_ACU: vi.fn(),
}));

import { validateDDLText } from '../../src/presentation/pages/visualizer-main-config';

// ═══════════════════════════════════════════════════════════════
// validateDDLText
// ═══════════════════════════════════════════════════════════════
describe('validateDDLText', () => {
  const headers = ['row_id', '物品名', '数量', '描述'];
  const asciiHeaders = ['row_id', 'item_name', 'quantity', 'description'];

  // ─── 正常情况 ───
  it('有效 DDL 返回 valid', () => {
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, quantity INTEGER, description TEXT);';
    const result = validateDDLText(ddl, asciiHeaders);
    expect(result.valid).toBe(true);
    expect(result.message).toContain('✓');
  });

  it('大小写不敏感', () => {
    const ddl = 'create table inventory (ROW_ID integer primary key, item_name TEXT, quantity INTEGER, description TEXT);';
    const result = validateDDLText(ddl, asciiHeaders);
    expect(result.valid).toBe(true);
  });

  // ─── 空值 ───
  it('空字符串返回警告', () => {
    const result = validateDDLText('', headers);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('DDL 为空');
  });

  it('null 返回警告', () => {
    const result = validateDDLText(null as any, headers);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('DDL 为空');
  });

  it('纯空白返回警告', () => {
    const result = validateDDLText('   \n\t  ', headers);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('DDL 为空');
  });

  // ─── 无 CREATE TABLE ───
  it('不是 CREATE TABLE 语句', () => {
    const result = validateDDLText('ALTER TABLE inventory ADD COLUMN x TEXT;', headers);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('不是有效的 CREATE TABLE 语句');
  });

  // ─── 无 row_id ───
  it('缺少 row_id PRIMARY KEY', () => {
    const ddl = 'CREATE TABLE inventory (id INTEGER PRIMARY KEY, 物品名 TEXT);';
    const result = validateDDLText(ddl, headers);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('缺少 row_id INTEGER PRIMARY KEY');
  });

  // ─── 列名不匹配 ───
  it('DDL 多出列', () => {
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, 物品名 TEXT, 数量 INTEGER, 描述 TEXT, 额外列 TEXT);';
    const result = validateDDLText(ddl, headers);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('列数不匹配');
  });

  it('表头多出列', () => {
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, 物品名 TEXT);';
    const result = validateDDLText(ddl, ['row_id', '物品名', '数量']);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('列数不匹配');
  });

  it('DDL 和表头都有多出', () => {
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, 物品名 TEXT, 额外列 TEXT);';
    const result = validateDDLText(ddl, ['row_id', '物品名', '数量']);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('第 2 列不匹配');
  });

  // ─── 空表头 ───
  it('空数组表头（无身份）fail-closed，不再放行', () => {
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);';
    const result = validateDDLText(ddl, []);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('表头为空');
  });

  it('null 占位表头 + 有效 DDL（只有 row_id）通过', () => {
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);';
    const result = validateDDLText(ddl, [null]);
    expect(result.valid).toBe(true);
  });

  // ─── 多行 DDL ───
  it('多行 DDL 格式', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      item_name TEXT, -- 物品名
      quantity INTEGER, -- 数量
      description TEXT -- 描述
    );`;
    const result = validateDDLText(ddl, headers);
    expect(result.valid).toBe(true);
  });

  // ─── DDL 中有注释 ───
  it('DDL 列定义中有注释', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      item_name TEXT, -- 物品名
      quantity INTEGER, -- 数量
      description TEXT -- 描述
    );`;
    const result = validateDDLText(ddl, headers);
    expect(result.valid).toBe(true);
  });

  it('英文物理列名配中文注释时校验通过', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      item_name TEXT, -- 物品名
      quantity INTEGER, -- 数量
      description TEXT -- 描述
    );`;
    const result = validateDDLText(ddl, headers);
    expect(result.valid).toBe(true);
  });

  it('ASCII 展示表头可通过精确 DDL 注释映射到不同物理列名', () => {
    const ddl = `CREATE TABLE battle_status (
      row_id INTEGER PRIMARY KEY, -- 行号
      hp_rp TEXT, -- HP/RP
      en TEXT -- EN
    );`;

    expect(validateDDLText(ddl, ['row_id', 'HP/RP', 'EN'])).toEqual(
      expect.objectContaining({ valid: true }),
    );
  });

  it('ASCII 展示表头既不匹配物理列名也不匹配注释时仍拒绝', () => {
    const ddl = `CREATE TABLE battle_status (
      row_id INTEGER PRIMARY KEY, -- 行号
      hp_rp TEXT, -- 生命值
      en TEXT
    );`;

    const result = validateDDLText(ddl, ['row_id', 'HP/RP', 'EN']);

    expect(result.valid).toBe(false);
    expect(result.message).toContain('第 1 列不匹配');
    expect(result.message).toContain('第 2 列不匹配');
  });

  it('ASCII 展示表头不会仅凭大小写差异匹配物理列名', () => {
    const ddl = `CREATE TABLE battle_status (
      row_id INTEGER PRIMARY KEY,
      en TEXT
    );`;

    expect(validateDDLText(ddl, ['row_id', 'EN']).valid).toBe(false);
  });

  it('ASCII 表头按列位置校验，交换顺序仍拒绝', () => {
    const ddl = `CREATE TABLE battle_status (
      row_id INTEGER PRIMARY KEY, -- 行号
      hp_rp TEXT, -- HP/RP
      en TEXT -- EN
    );`;

    const result = validateDDLText(ddl, ['row_id', 'EN', 'HP/RP']);

    expect(result.valid).toBe(false);
    expect(result.message).toContain('第 1 列不匹配');
    expect(result.message).toContain('第 2 列不匹配');
  });

  it('英文物理列名缺少中文注释时校验失败', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      item_name TEXT,
      quantity INTEGER,
      description TEXT
    );`;
    const result = validateDDLText(ddl, headers);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('第 1 列不匹配');
  });
});
