import { describe, expect, it } from 'vitest';
import { normalizeTemplateRowIds_ACU } from '../../../src/service/template/template-row-id-normalizer';

function sheet(name: string, headers: string[], rows: Array<Array<string | null>> = [], extra: Record<string, any> = {}) {
  return { uid: `sheet_${name.toLowerCase()}`, name, content: [headers, ...rows], sourceData: {}, ...extra };
}

function state(sheets: Record<string, any>) {
  return { mate: { type: 'chatSheets', version: 1 }, ...sheets };
}

describe('normalizeTemplateRowIds_ACU', () => {
  it('合法 row_id 首列表头保持不变，空身份被稳定分配', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['', '铁剑'], ['7', '盾牌']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.templateData.sheet_a.content).toEqual([
      ['row_id', '名称'], ['8', '铁剑'], ['7', '盾牌'],
    ]);
    expect(input.sheet_a.content[1][0]).toBe('');
  });

  it('id 别名改名为 row_id，数据行不右移', () => {
    const input = state({ sheet_a: sheet('A', ['id', '名称'], [['1', '铁剑']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
  });

  it('行号 别名改名为 row_id', () => {
    const input = state({ sheet_a: sheet('A', ['行号', '名称'], [['3', '药水']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '名称'], ['3', '药水']]);
  });

  it('缺失整列 row_id 时插入表头并为数据行分配身份', () => {
    const input = state({ sheet_log: sheet('日志', ['时间', '摘要'], [['T1', '事件A'], ['T2', '事件B']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_log.content).toEqual([
      ['row_id', '时间', '摘要'], ['1', 'T1', '事件A'], ['2', 'T2', '事件B'],
    ]);
    expect(result.audits[0].headerAction).toBe('inserted');
    expect(result.audits[0].generatedRowIdCount).toBe(2);
  });

  it('header-only 表只补表头，不造数据行', () => {
    const input = state({ sheet_a: sheet('A', ['名称']) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '名称']]);
  });

  it('seedRows 同步插列，并与 content 共享身份空间', () => {
    const input = state({ sheet_a: sheet('A', ['时间', '名称'], [['T1', 'A']], { seedRows: [['T2', 'B']] }) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '时间', '名称'], ['1', 'T1', 'A']]);
    expect(result.templateData.sheet_a.seedRows).toEqual([['2', 'T2', 'B']]);
  });

  it('保留已有非空 ID，并从最大身份后分配空 ID', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['5', '甲'], ['', '乙']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '名称'], ['5', '甲'], ['6', '乙']]);
  });

  it('重复的非空 row_id 阻断，不静默重写身份', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['same', '甲'], ['same', '乙']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([expect.objectContaining({ code: 'duplicate_row_id', sheetKey: 'sheet_a' })]);
    expect(result.changed).toBe(false);
    expect(result.templateData.sheet_a.content).toEqual(input.sheet_a.content);
  });

  it('row_id 不在首列时阻断', () => {
    const input = state({ sheet_a: sheet('A', ['时间', 'row_id', '摘要'], [['T1', '1', 'A']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('misplaced_row_id');
    expect(result.blockers[0].sheetKey).toBe('sheet_a');
    expect(result.changed).toBe(false);
  });

  it('重复身份表头阻断', () => {
    const input = state({ sheet_a: sheet('A', ['时间', '行号', '摘要'], [['T1', '1', 'A']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers[0].code).toBe('duplicate_row_id_header');
  });

  it('非数组 content 行阻断', () => {
    const input = state({ sheet_a: { uid: 'sheet_a', name: 'A', content: [['名称'], '不是数组'] } });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers[0].code).toBe('invalid_content_row');
  });

  it('非数组 seedRows 阻断', () => {
    const input = state({ sheet_a: sheet('A', ['名称'], [], { seedRows: 'bad' }) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers[0].code).toBe('invalid_seed_rows');
  });

  it('超长行阻断，不静默截断', () => {
    const input = state({ sheet_a: sheet('A', ['名称'], [['T1', 'A', '多余']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers[0].code).toBe('row_width_mismatch');
  });

  it('DDL 已含合法身份列时保持不变', () => {
    const input = state({ sheet_a: sheet('A', ['时间', '摘要'], [['T1', 'A']], {
      sourceData: { ddl: 'CREATE TABLE a (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  time TEXT, -- 时间\n  summary TEXT -- 摘要\n);' },
    }) });
    const result = normalizeTemplateRowIds_ACU(input, { syncDdl: true });
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
  });

  it('DDL 缺失身份列时安全注入，并校验表头映射', () => {
    const input = state({ sheet_a: sheet('A', ['时间', '摘要'], [['T1', 'A']], {
      sourceData: { ddl: 'CREATE TABLE a (\n  time TEXT, -- 时间\n  summary TEXT -- 摘要\n);' },
    }) });
    const result = normalizeTemplateRowIds_ACU(input, { syncDdl: true });
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
  });

  it('DDL row_id 类型/主键非法时阻断', () => {
    const input = state({ sheet_a: sheet('A', ['时间', '摘要'], [['T1', 'A']], {
      sourceData: { ddl: 'CREATE TABLE a (\n  time TEXT -- 时间\n, summary TEXT -- 摘要\n, row_id TEXT\n);' },
    }) });
    const result = normalizeTemplateRowIds_ACU(input, { syncDdl: true });
    expect(result.blockers[0].code).toBe('invalid_ddl');
  });

  it('输入对象不被修改', () => {
    const input = state({ sheet_a: sheet('A', ['名称'], [['T1', 'A']]) });
    const snapshot = JSON.stringify(input);
    normalizeTemplateRowIds_ACU(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('第二次规范化幂等', () => {
    const input = state({ sheet_a: sheet('A', ['名称'], [['T1', 'A']]) });
    const first = normalizeTemplateRowIds_ACU(input);
    const second = normalizeTemplateRowIds_ACU(first.templateData);
    expect(second.changed).toBe(false);
    expect(second.blockers).toEqual([]);
    expect(second.templateData).toEqual(first.templateData);
  });

  it('多表错误一次返回全部 blockers', () => {
    const input = state({
      sheet_a: sheet('A', ['时间', 'row_id'], []),
      sheet_b: sheet('B', ['时间', '行号'], []),
    });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers.map(b => b.code)).toEqual(['misplaced_row_id', 'duplicate_row_id_header']);
  });

  it('首列 null 占位原地规范化为 row_id，不插列、不右移', () => {
    const input = state({ sheet_a: sheet('A', [null as any, '名称'], [['', '铁剑'], ['7', '盾牌']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.templateData.sheet_a.content).toEqual([
      ['row_id', '名称'], ['8', '铁剑'], ['7', '盾牌'],
    ]);
    expect(result.audits[0].headerAction).toBe('renamed');
    expect(result.templateData.sheet_a.content[0]).toHaveLength(2);
  });

  it('首列 undefined 占位（对象入口经 JSON 深拷贝后为 null）同样规范化为 row_id', () => {
    const input = state({ sheet_a: sheet('A', [undefined as any, '名称'], [['1', '铁剑']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
    expect(result.audits[0].headerAction).toBe('renamed');
  });

  it('多张首列为 null 的表均独立规范化，业务列顺序保持不变', () => {
    const input = state({
      sheet_worldview: sheet('世界观', [null as any, '主要世界观', '力量体系'], [['', '高魔', '强者']]),
      sheet_system: sheet('系统', [null as any, '系统名', '版本'], [['', '斗气', '1.0']]),
    });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_worldview.content).toEqual([
      ['row_id', '主要世界观', '力量体系'], ['1', '高魔', '强者'],
    ]);
    expect(result.templateData.sheet_system.content).toEqual([
      ['row_id', '系统名', '版本'], ['1', '斗气', '1.0'],
    ]);
    expect(result.audits).toHaveLength(2);
    expect(result.audits.every(audit => audit.headerAction === 'renamed')).toBe(true);
  });

  it('首列 null 占位 + content 数据行与 seedRows：行宽不变、身份分配正确、不重复插列', () => {
    const input = state({ sheet_a: sheet('A', [null as any, '名称'], [['', '铁剑']], { seedRows: [['', '盾牌']] }) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
    expect(result.templateData.sheet_a.seedRows).toEqual([['2', '盾牌']]);
    expect(result.templateData.sheet_a.content[1]).toHaveLength(2);
    expect(result.templateData.sheet_a.seedRows[0]).toHaveLength(2);
    expect(result.audits[0].generatedRowIdCount).toBe(2);
  });

});


  it('首列 null 占位 + 合法 SQLite DDL：规范化成功且不重复注入 row_id', () => {
    const input = state({ sheet_a: sheet('A', [null as any, '时间', '摘要'], [['', 'T1', 'A']], {
      sourceData: { ddl: 'CREATE TABLE a (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  time TEXT, -- 时间\n  summary TEXT -- 摘要\n);' },
    }) });
    const result = normalizeTemplateRowIds_ACU(input, { syncDdl: true });
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '时间', '摘要'], ['1', 'T1', 'A']]);
    expect(result.templateData.sheet_a.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
    expect(result.audits[0].ddlUpdated).toBe(false);
    expect(result.audits[0].headerAction).toBe('renamed');
  });

  it('首列 null 占位 + 非法 DDL：仍返回 invalid_ddl，不被本修复放行', () => {
    const input = state({ sheet_a: sheet('A', [null as any, '时间', '摘要'], [['', 'T1', 'A']], {
      sourceData: { ddl: 'CREATE TABLE a (\n  time TEXT -- 时间\n, summary TEXT -- 摘要\n, row_id TEXT\n);' },
    }) });
    const result = normalizeTemplateRowIds_ACU(input, { syncDdl: true });
    expect(result.blockers[0].code).toBe('invalid_ddl');
    expect(result.changed).toBe(false);
  });

  it('[名称, row_id] 错位 row_id 仍阻断', () => {
    const input = state({ sheet_a: sheet('A', ['名称', 'row_id'], [['T1', '1']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers[0].code).toBe('misplaced_row_id');
  });

  it('[row_id, null] 非首列空表头在规范化层不吞掉、不修改（拒绝交由导入 validator）', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', null as any], [['1', 'A']]) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.content[0]).toEqual(['row_id', null]);
    expect(result.audits[0].headerAction).toBe('unchanged');
  });

describe('normalizeTemplateRowIds_ACU 跨来源完全重复去重', () => {
  it('content 与 seedRows 相同 row_id 且完整行相同：去重成功，seedRows 删除副本，无 blocker', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']], { seedRows: [['1', '铁剑']] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(result.blockers).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.templateData.sheet_a.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
    expect(result.templateData.sheet_a.seedRows).toEqual([]);
    expect(result.audits[0].deduplicatedSeedRows).toEqual([{ rowId: '1', contentRowIndex: 0 }]);
  });

  it('row_id 一个为数字一个为字符串但 canonical 相同、其他列相同：去重', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [[1, '铁剑']], { seedRows: [['1', '铁剑']] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.seedRows).toEqual([]);
    expect(result.audits[0].deduplicatedSeedRows).toEqual([{ rowId: '1', contentRowIndex: 0 }]);
  });

  it('相同 row_id 但任一业务字段不同：仍返回跨池冲突', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']], { seedRows: [['1', '盾牌']] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(result.blockers[0].code).toBe('duplicate_row_id');
    expect(result.blockers[0].message).toContain('seedRows');
    expect(result.changed).toBe(false);
  });

  it('同池 content 重复：仍 blocker，不受去重影响', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '甲'], ['1', '乙']], { seedRows: [['1', '甲']] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    // content 内部重复仍阻断；与 content 完全相同的 seedRows 副本先去重，
    // 但同池冲突不会因去重而被吞掉（blocker 仍存在，changed=false）。
    expect(result.blockers[0].code).toBe('duplicate_row_id');
    expect(result.changed).toBe(false);
    expect(result.templateData.sheet_a.seedRows).toEqual([]);
  });

  it('同池 seedRows 重复：仍 blocker', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '甲']], { seedRows: [['2', '乙'], ['2', '乙']] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(result.blockers[0].code).toBe('duplicate_row_id');
    expect(result.blockers[0].message).toContain('seedRows');
  });

  it('多个跨池重复与非重复 seedRows 混合：只删除安全重复，保留其他种子', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '甲'], ['2', '乙']], { seedRows: [['1', '甲'], ['3', '丙'], ['2', '乙']] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(result.blockers).toEqual([]);
    expect(result.templateData.sheet_a.seedRows).toEqual([['3', '丙']]);
    expect(result.audits[0].deduplicatedSeedRows).toEqual([
      { rowId: '1', contentRowIndex: 0 },
      { rowId: '2', contentRowIndex: 1 },
    ]);
  });

  it('默认关闭：不传选项时不删除跨池相同行', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']], { seedRows: [['1', '铁剑']] }) });
    const result = normalizeTemplateRowIds_ACU(input);
    expect(result.blockers[0].code).toBe('duplicate_row_id');
    expect(result.templateData.sheet_a.seedRows).toEqual([['1', '铁剑']]);
  });

  it('去重后审计数量/row_id 正确；输入对象不变；二次规范化幂等', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']], { seedRows: [['1', '铁剑']] }) });
    const snapshot = JSON.stringify(input);
    const first = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(first.audits[0].deduplicatedSeedRows).toEqual([{ rowId: '1', contentRowIndex: 0 }]);
    const second = normalizeTemplateRowIds_ACU(first.templateData, { deduplicateIdenticalCrossSourceRows: true });
    expect(second.changed).toBe(false);
    expect(second.blockers).toEqual([]);
    expect(second.audits[0].deduplicatedSeedRows).toEqual([]);
    expect(second.templateData.sheet_a.seedRows).toEqual([]);
  });

  it('行宽不一致或非法行不能被去重逻辑绕过', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']], { seedRows: [['1', '铁剑', '多余']] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(result.blockers[0].code).toBe('duplicate_row_id');
    expect(result.templateData.sheet_a.seedRows).toEqual([['1', '铁剑', '多余']]);
  });

  it('null 与空串不等价，不能误去重', () => {
    const input = state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '']], { seedRows: [['1', null]] }) });
    const result = normalizeTemplateRowIds_ACU(input, { deduplicateIdenticalCrossSourceRows: true });
    expect(result.blockers[0].code).toBe('duplicate_row_id');
  });
});
