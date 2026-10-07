import { describe, expect, it } from 'vitest';
import { validateReadOnlySql_ACU } from '../../../../src/service/runtime/template-vars/read-only-sql-validation';

describe('validateReadOnlySql_ACU', () => {
  it.each([
    'SELECT * FROM inventory',
    'WITH rows AS (SELECT * FROM inventory) SELECT * FROM rows',
    'EXPLAIN SELECT * FROM inventory',
    'EXPLAIN QUERY PLAN WITH rows AS (SELECT 1) SELECT * FROM rows',
    'PRAGMA table_info(inventory)',
    'PRAGMA index_list(inventory)',
  ])('accepts read-only SQL: %s', sql => {
    expect(validateReadOnlySql_ACU(sql)).toEqual({ valid: true });
  });

  it.each([
    'UPDATE inventory SET quantity = 0',
    'WITH deleted AS (DELETE FROM inventory RETURNING *) SELECT * FROM deleted',
    'SELECT 1; DELETE FROM inventory',
    'PRAGMA journal_mode=WAL',
    'PRAGMA foreign_keys',
    'VACUUM',
    'CREATE TABLE x(id INTEGER)',
  ])('rejects non-read-only SQL: %s', sql => {
    expect(validateReadOnlySql_ACU(sql).valid).toBe(false);
  });

  it('认 SQLite 的 [方括号] 标识符：标识符里的引号不能吞掉后面的分号与写语句（R3-01）', () => {
    expect(validateReadOnlySql_ACU("SELECT 1 AS [a'];DELETE FROM t;SELECT 1 AS [']").valid).toBe(false);
    expect(validateReadOnlySql_ACU('SELECT [item name] FROM [my table]')).toEqual({ valid: true });
  });

  it('CASE … END 与 REPLACE() 函数是合法只读查询；WITH 后接写语句仍拒绝（R3-03）', () => {
    expect(validateReadOnlySql_ACU("SELECT CASE WHEN quantity>0 THEN 'y' ELSE 'n' END FROM inventory")).toEqual({ valid: true });
    expect(validateReadOnlySql_ACU("SELECT REPLACE(item_name,'剑','刀') FROM inventory")).toEqual({ valid: true });
    expect(validateReadOnlySql_ACU('WITH a AS (SELECT 1) SELECT * FROM a')).toEqual({ valid: true });
    expect(validateReadOnlySql_ACU('WITH a AS (SELECT 1) DELETE FROM t').valid).toBe(false);
    expect(validateReadOnlySql_ACU('WITH a AS (SELECT 1) REPLACE INTO t VALUES (1)').valid).toBe(false);
    expect(validateReadOnlySql_ACU('REPLACE INTO t VALUES (1)').valid).toBe(false);
    expect(validateReadOnlySql_ACU('END').valid).toBe(false);
  });

  it('ignores forbidden words inside strings and comments', () => {
    expect(validateReadOnlySql_ACU("SELECT 'DELETE FROM x' AS text -- UPDATE x\n")).toEqual({ valid: true });
  });
});
