import { describe, expect, it } from 'vitest';
import { diagnoseSheetSeedPools_ACU } from '../../../src/service/template/template-seed-pollution-diagnostics';

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

describe('diagnoseSheetSeedPools_ACU', () => {
  it('content 与 seedRows 同 UNIQUE 业务键时报告 content_seed_duplicate', () => {
    const sheet = sheetWithDdl({
      content: [['row_id', 'code', 'name'], ['1', 'C1', '铁剑']],
      seedRows: [['1', 'C1', '铁剑']],
    });
    const diags = diagnoseSheetSeedPools_ACU(sheet, { source: 'runtime', sheetKey: 'sheet_x', sheetName: '测试表' });
    expect(diags.some(d => d.code === 'content_seed_duplicate' && d.conflictingKeys.includes('C1'))).toBe(true);
  });

  it('guide seedRows 与 runtime 同业务键时报告 guide_seed_duplicate', () => {
    const sheet = sheetWithDdl({
      content: [['row_id', 'code', 'name']],
      seedRows: [['1', 'C1', '铁剑']],
    });
    const runtimeRows = [['1', 'C1', '铁剑']];
    const runtimeHeader = ['row_id', 'code', 'name'];
    const diags = diagnoseSheetSeedPools_ACU(sheet, {
      source: 'guide', sheetKey: 'sheet_x', sheetName: '测试表',
      runtimeRows, runtimeHeader,
    });
    expect(diags.some(d => d.code === 'guide_seed_duplicate')).toBe(true);
  });

  it('seedRows 池内重复 row_id 报告 seed_row_id_conflict', () => {
    const sheet = sheetWithDdl({
      content: [['row_id', 'code', 'name']],
      seedRows: [['1', 'C1', '铁剑'], ['1', 'C2', '卷轴']],
    });
    const diags = diagnoseSheetSeedPools_ACU(sheet, { source: 'runtime', sheetKey: 'sheet_x', sheetName: '测试表' });
    expect(diags.some(d => d.code === 'seed_row_id_conflict')).toBe(true);
  });

  it('无问题时报告 info_no_issue', () => {
    const sheet = sheetWithDdl({
      content: [['row_id', 'code', 'name']],
      seedRows: [],
    });
    const diags = diagnoseSheetSeedPools_ACU(sheet, { source: 'runtime', sheetKey: 'sheet_x', sheetName: '测试表' });
    expect(diags.some(d => d.code === 'info_no_issue')).toBe(true);
  });

  it('无 UNIQUE 约束的表不做业务键对比（只报告 info）', () => {
    const sheet = {
      uid: 'sheet_y', name: '无键表',
      content: [['row_id', 'value'], ['1', 'v1']],
      sourceData: { ddl: `CREATE TABLE y ( -- 无键表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  value TEXT -- 值\n);` },
      seedRows: [['1', 'v1']],
    };
    const diags = diagnoseSheetSeedPools_ACU(sheet, { source: 'runtime', sheetKey: 'sheet_y', sheetName: '无键表' });
    expect(diags.every(d => d.code === 'info_no_issue')).toBe(true);
  });
});

