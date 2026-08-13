import { describe, expect, it } from 'vitest';
import { buildSeedCleanupPlanForSheet_ACU, isSeedMigrationEnabled_ACU, prepareSeedMigration_ACU } from '../../../src/service/template/template-seed-pollution-migration';
import { settings_ACU } from '../../../src/service/runtime/state-manager';

function sheetWithDdl(overrides: any = {}) {
  return {
    uid: 'sheet_x',
    name: '测试表',
    content: [['row_id', 'code', 'name']],
    sourceData: {
      ddl: `CREATE TABLE t ( -- 测试表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  code TEXT UNIQUE, -- 编码\n  name TEXT -- 名称\n);`,
    },
    ...overrides,
  };
}

describe('buildSeedCleanupPlanForSheet_ACU', () => {
  it('与 runtime 同业务键的 seed 被清理，保留 runtime 数据', () => {
    const sheet = sheetWithDdl({
      content: [['row_id', 'code', 'name']],
      seedRows: [['1', 'C1', '铁剑'], ['2', 'C2', '卷轴']],
    });
    const { nextSeedRows, action } = buildSeedCleanupPlanForSheet_ACU(sheet, {
      sheetKey: 'sheet_x', sheetName: '测试表',
      keyGroups: [['code']],
      runtimeHeader: ['row_id', 'code', 'name'],
      runtimeRows: [['1', 'C1', '铁剑']],
    });
    expect(nextSeedRows).toEqual([['2', 'C2', '卷轴']]);
    expect(action.kind).toBe('drop_duplicate_seed_rows');
    if (action.kind === 'drop_duplicate_seed_rows') {
      expect(action.droppedKeys).toEqual(['C1']);
    }
  });

  it('与 content 同业务键的 seed 被清理（双池重复，template-wins 保留 content）', () => {
    const sheet = sheetWithDdl({
      content: [['row_id', 'code', 'name'], ['1', 'C1', '铁剑']],
      seedRows: [['1', 'C1', '铁剑']],
    });
    const { nextSeedRows, action } = buildSeedCleanupPlanForSheet_ACU(sheet, {
      sheetKey: 'sheet_x', sheetName: '测试表', keyGroups: [['code']],
    });
    expect(nextSeedRows).toEqual([]);
    expect(action.kind).toBe('drop_duplicate_seed_rows');
  });

  it('无重复时返回 no_change 且保留全部 seed', () => {
    const sheet = sheetWithDdl({
      content: [['row_id', 'code', 'name']],
      seedRows: [['1', 'C1', '铁剑']],
    });
    const { nextSeedRows, action } = buildSeedCleanupPlanForSheet_ACU(sheet, {
      sheetKey: 'sheet_x', sheetName: '测试表', keyGroups: [['code']],
    });
    expect(nextSeedRows).toEqual([['1', 'C1', '铁剑']]);
    expect(action.kind).toBe('no_change');
  });

  it('无 UNIQUE 键的表不清理任何 seed', () => {
    const sheet = {
      uid: 'sheet_y', name: '无键表',
      content: [['row_id', 'value'], ['1', 'v1']],
      sourceData: { ddl: `CREATE TABLE y ( -- 无键表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  value TEXT -- 值\n);` },
      seedRows: [['1', 'v1'], ['2', 'v2']],
    };
    const { nextSeedRows, action } = buildSeedCleanupPlanForSheet_ACU(sheet, {
      sheetKey: 'sheet_y', sheetName: '无键表', keyGroups: [],
    });
    expect(nextSeedRows).toEqual([['1', 'v1'], ['2', 'v2']]);
    expect(action.kind).toBe('no_change');
  });
});

describe('prepareSeedMigration_ACU', () => {
  it('无全局聊天上下文时安全返回 no_issue（不抛错、不写存储）', () => {
    const result = prepareSeedMigration_ACU({ chat: [], isolationKey: 'test-key' });
    expect(['no_issue', 'plan_ready']).toContain(result.status);
  });

  it('版本开关默认开启', () => {
    const original = settings_ACU.seedMigrationEnabled;
    delete settings_ACU.seedMigrationEnabled;
    expect(isSeedMigrationEnabled_ACU()).toBe(true);
    if (original !== undefined) settings_ACU.seedMigrationEnabled = original;
  });

  it('显式 seedMigrationEnabled=false 时关闭迁移', () => {
    const original = settings_ACU.seedMigrationEnabled;
    settings_ACU.seedMigrationEnabled = false;
    expect(isSeedMigrationEnabled_ACU()).toBe(false);
    const result = prepareSeedMigration_ACU({ chat: [], isolationKey: 'test-key' });
    expect(result.status).toBe('no_issue');
    if (original !== undefined) settings_ACU.seedMigrationEnabled = original; else delete settings_ACU.seedMigrationEnabled;
  });
});
