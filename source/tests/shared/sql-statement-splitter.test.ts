import { describe, expect, it } from 'vitest';
import { splitSqlStatements_ACU } from '../../src/shared/sql-statement-splitter';

describe('splitSqlStatements_ACU（R1-05 唯一分句实现）', () => {
  it('按分号拆分，引号内分号不算', () => {
    expect(splitSqlStatements_ACU("INSERT INTO t VALUES (1, 'a;b'); UPDATE t SET x = \"c;d\"; DELETE FROM t")).toEqual([
      "INSERT INTO t VALUES (1, 'a;b')",
      'UPDATE t SET x = "c;d"',
      'DELETE FROM t',
    ]);
  });

  it("成对引号转义（'' 与 \"\"）不提前结束字符串", () => {
    expect(splitSqlStatements_ACU("INSERT INTO t VALUES ('it''s; ok'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('it''s; ok')",
      'SELECT 1',
    ]);
  });

  it('行注释里的分号不切断语句，注释被剥除', () => {
    expect(splitSqlStatements_ACU("-- 更新角色; 补充说明\nUPDATE t SET hp = 1 WHERE row_id = 1; -- 结尾注释")).toEqual([
      'UPDATE t SET hp = 1 WHERE row_id = 1',
    ]);
  });

  it('块注释里的分号不切断语句，注释被剥除', () => {
    expect(splitSqlStatements_ACU("UPDATE t /* 说明; 不是分隔 */ SET hp = 2; /* 只有注释 */")).toEqual([
      'UPDATE t   SET hp = 2',
    ]);
  });

  it('引号里的 -- 与 /* 是正文，不是注释', () => {
    expect(splitSqlStatements_ACU("INSERT INTO t VALUES ('a -- b', '/* c */'); SELECT 2")).toEqual([
      "INSERT INTO t VALUES ('a -- b', '/* c */')",
      'SELECT 2',
    ]);
  });

  it('方括号与反引号标识符内的分号不算', () => {
    expect(splitSqlStatements_ACU('SELECT [a;b], `c;d` FROM t; SELECT 3')).toEqual([
      'SELECT [a;b], `c;d` FROM t',
      'SELECT 3',
    ]);
  });

  it('空串、纯空白、纯注释返回空数组', () => {
    expect(splitSqlStatements_ACU('')).toEqual([]);
    expect(splitSqlStatements_ACU('  \n ; ; ')).toEqual([]);
    expect(splitSqlStatements_ACU('-- 只有注释\n/* 还有块注释 */')).toEqual([]);
  });

  it('未闭合字符串：默认宽容，strictQuotes 时抛错', () => {
    expect(splitSqlStatements_ACU("INSERT INTO t VALUES ('abc; def")).toEqual(["INSERT INTO t VALUES ('abc; def"]);
    expect(() => splitSqlStatements_ACU("INSERT INTO t VALUES ('abc", { strictQuotes: true })).toThrow('未闭合');
  });
});
