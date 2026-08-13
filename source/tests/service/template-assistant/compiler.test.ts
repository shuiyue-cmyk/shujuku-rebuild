import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: (data: any) => Object.keys(data || {}).filter((key) => key.startsWith('sheet_')).sort((a, b) => (data[a]?.orderNo ?? 0) - (data[b]?.orderNo ?? 0)),
}));

vi.mock('../../../src/service/worldbook/injection-engine', async () => {
  const actual = await vi.importActual<any>('../../../src/service/worldbook/injection-engine-config');
  return {
    buildDefaultExportConfig_ACU: actual.buildDefaultExportConfig_ACU,
    ensureGlobalInjectionConfigDefaults_ACU: actual.ensureGlobalInjectionConfigDefaults_ACU,
    ensureSheetExportConfigDefaults_ACU: actual.ensureSheetExportConfigDefaults_ACU,
  };
});

vi.mock('../../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: (name: string) => /纪要|大纲/.test(String(name || '')),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  isSpecialIndexLockEnabled_ACU: vi.fn(() => true),
  getSummaryIndexColumnIndex_ACU: vi.fn((table: any) => {
    const headers = Array.isArray(table?.content?.[0]) ? table.content[0].slice(1) : [];
    const idx = headers.findIndex((item: string) => /编码|索引/.test(String(item || '')));
    return idx >= 0 ? idx : (headers.length ? headers.length - 1 : -1);
  }),
  applySummaryIndexSequenceToTable_ACU: vi.fn((table: any, colIndex: number) => {
    if (!Array.isArray(table?.content) || colIndex < 0) return;
    for (let i = 1; i < table.content.length; i += 1) {
      if (Array.isArray(table.content[i])) {
        table.content[i][colIndex + 1] = `AM${String(i).padStart(4, '0')}`;
      }
    }
  }),
}));

import { compileTemplateAssistantDraft_ACU } from '../../../src/service/template-assistant/compiler';

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
      content: [['row_id', '姓名', '备注'], [1, '甲', '旧备注']],
      sourceData: { note: 'a', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
      updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
      exportConfig: { enabled: false, splitByRow: false, entryName: 'A表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: 'A表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } },
    },
    sheet_b: {
      uid: 'sheet_b',
      name: 'B表',
      orderNo: 1,
      content: [['row_id', '标题'], [1, '旧值']],
      sourceData: { note: 'b', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
      updateConfig: { uiSentinel: -1, contextDepth: 3, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
      exportConfig: { enabled: true, splitByRow: false, entryName: 'B表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: 'B表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } },
    },
    sheet_summary: {
      uid: 'sheet_summary',
      name: '纪要表',
      orderNo: 2,
      content: [['row_id', '标题', '编码索引'], [1, '第一条', 'AM0001']],
      sourceData: { note: 'summary', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
      updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
      exportConfig: { enabled: false, splitByRow: false, entryName: '纪要表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: '纪要表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } },
    },
  } as any;
}

describe('compileTemplateAssistantDraft_ACU', () => {
  it('add_sheet 生成兼容的新表对象', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        operations: [
          { op: 'add_sheet', sheetName: '战利品表', headers: ['物品', '品质'], sourceData: { note: 'loot' } },
        ],
      },
    });

    expect(result.diff.addedSheets).toHaveLength(1);
    const addedKey = result.diff.addedSheets[0].sheetKey;
    expect(addedKey).toBe('sheet_zhan_li_pin_biao');
    expect(result.candidateData[addedKey].content[0]).toEqual(['row_id', '物品', '品质']);
    expect(result.candidateData[addedKey].updateConfig.groupId).toBe(-1);
    expect(result.candidateData[addedKey].sourceData.initNode).toContain('初始化');
    expect(result.candidateData[addedKey].sourceData.insertNode).toContain('新增');
    expect(result.focusSheetKey).toBe(addedKey);
  });

  it('add_sheet 缺省 sourceData 时会生成可用的初始化脚手架', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        operations: [
          { op: 'add_sheet', sheetName: '战利品表', headers: ['物品名称', '数量', '描述/效果', '类别'] },
        ],
      },
    });

    const addedKey = result.diff.addedSheets[0].sheetKey;
    expect(result.candidateData[addedKey].sourceData.note).toContain('记录战利品表中的物品或战利品条目');
    expect(result.candidateData[addedKey].sourceData.note).toContain('列1: 物品名称');
    expect(result.candidateData[addedKey].sourceData.initNode).toContain('不要编造');
    expect(result.candidateData[addedKey].sourceData.updateNode).toContain('数量');
    expect(result.candidateData[addedKey].sourceData.updateNode).toContain('更新');
    expect(result.candidateData[addedKey].sourceData.deleteNode).toContain('删除');
  });

  it('add_sheet 拒绝与现有表 canonical 重名的名称', () => {
    const data = buildTempData_ACU();
    data.sheet_a.name = '背包';

    expect(() => compileTemplateAssistantDraft_ACU({
      tempData: data,
      sheetOrder: ['sheet_a'],
      draft: {
        version: 2,
        selectedSheetKey: 'sheet_a',
        operations: [{ op: 'add_sheet', sheetName: ' 背包 ', headers: ['物品'] }],
      },
    } as any)).toThrow('与现有表重复');
  });

  it('add_sheet 拒绝重复表头', () => {
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        operations: [
          { op: 'add_sheet', sheetName: '战利品表', headers: ['物品名称', '物品名称'] },
        ],
      },
    })).toThrow(/列名重复/);
  });

  it('add_sheet 拒绝把 row_id 当作业务表头', () => {
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        operations: [
          { op: 'add_sheet', sheetName: '战利品表', headers: ['row_id', '物品名称'] },
        ],
      },
    })).toThrow(/不能为 row_id/);
  });

  it('add_sheet 拒绝未知 sourceData 字段和直接注入 ddl', () => {
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        operations: [
          { op: 'add_sheet', sheetName: '战利品表', headers: ['物品'], sourceData: { ddl: 'CREATE TABLE loot(id INTEGER);' } },
        ],
      },
    })).toThrow(/未知字段/);
  });

  it('rename_sheet 只改表名', () => {
    const data = buildTempData_ACU();
    const result = compileTemplateAssistantDraft_ACU({
      tempData: data,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 2, operations: [{ op: 'rename_sheet', sheetKey: 'sheet_a', newName: '新A表' }] },
    });

    expect(result.candidateData.sheet_a.name).toBe('新A表');
    expect(result.candidateData.sheet_a.content).toEqual(data.sheet_a.content);
  });

  it('delete_sheet 产出删除 key 并更新顺序', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 2, operations: [{ op: 'delete_sheet', sheetKey: 'sheet_b' }] },
    });

    expect(result.deletedSheetKeys).toEqual(['sheet_b']);
    expect(result.orderedSheetKeys).toEqual(['sheet_a', 'sheet_summary']);
    expect(result.highRiskItems[0]?.type).toBe('delete_sheet');
  });

  it('move_sheet 重建 orderedSheetKeys', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 2, operations: [{ op: 'move_sheet', sheetKey: 'sheet_b', beforeSheetKey: 'sheet_a' }] },
    });

    expect(result.orderedSheetKeys).toEqual(['sheet_b', 'sheet_a', 'sheet_summary']);
    expect(result.diff.movedSheets[0]?.toIndex).toBe(0);
  });

  it('v1 patch_sheet_update_config 保留当前表限制', () => {
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 1, selectedSheetKey: 'sheet_b', operations: [{ op: 'patch_sheet_update_config', sheetKey: 'sheet_b', patch: { contextDepth: 8 } }] },
    })).toThrow(/只能修改当前选中表/);
  });

  it('v2 允许跨表 patch_sheet_update_config', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 2, selectedSheetKey: 'sheet_a', operations: [{ op: 'patch_sheet_update_config', sheetKey: 'sheet_b', patch: { contextDepth: 8 } }] },
    });

    expect(result.candidateData.sheet_b.updateConfig.contextDepth).toBe(8);
    expect(result.candidateData.sheet_b.updateConfig.updateFrequency).toBe(-1);
  });

  it('patch_sheet_export_config 保持默认值完整', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_b',
      draft: { protocolVersion: 2, selectedSheetKey: 'sheet_b', operations: [{ op: 'patch_sheet_export_config', sheetKey: 'sheet_b', patch: { enabled: false } }] },
    });

    expect(result.candidateData.sheet_b.exportConfig.extraIndexPlacement).toBeTruthy();
    expect(result.candidateData.sheet_b.exportConfig.enabled).toBe(false);
  });

  it('patch_global_injection_config 复用默认 normalize 结果', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 2, operations: [{ op: 'patch_global_injection_config', patch: { readableEntryPlacement: { position: 'after_character_definition', depth: 4, order: 100 } } }] },
    });

    expect(result.candidateData.mate.globalInjectionConfig.readableEntryPlacement.position).toBe('after_character_definition');
    expect(result.diff.globalInjectionChanged).toBe(true);
  });

  it('patch_sheet_content 支持改单元格、增行、删行', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        selectedSheetKey: 'sheet_a',
        operations: [{
          op: 'patch_sheet_content',
          sheetKey: 'sheet_a',
          patch: {
            updateCells: [{ rowNumber: 1, columnName: '备注', value: '新备注' }],
            addRows: [{ 姓名: '乙', 备注: '第二行' }],
            deleteRows: [1],
          },
        }],
      },
    });

    expect(result.diff.patchedContentSheets[0]?.changes.join('；')).toContain('改单元格');
    expect(result.diff.patchedContentSheets[0]?.changes.join('；')).toContain('新增 1 行');
    expect(result.candidateData.sheet_a.content).toEqual([
      ['row_id', '姓名', '备注'],
      [null, '乙', '第二行'],
    ]);
  });

  it('patch_sheet_schema 支持结构修改并标记高风险', () => {
    const tempData = buildTempData_ACU();
    tempData.sheet_a.content = [['row_id', 'name', 'note'], [1, '甲', '旧备注']];
    tempData.sheet_a.sourceData.ddl = 'CREATE TABLE a (row_id INTEGER PRIMARY KEY, name TEXT, note TEXT)';
    const result = compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        selectedSheetKey: 'sheet_a',
        operations: [{
          op: 'patch_sheet_schema',
          sheetKey: 'sheet_a',
          patch: {
            renameColumns: [{ from: 'name', to: 'character_name' }],
            addColumns: [{ name: 'age', defaultValue: 18 }],
            deleteColumns: ['note'],
            ddl: 'CREATE TABLE a (row_id INTEGER PRIMARY KEY, character_name TEXT, age INTEGER)',
          },
        }],
      },
    });

    expect(result.candidateData.sheet_a.content[0]).toEqual(['row_id', 'character_name', 'age']);
    expect(result.candidateData.sheet_a.content[1]).toEqual([1, '甲', 18]);
    expect(result.diff.patchedSchemaSheets[0]?.changes.join('；')).toContain('列改名');
    expect(result.highRiskItems.some((item) => item.type === 'patch_sheet_schema')).toBe(true);
  });

  it('patch_sheet_schema.ddl 支持英文物理列名配中文注释与中文表头', () => {
    const tempData = buildTempData_ACU();
    tempData.sheet_a.content = [['row_id', '物品名称', '数量', '时间跨度', '备注']];

    const result = compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        selectedSheetKey: 'sheet_a',
        operations: [{
          op: 'patch_sheet_schema',
          sheetKey: 'sheet_a',
          patch: {
            ddl: `CREATE TABLE loot_table ( -- 战利品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT, -- 物品名称
  quantity INTEGER, -- 数量
  time_span TEXT NOT NULL, -- 时间跨度
  remarks TEXT -- 备注
);`,
          },
        }],
      },
    });

    expect(result.candidateData.sheet_a.sourceData.ddl).toContain('item_name TEXT');
    expect(result.candidateData.sheet_a.sourceData.ddl).toContain('time_span TEXT NOT NULL');
    expect(result.diff.patchedSchemaSheets[0]?.changes).toContain('DDL 已更新');
  });

  it('patch_sheet_schema 将 migrationIntent 原样克隆到 compile result', () => {
    const migrationIntent = {
      physicalColumnMappings: [{ fromPhysicalName: 'name', toPhysicalName: 'character_name' }],
      fills: {},
      conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    };
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        selectedSheetKey: 'sheet_a',
        operations: [{
          op: 'patch_sheet_schema',
          sheetKey: 'sheet_a',
          patch: { renameColumns: [{ from: '姓名', to: '角色名' }], migrationIntent },
        }],
      },
    });

    expect(result.schemaMigrationIntents.sheet_a).toEqual(migrationIntent);
    expect(result.schemaMigrationIntents.sheet_a).not.toBe(migrationIntent);
  });

  it('patch_sheet_schema.ddl 拒绝中文物理列名，即使带同名中文注释', () => {
    const tempData = buildTempData_ACU();
    tempData.sheet_a.content = [['row_id', '物品名称', '数量', '备注']];

    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        selectedSheetKey: 'sheet_a',
        operations: [{
          op: 'patch_sheet_schema',
          sheetKey: 'sheet_a',
          patch: {
            ddl: `CREATE TABLE loot_table ( -- 战利品表
  row_id INTEGER PRIMARY KEY, -- 行号
  物品名称 TEXT, -- 物品名称
  数量 INTEGER, -- 数量
  备注 TEXT -- 备注
);`,
          },
        }],
      },
    })).toThrow(/物理列名必须使用英文\/ASCII/);
  });

  it('patch_sheet_schema.ddl 在无中文注释映射时仍拒绝英文物理列名', () => {
    const tempData = buildTempData_ACU();
    tempData.sheet_a.content = [['row_id', '物品名称', '数量', '备注']];

    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 2,
        selectedSheetKey: 'sheet_a',
        operations: [{
          op: 'patch_sheet_schema',
          sheetKey: 'sheet_a',
          patch: {
            ddl: `CREATE TABLE loot_table (
  row_id INTEGER PRIMARY KEY,
  item_name TEXT,
  quantity INTEGER,
  remarks TEXT
);`,
          },
        }],
      },
    })).toThrow(/第 1 列不匹配/);
  });

  it('patch_sheet_locks 产出声明式 lockChanges 并汇总 diff', () => {
    const result = compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_summary',
      draft: {
        protocolVersion: 2,
        selectedSheetKey: 'sheet_summary',
        operations: [{
          op: 'patch_sheet_locks',
          sheetKey: 'sheet_summary',
          patch: {
            rows: [{ rowNumber: 1, locked: true }],
            columns: [{ columnName: '标题', locked: true }],
            cells: [{ rowNumber: 1, columnName: '标题', locked: false }],
            specialIndexLocked: true,
          },
        }],
      },
    });

    expect(result.lockChanges).toHaveLength(1);
    expect(result.lockChanges[0].rows).toEqual([{ rowIndex: 0, locked: true }]);
    expect(result.lockChanges[0].columns).toEqual([{ colIndex: 0, locked: true }]);
    expect(result.lockChanges[0].cells).toEqual([{ rowIndex: 0, colIndex: 0, locked: false }]);
    expect(result.lockChanges[0].specialIndexLocked).toBe(true);
    expect(result.diff.patchedLockSheets[0]?.changes.join('；')).toContain('启用编码索引列特殊锁定');
  });

  it('拒绝未知结构 patch 字段', () => {
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 2, selectedSheetKey: 'sheet_a', operations: [{ op: 'patch_sheet_source_data', sheetKey: 'sheet_a', patch: { unknownField: 'x' } }] },
    })).toThrow(/未知字段/);
  });

  it('拒绝对普通表设置 specialIndexLocked', () => {
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData: buildTempData_ACU(),
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: { protocolVersion: 2, selectedSheetKey: 'sheet_a', operations: [{ op: 'patch_sheet_locks', sheetKey: 'sheet_a', patch: { specialIndexLocked: true } }] },
    })).toThrow(/仅支持纪要\/大纲类表格/);
  });
});

function buildV3ReplaceDraft_ACU(fp: string, sheetKey: string, sheet: any) {
  return {
    protocolVersion: 3,
    mode: 'single_sheet_full_replace',
    requestId: 'req-v3',
    baseFingerprint: fp,
    atomic: true,
    selectedSheetKey: sheetKey,
    summary: 'x',
    warnings: [],
    result: { action: 'replace', sheetKey, sheet },
  };
}

function buildV3CreateDraft_ACU(fp: string, sheet: any, insertAfterSheetKey?: string) {
  return {
    protocolVersion: 3,
    mode: 'single_sheet_full_replace',
    requestId: 'req-v3',
    baseFingerprint: fp,
    atomic: true,
    selectedSheetKey: 'sheet_a',
    summary: 'x',
    warnings: [],
    result: { action: 'create', sheet, ...(insertAfterSheetKey ? { insertAfterSheetKey } : {}) },
  };
}

function buildV3FullSheet_ACU(overrides: any = {}) {
  return {
    name: 'A表',
    domain: 'chat',
    type: 'dynamic',
    enable: true,
    required: false,
    content: [['row_id', '姓名', '备注'], [1, '甲', '新备注']],
    sourceData: {
      note: 'a',
      ddl: 'CREATE TABLE a (row_id INTEGER PRIMARY KEY, -- 行号\n  name TEXT, -- 姓名\n  remark TEXT -- 备注\n);',
    },
    updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
    exportConfig: { enabled: false, splitByRow: false, entryName: 'A表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: 'A表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } },
    ...overrides,
  };
}

describe('v3 单表完整替换协议', () => {
  const fp = 'fp-v3';

  it('replace 完整替换目标表并继承本地身份/顺序', () => {
    const tempData = buildTempData_ACU();
    const result = compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', buildV3FullSheet_ACU()),
    });

    expect(result.candidateData.sheet_a.content).toEqual([['row_id', '姓名', '备注'], [1, '甲', '新备注']]);
    expect(result.candidateData.sheet_a.uid).toBe('sheet_a');
    expect(result.candidateData.sheet_a.orderNo).toBe(0);
    expect(result.candidateData.sheet_b.name).toBe('B表');
    expect(result.candidateData.sheet_summary.name).toBe('纪要表');
    expect(result.focusSheetKey).toBe('sheet_a');
    expect(result.deletedSheetKeys).toEqual([]);
  });

  it('replace 未目标表保持不变（缺席不删除）', () => {
    const tempData = buildTempData_ACU();
    const result = compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', buildV3FullSheet_ACU()),
    });

    expect(Object.keys(result.candidateData).sort()).toEqual(['mate', 'sheet_a', 'sheet_b', 'sheet_summary']);
    expect(result.candidateData.sheet_b.content[1]).toEqual([1, '旧值']);
    expect(result.candidateData.sheet_summary.content[1]).toEqual([1, '第一条', 'AM0001']);
  });

  it('replace 目标表不存在时报错', () => {
    const tempData = buildTempData_ACU();
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_not_exist', buildV3FullSheet_ACU()),
    })).toThrow(/找不到目标表/);
  });

  it('replace 拒绝缺必填字段的完整 Sheet', () => {
    const tempData = buildTempData_ACU();
    const sheet = buildV3FullSheet_ACU();
    delete sheet.required;
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', sheet),
    })).toThrow(/缺少必填字段: required/);
  });

  it('replace 拒绝缺 DDL 或非法 DDL', () => {
    const tempData = buildTempData_ACU();
    const noDdl = buildV3FullSheet_ACU({ sourceData: { note: 'a' } });
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', noDdl),
    })).toThrow(/必须提供非空 sourceData.ddl/);

    const badDdl = buildV3FullSheet_ACU({ sourceData: { note: 'a', ddl: 'CREATE TABLE a (row_id INTEGER PRIMARY KEY, 姓名 TEXT)' } });
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', badDdl),
    })).toThrow(/sourceData.ddl 非法/);
  });

  it('replace 拒绝表头非 row_id 开头', () => {
    const tempData = buildTempData_ACU();
    const sheet = buildV3FullSheet_ACU({ content: [['姓名', '备注'], [1, 'x']] });
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', sheet),
    })).toThrow(/必须为 row_id/);
  });

  it('replace 拒绝行宽不一致', () => {
    const tempData = buildTempData_ACU();
    const sheet = buildV3FullSheet_ACU({ content: [['row_id', '姓名', '备注'], [1, '甲']] });
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', sheet),
    })).toThrow(/行宽/);
  });

  it('replace 拒绝 row_id 重复', () => {
    const tempData = buildTempData_ACU();
    const sheet = buildV3FullSheet_ACU({ content: [['row_id', '姓名', '备注'], [1, '甲', 'x'], [1, '乙', 'y']] });
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3ReplaceDraft_ACU(fp, 'sheet_a', sheet),
    })).toThrow(/row_id 重复/);
  });

  it('create 分配本地身份并保持未目标表不变', () => {
    const tempData = buildTempData_ACU();
    const result = compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3CreateDraft_ACU(fp, buildV3FullSheet_ACU({ name: '战利品表', content: [['row_id', 'item'], [1, '金币']], sourceData: { note: 'loot', ddl: 'CREATE TABLE loot (row_id INTEGER PRIMARY KEY, -- 行号\n  item TEXT\n);' } })),
    });

    expect(result.diff.addedSheets).toHaveLength(1);
    const newKey = result.diff.addedSheets[0].sheetKey;
    expect(newKey).toBe('sheet_zhan_li_pin_biao');
    expect(result.candidateData[newKey].uid).toBe(newKey);
    expect(result.candidateData[newKey].orderNo).toBe(3);
    expect(result.candidateData.sheet_a.name).toBe('A表');
    expect(result.focusSheetKey).toBe(newKey);
  });

  it('create 表名重复时报错', () => {
    const tempData = buildTempData_ACU();
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3CreateDraft_ACU(fp, buildV3FullSheet_ACU({ name: 'A表', content: [['row_id', 'item'], [1, '金币']], sourceData: { note: 'loot', ddl: 'CREATE TABLE loot (row_id INTEGER PRIMARY KEY, -- 行号\n  item TEXT\n);' } })),
    })).toThrow(/表名.*重复/);
  });

  it('delete 显式删除目标表并返回焦点', () => {
    const tempData = buildTempData_ACU();
    const result = compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 3,
        mode: 'single_sheet_full_replace',
        requestId: 'req-v3',
        baseFingerprint: fp,
        atomic: true,
        selectedSheetKey: 'sheet_a',
        summary: 'x',
        warnings: [],
        result: { action: 'delete', sheetKey: 'sheet_b' },
      },
    });

    expect(result.deletedSheetKeys).toEqual(['sheet_b']);
    expect(result.candidateData.sheet_b).toBeUndefined();
    expect(result.candidateData.sheet_a).toBeDefined();
    expect(result.candidateData.sheet_summary).toBeDefined();
    expect(result.highRiskItems.some((item) => item.type === 'delete_sheet')).toBe(true);
    expect(result.focusSheetKey).toBe('sheet_a');
  });

  it('delete 目标表不存在时报错', () => {
    const tempData = buildTempData_ACU();
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: {
        protocolVersion: 3,
        mode: 'single_sheet_full_replace',
        requestId: 'req-v3',
        baseFingerprint: fp,
        atomic: true,
        selectedSheetKey: 'sheet_a',
        summary: 'x',
        warnings: [],
        result: { action: 'delete', sheetKey: 'sheet_not_exist' },
      },
    })).toThrow(/找不到目标表/);
  });

  it('create 的 insertAfterSheetKey 不存在时报错', () => {
    const tempData = buildTempData_ACU();
    expect(() => compileTemplateAssistantDraft_ACU({
      tempData,
      sheetOrder: ['sheet_a', 'sheet_b', 'sheet_summary'],
      currentSheetKey: 'sheet_a',
      draft: buildV3CreateDraft_ACU(fp, buildV3FullSheet_ACU({ name: '战利品表', content: [['row_id', 'item'], [1, '金币']], sourceData: { note: 'loot', ddl: 'CREATE TABLE loot (row_id INTEGER PRIMARY KEY, -- 行号\n  item TEXT\n);' } }), 'sheet_missing'),
    })).toThrow(/insertAfterSheetKey 不存在/);
  });
});

