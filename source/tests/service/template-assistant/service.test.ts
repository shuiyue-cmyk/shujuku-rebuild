import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockCallAIWithPreset, mockLogError, mockCompileTemplateAssistantDraft, mockBuildTemplateAssistantCumulativeCompileResult, mockPreflightSchemaMigrations } = vi.hoisted(() => ({
  mockCallAIWithPreset: vi.fn(),
  mockLogError: vi.fn(),
  mockPreflightSchemaMigrations: vi.fn(async () => ({ changedSheetKeys: [], blockers: [], operations: [] })),
  mockCompileTemplateAssistantDraft: vi.fn((input: any) => ({
    candidateData: input.tempData,
    orderedSheetKeys: input.sheetOrder || [],
    deletedSheetKeys: [],
    focusSheetKey: input.currentSheetKey,
    diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
    highRiskItems: [],
    lockChanges: [],
    schemaMigrationIntents: {},
  })),
  mockBuildTemplateAssistantCumulativeCompileResult: vi.fn((input: any) => ({
    candidateData: input.candidateData,
    orderedSheetKeys: input.candidateSheetOrder || [],
    deletedSheetKeys: [],
    focusSheetKey: input.focusSheetKey || null,
    diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
    highRiskItems: [],
    lockChanges: [],
    schemaMigrationIntents: {},
  })),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: mockCallAIWithPreset,
  // 与真实 isRetryableAiRequestError_ACU 同语义（Abort 立停、408/429/5xx + TimeoutError 放行），供单发重试包装的 catch 路径使用。
  isRetryableAiRequestError_ACU: (error: any) => {
    const status = Number(error?.status);
    if (String(error?.name || '') === 'AbortError') return false;
    if (Number.isFinite(status)) return status === 408 || status === 429 || (status >= 500 && status <= 599);
    if (String(error?.name || '') === 'TimeoutError') return true;
    return error instanceof TypeError || /(?:timeout|timed out|network(?:\s+error)?|connection reset|socket hang up)/i.test(String(error?.message || ''));
  },
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { tableApiPreset: 'preset-1', apiPresets: [], tableApiPresetOverridesByName: {}, templateAssistantPromptSegments: [] },
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return {
    ...actual,
    logError_ACU: mockLogError,
  };
});

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: (data: any) => Object.keys(data || {}).filter((key) => key.startsWith('sheet_')).sort((a, b) => (data[a]?.orderNo ?? 0) - (data[b]?.orderNo ?? 0)),
}));

vi.mock('../../../src/service/worldbook/injection-engine', async () => {
  const actual = await vi.importActual<any>('../../../src/service/worldbook/injection-engine-config');
  return {
    getGlobalInjectionConfigFromData_ACU: actual.getGlobalInjectionConfigFromData_ACU,
  };
});

vi.mock('../../../src/service/template-assistant/compiler', () => ({
  compileTemplateAssistantDraft_ACU: mockCompileTemplateAssistantDraft,
  buildTemplateAssistantCumulativeCompileResult_ACU: mockBuildTemplateAssistantCumulativeCompileResult,
}));

vi.mock('../../../src/service/table/schema-migration-preflight', () => ({
  preflightSchemaMigrations_ACU: mockPreflightSchemaMigrations,
}));

import { SqliteRuntimeUnavailableError_ACU } from '../../../src/data/sqlite/sqlite-engine';

import {
  buildTemplateAssistantFingerprint_ACU,
  createTemplateAssistantSessionGuard_ACU,
  generateTemplateAssistantDraft_ACU,
  getTemplateAssistantApplyBaselineFingerprint_ACU,
  hasTemplateAssistantApplicableDraft_ACU,
  parseTemplateAssistantDraft_ACU,
  runTemplateAssistantSession_ACU,
  TemplateAssistantSessionStoppedError_ACU,
  validateTemplateAssistantDraft_ACU,
} from '../../../src/service/template-assistant/service';

function buildTempData_ACU() {
  return {
    mate: {
      type: 'chatSheets',
      version: 1,
      globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      },
    },
    sheet_a: {
      uid: 'sheet_a',
      name: 'A表',
      orderNo: 0,
      content: [['row_id', '姓名'], [1, '甲']],
      sourceData: { note: 'a', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
      updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
      exportConfig: { enabled: false, splitByRow: false, entryName: 'A表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: 'A表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } },
    },
  } as any;
}

describe('template assistant service', () => {
  beforeEach(() => {
    mockCallAIWithPreset.mockReset();
    mockLogError.mockReset();
    mockCompileTemplateAssistantDraft.mockReset();
    mockPreflightSchemaMigrations.mockReset();
    mockPreflightSchemaMigrations.mockResolvedValue({ changedSheetKeys: [], blockers: [], operations: [] });
    mockCompileTemplateAssistantDraft.mockImplementation((input: any) => ({
      candidateData: input.tempData,
      orderedSheetKeys: input.sheetOrder || [],
      deletedSheetKeys: [],
      focusSheetKey: input.currentSheetKey,
      diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
      highRiskItems: [],
      lockChanges: [],
      schemaMigrationIntents: {},
    }));
  });

  it('显式 tableApiPreset override 会覆盖默认 preset', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-override","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);

    await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', tableApiPreset: 'assistant-preset', protocolVersion: 2 });

    expect(mockCallAIWithPreset).toHaveBeenCalledWith(expect.any(Array), 'assistant-preset');
  });

  it('瞬时 503 重试后成功（调用形状逐字一致）', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset
      .mockRejectedValueOnce(Object.assign(new Error('API请求失败: 503'), { status: 503 }))
      .mockResolvedValueOnce(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-retry","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);

    await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', tableApiPreset: 'assistant-preset', protocolVersion: 2 });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(2);
  }, 15000);

  it('AbortError 立停不重试直接抛出', async () => {
    const tempData = buildTempData_ACU();
    mockCallAIWithPreset.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', tableApiPreset: 'assistant-preset', protocolVersion: 2 })).rejects.toThrow('aborted');
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
  });

  it('空 tableApiPreset override 时回退到既有 settings preset', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-fallback","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);

    await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', tableApiPreset: '   ', protocolVersion: 2 });

    expect(mockCallAIWithPreset).toHaveBeenCalledWith(expect.any(Array), 'preset-1');
  });

  it('提取最后一个合法标签块', () => {
    const draft = parseTemplateAssistantDraft_ACU(`x<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-old","baseFingerprint":"acu-struct:1","atomic":true,"selectedSheetKey":"sheet_a","summary":"旧","warnings":[],"operations":[]}</templateAssistantDraft>y<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-new","baseFingerprint":"acu-struct:2","atomic":true,"selectedSheetKey":"sheet_a","summary":"新","warnings":[],"operations":[]}</templateAssistantDraft>`);
    expect(draft.summary).toBe('新');
    expect(draft.baseFingerprint).toBe('acu-struct:2');
  });

  it('协议缺字段时报错', () => {
    expect(() => validateTemplateAssistantDraft_ACU({ protocolVersion: 1 })).toThrow(/mode/);
  });

  it('selectedSheetKey 为空字符串时报错', () => {
    expect(() => validateTemplateAssistantDraft_ACU({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      requestId: 'req-1',
      baseFingerprint: 'acu-struct:1',
      atomic: true,
      selectedSheetKey: '',
      summary: 'x',
      warnings: [],
      operations: [],
    })).toThrow(/selectedSheetKey 必须是非空字符串/);
  });

  it('v1 selectedSheetKey 与 patch op 的 sheetKey 不一致时报错', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":1,"mode":"modify_current_template_incremental","baseFingerprint":"${fp}","selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[{"op":"patch_sheet_update_config","sheetKey":"sheet_b","patch":{"contextDepth":8}}]}</templateAssistantDraft>`);
    await expect(generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', protocolVersion: 2 })).rejects.toThrow(/selectedSheetKey/);
  });

  it('v2 缺少 requestId 时校验失败', () => {
    expect(() => validateTemplateAssistantDraft_ACU({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      baseFingerprint: 'acu-struct:1',
      atomic: true,
      selectedSheetKey: 'sheet_a',
      summary: 'x',
      warnings: [],
      operations: [],
    })).toThrow(/requestId/);
  });

  it('add_sheet.sourceData.ddl 在 draft 校验阶段直接拒绝', () => {
    expect(() => validateTemplateAssistantDraft_ACU({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      requestId: 'req-ddl',
      baseFingerprint: 'acu-struct:1',
      atomic: true,
      selectedSheetKey: 'sheet_a',
      summary: 'x',
      warnings: [],
      operations: [{
        op: 'add_sheet',
        sheetName: '战利品表',
        headers: ['物品名称'],
        sourceData: {
          ddl: 'CREATE TABLE loot (row_id INTEGER PRIMARY KEY, item_name TEXT);',
        },
      }],
    })).toThrow(/add_sheet\.sourceData 不能直接修改 ddl/);
  });

  it('patch_sheet_source_data.patch.ddl 在 draft 校验阶段直接拒绝', () => {
    expect(() => validateTemplateAssistantDraft_ACU({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      requestId: 'req-patch-ddl',
      baseFingerprint: 'acu-struct:1',
      atomic: true,
      selectedSheetKey: 'sheet_a',
      summary: 'x',
      warnings: [],
      operations: [{
        op: 'patch_sheet_source_data',
        sheetKey: 'sheet_a',
        patch: {
          ddl: 'CREATE TABLE loot (row_id INTEGER PRIMARY KEY, item_name TEXT);',
        },
      }],
    })).toThrow(/patch_sheet_source_data\.patch 不能直接修改 ddl/);
  });

  it.each([
    ['缺少必填字段', {}, /physicalColumnMappings 必须是数组/],
    ['未知顶层字段', {
      physicalColumnMappings: [], fills: {}, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false }, unexpected: true,
    }, /migrationIntent 包含未知字段: unexpected/],
    ['错误 mapping', {
      physicalColumnMappings: [{ fromPhysicalName: 'name' }], fills: {}, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    }, /toPhysicalName 必须是非空字符串/],
    ['错误 fill kind', {
      physicalColumnMappings: [], fills: { added: { kind: 'computed', literal: { kind: 'string', sql: "'x'", value: 'x' } } }, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    }, /fills\.added\.kind 不受支持/],
    ['错误 conversion policy', {
      physicalColumnMappings: [], fills: {}, conversions: [{ fromPhysicalName: 'name', toPhysicalName: 'renamed', policy: { kind: 'rename' } }], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    }, /policy\.kind 不受支持/],
    ['缺少 migrationPolicy 确认值', {
      physicalColumnMappings: [], fills: {}, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false },
    }, /必须提供 destructiveChangeConfirmed 和 lossyConversionConfirmed 两个 boolean/],
  ])('patch_sheet_schema 的 migrationIntent %s 时在草稿校验阶段拒绝', (_caseName, migrationIntent, error) => {
    expect(() => validateTemplateAssistantDraft_ACU({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      requestId: 'req-invalid-migration-intent',
      baseFingerprint: 'acu-struct:1',
      atomic: true,
      selectedSheetKey: 'sheet_a',
      summary: '修改列名',
      warnings: [],
      operations: [{
        op: 'patch_sheet_schema',
        sheetKey: 'sheet_a',
        patch: {
          renameColumns: [{ from: '姓名', to: '角色名' }],
          migrationIntent,
        },
      }],
    })).toThrow(error);
  });

  it('V1-compatible schema 变更携带畸形 migrationIntent 时不会被 preflight 快路径静默接受', () => {
    expect(() => validateTemplateAssistantDraft_ACU({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      requestId: 'req-v1-bypass',
      baseFingerprint: 'acu-struct:1',
      atomic: true,
      selectedSheetKey: 'sheet_a',
      summary: '新增列',
      warnings: [],
      operations: [{
        op: 'patch_sheet_schema',
        sheetKey: 'sheet_a',
        patch: {
          addColumns: [{ name: '备注' }],
          migrationIntent: { physicalColumnMappings: [], fills: {}, conversions: [], migrationPolicy: 'confirmed' },
        },
      }],
    })).toThrow(/migrationPolicy 必须是普通对象/);
  });

  it('v2 允许跨表 patch op', async () => {
    const tempData = {
      ...buildTempData_ACU(),
      sheet_b: {
        uid: 'sheet_b',
        name: 'B表',
        orderNo: 1,
        content: [['row_id', '标题'], [1, '旧值']],
        sourceData: { note: 'b', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
        updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
        exportConfig: { enabled: false, splitByRow: false, entryName: 'B表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: 'B表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } },
      },
    } as any;
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-1","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[{"op":"patch_sheet_update_config","sheetKey":"sheet_b","patch":{"contextDepth":8}}]}</templateAssistantDraft>`);
    const result = await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a', 'sheet_b'], userRequest: '修改 B 表', protocolVersion: 2 });
    expect(result.draft.protocolVersion).toBe(2);
  });

  it('协议校验失败时会记录完整 AI 原始返回', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    const aiRawText = `<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-bad","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[{"op":"create_sheet","sheetName":"战利品表"}]}</templateAssistantDraft>`;
    mockCallAIWithPreset.mockResolvedValue(aiRawText);

    await expect(generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '帮我新建一个战利品表吧', protocolVersion: 2 })).rejects.toThrow(/包含当前协议不支持的操作/);

    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('[TemplateAssistant] draft 解析失败', expect.objectContaining({
      currentSheetKey: 'sheet_a',
      baseFingerprint: fp,
      userRequest: '帮我新建一个战利品表吧',
      aiRawText,
      errorMessage: expect.stringMatching(/包含当前协议不支持的操作/),
    }));
  });

  it('结构级 fingerprint 稳定', () => {
    const tempData = buildTempData_ACU();
    expect(buildTemplateAssistantFingerprint_ACU(tempData)).toBe(buildTemplateAssistantFingerprint_ACU(buildTempData_ACU()));
  });

  it('currentSheetKey 为空时直接拒绝生成', async () => {
    await expect(generateTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      currentSheetKey: null,
      sheetOrder: ['sheet_a'],
      userRequest: '修改当前表',
    })).rejects.toThrow(/请先选中一个表/);
    expect(mockCallAIWithPreset).not.toHaveBeenCalled();
  });

  it('构建 messages 后调用 callAIWithPreset_ACU', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-2","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);
    const result = await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '查看', protocolVersion: 2 });
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    expect(result.messages).toHaveLength(2);
  });

  it('构建 user payload 时不会向模型暴露 sourceData.ddl', async () => {
    const tempData = buildTempData_ACU();
    tempData.sheet_a.sourceData.ddl = 'CREATE TABLE a (row_id INTEGER PRIMARY KEY, 姓名 TEXT)';
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-payload","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);

    const result = await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '检查 payload', protocolVersion: 2 });
    const payload = JSON.parse(result.messages[1]?.content || '{}');
    const selectedSheet = payload.selectedSheet;
    const sheetA = Array.isArray(payload.allSheets) ? payload.allSheets.find((item: any) => item.sheetKey === 'sheet_a') : null;

    expect(selectedSheet?.sourceData?.ddl).toBeUndefined();
    expect(sheetA?.sourceData?.ddl).toBeUndefined();
    expect(selectedSheet?.sourceData?.note).toBe('a');
    expect(payload.constraints?.ddlMustPreserveHeaderOrder).toBe(true);
    expect(payload.constraints?.ddlChineseHeadersRequireCommentMapping).toBe(true);
    expect(payload.constraints?.ddlChineseHeadersForbidChinesePhysicalNames).toBe(true);
  });

  it('system prompt 会写死 op 字段、add_sheet 必填项和空 operations 回退规则', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-3","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);

    const result = await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '新增角色关系表', protocolVersion: 2 });
    const systemPrompt = result.messages[0]?.content || '';

    expect(systemPrompt).toContain('每个 operations[i] 必须使用 op 字段表示操作名');
    expect(systemPrompt).toContain('add_sheet 必须同时提供非空 sheetName 和至少一个 headers 项');
    expect(systemPrompt).toContain('应尽量同时提供 sourceData.note、sourceData.initNode、sourceData.insertNode、sourceData.updateNode、sourceData.deleteNode');
    expect(systemPrompt).toContain('add_sheet.sourceData 与 patch_sheet_source_data.patch 只允许 note、initNode、insertNode、updateNode、deleteNode 五个字段');
    expect(systemPrompt).toContain('除非用户明确要求 DDL、字段类型、约束或 SQLite 建表语句，否则不要主动输出 patch_sheet_schema.ddl');
    expect(systemPrompt).toContain('即使用户要求“顺便写 SQL/DDL”，也不要把 ddl 或 sql 塞进 add_sheet.sourceData');
    expect(systemPrompt).toContain('当用户对【已存在的表】明确要求 DDL、字段类型、约束或 SQLite 建表语句时，不得因为表已存在就返回空 operations');
    expect(systemPrompt).toContain('如果当前 headers 主要是中文，自定义 ddl 只有在你能提供英文/ASCII 物理列名');
    expect(systemPrompt).toContain('ASCII/英文 headers 必须由同名物理列匹配；中文 headers 必须使用英文/ASCII 物理列名');
    expect(systemPrompt).toContain('time_span TEXT NOT NULL, -- 时间跨度');
    expect(systemPrompt).toContain('row_id INTEGER PRIMARY KEY, -- 行号');
    expect(systemPrompt).toContain('即使是 row_id INTEGER PRIMARY KEY 这一行，也必须保留 `-- 行号` 注释');
    expect(systemPrompt).toContain('这种把中文表头直接写成物理列名的 ddl 会被拒绝');
    expect(systemPrompt).toContain('即使再写 `-- 物品名称` 这类同名注释也不合法');
    expect(systemPrompt).toContain('patch_sheet_schema.patch 只允许使用 renameColumns、addColumns、deleteColumns、ddl、migrationIntent');
    expect(systemPrompt).toContain('physicalColumnMappings（每项 {fromPhysicalName,toPhysicalName}）');
    expect(systemPrompt).toContain('destructiveChangeConfirmed,lossyConversionConfirmed');
    expect(systemPrompt).toContain('"fromPhysicalName":"name","toPhysicalName":"item_name"');
    expect(systemPrompt).toContain('ddl_literal_default');
    expect(systemPrompt).toContain('不要为刚 add_sheet 的新表生成依赖真实 sheetKey 的 follow-up patch');
    expect(systemPrompt).toContain('operations 输出空数组');
    expect(systemPrompt).toContain('{"op":"add_sheet","sheetName":"角色关系表","headers":["角色A","角色B","关系","备注"]}');
    expect(systemPrompt).toContain('{"op":"add_sheet","sheetName":"战利品表","headers":["物品名称","数量","描述/效果","类别"]');
    expect(systemPrompt).toContain('从 `syntax-reference (1).md` 和 `SQL模板语法从0开始上手教程.txt` 摘取的原文片段');
    expect(systemPrompt).toContain('【原文嵌入 / syntax-reference (1).md / 导读：两种运行模式的能力差异】');
    expect(systemPrompt).toContain('【原文嵌入 / SQL模板语法从0开始上手教程.txt / 第一个能用的例子（先看这个）】');
    expect(systemPrompt).toContain('语法能否生效取决于当前运行模式。**在看每一节前先对照这张表**：');
    expect(systemPrompt).toContain('你身上有 {[db.背包物品表.where(\'物品名称\', \'铁剑\').get(\'数量\')]} 把铁剑。');
    expect(systemPrompt).toContain('### 3.2 `<if cell="表达式">`');
    expect(systemPrompt).toContain('变量 · 存一个值反复用（as 和 $v:）');
    expect(systemPrompt).toContain('· 只能用英文、数字、下划线');
    expect(systemPrompt).toContain('· 不能用中文');
    expect(systemPrompt).toContain('如果你写了 {[db...]} 结果屏幕上原样显示没变成数字，就是模式没开。');
  });

  it('生成阶段将 compiler 收集的 migration intent 传给共享 preflight', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    const migrationIntent = {
      physicalColumnMappings: [{ fromPhysicalName: 'name', toPhysicalName: 'character_name' }],
      fills: {},
      conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    };
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>${JSON.stringify({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      requestId: 'req-migration-intent',
      baseFingerprint: fp,
      atomic: true,
      selectedSheetKey: 'sheet_a',
      summary: '改列名',
      warnings: [],
      operations: [{
        op: 'patch_sheet_schema',
        sheetKey: 'sheet_a',
        patch: { renameColumns: [{ from: '姓名', to: '角色名' }], migrationIntent },
      }],
    })}</templateAssistantDraft>`);
    mockCompileTemplateAssistantDraft.mockReturnValueOnce({
      candidateData: tempData,
      orderedSheetKeys: ['sheet_a'],
      deletedSheetKeys: [],
      focusSheetKey: 'sheet_a',
      diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
      highRiskItems: [],
      lockChanges: [],
      schemaMigrationIntents: { sheet_a: migrationIntent },
    });

    await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '把姓名改为角色名', protocolVersion: 2 });

    expect(mockPreflightSchemaMigrations).toHaveBeenCalledWith(expect.objectContaining({
      baselineData: tempData,
      candidateData: tempData,
      intents: { sheet_a: migrationIntent },
    }));
  });

  it('构建 messages 时会携带 prior-turn 历史', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-history","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);

    const result = await generateTemplateAssistantDraft_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '继续调整',
      priorTurns: [
        { user: '先建一个掉落表', assistant: '已生成初版草稿' },
        { user: '再补充备注列', assistant: '已补充备注列建议' },
      ],
      protocolVersion: 2,
    });

    expect(result.messages).toHaveLength(6);
    expect(result.messages[1]).toEqual({ role: 'user', content: '先建一个掉落表' });
    expect(result.messages[2]).toEqual({ role: 'assistant', content: '已生成初版草稿' });
    expect(result.messages[3]).toEqual({ role: 'user', content: '再补充备注列' });
    expect(result.messages[4]).toEqual({ role: 'assistant', content: '已补充备注列建议' });
    expect(JSON.parse(result.messages[5]?.content || '{}').userRequest).toBe('继续调整');
  });

  it('session loop 在空 operations 时停止并返回 metadata', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-session-empty","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"无需继续","warnings":[],"operations":[]}</templateAssistantDraft>`);

    const result = await runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '检查是否还需要修改',
      priorTurns: [{ user: '上一轮需求', assistant: '上一轮结果' }],
      maxRounds: 3,
      protocolVersion: 2,
    });

    expect(result.originalBaseFingerprint).toBe(fp);
    expect(result.session.stopReason).toBe('empty_operations');
    expect(result.session.roundsExecuted).toBe(1);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.messages[1]).toEqual({ role: 'user', content: '上一轮需求' });
    expect(result.rounds[0]?.messages[2]).toEqual({ role: 'assistant', content: '上一轮结果' });
    expect(mockPreflightSchemaMigrations).toHaveBeenCalledTimes(2);
    expect(mockPreflightSchemaMigrations.mock.calls[1][0]).toEqual(expect.objectContaining({
      baselineData: tempData,
      candidateData: result.compileResult.candidateData,
      intents: result.compileResult.schemaMigrationIntents,
    }));
  });



  it('改表助手是一问一答：无论有无 priorTurns，一次提交只执行 1 轮', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-first-round","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"第一轮","warnings":[],"operations":[{"op":"patch_sheet_update_config","sheetKey":"sheet_a","patch":{"contextDepth":8}}]}</templateAssistantDraft>`);

    // 有历史：传入 maxRounds=3 也必须只跑 1 轮
    const result = await runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '第二次对话需求',
      priorTurns: [{ user: '上一轮需求', assistant: '上一轮结果' }],
      maxRounds: 3,
      protocolVersion: 2,
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    expect(result.rounds).toHaveLength(1);
    expect(result.session.roundsExecuted).toBe(1);
    expect(result.session.maxRounds).toBe(1);
    expect(result.session.stopReason).toBe('success');
    // 单轮：compileResult 直接取该轮结果（与 generateTemplateAssistantDraft_ACU 语义一致）
    expect(result.compileResult).toBe(result.rounds[0]?.perRoundCompileResult);
    expect(result.session.finalWorkingFingerprint).toBe(buildTemplateAssistantFingerprint_ACU(result.compileResult.candidateData || tempData));
  });




  it('session loop 在修复重试耗尽时停止并保留错误信息', async () => {
    mockCallAIWithPreset.mockRejectedValue(new Error('mock ai failure'));

    const result = await runTemplateAssistantSession_ACU({
      tempData: buildTempData_ACU(),
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '请修复并继续',
      maxRounds: 1,
      maxRepairRetries: 1,
    });

    expect(result.session.stopReason).toBe('repair_retry_capped');
    expect(result.session.repairRetriesUsed).toBe(1);
    expect(result.session.lastErrorMessage).toContain('mock ai failure');
    expect(result.rounds).toHaveLength(0);
  });

  it('环境失败（sql.js 引擎不可用）不重试、不消耗 repairRetries、不回喂 AI（T6）', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    // AI 先正常返回合法 draft，环境失败只来自 preflight（SqliteRuntimeUnavailableError_ACU）。
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-env","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"环境失败","warnings":[],"operations":[]}</templateAssistantDraft>`);
    // 仅第一次 preflight 调用（generate 内）reject 环境错误：
    // environment 分支会 break，最终 preflight 不会被执行，无需 Once。
    mockPreflightSchemaMigrations.mockRejectedValueOnce(
      new SqliteRuntimeUnavailableError_ACU('sql.js 初始化失败: both async and sync fetching of the wasm failed'),
    );

    const result = await runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '修改当前表',
      maxRounds: 1,
      maxRepairRetries: 3,
      protocolVersion: 2,
    });

    // 环境失败立即终止：不可重试、不消耗 repairRetriesUsed、stopReason 独立。
    expect(result.session.stopReason).toBe('environment_failure');
    expect(result.session.repairRetriesUsed).toBe(0);
    expect(result.session.lastFailure?.kind).toBe('environment');
    // 不把 sql.js 错误当修复上下文回喂 AI：repairReason 不进入下一轮（无下一轮，且未重试）。
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    expect(result.rounds).toHaveLength(0);
  });

  it('apply baseline helper 同时兼容 legacy 与 session 结果', () => {
    expect(getTemplateAssistantApplyBaselineFingerprint_ACU({
      draft: { baseFingerprint: 'acu-struct:legacy' } as any,
      compileResult: {} as any,
      aiRawText: '',
      messages: [],
    })).toBe('acu-struct:legacy');

    expect(getTemplateAssistantApplyBaselineFingerprint_ACU({
      draft: { baseFingerprint: 'acu-struct:working' } as any,
      compileResult: {} as any,
      aiRawText: '',
      messages: [],
      originalBaseFingerprint: 'acu-struct:baseline',
      rounds: [],
      session: {
        originalBaseFingerprint: 'acu-struct:baseline',
        finalWorkingFingerprint: 'acu-struct:working',
        stopReason: 'empty_operations',
        roundsExecuted: 0,
        maxRounds: 1,
        lastFailure: null,
        repairRetriesUsed: 0,
        maxRepairRetries: 1,
        lastErrorMessage: '',
      },
    })).toBe('acu-struct:baseline');

    expect(getTemplateAssistantApplyBaselineFingerprint_ACU({
      draft: { baseFingerprint: 'acu-struct:working' } as any,
      compileResult: {} as any,
      aiRawText: '',
      messages: [],
      rounds: [],
      session: {
        originalBaseFingerprint: '',
        finalWorkingFingerprint: 'acu-struct:working',
        stopReason: 'empty_operations',
        roundsExecuted: 0,
        maxRounds: 1,
        lastFailure: null,
        repairRetriesUsed: 0,
        maxRepairRetries: 1,
        lastErrorMessage: '',
      },
    })).toBe('');
  });

  it('repair 重试耗尽时透出结构化 lastFailure（含失败分类与 AI 原文）', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    const aiRawText = `<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-bad-op","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[{"op":"create_sheet","sheetName":"战利品表"}]}</templateAssistantDraft>`;
    mockCallAIWithPreset.mockResolvedValue(aiRawText);

    const result = await runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '请生成草稿',
      protocolVersion: 2,
      maxRounds: 2,
      maxRepairRetries: 1,
    });

    expect(result.session.stopReason).toBe('repair_retry_capped');
    expect(result.session.repairRetriesUsed).toBe(1);
    expect(result.session.lastFailure).toEqual({
      kind: 'validate',
      message: expect.stringMatching(/包含当前协议不支持的操作/),
      rawText: aiRawText,
    });
    expect(result.rounds).toHaveLength(0);
    expect(result.draft.operations).toEqual([]);
  });

  it('无标签垃圾文本失败时 lastFailure.kind 为 parse 且携带原文', async () => {
    const tempData = buildTempData_ACU();
    mockCallAIWithPreset.mockResolvedValue('这只是一句解释，没有任何 JSON');

    const result = await runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '请生成草稿',
      maxRounds: 2,
      maxRepairRetries: 0,
    });

    expect(result.session.stopReason).toBe('repair_retry_capped');
    expect(result.session.lastFailure?.kind).toBe('parse');
    expect(result.session.lastFailure?.rawText).toBe('这只是一句解释，没有任何 JSON');
    expect(result.session.lastFailure?.message).toContain('JSON');
  });

  it('preflight 失败时 lastFailure.kind 为 preflight', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-preflight","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);
    mockPreflightSchemaMigrations.mockResolvedValueOnce({ changedSheetKeys: [], blockers: ['迁移不可逆'], operations: [] });

    const result = await runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '请生成草稿',
      maxRounds: 1,
      maxRepairRetries: 0,
      protocolVersion: 2,
    });

    expect(result.session.stopReason).toBe('repair_retry_capped');
    expect(result.session.lastFailure?.kind).toBe('preflight');
    expect(result.session.lastFailure?.message).toContain('迁移不可逆');
  });

  it('先失败后成功时 lastFailure 被清空（成功会话不误报失败）', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    const okDraft = `<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-ok","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"ok","warnings":[],"operations":[]}</templateAssistantDraft>`;
    // 第 1 轮：解析失败；第 2 轮（修复重试）：成功产出空操作 draft
    mockCallAIWithPreset
      .mockResolvedValueOnce('不是 JSON 的解释文本')
      .mockResolvedValueOnce(okDraft);

    const result = await runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '请生成草稿',
      maxRounds: 3,
      maxRepairRetries: 1,
      protocolVersion: 2,
    });

    expect(result.session.stopReason).toBe('empty_operations');
    expect(result.session.repairRetriesUsed).toBe(1);
    // 成功路径清空 lastFailure，避免面板误显示失败横幅
    expect(result.session.lastFailure).toBeNull();
    expect(result.session.lastErrorMessage).toBe('');
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.aiRawText).toBe(okDraft);

  });




  it('session loop 在 guard.cancel() 后中断：不返回成功结果，抛出停止错误（停止按钮语义）', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-cancel-1","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"第一轮","warnings":[],"operations":[{"op":"patch_sheet_update_config","sheetKey":"sheet_a","patch":{"contextDepth":8}}]}</templateAssistantDraft>`);

    const guard = createTemplateAssistantSessionGuard_ACU();
    const runGuard = guard.createRunGuard();
    let cancelled = false;

    // 单轮：onRoundComplete 在 AI 返回后触发。回调中 cancel 后，
    // service 必须在收尾前再次确认会话活动，并抛出停止错误，而不是提交成功结果。
    await expect(runTemplateAssistantSession_ACU({
      tempData,
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '连续处理',
      priorTurns: [{ user: '上一轮需求', assistant: '上一轮结果' }],
      maxRounds: 3,
      protocolVersion: 2,
      guard: runGuard,
      onRoundComplete() {
        if (!cancelled) {
          cancelled = true;
          guard.cancel();
        }
      },
    } as any)).rejects.toBeInstanceOf(TemplateAssistantSessionStoppedError_ACU);

    expect(runGuard.isCancelled?.()).toBe(true);
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
  });


  it('guard.cancel() 后其 signal 被 abort（AbortController 已接通）', () => {
    const guard = createTemplateAssistantSessionGuard_ACU();
    const signal = guard.getSignal();
    expect(signal?.aborted).toBe(false);
    guard.cancel();
    expect(signal?.aborted).toBe(true);
  });

  it('传递 guard 时 generateTemplateAssistantDraft_ACU 将 signal 传给 callAIWithPreset，且 cancel 后 signal 已 abort', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-signal","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);

    const guard = createTemplateAssistantSessionGuard_ACU();
    // 先初始化 AbortController，使 runGuard.signal 非空
    guard.getSignal();
    const runGuard = guard.createRunGuard();

    await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', guard: runGuard, protocolVersion: 2 });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    const signalArg = mockCallAIWithPreset.mock.calls[0][3];
    expect(signalArg).toBeDefined();
    expect(signalArg.aborted).toBe(false);


    guard.cancel();
    expect(signalArg.aborted).toBe(true);
    expect(runGuard.isCancelled?.()).toBe(true);
  });


  it('v3 会话全部失败时回退的 noop draft 不可应用且协议版本为 3', async () => {
    mockCallAIWithPreset.mockRejectedValue(new Error('mock ai failure'));

    const result = await runTemplateAssistantSession_ACU({
      tempData: buildTempData_ACU(),
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '请生成草稿',
      maxRounds: 1,
      maxRepairRetries: 0,
    });

    expect(result.session.stopReason).toBe('repair_retry_capped');
    expect(result.draft.protocolVersion).toBe(3);
    expect(hasTemplateAssistantApplicableDraft_ACU(result.draft)).toBe(false);
    expect(result.draft.result).toBeUndefined();
  });


  it('协议一致性门禁：默认 v3 请求下 AI 返回 v2 draft 会被拒绝（validate）', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    const v2RawText = `<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-mix","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`;
    mockCallAIWithPreset.mockResolvedValue(v2RawText);

    await expect(
      generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表' }),
    ).rejects.toMatchObject({ failureKind: 'validate' });
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
  });

  it('协议一致性门禁：显式 v3 请求下 AI 返回 v2 draft 会被拒绝，v2 请求接受 v1 输出', async () => {
    const tempData = buildTempData_ACU();
    const fp = buildTemplateAssistantFingerprint_ACU(tempData);
    const v2RawText = `<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-mix2","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`;
    mockCallAIWithPreset.mockResolvedValue(v2RawText);

    await expect(
      generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', protocolVersion: 3 }),
    ).rejects.toMatchObject({ failureKind: 'validate' });

    // v2 请求接受 v1 输出（存量兼容）
    mockCallAIWithPreset.mockResolvedValue(`<templateAssistantDraft>{"protocolVersion":1,"mode":"modify_current_template_incremental","baseFingerprint":"${fp}","selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`);
    const v1Result = await generateTemplateAssistantDraft_ACU({ tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'], userRequest: '修改当前表', protocolVersion: 2 });
    expect(v1Result.draft.protocolVersion).toBe(1);
  });


  describe('v3 上下文预算守卫', () => {
    it('v3 payload 超过预算时拒绝请求且不调用 AI（fail-closed）', async () => {
      const tempData = buildTempData_ACU();
      // 构造超长 userRequest，使 v3 payload 超过 40,000 字符。
      const hugeRequest = '请修改当前表。' + '扩'.repeat(45_000);
      await expect(
        generateTemplateAssistantDraft_ACU({
          tempData,
          currentSheetKey: 'sheet_a',
          sheetOrder: ['sheet_a'],
          userRequest: hugeRequest,
        }),
      ).rejects.toThrow(/预算超限|context budget/i);
      expect(mockCallAIWithPreset).not.toHaveBeenCalled();
    });

    it('v2 payload 不受 v3 预算限制', async () => {
      const tempData = buildTempData_ACU();
      const fp = buildTemplateAssistantFingerprint_ACU(tempData);
      const hugeRequest = '请修改当前表。' + '扩'.repeat(45_000);
      mockCallAIWithPreset.mockResolvedValue(
        `<templateAssistantDraft>{"protocolVersion":2,"mode":"modify_current_template_incremental","requestId":"req-budget-v2","baseFingerprint":"${fp}","atomic":true,"selectedSheetKey":"sheet_a","summary":"x","warnings":[],"operations":[]}</templateAssistantDraft>`,
      );
      const result = await generateTemplateAssistantDraft_ACU({
        tempData,
        currentSheetKey: 'sheet_a',
        sheetOrder: ['sheet_a'],
        userRequest: hugeRequest,
        protocolVersion: 2,
      });
      expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
      expect(result.draft.protocolVersion).toBe(2);
    });
  });

  });
