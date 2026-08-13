/**
 * tests/service/template/chat-scope.test.ts
 * 聊天作用域管理 单元测试（base + plot + sheet）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockGetCurrentIsolationKey,
  mockCurrentJsonTableData,
  mockGetChatArray,
  mockSaveChatToHost,
  mockGetChatScopedConfigContainer,
  mockNormalizeChatScopedConfigContainer,
  mockGetChatFirstLayerMessage,
  mockParseTableTemplateJson,
  mockEnsureSheetOrderNumbers,
  mockCloneScopedConfigData,
  mockEnsurePlotPromptsArray,
  mockEnsureLoopPromptsArray,
  mockEnsurePlotTasksCompat,
  mockGetPlotFinalDirectiveFromSource,
  mockSetPlotPromptContentById,
  mockNormalizePlotPresetSelectionValue,
  mockEnsureExportConfigDefaults,
  mockGetChatSheetGuideData,
  mockSaveCurrentProfileTemplate,
  mockSetTableTemplate,
  mockStripPlotTaskRuntimeApiPresetFields,
} = vi.hoisted(() => ({
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '' } as any,
  mockGetCurrentIsolationKey: vi.fn(() => ''),
  mockCurrentJsonTableData: {} as any,
  mockGetChatArray: vi.fn(() => []),
  mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
  mockGetChatScopedConfigContainer: vi.fn(() => null),
  mockNormalizeChatScopedConfigContainer: vi.fn((c: any) => c || { version: 1 }),
  mockGetChatFirstLayerMessage: vi.fn(() => null),
  mockParseTableTemplateJson: vi.fn(() => ({})),
  mockEnsureSheetOrderNumbers: vi.fn(() => false),
  mockCloneScopedConfigData: vi.fn((data: any) => data ? JSON.parse(JSON.stringify(data)) : null),
  mockEnsurePlotPromptsArray: vi.fn(),
  mockEnsureLoopPromptsArray: vi.fn(),
  mockEnsurePlotTasksCompat: vi.fn(),
  mockGetPlotFinalDirectiveFromSource: vi.fn(() => ''),
  mockSetPlotPromptContentById: vi.fn(),
  mockNormalizePlotPresetSelectionValue: vi.fn((v: any) => v || ''),
  mockEnsureExportConfigDefaults: vi.fn((cfg: any, name: string) => cfg || { enabled: true, name }),
  mockGetChatSheetGuideData: vi.fn(() => null),
  mockSaveCurrentProfileTemplate: vi.fn(),
  mockSetTableTemplate: vi.fn(),
  mockStripPlotTaskRuntimeApiPresetFields: vi.fn((tasks: any[]) => tasks || []),
}));

// ═══ Mocks ═══

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_TABLE_TEMPLATE_ACU: '{}',
  get TABLE_TEMPLATE_ACU() { return '{}'; },
  _set_TABLE_TEMPLATE_ACU: mockSetTableTemplate,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  readProfileTemplateFromStorage_ACU: vi.fn(() => null),
  saveCurrentProfileTemplate_ACU: mockSaveCurrentProfileTemplate,
}));

vi.mock('../../../src/shared/template-preset-utils', () => ({
  DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU: '',
  deriveTemplatePresetNameForImport_ACU: vi.fn(),
  getCurrentTemplatePresetName_ACU: vi.fn(() => ''),
  normalizeTemplatePresetSelectionValue_ACU: vi.fn((v: any) => v || ''),
}));

vi.mock('../../../src/data/storage/chat-history', () => ({
  CHAT_SCOPED_CONFIG_FIELD_ACU: '_acu_scoped_config',
  CHAT_SHEET_GUIDE_FIELD_ACU: '_acu_sheet_guide',
  CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU: '_seedRows',
  CHAT_SHEET_GUIDE_VERSION_ACU: 2,
  CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU: 'archive_',
  LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU: '_acu_table_header_guide',
  MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU: 5,
  getChatScopedConfigContainer_ACU: mockGetChatScopedConfigContainer,
  getChatSheetGuideContainer_ACU: vi.fn(() => ({})),
  normalizeChatScopedConfigContainer_ACU: mockNormalizeChatScopedConfigContainer,
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  getDefaultTemplateSnapshot_ACU: vi.fn(() => null),
  getTemplatePreset_ACU: vi.fn(() => null),
  getTemplatePresetDisplayName_ACU: vi.fn(() => ''),
  persistTemplateScopeSelectionState_ACU: vi.fn(),
  upsertTemplatePreset_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: mockCurrentJsonTableData,
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHost_ACU: mockSaveChatToHost,
}));

vi.mock('../../../src/shared/constants', () => ({
  TABLE_ORDER_FIELD_ACU: 'orderNo',
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

vi.mock('../../../src/shared/utils', () => ({
  applySheetOrderNumbers_ACU: vi.fn(),
  cloneScopedConfigData_ACU: mockCloneScopedConfigData,
  ensureSheetOrderNumbers_ACU: mockEnsureSheetOrderNumbers,
  formatPlotScopeUpdatedAt_ACU: vi.fn(() => ''),
  getChatFirstLayerMessage_ACU: mockGetChatFirstLayerMessage,
  hashUserInput_ACU: vi.fn((t: string) => `hash_${t}`),
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name?.includes('纪要') || name?.includes('总结')),
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: mockParseTableTemplateJson,
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  ensureExportConfigDefaults_ACU: mockEnsureExportConfigDefaults,
  ensureGlobalInjectionConfigDefaults_ACU: vi.fn(),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: vi.fn(() => null),
  readLegacyIndependentData_ACU: vi.fn(() => null),
  readLegacyStandardData_ACU: vi.fn(() => null),
  readLegacySummaryData_ACU: vi.fn(() => null),
  isLegacyMatchForIsolation_ACU: vi.fn(() => false),
}));

vi.mock('../../../src/service/plot/plot-logic', () => ({
  ensurePlotPromptsArray_ACU: mockEnsurePlotPromptsArray,
  ensureLoopPromptsArray_ACU: mockEnsureLoopPromptsArray,
  ensurePlotTasksCompat_ACU: mockEnsurePlotTasksCompat,
  getPlotFinalDirectiveFromSource_ACU: mockGetPlotFinalDirectiveFromSource,
  normalizePlotPresetSelectionValue_ACU: mockNormalizePlotPresetSelectionValue,
  setPlotPromptContentByIdForSettings_ACU: mockSetPlotPromptContentById,
  stripPlotTaskRuntimeApiPresetFields_ACU: mockStripPlotTaskRuntimeApiPresetFields,
}));

// mock chat-scope 内部跨文件依赖
vi.mock('../../../src/service/template/chat-scope/chat-scope-template', () => ({
  getCurrentChatTemplateScopeState_ACU: vi.fn(() => null),
  buildChatTemplateScopeStateFromCurrent_ACU: vi.fn(() => null),
  setCurrentChatTemplateScopeState_ACU: vi.fn(),
}));

vi.mock('../../../src/service/template/chat-scope/chat-scope-guide', () => ({
  migrateLegacyTemplateScopeForCurrentChat_ACU: vi.fn(() => null),
  getChatSheetGuideDataForIsolationKey_ACU: mockGetChatSheetGuideData,
  buildChatSheetGuideDataFromTemplateObj_ACU: vi.fn(() => null),
}));

import {
  normalizeChatScopedConfigSource_ACU,
  normalizeGuideData_ACU,
} from '../../../src/service/template/chat-scope/chat-scope-base';

import {
  sanitizePlotSettingsSnapshotForChat_ACU,
  getCurrentChatPlotScopeState_ACU,
  buildChatPlotScopeStateFromSettings_ACU,
  setCurrentChatPlotScopeState_ACU,
  clearCurrentChatPlotScopeState_ACU,
} from '../../../src/service/template/chat-scope/chat-scope-plot';

import {
  getSortedSheetKeys_ACU,
  buildGuidedBaseDataFromSheetGuide_ACU,
  reorderDataBySheetKeys_ACU,
  sanitizeSheetForStorage_ACU,
  sanitizeChatSheetsObject_ACU,
} from '../../../src/service/template/chat-scope/chat-scope-sheet';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentIsolationKey.mockReturnValue('');
  mockGetChatSheetGuideData.mockReturnValue(null);
  mockParseTableTemplateJson.mockReturnValue({});
  mockEnsureSheetOrderNumbers.mockReturnValue(false);
});

// ═══ chat-scope-base ═══
describe('normalizeChatScopedConfigSource_ACU', () => {
  it('非字符串输入返回 fallback', () => {
    expect(normalizeChatScopedConfigSource_ACU(null)).toBe('inherit');
    expect(normalizeChatScopedConfigSource_ACU(123)).toBe('inherit');
    expect(normalizeChatScopedConfigSource_ACU(undefined, 'custom')).toBe('custom');
  });

  it('空字符串返回 fallback', () => {
    expect(normalizeChatScopedConfigSource_ACU('')).toBe('inherit');
    expect(normalizeChatScopedConfigSource_ACU('  ')).toBe('inherit');
  });

  it('有效字符串返回 trim 后的值', () => {
    expect(normalizeChatScopedConfigSource_ACU('  ui  ')).toBe('ui');
    expect(normalizeChatScopedConfigSource_ACU('preset_link')).toBe('preset_link');
  });
});

describe('normalizeGuideData_ACU', () => {
  it('null 输入返回 null', () => {
    expect(normalizeGuideData_ACU(null)).toBeNull();
    expect(normalizeGuideData_ACU(undefined)).toBeNull();
  });

  it('无 sheet_ 键时返回只有 mate 的对象', () => {
    const result = normalizeGuideData_ACU({ someField: 'value' });
    expect(result).toBeDefined();
    expect(result.mate).toBeDefined();
    expect(result.mate.type).toBe('chatSheets');
    expect(Object.keys(result).filter((k: string) => k.startsWith('sheet_'))).toHaveLength(0);
  });

  it('有 sheet_ 键时只保留表头行和配置', () => {
    const input = {
      sheet_0: {
        uid: 's0',
        name: '物品表',
        content: [['row_id', '物品名'], ['1', '铁剑'], ['2', '盾牌']],
        sourceData: { note: '备注' },
        updateConfig: { contextDepth: 5 },
        customField: '应被丢弃',
      },
    };
    const result = normalizeGuideData_ACU(input);
    expect(result.sheet_0).toBeDefined();
    expect(result.sheet_0.name).toBe('物品表');
    // 只保留表头行
    expect(result.sheet_0.content).toEqual([['row_id', '物品名']]);
    expect(result.sheet_0.sourceData).toEqual({ note: '备注' });
    // customField 不在保留列表中，不应出现
    expect(result.sheet_0.customField).toBeUndefined();
  });

  it('有 seedRows 时保留深拷贝', () => {
    const seedRows = [['1', '种子行']];
    const input = {
      sheet_0: {
        name: '表',
        content: [['row_id']],
        _seedRows: seedRows,
      },
    };
    const result = normalizeGuideData_ACU(input);
    expect(result.sheet_0._seedRows).toEqual(seedRows);
    // 深拷贝验证
    expect(result.sheet_0._seedRows).not.toBe(seedRows);
  });
});

// ═══ chat-scope-plot ═══
describe('sanitizePlotSettingsSnapshotForChat_ACU', () => {
  it('null 输入返回 null', () => {
    expect(sanitizePlotSettingsSnapshotForChat_ACU(null)).toBeNull();
  });

  it('有效 plotSettings 返回清洗后的快照', () => {
    mockCloneScopedConfigData.mockReturnValue({
      enabled: true,
      promptPresets: ['preset1'],
      lastUsedPresetName: '预设A',
      rateMain: 5,
    });
    const result = sanitizePlotSettingsSnapshotForChat_ACU({ rateMain: 5 });
    expect(result).toBeDefined();
    // enabled、promptPresets、lastUsedPresetName 应被删除
    expect(result.enabled).toBeUndefined();
    expect(result.promptPresets).toBeUndefined();
    expect(result.lastUsedPresetName).toBeUndefined();
    // rateMain 应保留
    expect(result.rateMain).toBe(5);
    // 确保 plot-logic 的规范化函数被调用
    expect(mockEnsurePlotPromptsArray).toHaveBeenCalled();
    expect(mockEnsureLoopPromptsArray).toHaveBeenCalled();
    expect(mockEnsurePlotTasksCompat).toHaveBeenCalled();
  });
});

describe('getCurrentChatPlotScopeState_ACU', () => {
  it('无容器时返回 null', () => {
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    expect(getCurrentChatPlotScopeState_ACU([])).toBeNull();
  });

  it('mode 不是 chat_override 时返回 null', () => {
    mockGetChatScopedConfigContainer.mockReturnValue({
      plot: { mode: 'inherit_global' },
    });
    expect(getCurrentChatPlotScopeState_ACU([])).toBeNull();
  });

  it('有效 chat_override 快照时返回规范化状态', () => {
    mockCloneScopedConfigData.mockReturnValue({ rateMain: 5 });
    mockGetChatScopedConfigContainer.mockReturnValue({
      plot: {
        mode: 'chat_override',
        snapshot: { rateMain: 5 },
        presetName: '预设A',
      },
    });
    const result = getCurrentChatPlotScopeState_ACU([]);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat_override');
  });
});

describe('buildChatPlotScopeStateFromSettings_ACU', () => {
  it('plotSettings 无效时返回 null', () => {
    mockCloneScopedConfigData.mockReturnValue(null);
    expect(buildChatPlotScopeStateFromSettings_ACU(null)).toBeNull();
  });

  it('有效 plotSettings 返回 chat_override 状态', () => {
    mockCloneScopedConfigData.mockReturnValue({ rateMain: 5 });
    const result = buildChatPlotScopeStateFromSettings_ACU(
      { rateMain: 5 },
      { presetName: '预设A', source: 'ui' },
    );
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat_override');
    expect(result!.source).toBe('ui');
  });
});

describe('setCurrentChatPlotScopeState_ACU', () => {
  it('无首条消息时返回 null', () => {
    mockGetChatFirstLayerMessage.mockReturnValue(null);
    expect(setCurrentChatPlotScopeState_ACU({ mode: 'chat_override' })).toBeNull();
  });

  it('写入 chat_override 时设置 _acu_scoped_config.plot', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    mockNormalizeChatScopedConfigContainer.mockReturnValue({ version: 1 });
    mockCloneScopedConfigData.mockReturnValue({ rateMain: 5 });

    setCurrentChatPlotScopeState_ACU(
      { mode: 'chat_override', snapshot: { rateMain: 5 } },
      { reason: 'test' },
    );

    expect(firstMsg._acu_scoped_config).toBeDefined();
    expect(firstMsg._acu_scoped_config.plot).toBeDefined();
    expect(firstMsg._acu_scoped_config.plot.reason).toBe('test');
  });
});

describe('clearCurrentChatPlotScopeState_ACU', () => {
  it('调用 setCurrentChatPlotScopeState 并传入 inherit_global', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue({ version: 1, plot: { mode: 'chat_override' } });
    mockNormalizeChatScopedConfigContainer.mockReturnValue({ version: 1, plot: { mode: 'chat_override' } });

    clearCurrentChatPlotScopeState_ACU();

    // inherit_global 模式下 plot 键应被删除
    // 由于 getCurrentChatPlotScopeState_ACU 在 mode !== chat_override 时返回 null
    // 所以 clearCurrentChatPlotScopeState_ACU 的返回值应为 null
    // 这里主要验证函数不抛错
    expect(mockGetChatFirstLayerMessage).toHaveBeenCalled();
  });
});

// ═══ chat-scope-sheet ═══
describe('sanitizeSheetForStorage_ACU', () => {
  it('null 输入原样返回', () => {
    expect(sanitizeSheetForStorage_ACU(null)).toBeNull();
  });

  it('只保留白名单键', () => {
    const input = {
      uid: 's0',
      name: '物品表',
      content: [['row_id', '物品名']],
      sourceData: { note: '', tableAliases: ['物品旧名'] },
      updateConfig: { contextDepth: 5 },
      orderNo: 1,
      domain: '应被丢弃',
      type: '应被丢弃',
      enable: true,
      customStyles: {},
    };
    const result = sanitizeSheetForStorage_ACU(input);
    expect(result.uid).toBe('s0');
    expect(result.name).toBe('物品表');
    expect(result.content).toEqual([['row_id', '物品名']]);
    expect(result.updateConfig).toEqual({ contextDepth: 5 });
    expect(result.sourceData).toEqual({ note: '', tableAliases: ['物品旧名'] });
    expect(result.orderNo).toBe(1);
    // 非白名单键不应存在
    expect(result.domain).toBeUndefined();
    expect(result.type).toBeUndefined();
    expect(result.enable).toBeUndefined();
    expect(result.customStyles).toBeUndefined();
    // exportConfig 应被 ensureExportConfigDefaults 处理
    expect(mockEnsureExportConfigDefaults).toHaveBeenCalled();
  });
});

describe('sanitizeChatSheetsObject_ACU', () => {
  it('null 输入原样返回', () => {
    expect(sanitizeChatSheetsObject_ACU(null)).toBeNull();
  });

  it('sheet_ 键被清洗，非 sheet_ 键保留', () => {
    const input = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [], domain: '冗余' },
      customTopLevel: 'preserved',
    };
    const result = sanitizeChatSheetsObject_ACU(input);
    expect(result.mate).toEqual({ type: 'chatSheets', version: 1 });
    expect(result.sheet_0).toBeDefined();
    expect(result.sheet_0.domain).toBeUndefined();
    expect(result.customTopLevel).toBe('preserved');
  });

  it('ensureMate=true 时补齐 mate', () => {
    const result = sanitizeChatSheetsObject_ACU({}, { ensureMate: true });
    expect(result.mate).toBeDefined();
    expect(result.mate.type).toBe('chatSheets');
    expect(result.mate.version).toBe(1);
  });
});

describe('reorderDataBySheetKeys_ACU', () => {
  it('null 输入原样返回', () => {
    expect(reorderDataBySheetKeys_ACU(null, [])).toBeNull();
  });

  it('按指定顺序重建对象键', () => {
    const input = {
      mate: { type: 'chatSheets' },
      sheet_2: { name: '表2' },
      sheet_0: { name: '表0' },
      sheet_1: { name: '表1' },
    };
    const result = reorderDataBySheetKeys_ACU(input, ['sheet_1', 'sheet_0', 'sheet_2']);
    const keys = Object.keys(result);
    // mate 应在最前面
    expect(keys[0]).toBe('mate');
    // sheet 键按指定顺序
    expect(keys[1]).toBe('sheet_1');
    expect(keys[2]).toBe('sheet_0');
    expect(keys[3]).toBe('sheet_2');
  });
});

describe('buildGuidedBaseDataFromSheetGuide_ACU', () => {
  it('null guide 返回只有 mate 的对象', () => {
    const result = buildGuidedBaseDataFromSheetGuide_ACU(null);
    expect(result.mate).toBeDefined();
    expect(result.mate.type).toBe('chatSheets');
  });

  it('有效 guide 返回深拷贝', () => {
    const guide = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: { name: '表', content: [['row_id']] },
    };
    const result = buildGuidedBaseDataFromSheetGuide_ACU(guide);
    expect(result.sheet_0).toBeDefined();
    // 深拷贝验证
    expect(result.sheet_0).not.toBe(guide.sheet_0);
  });

  it('直接传入历史“行号” guide 时先规范化再构建基底', () => {
    const guide = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [['行号', '名称']], _seedRows: [['7', '铁剑']] },
    };

    const result = buildGuidedBaseDataFromSheetGuide_ACU(guide);

    expect(result.sheet_0.content).toEqual([['row_id', '名称']]);
    expect(result.sheet_0._seedRows).toEqual([['7', '铁剑']]);
  });

  it('直接传入错位身份列的 guide 时拒绝构建运行时基底', () => {
    const guide = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [['名称', '行号']], _seedRows: [['铁剑', '7']] },
    };

    expect(() => buildGuidedBaseDataFromSheetGuide_ACU(guide)).toThrow('Sheet Guide row_id 结构无效');
  });
});

describe('getSortedSheetKeys_ACU', () => {
  it('空对象返回空数组', () => {
    expect(getSortedSheetKeys_ACU(null)).toEqual([]);
    expect(getSortedSheetKeys_ACU({})).toEqual([]);
  });

  it('有 guide 数据时按 guide 的 orderNo 排序', () => {
    mockGetChatSheetGuideData.mockReturnValue({
      sheet_1: { name: '表1', orderNo: 2 },
      sheet_0: { name: '表0', orderNo: 1 },
    });
    const data = {
      sheet_0: { name: '表0' },
      sheet_1: { name: '表1' },
    };
    const result = getSortedSheetKeys_ACU(data);
    expect(result).toEqual(['sheet_0', 'sheet_1']);
  });

  it('ignoreChatGuide=true 时跳过 guide，按 orderNo 排序', () => {
    mockGetChatSheetGuideData.mockReturnValue({
      sheet_1: { name: '表1', orderNo: 1 },
      sheet_0: { name: '表0', orderNo: 2 },
    });
    const data = {
      sheet_0: { name: '表0', orderNo: 1 },
      sheet_1: { name: '表1', orderNo: 2 },
    };
    const result = getSortedSheetKeys_ACU(data, { ignoreChatGuide: true });
    expect(result[0]).toBe('sheet_0');
    expect(result[1]).toBe('sheet_1');
  });

  it('无 guide 且无 orderNo 时按键名排序', () => {
    mockGetChatSheetGuideData.mockReturnValue(null);
    const data = {
      sheet_b: { name: 'B表' },
      sheet_a: { name: 'A表' },
    };
    const result = getSortedSheetKeys_ACU(data);
    expect(result[0]).toBe('sheet_a');
    expect(result[1]).toBe('sheet_b');
  });
});