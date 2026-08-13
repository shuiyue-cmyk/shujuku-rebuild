import { describe, expect, it } from 'vitest';
import { planSheetSchemaMigration_ACU } from '../../../src/service/table/schema-migration-planner';

function sheet(headers: string[], ddl: string, rows: Array<Array<string | null>> = [['1', 'iron sword']]): any {
  return {
    uid: 'inventory', name: '背包', orderNo: 0,
    content: [headers, ...rows], sourceData: { ddl }, updateConfig: {}, exportConfig: {},
  };
}

describe('schema migration semantic planner', () => {
  it('唯一 display identity 的 physical rename 自动生成 mapping', () => {
    const before = sheet(
      ['row_id', '名称'],
      'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- row_id\n name TEXT -- 名称\n);',
    );
    const target = sheet(
      ['row_id', '名称'],
      'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- row_id\n item_name TEXT -- 名称\n);',
    );

    expect(planSheetSchemaMigration_ACU(before, target)).toMatchObject({
      status: 'auto_apply', code: 'UNIQUE_V2_INTENT',
      intent: { physicalColumnMappings: [{ fromPhysicalName: 'name', toPhysicalName: 'item_name' }] },
    });
  });

  it('literal DEFAULT 新列自动生成 fill，表达式 DEFAULT 保持拒绝', () => {
    const before = sheet(['row_id', 'name'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);');
    const literalTarget = sheet(
      ['row_id', 'name', 'quality'],
      "CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT NOT NULL DEFAULT 'normal');",
      [['1', 'iron sword', 'normal']],
    );
    const expressionTarget = sheet(
      ['row_id', 'name', 'created_at'],
      'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);',
      [['1', 'iron sword', '2025-01-01']],
    );

    expect(planSheetSchemaMigration_ACU(before, literalTarget)).toMatchObject({
      status: 'auto_apply', intent: { fills: { quality: { kind: 'ddl_literal_default' } } },
    });
    expect(planSheetSchemaMigration_ACU(before, expressionTarget)).toMatchObject({
      status: 'rebase_available', code: 'UNSUPPORTED_SCHEMA_CHANGE', message: expect.stringContaining('literal DEFAULT'),
    });
  });

  it('移除 NOT NULL 属于约束放宽，自动使用 identity conversion', () => {
    const before = sheet(
      ['row_id', 'name'],
      'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
    );
    const target = sheet(
      ['row_id', 'name'],
      'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);',
    );

    expect(planSheetSchemaMigration_ACU(before, target)).toMatchObject({
      status: 'auto_apply',
      intent: {
        conversions: [{ fromPhysicalName: 'name', toPhysicalName: 'name', policy: { kind: 'identity' } }],
      },
    });
  });

  it('新增 NOT NULL 属于约束收紧，未扫描确认前保持拒绝', () => {
    const before = sheet(['row_id', 'name'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);');
    const target = sheet(['row_id', 'name'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT NOT NULL);');

    expect(planSheetSchemaMigration_ACU(before, target)).toMatchObject({ status: 'rebase_available', code: 'UNSUPPORTED_SCHEMA_CHANGE' });
  });

  it('无法证明同一身份的 add/drop 返回 needs_choice，不擅自迁移', () => {
    const before = sheet(['row_id', 'name'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);');
    const target = sheet(['row_id', 'quality'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, quality TEXT);');

    expect(planSheetSchemaMigration_ACU(before, target)).toMatchObject({
      status: 'needs_choice', code: 'AMBIGUOUS_COLUMN_IDENTITY', message: expect.stringContaining('需要确认列身份'),
      choices: [{
        id: 'map:name->quality',
        label: expect.stringMatching(/name.*→.*quality/),
        intent: {
          physicalColumnMappings: [{ fromPhysicalName: 'name', toPhysicalName: 'quality' }],
          fills: {},
          conversions: [],
        },
      }],
    });
  });

  it('add/drop 的 definition 不一致时不提供伪 identity mapping', () => {
    const before = sheet(['row_id', 'name'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);');
    const target = sheet(['row_id', 'quality'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, quality INTEGER);');

    expect(planSheetSchemaMigration_ACU(before, target)).toMatchObject({
      status: 'needs_choice',
      code: 'AMBIGUOUS_COLUMN_IDENTITY',
      choices: [],
    });
  });

  it('真实 DDL/表头错误返回 invalid 而不是抛出', () => {
    const before = sheet(['row_id', 'name'], 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);');
    const target = sheet(['row_id', 'name'], 'not sql');

    expect(planSheetSchemaMigration_ACU(before, target)).toMatchObject({
      status: 'invalid', code: 'INVALID_SCHEMA', message: expect.stringContaining('DDL/表头不一致'),
    });
  });
});
