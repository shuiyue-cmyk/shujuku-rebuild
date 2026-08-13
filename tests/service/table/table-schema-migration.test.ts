import { describe, expect, it } from 'vitest';
import {
  applySheetSchemaMigrationOperation_ACU,
  buildSheetSchemaMigrationOperation_ACU,
  buildSheetSchemaMigrationOperationV2_ACU,
  getSheetSchemaDescriptor_ACU,
  getSheetSchemaDigest_ACU,
} from '../../../src/service/table/table-schema-migration';

function makeSheet(overrides: Record<string, any> = {}): any {
  return {
    uid: 'inventory', name: '背包', orderNo: 0,
    content: [['row_id', '名称'], ['1', '铁剑']],
    sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 名称\n);' },
    updateConfig: {}, exportConfig: {}, ...overrides,
  };
}

function makeState(sheet: any): any {
  return { mate: { type: 'acu', version: 1 }, sheet_inventory: sheet };
}

describe('table schema migration P1 contract', () => {
  it('nullable add 保留旧值并通过真实 SQLite hydrate', async () => {
    const before = makeSheet();
    const after = makeSheet({
      content: [['row_id', '名称', '品质'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT, -- 名称\n  quality TEXT -- 品质\n);' },
    });
    const operation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, after);
    const result = await applySheetSchemaMigrationOperation_ACU(makeState(before), operation);

    expect(operation).toMatchObject({ contractVersion: 1, beforeSchemaDigest: expect.stringMatching(/^sha256:/) });
    expect(operation.columnChanges).toContainEqual({ kind: 'add', physicalName: 'quality', header: '品质', index: 2 });
    expect(result.sheet_inventory.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', null]]);
  });

  it('显示名修改不移动数据且保留 physical column identity', async () => {
    const before = makeSheet();
    const after = makeSheet({
      content: [['row_id', '物品名称'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 物品名称\n);' },
    });
    const operation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, after);
    const result = await applySheetSchemaMigrationOperation_ACU(makeState(before), operation);

    expect(operation.columnChanges).toContainEqual(expect.objectContaining({ kind: 'rename_display', physicalName: 'item_name' }));
    expect(result.sheet_inventory.content[1]).toEqual(['1', '铁剑']);
  });

  it('篡改 columnChanges 时拒绝且原 state 不变', async () => {
    const before = makeSheet();
    const after = makeSheet({ content: [['row_id', '物品名称'], ['1', '铁剑']], sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 物品名称\n);' } });
    const operation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, after);
    const state = makeState(before);
    operation.columnChanges = [];

    await expect(applySheetSchemaMigrationOperation_ACU(state, operation)).rejects.toThrow('columnChanges');
    expect(state).toEqual(makeState(before));
  });

  it('显式确认 drop 后保留 row_id 与未删除的业务数据', async () => {
    const before = makeSheet({
      content: [['row_id', '名称', '备注'], ['1', '铁剑', '旧备注']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n note TEXT -- 备注\n);' },
    });
    const after = makeSheet({
      content: [['row_id', '名称'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT -- 名称\n);' },
    });
    const operation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, after, { destructiveChangeConfirmed: true });
    const result = await applySheetSchemaMigrationOperation_ACU(makeState(before), operation);

    expect(operation.migrationPolicy).toEqual({ destructiveChangeConfirmed: true });
    expect(operation.columnChanges).toContainEqual({ kind: 'drop', physicalName: 'note', header: '备注', index: 2 });
    expect(result.sheet_inventory.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
  });

  it('允许中间纯 add/drop，并保持 retained physical column 的数据对应关系', async () => {
    const before = makeSheet({
      content: [['row_id', '名称', '数量'], ['1', '铁剑', '3']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n quantity INTEGER -- 数量\n);' },
    });
    const withMiddleAdd = makeSheet({
      content: [['row_id', '名称', '品质', '数量'], ['1', '铁剑', null, '3']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n quality TEXT, -- 品质\n quantity INTEGER -- 数量\n);' },
    });
    const addOperation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, withMiddleAdd);
    const afterAdd = await applySheetSchemaMigrationOperation_ACU(makeState(before), addOperation);
    expect(afterAdd.sheet_inventory.content).toEqual([['row_id', '名称', '品质', '数量'], ['1', '铁剑', null, '3']]);

    const dropOperation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', withMiddleAdd, before, { destructiveChangeConfirmed: true });
    const afterDrop = await applySheetSchemaMigrationOperation_ACU(afterAdd, dropOperation);
    expect(afterDrop.sheet_inventory.content).toEqual([['row_id', '名称', '数量'], ['1', '铁剑', '3']]);
  });

  it('retained physical column 重排、CREATE TABLE suffix 变化均 fail closed', async () => {
    const before = makeSheet({
      content: [['row_id', '名称', '数量'], ['1', '铁剑', '3']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n quantity INTEGER -- 数量\n);' },
    });
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      content: [['row_id', '数量', '名称'], ['1', '3', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n quantity INTEGER, -- 数量\n item_name TEXT -- 名称\n);' },
    }))).rejects.toThrow('retained physical column 重排');
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      content: [['row_id', '名称', '数量'], ['1', '铁剑', '3']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n quantity INTEGER -- 数量\n) STRICT;' },
    }))).rejects.toThrow('suffix');
  });

  it('同次 physical add/drop、NOT NULL add 与 definition change 均 fail closed', async () => {
    const before = makeSheet();
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      content: [['row_id', '品质'], ['1', '普通']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n quality TEXT -- 品质\n);' },
    }), { destructiveChangeConfirmed: true })).rejects.toThrow('同次新增和删除');
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      content: [['row_id', '名称', '品质'], ['1', '铁剑', '普通']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n quality TEXT NOT NULL DEFAULT \'普通\' -- 品质\n);' },
    }))).rejects.toThrow('NOT NULL');
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name INTEGER -- 名称\n);' },
    }))).rejects.toThrow('definition');
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      content: [['row_id', '名称', '标记'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n marker TEXT DEFAULT \'new\' -- 标记\n);' },
    }))).rejects.toThrow('nullable pure column');
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      content: [['row_id', '名称', '标记'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n marker TEXT CHECK (marker <> \'blocked\') -- 标记\n);' },
    }))).rejects.toThrow('nullable pure column');
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      content: [['row_id', '名称', '标记'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n marker TEXT UNIQUE COLLATE NOCASE REFERENCES other_table(id) -- 标记\n);' },
    }))).rejects.toThrow('nullable pure column');
    for (const definition of [
      'marker UNIQUE',
      'marker COLLATE NOCASE',
      'marker REFERENCES other_table(id)',
    ]) {
      await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
        content: [['row_id', '名称', '标记'], ['1', '铁剑', null]],
        sourceData: { ddl: `CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n ${definition} -- 标记\n);` },
      }))).rejects.toThrow('nullable pure column');
    }
  });

  it('表级约束变更 fail closed，DDL 作者表名变化不改变 runtime 物理名', async () => {
    const before = makeSheet();
    await expect(buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, makeSheet({
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n UNIQUE (item_name)\n);' },
    }))).rejects.toThrow('表级 constraint');
    const renamedDdl = makeSheet({
      sourceData: { ddl: 'CREATE TABLE inventory_next (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT -- 名称\n);' },
    });
    const operation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, renamedDdl);
    const result = await applySheetSchemaMigrationOperation_ACU(makeState(before), operation);

    expect(result.sheet_inventory.sourceData.ddl).toContain('CREATE TABLE inventory_next');
  });

  it('完整 candidate 中其他 sheet 的 SQLite 约束失败时拒绝且原 state 不变', async () => {
    const before = makeSheet();
    const validAfter = makeSheet({
      content: [['row_id', '名称', '标记'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n marker TEXT -- 标记\n);' },
    });
    const operation = await buildSheetSchemaMigrationOperation_ACU('sheet_inventory', before, validAfter);
    const state = makeState(before);
    state.sheet_other = {
      uid: 'other', name: '损坏表', orderNo: 1,
      content: [['row_id', '值'], ['1', null]],
      sourceData: { ddl: 'CREATE TABLE other_table (row_id INTEGER PRIMARY KEY, value TEXT CHECK (value IS NOT NULL));' },
      updateConfig: {}, exportConfig: {},
    };
    const original = structuredClone(state);

    await expect(applySheetSchemaMigrationOperation_ACU(state, operation)).rejects.toThrow('SQLite');
    expect(state).toEqual(original);
  });
});


describe('table schema migration P2 contract', () => {
  it('显式 physical mapping 保留历史值，NOT NULL DEFAULT 由 ddl_literal_default 回填', async () => {
    const before = makeSheet({
      content: [['row_id', '名称'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n name TEXT -- 名称\n);' },
    });
    const target = makeSheet({
      content: [['row_id', '物品名称', '品质']],
      sourceData: { ddl: "CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 物品名称\n quality TEXT NOT NULL DEFAULT 'normal' -- 品质\n);" },
    });
    const operation = await buildSheetSchemaMigrationOperationV2_ACU('sheet_inventory', before, target, {
      physicalColumnMappings: [{ fromPhysicalName: 'name', toPhysicalName: 'item_name' }],
      fills: {
        quality: { kind: 'ddl_literal_default', literal: { kind: 'string', sql: "'normal'", value: 'normal' } },
      },
      conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    });

    const result = await applySheetSchemaMigrationOperation_ACU(makeState(before), operation);
    expect(operation).toMatchObject({ contractVersion: 2, dryRun: { convertedRowCount: 0, failedRowCount: 0, lossyRowCount: 0 } });
    expect(result.sheet_inventory.content).toEqual([['row_id', '物品名称', '品质'], ['1', '铁剑', 'normal']]);
  });

  it('definition conversion 逐行复算、要求有损确认并拒绝伪造 dry-run', async () => {
    const before = makeSheet({
      content: [['row_id', '数量'], ['1', '003']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n amount TEXT -- 数量\n);' },
    });
    const target = makeSheet({
      content: [['row_id', '数量']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n amount INTEGER -- 数量\n);' },
    });
    await expect(buildSheetSchemaMigrationOperationV2_ACU('sheet_inventory', before, target, {
      physicalColumnMappings: [],
      fills: {},
      conversions: [{ fromPhysicalName: 'amount', toPhysicalName: 'amount', policy: { kind: 'integer_strict' } }],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    })).rejects.toThrow('lossyConversionConfirmed');

    const operation = await buildSheetSchemaMigrationOperationV2_ACU('sheet_inventory', before, target, {
      physicalColumnMappings: [],
      fills: {},
      conversions: [{ fromPhysicalName: 'amount', toPhysicalName: 'amount', policy: { kind: 'integer_strict' } }],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: true },
    });
    expect(operation.dryRun).toEqual({ convertedRowCount: 1, failedRowCount: 0, lossyRowCount: 1 });
    expect((await applySheetSchemaMigrationOperation_ACU(makeState(before), operation)).sheet_inventory.content[1]).toEqual(['1', '3']);

    const state = makeState(before);
    const tampered = structuredClone(operation);
    tampered.dryRun.lossyRowCount = 0;
    await expect(applySheetSchemaMigrationOperation_ACU(state, tampered)).rejects.toThrow('dryRun');
    expect(state).toEqual(makeState(before));
  });

  it('physical rename 仍要求 mapping，新增列仍要求 fillStrategy', async () => {
    const before = makeSheet({
      content: [['row_id', 'name'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
    });
    const renamed = makeSheet({
      content: [['row_id', 'item_name'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
    });
    const renameWithoutMapping = buildSheetSchemaMigrationOperationV2_ACU('sheet_inventory', before, renamed, {
      physicalColumnMappings: [], fills: {}, conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: true, lossyConversionConfirmed: false },
    });
    await expect(renameWithoutMapping).rejects.toThrow('fillStrategy');

    const added = makeSheet({
      content: [['row_id', 'item_name', 'quality'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, quality TEXT);' },
    });
    const simpleBefore = makeSheet({ content: [['row_id', 'item_name'], ['1', '铁剑']], sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' } });
    await expect(buildSheetSchemaMigrationOperationV2_ACU('sheet_inventory', simpleBefore, added, {
      physicalColumnMappings: [], fills: {}, conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    })).rejects.toThrow('fillStrategy');
  });
});

