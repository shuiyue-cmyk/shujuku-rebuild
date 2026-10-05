import { describe, expect, it } from 'vitest';
import {
  normalizeSqlParenBalance_ACU,
  normalizeSqlQuoteLookalikes_ACU,
  parseRestrictedSqlDml_ACU,
  parseRestrictedSqlDmlTolerant_ACU,
} from '../../src/shared/restricted-sql-dml';

describe('受限 SQL DML', () => {
  it('逐句解析 INSERT、UPDATE、DELETE，保留字符串内的分隔符与转义', () => {
    expect(parseRestrictedSqlDml_ACU("INSERT INTO hooks (id, summary) VALUES ('H1', 'A; B, O''Brien'); UPDATE hooks SET summary = 'red, AND blue' WHERE id = 'H1' AND expected_revision = 1; DELETE FROM hooks WHERE id = 'H1' AND reason = 'old AND gone';")).toEqual([
      { kind: 'insert', table: 'hooks', values: { id: 'H1', summary: "A; B, O'Brien" } },
      { kind: 'update', table: 'hooks', values: { summary: 'red, AND blue' }, where: { id: 'H1', expected_revision: 1 } },
      { kind: 'delete', table: 'hooks', where: { id: 'H1', reason: 'old AND gone' } },
    ]);
  });
  it('字段数与值数量不一致时指导逐项核对列名与 VALUES（移植上游 5f8afe3a）', () => {
    let message = '';
    try { parseRestrictedSqlDml_ACU("INSERT INTO hooks (id, summary) VALUES ('H1')"); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain('INSERT 字段数与值数量不一致（2 个字段、1 个值）');
    expect(message).toContain('逐项核对列名列表与 VALUES 一一对应');
    expect(message).toContain('不要把正文内容写进列名');
    expect(message).toContain('应写成两个单引号');
    expect(message).toContain('id 和 expected_revision 可以不写');
    expect(message, '旧的缺 id 解释已 retire').not.toContain('不是缺 id');
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

describe('受限 SQL DML 容忍管线（移植上游 5f8afe3a）', () => {
  it('合法语句保留并记录原始位置，坏语句隔离（statementIndexes 与 statements 一一对应）', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU(
      "INSERT INTO hooks (id) VALUES ('a'); DROP TABLE hooks; INSERT INTO hooks (id) VALUES ('b');",
    );
    expect(result.statements).toHaveLength(2);
    expect(result.statementIndexes).toEqual([0, 2]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ index: 1 });
  });

  it('列值不匹配的 INSERT 给出纠错关联（只信任第一个明确配对）', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO hooks (id, summary) VALUES ('H1')");
    expect(result.statements).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].repairTarget).toEqual({
      table: 'hooks',
      column: 'id',
      value: 'H1',
      columns: ['id', 'summary'],
    });
  });

  it('WHERE 干净的坏 UPDATE 给出 id 纠错关联', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("UPDATE hooks SET summary = upper(summary) WHERE id = 'H1'");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].repairTarget).toEqual({
      table: 'hooks',
      column: 'id',
      value: 'H1',
      columns: ['summary'],
    });
  });

  it('无法可靠识别时不猜测目标（无 repairTarget 键）', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU('DROP TABLE hooks;');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).not.toHaveProperty('repairTarget');
  });

  it('字符串未闭合的尾段只报告拒绝', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO hooks (id) VALUES ('a'); UPDATE hooks SET summary = 'unterminated");
    expect(result.statements).toHaveLength(1);
    expect(result.statementIndexes).toEqual([0]);
    expect(result.rejected).toEqual([{ index: 1, text: "UPDATE hooks SET summary = 'unterminated", reason: '字符串字面量未闭合' }]);
  });

  it('近似引号与多余右括号可安全改写后接受', () => {
    expect(normalizeSqlQuoteLookalikes_ACU('‘x’')).toBe("'x'");
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO hooks (id) VALUES ('a'));" );
    expect(result.statements).toEqual([{ kind: 'insert', table: 'hooks', values: { id: 'a' } }]);
    expect(result.statementIndexes).toEqual([0]);
    expect(normalizeSqlParenBalance_ACU('SELECT (1))')).toBe('SELECT (1)');
  });
});
