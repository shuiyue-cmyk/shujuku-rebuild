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

  it('ignores forbidden words inside strings and comments', () => {
    expect(validateReadOnlySql_ACU("SELECT 'DELETE FROM x' AS text -- UPDATE x\n")).toEqual({ valid: true });
  });
});
