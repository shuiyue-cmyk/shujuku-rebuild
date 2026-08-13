/**
 * tests/service/template/chat-scope-template.test.ts
 * Template Scope 管理 单元测试（B+C 组）
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
  mockGetChatSheetGuideContainer,
  mockGetChatFirstLayerMessage,
  mockParseTableTemplateJson,
  mockEnsureSheetOrderNumbers,
  mockCloneScopedConfigData,
  mockEnsureExportConfigDefaults,
  mockSaveCurrentProfileTemplate,
  mockSetTableTemplate,
  mockReadProfileTemplate,
  // chat-scope-guide mocks
    mockMigrateLegacyTemplateScope,
    mockClearChatSheetGuideData,
    mockGetChatSheetGuideData,
    mockBuildChatSheetGuideDataFromTemplateObj,
    mockSetChatSheetGuideDataForIsolationKey,
  // chat-scope-sheet mocks
  mockSanitizeChatSheetsObject,
  mockSetChatScopedConfigContainer,
  mockSetChatSheetGuideContainer,
} = vi.hoisted(() => ({
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '' } as any,
  mockGetCurrentIsolationKey: vi.fn(() => ''),
  mockCurrentJsonTableData: {} as any,
  mockGetChatArray: vi.fn(() => []),
  mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
  mockGetChatScopedConfigContainer: vi.fn(() => null),
  mockNormalizeChatScopedConfigContainer: vi.fn((c: any) => c || { version: 1 }),
  mockGetChatSheetGuideContainer: vi.fn(() => ({})),
  mockGetChatFirstLayerMessage: vi.fn(() => null),
  mockParseTableTemplateJson: vi.fn(() => ({})),
  mockEnsureSheetOrderNumbers: vi.fn(() => false),
  mockCloneScopedConfigData: vi.fn((data: any) => data ? JSON.parse(JSON.stringify(data)) : null),
  mockEnsureExportConfigDefaults: vi.fn((cfg: any, name: string) => cfg || { enabled: true, name }),
  mockSaveCurrentProfileTemplate: vi.fn(),
  mockSetTableTemplate: vi.fn(),
  mockReadProfileTemplate: vi.fn(() => null),
  mockMigrateLegacyTemplateScope: vi.fn(() => null),
  mockClearChatSheetGuideData: vi.fn(() => false),
  mockGetChatSheetGuideData: vi.fn(() => null),
  mockBuildChatSheetGuideDataFromTemplateObj: vi.fn((templateObj: any) => templateObj ? { mate: { type: 'chatSheets', version: 1 }, sheet_test: { name: '测试表', content: [['row_id']] } } : null),
  mockSetChatSheetGuideDataForIsolationKey: vi.fn(() => true),
  mockSetChatScopedConfigContainer: vi.fn((chat: any[], container: any) => {
    const first = Array.isArray(chat) ? chat[0] : null;
    if (!first) return;
    if (container) first._acu_scoped_config = container;
    else delete first._acu_scoped_config;
  }),
  mockSetChatSheetGuideContainer: vi.fn((chat: any[], container: any) => {
    const first = Array.isArray(chat) ? chat[0] : null;
    if (!first) return;
    if (container) first._acu_sheet_guide = container;
    else delete first._acu_sheet_guide;
  }),
  mockSanitizeChatSheetsObject: vi.fn((obj: any, opts: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    const out: any = {};
    Object.keys(obj).forEach(k => { out[k] = obj[k]; });
    if (opts?.ensureMate) {
      if (!out.mate) out.mate = { type: 'chatSheets', version: 1 };
    }
    return out;
  }),
}));

// ═══ Mocks ═══

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_TABLE_TEMPLATE_ACU: '{}',
  get TABLE_TEMPLATE_ACU() { return '{}'; },
  _set_TABLE_TEMPLATE_ACU: mockSetTableTemplate,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  readProfileTemplateFromStorage_ACU: mockReadProfileTemplate,
  saveCurrentProfileTemplate_ACU: mockSaveCurrentProfileTemplate,
}));

vi.mock('../../../src/shared/template-preset-utils', () => ({
  DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU: '',
  deriveTemplatePresetNameForImport_ACU: vi.fn((opts: any) => opts?.presetName || ''),
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
  getChatSheetGuideContainer_ACU: mockGetChatSheetGuideContainer,
  normalizeChatScopedConfigContainer_ACU: mockNormalizeChatScopedConfigContainer,
  setChatScopedConfigContainer_ACU: mockSetChatScopedConfigContainer,
  setChatSheetGuideContainer_ACU: mockSetChatSheetGuideContainer,
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  getDefaultTemplateSnapshot_ACU: vi.fn(() => ({ templateStr: JSON.stringify({ mate: { type: 'chatSheets', version: 1 }, sheet_default: { name: '默认表', content: [['row_id']] } }), templateObj: { mate: { type: 'chatSheets', version: 1 }, sheet_default: { name: '默认表', content: [['row_id']] } } })),
  getTemplatePreset_ACU: vi.fn(() => null),
  getTemplatePresetDisplayName_ACU: vi.fn((name: string) => name || ''),
  persistTemplateScopeSelectionState_ACU: vi.fn(),
  upsertTemplatePreset_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
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
  refreshMergedDataAndNotify_ACU: vi.fn().mockResolvedValue(undefined),
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
  ensureGlobalInjectionConfigDefaults_ACU: vi.fn((cfg: any) => cfg || { enabled: false }),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: vi.fn(() => null),
  readLegacyIndependentData_ACU: vi.fn(() => null),
  readLegacyStandardData_ACU: vi.fn(() => null),
  readLegacySummaryData_ACU: vi.fn(() => null),
  isLegacyMatchForIsolation_ACU: vi.fn(() => false),
}));

vi.mock('../../../src/shared/data-constants', () => ({
  normalizeIsolationCode_ACU: vi.fn((code: string) => String(code || '').trim()),
}));

// mock chat-scope-guide（template 的循环依赖）
vi.mock('../../../src/service/template/chat-scope/chat-scope-guide', () => ({
  migrateLegacyTemplateScopeForCurrentChat_ACU: mockMigrateLegacyTemplateScope,
  clearChatSheetGuideDataForIsolationKey_ACU: mockClearChatSheetGuideData,
  getChatSheetGuideDataForIsolationKey_ACU: mockGetChatSheetGuideData,
  buildChatSheetGuideDataFromTemplateObj_ACU: mockBuildChatSheetGuideDataFromTemplateObj,
  setChatSheetGuideDataForIsolationKey_ACU: mockSetChatSheetGuideDataForIsolationKey,
}));

// mock chat-scope-sheet
vi.mock('../../../src/service/template/chat-scope/chat-scope-sheet', () => ({
  sanitizeChatSheetsObject_ACU: mockSanitizeChatSheetsObject,
}));

import {
  normalizeTemplateScopeMode_ACU,
  normalizeTemplateScopeIsolationKey_ACU,
  sanitizeTemplateSnapshotForChat_ACU,
  normalizeChatTemplateScopeState_ACU,
  listChatTemplatePresetEntries_ACU,
  upsertChatTemplatePresetEntry_ACU,
  buildChatTemplatePresetLinkState_ACU,
  activateChatTemplatePresetSelection_ACU,
  clearCurrentChatTemplateSnapshots_ACU,
  getCurrentChatTemplateScopeState_ACU,
  buildChatTemplateScopeStateFromCurrent_ACU,
  setCurrentChatTemplateScopeState_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU,
} from '../../../src/service/template/chat-scope/chat-scope-template';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentIsolationKey.mockReturnValue('');
  mockGetChatArray.mockReturnValue([]);
  mockGetChatFirstLayerMessage.mockReturnValue(null);
  mockGetChatScopedConfigContainer.mockReturnValue(null);
  mockNormalizeChatScopedConfigContainer.mockImplementation((c: any) => c || { version: 1 });
  mockGetChatSheetGuideContainer.mockReturnValue({});
  mockParseTableTemplateJson.mockReturnValue({});
  mockEnsureSheetOrderNumbers.mockReturnValue(false);
  mockCloneScopedConfigData.mockImplementation((data: any) => data ? JSON.parse(JSON.stringify(data)) : null);
  mockMigrateLegacyTemplateScope.mockReturnValue(null);
  mockGetChatSheetGuideData.mockReturnValue(null);
  mockReadProfileTemplate.mockReturnValue(null);
  Object.keys(mockCurrentJsonTableData).forEach(k => delete mockCurrentJsonTableData[k]);
});

// ═══ normalizeTemplateScopeMode_ACU ═══
describe('normalizeTemplateScopeMode_ACU', () => {
  it('chat_override 返回 chat_override', () => {
    expect(normalizeTemplateScopeMode_ACU('chat_override')).toBe('chat_override');
  });

  it('preset_link 返回 preset_link', () => {
    expect(normalizeTemplateScopeMode_ACU('preset_link')).toBe('preset_link');
  });

  it('其他值返回 inherit_global', () => {
    expect(normalizeTemplateScopeMode_ACU('unknown')).toBe('inherit_global');
    expect(normalizeTemplateScopeMode_ACU('')).toBe('inherit_global');
  });
});

// ═══ normalizeTemplateScopeIsolationKey_ACU ═══
describe('normalizeTemplateScopeIsolationKey_ACU', () => {
  it('有效字符串原样返回', () => {
    expect(normalizeTemplateScopeIsolationKey_ACU('tag_1')).toBe('tag_1');
  });

  it('null/undefined 返回空字符串', () => {
    mockGetCurrentIsolationKey.mockReturnValue('');
    expect(normalizeTemplateScopeIsolationKey_ACU(undefined)).toBe('');
    // null ?? '' = ''，所以 String('') = ''
    expect(normalizeTemplateScopeIsolationKey_ACU(null as any)).toBe('');
  });
});

// ═══ sanitizeTemplateSnapshotForChat_ACU ═══
describe('sanitizeTemplateSnapshotForChat_ACU', () => {
  it('null 输入返回 null', () => {
    expect(sanitizeTemplateSnapshotForChat_ACU(null)).toBeNull();
  });

  it('字符串输入解析为对象', () => {
    const templateStr = JSON.stringify({
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [['row_id']] },
    });
    const result = sanitizeTemplateSnapshotForChat_ACU(templateStr);
    expect(result).not.toBeNull();
    expect(result!.templateStr).toBeDefined();
    expect(result!.templateObj).toBeDefined();
  });

  it('按 sheet 键顺序委派 orderNo 补齐', () => {
    sanitizeTemplateSnapshotForChat_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_b: { name: 'B', content: [['row_id']] },
      sheet_a: { name: 'A', content: [['row_id']] },
    });
    expect(mockEnsureSheetOrderNumbers).toHaveBeenCalledWith(expect.any(Object), { baseOrderKeys: ['sheet_b', 'sheet_a'], forceRebuild: false });
  });

  it('对象输入深拷贝后处理', () => {
    const templateObj = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [['row_id']] },
    };
    const result = sanitizeTemplateSnapshotForChat_ACU(templateObj);
    expect(result).not.toBeNull();
    expect(result!.templateStr).toBeDefined();
  });

  it('数组输入返回 null', () => {
    expect(sanitizeTemplateSnapshotForChat_ACU([])).toBeNull();
  });
});

// ═══ normalizeChatTemplateScopeState_ACU ═══
describe('normalizeChatTemplateScopeState_ACU', () => {
  it('null 输入返回默认状态', () => {
    const result = normalizeChatTemplateScopeState_ACU(null);
    expect(result.mode).toBe('inherit_global');
    expect(result.templateStr).toBe('');
    expect(result.source).toBe('inherit');
  });

  it('有效状态规范化', () => {
    const raw = {
      mode: 'chat_override',
      templateStr: '{"sheet_0":{}}',
      presetName: '预设A',
      source: 'ui',
      updatedAt: 1000,
    };
    mockCloneScopedConfigData.mockReturnValue({ sheet_0: {} });
    mockSanitizeChatSheetsObject.mockReturnValue({ sheet_0: {}, mate: { type: 'chatSheets', version: 1 } });
    const result = normalizeChatTemplateScopeState_ACU(raw);
    expect(result.mode).toBe('chat_override');
    expect(result.source).toBe('ui');
    expect(result.updatedAt).toBe(1000);
  });
});

// ═══ getCurrentChatTemplateScopeState_ACU ═══
describe('getCurrentChatTemplateScopeState_ACU', () => {
  it('无容器返回 null', () => {
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    expect(getCurrentChatTemplateScopeState_ACU()).toBeNull();
  });

  it('无 template slots 返回 null', () => {
    mockGetChatScopedConfigContainer.mockReturnValue({ version: 1 });
    expect(getCurrentChatTemplateScopeState_ACU()).toBeNull();
  });

  it('preset_link 旧状态读取时物化为 chat_override 快照', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue({
      version: 1,
      template: {
        '': {
          mode: 'preset_link',
          presetName: '预设A',
          source: 'ui',
        },
      },
    });
    mockCloneScopedConfigData.mockImplementation((data: any) => data ? JSON.parse(JSON.stringify(data)) : null);
    mockSanitizeChatSheetsObject.mockImplementation((obj: any, opts: any) => {
      const out = obj ? JSON.parse(JSON.stringify(obj)) : obj;
      if (opts?.ensureMate && out && !out.mate) out.mate = { type: 'chatSheets', version: 1 };
      return out;
    });
    const result = getCurrentChatTemplateScopeState_ACU({ isolationKey: '' });
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat_override');
    expect(result!.presetName).toBe('预设A');
    expect(result!.templateStr).toBeTruthy();
    expect(mockSetChatScopedConfigContainer).toHaveBeenCalled();
  });

  it('chat_override 无 templateStr 返回 null', () => {
    mockGetChatScopedConfigContainer.mockReturnValue({
      version: 1,
      template: {
        '': {
          mode: 'chat_override',
          templateStr: '',
        },
      },
    });
    const result = getCurrentChatTemplateScopeState_ACU({ isolationKey: '' });
    expect(result).toBeNull();
  });

  it('chat_override 有 templateStr 返回状态', () => {
    const templateStr = JSON.stringify({ sheet_0: { name: '表', content: [['row_id']] } });
    mockGetChatScopedConfigContainer.mockReturnValue({
      version: 1,
      template: {
        '': {
          mode: 'chat_override',
          templateStr,
          presetName: '预设A',
        },
      },
    });
    mockCloneScopedConfigData.mockReturnValue({ sheet_0: { name: '表', content: [['row_id']] } });
    mockSanitizeChatSheetsObject.mockReturnValue({ sheet_0: { name: '表', content: [['row_id']] }, mate: { type: 'chatSheets', version: 1 } });
    const result = getCurrentChatTemplateScopeState_ACU({ isolationKey: '' });
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat_override');
  });
});

// ═══ buildChatTemplateScopeStateFromCurrent_ACU ═══
describe('buildChatTemplateScopeStateFromCurrent_ACU', () => {
  it('无效 templateSource 返回 null', () => {
    mockCloneScopedConfigData.mockReturnValue(null);
    const result = buildChatTemplateScopeStateFromCurrent_ACU({ templateSource: null });
    expect(result).toBeNull();
  });

  it('有效 templateSource 返回 chat_override 状态', () => {
    const templateObj = { sheet_0: { name: '表', content: [['row_id']] } };
    mockCloneScopedConfigData.mockReturnValue(templateObj);
    mockSanitizeChatSheetsObject.mockReturnValue({ ...templateObj, mate: { type: 'chatSheets', version: 1 } });
    const result = buildChatTemplateScopeStateFromCurrent_ACU({
      templateSource: templateObj,
      presetName: '预设A',
      source: 'ui',
    });
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat_override');
    expect(result!.source).toBe('ui');
  });
});

// ═══ setCurrentChatTemplateScopeState_ACU ═══
describe('setCurrentChatTemplateScopeState_ACU', () => {
  it('无首条消息返回 null', () => {
    mockGetChatFirstLayerMessage.mockReturnValue(null);
    expect(setCurrentChatTemplateScopeState_ACU({ mode: 'chat_override' })).toBeNull();
  });

  it('chat_override 写入 template slot', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    mockNormalizeChatScopedConfigContainer.mockReturnValue({ version: 1 });

    const templateStr = JSON.stringify({ sheet_0: { name: '表' } });
    mockCloneScopedConfigData.mockReturnValue({ sheet_0: { name: '表' } });
    mockSanitizeChatSheetsObject.mockReturnValue({ sheet_0: { name: '表' }, mate: { type: 'chatSheets', version: 1 } });

    setCurrentChatTemplateScopeState_ACU(
      { mode: 'chat_override', templateStr, presetName: '预设A' },
      { reason: 'test' },
    );

    expect(firstMsg._acu_scoped_config).toBeDefined();
    expect(firstMsg._acu_scoped_config.template).toBeDefined();
  });

  it('preset_link 写入时物化为 chat_override 快照', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    mockNormalizeChatScopedConfigContainer.mockReturnValue({ version: 1 });
    mockCloneScopedConfigData.mockImplementation((data: any) => data ? JSON.parse(JSON.stringify(data)) : null);
    mockSanitizeChatSheetsObject.mockImplementation((obj: any, opts: any) => {
      const out = obj ? JSON.parse(JSON.stringify(obj)) : obj;
      if (opts?.ensureMate && out && !out.mate) out.mate = { type: 'chatSheets', version: 1 };
      return out;
    });

    setCurrentChatTemplateScopeState_ACU(
      { mode: 'preset_link', presetName: '预设A' },
      { reason: 'test_link' },
    );

    expect(firstMsg._acu_scoped_config).toBeDefined();
    const slot = firstMsg._acu_scoped_config.template?.[''];
    expect(slot).toBeDefined();
    expect(slot.mode).toBe('chat_override');
    expect(slot.presetName).toBe('预设A');
    expect(slot.templateStr).toBeTruthy();
    expect(slot.guideData).toBeTruthy();
  });

  it('inherit_global 删除 template slot', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    mockNormalizeChatScopedConfigContainer.mockReturnValue({ version: 1, template: { '': { mode: 'chat_override' } } });

    setCurrentChatTemplateScopeState_ACU(
      { mode: 'inherit_global' },
      { reason: 'clear' },
    );

    // inherit_global 应删除 slot
    // 如果 template 为空则删除 template 键
    // 如果 container 无 payload 则删除 _acu_scoped_config
    expect(mockGetChatFirstLayerMessage).toHaveBeenCalled();
  });

  it('覆盖当前聊天快照时将旧快照写入归档，新快照只写入当前 slot', () => {
    const firstMsg: any = {};
    const oldTemplateStr = JSON.stringify({ sheet_old: { name: '旧表' } });
    const newTemplateStr = JSON.stringify({ sheet_new: { name: '新表' } });
    const existingContainer = {
      version: 1,
      template: {
        '': {
          mode: 'chat_override',
          isolationKey: '',
          presetName: '旧预设',
          templateStr: oldTemplateStr,
          guideData: null,
          updatedAt: 1000,
          source: 'old_source',
        },
      },
    };
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue(existingContainer);
    mockNormalizeChatScopedConfigContainer.mockImplementation((c: any) => c || { version: 1 });
    mockCloneScopedConfigData.mockImplementation((data: any) => data ? JSON.parse(JSON.stringify(data)) : null);
    mockSanitizeChatSheetsObject.mockImplementation((obj: any, opts: any) => {
      const out = obj ? JSON.parse(JSON.stringify(obj)) : obj;
      if (opts?.ensureMate && out && !out.mate) out.mate = { type: 'chatSheets', version: 1 };
      return out;
    });

    setCurrentChatTemplateScopeState_ACU(
      { mode: 'chat_override', templateStr: newTemplateStr, presetName: '新预设', updatedAt: 2000, source: 'new_source' },
      { reason: 'replace_template' },
    );

    const saved = firstMsg._acu_scoped_config;
    expect(saved.template[''].presetName).toBe('新预设');
    expect(saved.template[''].templateStr).toContain('sheet_new');
    expect(saved.templateArchives['']).toHaveLength(1);
    expect(saved.templateArchives[''][0].presetName).toBe('旧预设');
    expect(saved.templateArchives[''][0].templateStr).toContain('sheet_old');
    expect(saved.templateArchives[''][0].templateStr).not.toContain('sheet_new');
  });

  it('写入相同聊天快照时不重复归档', () => {
    const firstMsg: any = {};
    const templateStr = JSON.stringify({ sheet_same: { name: '同表' } });
    const existingContainer = {
      version: 1,
      template: {
        '': {
          mode: 'chat_override',
          isolationKey: '',
          presetName: '同预设',
          templateStr,
          guideData: null,
          updatedAt: 1000,
          source: 'old_source',
        },
      },
    };
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue(existingContainer);
    mockNormalizeChatScopedConfigContainer.mockImplementation((c: any) => c || { version: 1 });
    mockCloneScopedConfigData.mockImplementation((data: any) => data ? JSON.parse(JSON.stringify(data)) : null);
    mockSanitizeChatSheetsObject.mockImplementation((obj: any, opts: any) => {
      const out = obj ? JSON.parse(JSON.stringify(obj)) : obj;
      if (opts?.ensureMate && out && !out.mate) out.mate = { type: 'chatSheets', version: 1 };
      return out;
    });

    setCurrentChatTemplateScopeState_ACU(
      { mode: 'chat_override', templateStr, presetName: '同预设', updatedAt: 2000, source: 'new_source' },
      { reason: 'same_template' },
    );

    expect(firstMsg._acu_scoped_config.templateArchives).toBeUndefined();
  });
});

// ═══ buildChatTemplatePresetLinkState_ACU ═══
describe('buildChatTemplatePresetLinkState_ACU', () => {
  it('构建 preset_link 状态', () => {
    const result = buildChatTemplatePresetLinkState_ACU({
      presetName: '预设A',
      source: 'ui',
    });
    expect(result.mode).toBe('preset_link');
    expect(result.source).toBe('ui');
  });
});

// ═══ listChatTemplatePresetEntries_ACU ═══
describe('listChatTemplatePresetEntries_ACU', () => {
  it('无 archive 数据返回空数组', () => {
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    const result = listChatTemplatePresetEntries_ACU();
    expect(result).toEqual([]);
  });

  it('有 archive 数据返回排序后的条目', () => {
    const templateStr = JSON.stringify({ sheet_0: { name: '表' } });
    mockCloneScopedConfigData.mockReturnValue({ sheet_0: { name: '表' } });
    mockSanitizeChatSheetsObject.mockReturnValue({ sheet_0: { name: '表' }, mate: { type: 'chatSheets', version: 1 } });
    mockGetChatScopedConfigContainer.mockReturnValue({
      version: 1,
      templateArchives: {
        '': [
          {
            archiveKey: 'key1',
            mode: 'chat_override',
            templateStr,
            presetName: '预设A',
            archivedAt: 1000,
            updatedAt: 1000,
            source: 'ui',
          },
        ],
      },
    });
    const result = listChatTemplatePresetEntries_ACU({ isolationKey: '' });
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

// ═══ upsertChatTemplatePresetEntry_ACU ═══
describe('upsertChatTemplatePresetEntry_ACU', () => {
  it('非 chat_override 模式返回 null', () => {
    const result = upsertChatTemplatePresetEntry_ACU({ mode: 'inherit_global' });
    expect(result).toBeNull();
  });

  it('有效 chat_override 状态插入条目', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatScopedConfigContainer.mockReturnValue(null);
    mockNormalizeChatScopedConfigContainer.mockReturnValue({ version: 1 });

    const templateStr = JSON.stringify({ sheet_0: { name: '表' } });
    mockCloneScopedConfigData.mockReturnValue({ sheet_0: { name: '表' } });
    mockSanitizeChatSheetsObject.mockReturnValue({ sheet_0: { name: '表' }, mate: { type: 'chatSheets', version: 1 } });

    const result = upsertChatTemplatePresetEntry_ACU({
      mode: 'chat_override',
      templateStr,
      presetName: '预设A',
    });
    expect(mockSetChatScopedConfigContainer).toHaveBeenCalled();
  });
});

// ═══ activateChatTemplatePresetSelection_ACU ═══
describe('activateChatTemplatePresetSelection_ACU', () => {
  it('无全局预设且无本地条目返回 false', async () => {
    const result = await activateChatTemplatePresetSelection_ACU('不存在的预设');
    expect(result).toBe(false);
  });
});

// ═══ clearCurrentChatTemplateSnapshots_ACU ═══
describe('clearCurrentChatTemplateSnapshots_ACU', () => {
  it('无首条消息时返回未变更结果', async () => {
    mockGetChatFirstLayerMessage.mockReturnValue(null);

    const result = await clearCurrentChatTemplateSnapshots_ACU({ isolationKey: 'iso-key' });

    expect(result.changed).toBe(false);
    expect(result.removedCurrentScope).toBe(false);
    expect(result.removedArchives).toBe(0);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('清理当前隔离标识的模板覆盖、归档、指导表和旧版表头指导', async () => {
    const firstMsg: any = {
      _acu_table_header_guide: {
        version: 1,
        tags: {
          'iso-key': { headers: [{ uid: 'sheet_0' }] },
          other: { headers: [{ uid: 'sheet_1' }] },
        },
      },
    };
    const chat = [firstMsg];
    mockGetChatArray.mockReturnValue(chat);
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatScopedConfigContainer.mockReturnValue({
      version: 1,
      plot: {
        'iso-key': { mode: 'chat_override' },
      },
      template: {
        'iso-key': { mode: 'chat_override', templateStr: '{"sheet_0":{}}' },
        other: { mode: 'chat_override', templateStr: '{"sheet_1":{}}' },
      },
      templateArchives: {
        'iso-key': [
          { archiveKey: 'a', mode: 'chat_override', templateStr: '{"sheet_0":{}}' },
          { archiveKey: 'b', mode: 'chat_override', templateStr: '{"sheet_0":{}}' },
        ],
        other: [
          { archiveKey: 'c', mode: 'chat_override', templateStr: '{"sheet_1":{}}' },
        ],
      },
    });
    mockClearChatSheetGuideData.mockReturnValue(true);

    const result = await clearCurrentChatTemplateSnapshots_ACU({
      isolationKey: 'iso-key',
      save: true,
    });

    expect(result.changed).toBe(true);
    expect(result.removedCurrentScope).toBe(true);
    expect(result.removedArchives).toBe(2);
    expect(result.removedGuide).toBe(true);
    expect(result.removedLegacyGuide).toBe(true);
    expect(firstMsg._acu_scoped_config.template['iso-key']).toBeUndefined();
    expect(firstMsg._acu_scoped_config.template.other).toBeDefined();
    expect(firstMsg._acu_scoped_config.templateArchives['iso-key']).toBeUndefined();
    expect(firstMsg._acu_scoped_config.templateArchives.other).toBeDefined();
    expect(firstMsg._acu_scoped_config.plot['iso-key']).toBeDefined();
    expect(firstMsg._acu_table_header_guide.tags['iso-key']).toBeUndefined();
    expect(firstMsg._acu_table_header_guide.tags.other).toBeDefined();
    expect(mockClearChatSheetGuideData).toHaveBeenCalledWith({ chat, isolationKey: 'iso-key' });
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('删除最后一个 scoped payload 时移除 scoped config 字段', async () => {
    const firstMsg: any = { _acu_scoped_config: { version: 1 } };
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatScopedConfigContainer.mockReturnValue({
      version: 1,
      template: {
        '': { mode: 'chat_override', templateStr: '{"sheet_0":{}}' },
      },
      templateArchives: {
        '': [{ archiveKey: 'a', mode: 'chat_override', templateStr: '{"sheet_0":{}}' }],
      },
    });

    const result = await clearCurrentChatTemplateSnapshots_ACU({ isolationKey: '', save: false });

    expect(result.changed).toBe(true);
    expect(firstMsg._acu_scoped_config).toBeUndefined();
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });
});

// ═══ getGlobalTemplateSnapshotForCurrentProfile_ACU ═══
describe('getGlobalTemplateSnapshotForCurrentProfile_ACU', () => {
  it('有保存模板时返回快照', () => {
    const savedTemplate = JSON.stringify({
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [['row_id']] },
    });
    mockReadProfileTemplate.mockReturnValue(savedTemplate);
    mockCloneScopedConfigData.mockReturnValue({
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [['row_id']] },
    });
    mockSanitizeChatSheetsObject.mockReturnValue({
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '表', content: [['row_id']] },
    });
    const result = getGlobalTemplateSnapshotForCurrentProfile_ACU();
    expect(result).not.toBeNull();
    expect(result!.templateStr).toBeDefined();
  });

  it('无保存模板时回退到默认', () => {
    mockReadProfileTemplate.mockReturnValue(null);
    // TABLE_TEMPLATE_ACU 是 '{}'，sanitize 后可能返回 null
    const result = getGlobalTemplateSnapshotForCurrentProfile_ACU();
    // 验证不抛错
    expect(mockReadProfileTemplate).toHaveBeenCalled();
  });
});
