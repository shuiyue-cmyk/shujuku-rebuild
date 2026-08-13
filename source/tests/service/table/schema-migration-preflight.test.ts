import { describe, expect, it } from 'vitest';
import { preflightSchemaMigrations_ACU } from '../../../src/service/table/schema-migration-preflight';

function sheet(overrides: Record<string, any> = {}): any {
  return {
    uid: 'inventory', name: '背包', orderNo: 0,
    content: [['row_id', 'name'], ['1', 'iron sword']],
    sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    updateConfig: {}, exportConfig: {}, ...overrides,
  };
}

function state(value: any): any {
  return { mate: { type: 'acu', version: 1 }, sheet_inventory: value };
}

describe('schema migration preflight', () => {
  it('V1 安全子集返回仅内存 operation，且不修改输入', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'name', 'quality'], ['1', 'iron sword', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT);' },
    }));
    const before = structuredClone({ baseline, candidate });

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ kind: 'sheet_schema_migrate', contractVersion: 1 });
    expect({ baseline, candidate }).toEqual(before);
  });

  it('未确认删列返回结构化确认 issue 且不返回 operation', async () => {
    const baseline = state(sheet({
      content: [['row_id', 'name', 'note'], ['1', 'iron sword', 'old note']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, note TEXT);' },
    }));
    const candidate = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    }));
    const before = structuredClone({ baseline, candidate });

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.operations).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({
      code: 'DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED',
      sheetKey: 'sheet_inventory',
      tableName: '背包',
      affectedRowCount: 1,
      droppedColumns: [{ physicalName: 'note', displayHeader: 'note', index: 2 }],
    })]);
    expect(result.blockers).toHaveLength(1);
    expect({ baseline, candidate }).toEqual(before);
  });

  it('已确认删列返回 destructiveChangeConfirmed operation', async () => {
    const baseline = state(sheet({
      content: [['row_id', 'name', 'note'], ['1', 'iron sword', 'old note']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, note TEXT);' },
    }));
    const candidate = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate, destructiveChangeConfirmed: true });

    expect(result.blockers).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.operations).toMatchObject([{ migrationPolicy: { destructiveChangeConfirmed: true } }]);
  });

  it('display header 唯一对应时自动推导 physical rename 的 V2 mapping', async () => {
    const baseline = state(sheet({
      content: [['row_id', '名称'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- row_id\n  name TEXT -- 名称\n);' },
    }));
    const candidate = state(sheet({
      content: [['row_id', '名称'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- row_id\n  item_name TEXT -- 名称\n);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.operations).toMatchObject([{
      kind: 'sheet_schema_migrate', contractVersion: 2,
      physicalColumnMappings: [{ fromPhysicalName: 'name', toPhysicalName: 'item_name' }],
    }]);
  });

  it('P2 physical rename 携带完整显式 intent 时返回 V2 operation', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'item_name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({
      baselineData: baseline,
      candidateData: candidate,
      intents: {
        sheet_inventory: {
          physicalColumnMappings: [{ fromPhysicalName: 'name', toPhysicalName: 'item_name' }],
          fills: {},
          conversions: [],
          migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
        },
      },
    });

    expect(result.blockers).toEqual([]);
    expect(result.operations).toMatchObject([{ kind: 'sheet_schema_migrate', contractVersion: 2 }]);
  });

  it('literal DEFAULT 新列自动生成 V2 fill 并保留历史行', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'name', 'quality'], ['1', 'iron sword', 'normal']],
      sourceData: { ddl: "CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT NOT NULL DEFAULT 'normal');" },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.operations).toMatchObject([{
      contractVersion: 2,
      fills: { quality: { kind: 'ddl_literal_default', literal: { kind: 'string', value: 'normal' } } },
    }]);
  });

  it('自动推导 operation 的逐行结果与候选不一致时拒绝', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'name', 'quality'], ['1', 'iron sword', 'tampered']],
      sourceData: { ddl: "CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT NOT NULL DEFAULT 'normal');" },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.operations).toEqual([]);
    expect(result.blockers.join('\n')).toContain('operation 应用结果与 candidate 不一致');
  });

  it('无法解析的 candidate DDL 返回 blocker 而不是抛出异常', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({ sourceData: { ddl: 'not sql' } }));

    await expect(preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate })).resolves.toMatchObject({
      operations: [], blockers: [expect.stringContaining('DDL/表头不一致')],
    });
  });

  it('retained physical column 重排自动生成 V2 operation', async () => {
    const baseline = state(sheet({
      content: [['row_id', 'name', 'quantity'], ['1', 'iron sword', '3']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER);' },
    }));
    const candidate = state(sheet({
      content: [['row_id', 'quantity', 'name'], ['1', '3', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, quantity INTEGER, name TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.operations).toMatchObject([{ contractVersion: 2, physicalColumnMappings: [], fills: {}, conversions: [] }]);
  });

  it('存在可精确迁移的候选 mapping 时仍要求用户选择', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'quality'], ['1', 'normal']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, quality TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.operations).toEqual([]);
    expect(result.blockers).toEqual([expect.stringContaining('无法唯一推导')]);
    expect(result.decisions).toEqual([expect.objectContaining({
      status: 'needs_choice', choices: [expect.objectContaining({ id: 'map:name->quality' })],
    })]);
  });

  it('无可选 mapping 的 add/drop 在删除确认后按候选整表 rebase', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'quality'], ['1', 'normal']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, quality INTEGER);' },
    }));

    const result = await preflightSchemaMigrations_ACU({
      baselineData: baseline,
      candidateData: candidate,
      destructiveChangeConfirmed: true,
    });

    expect(result.blockers).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.applyModes).toEqual({ sheet_inventory: 'rebase' });
    expect(result.decisions).toEqual([expect.objectContaining({
      sheetKey: 'sheet_inventory', status: 'auto_apply', code: 'REBASE_AVAILABLE',
    })]);
  });


  it('完整 candidate hydrate 失败时不返回 operation', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'name', 'quality'], ['1', 'iron sword', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT);' },
    }));
    candidate.sheet_other = sheet({
      uid: 'other', content: [['row_id', 'value'], ['1', null]],
      sourceData: { ddl: 'CREATE TABLE other_table (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' },
    });

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.operations).toEqual([]);
    expect(result.blockers.join('\n')).toContain('完整 candidate SQLite hydrate 失败');
  });
});

  it('retained 列 definition/constraint 变更（如删除 UNIQUE）降级为 rebase 而非 blocker', async () => {
    const baseline = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT UNIQUE);' },
    }));
    const candidate = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.applyModes).toEqual({ sheet_inventory: 'rebase' });
    expect(result.decisions[0]).toMatchObject({ sheetKey: 'sheet_inventory', status: 'auto_apply', code: 'REBASE_AVAILABLE' });
  });

  it('表级 constraint 变更（添加 UNIQUE 且候选数据合法）降级为 rebase', async () => {
    const baseline = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    }));
    const candidate = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, UNIQUE(name));' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.applyModes).toEqual({ sheet_inventory: 'rebase' });
  });

  it('suffix 变更（STRICT）在候选 hydrate 成功时降级为 rebase', async () => {
    const baseline = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    }));
    const candidate = state(sheet({
      content: [['row_id', 'name'], ['1', 'iron sword']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT) STRICT;' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.applyModes).toEqual({ sheet_inventory: 'rebase' });
  });

  it('新增带表达式 DEFAULT 的列，编辑器候选给出完整行值时降级为 rebase', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'name', 'created_at'], ['1', 'iron sword', '2025-01-01']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.applyModes).toEqual({ sheet_inventory: 'rebase' });
  });

  it('多 Sheet 混合：精确 migration 与 rebase 同时出现，各自携带正确 applyMode', async () => {
    const baseline: any = {
      mate: { type: 'acu', version: 1 },
      sheet_inventory: sheet(),
      sheet_quality: sheet({
        uid: 'quality', name: '品质',
        content: [['row_id', 'level'], ['1', '5']],
        sourceData: { ddl: 'CREATE TABLE quality (row_id INTEGER PRIMARY KEY, level INTEGER);' },
      }),
    };
    const candidate: any = {
      mate: { type: 'acu', version: 1 },
      sheet_inventory: sheet({
        content: [['row_id', 'name', 'quality'], ['1', 'iron sword', null]],
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT);' },
      }),
      sheet_quality: sheet({
        uid: 'quality', name: '品质',
        content: [['row_id', 'level'], ['1', '5']],
        sourceData: { ddl: 'CREATE TABLE quality (row_id INTEGER PRIMARY KEY, level INTEGER NOT NULL);' },
      }),
    };

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.applyModes).toEqual({ sheet_inventory: 'migration', sheet_quality: 'rebase' });
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ kind: 'sheet_schema_migrate', sheetKey: 'sheet_inventory' });
  });

  it('新增 NOT NULL 约束后候选行违反约束时真实 hydrate 失败为 blocker', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      content: [['row_id', 'name', 'quality'], ['1', 'iron sword', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT NOT NULL);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.operations).toEqual([]);
    expect(result.blockers.join('\n')).toContain('完整 candidate SQLite hydrate 失败');
  });

  it('首次定义 DDL：baseline 无 DDL + candidate 合法 + headers 未变 → 按候选整表 rebase 放行', async () => {
    const baseline = state(sheet({ sourceData: {} }));
    const candidate = state(sheet({
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).toEqual([]);
    expect(result.decisions).toEqual([expect.objectContaining({ status: 'auto_apply', code: 'REBASE_AVAILABLE' })]);
    expect(result.applyModes).toEqual({ sheet_inventory: 'rebase' });
  });

  it('首次定义防放宽：candidate DDL 非法时仍为 blocker', async () => {
    const baseline = state(sheet({ sourceData: {} }));
    const candidate = state(sheet({ sourceData: { ddl: 'not sql' } }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.operations).toEqual([]);
    expect(result.blockers.join('\n')).toContain('DDL/表头不一致');
  });

  it('首次定义防放宽：headers 同时变化时仍走原规划路径（不被首次定义分支放行）', async () => {
    const baseline = state(sheet({ sourceData: {} }));
    // candidate headers 增加一列 quality，结构确实变化，不能借首次定义绕过
    const candidate = state(sheet({
      content: [['row_id', 'name', 'quality'], ['1', 'iron sword', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    expect(result.blockers).not.toEqual([]);
  });

  it('首次定义防放宽：baseline 已有 DDL 时不进入新分支，行为与改动前一致', async () => {
    const baseline = state(sheet());
    const candidate = state(sheet({
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT);' },
    }));

    const result = await preflightSchemaMigrations_ACU({ baselineData: baseline, candidateData: candidate });

    // baseline 有 DDL 且 candidate 新增列，走原路径（存在可推导 mapping 时要求确认或 rebase），不因新增列被首次定义分支放行为 rebase
    expect(result.blockers).not.toEqual([]);
  });
