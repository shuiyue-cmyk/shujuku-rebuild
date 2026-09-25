import { describe, expect, it } from 'vitest';
import { parseRestrictedSqlDml_ACU } from '../../src/shared/restricted-sql-dml';

describe('受限 SQL DML', () => {
  it('逐句解析 INSERT、UPDATE、DELETE，保留字符串内的分隔符与转义', () => {
    expect(parseRestrictedSqlDml_ACU("INSERT INTO hooks (id, summary) VALUES ('H1', 'A; B, O''Brien'); UPDATE hooks SET summary = 'red, AND blue' WHERE id = 'H1' AND expected_revision = 1; DELETE FROM hooks WHERE id = 'H1' AND reason = 'old AND gone';")).toEqual([
      { kind: 'insert', table: 'hooks', values: { id: 'H1', summary: "A; B, O'Brien" } },
      { kind: 'update', table: 'hooks', values: { summary: 'red, AND blue' }, where: { id: 'H1', expected_revision: 1 } },
      { kind: 'delete', table: 'hooks', where: { id: 'H1', reason: 'old AND gone' } },
    ]);
  });
  it('字段数与值数量不一致时解释引号拆值而非缺 id，并附具体计数（移植上游 9ee4f0f）', () => {
    let message = '';
    try { parseRestrictedSqlDml_ACU("INSERT INTO hooks (id, summary) VALUES ('H1')"); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain('INSERT 字段数与值数量不一致（2 个字段、1 个值）');
    expect(message).toContain('不是缺 id');
    expect(message).toContain('单引号要写成两个单引号');
    expect(message).toContain('id 和 expected_revision 可以不写');
  });
  it.each([
    'SELECT * FROM hooks;',
    'DROP TABLE hooks;',
    'DELETE FROM hooks;',
    "UPDATE hooks SET summary = upper(summary) WHERE id = 'H1';",
    "INSERT INTO hooks (id, id) VALUES ('a', 'b');",
    "INSERT INTO hooks (id,,summary) VALUES ('a', 'b');",
    "UPDATE hooks SET summary = 'a',, status = 'b' WHERE id = 'H1';",
    "DELETE FROM hooks WHERE id = 'H1' AND AND reason = 'x';",
    "UPDATE hooks SET summary = 'unterminated WHERE id = 'H1';",
    'INSERT INTO hooks (id) VALUES (1e1000);',
  ])('拒绝不在受限文法内的语句：%s', sql => {
    expect(() => parseRestrictedSqlDml_ACU(sql)).toThrow();
  });
});
