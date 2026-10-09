/**
 * tests/data/sqlite/sqlite-engine.test.ts
 * SqliteEngine 单元测试 — 使用真实 sql.js 实例
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import { SqliteEngine } from '../../../src/data/sqlite/sqlite-engine';
import { logError_ACU } from '../../../src/shared/utils';

describe('SqliteEngine', () => {
  let engine: SqliteEngine;

  beforeEach(async () => {
    engine = new SqliteEngine();
    await engine.init();
    vi.mocked(logError_ACU).mockClear();
  });

  afterEach(() => {
    engine.dispose();
  });

  // ═══════════════════════════════════════════════════════════════
  // 初始化与生命周期
  // ═══════════════════════════════════════════════════════════════
  describe('初始化与生命周期', () => {

    it('未初始化时调用 query 抛出错误', () => {
      const freshEngine = new SqliteEngine();
      expect(() => freshEngine.query('SELECT 1')).toThrow('未初始化');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // query
  // ═══════════════════════════════════════════════════════════════
  describe('query', () => {
    it('readOnly：拒绝多语句与写语句，结束后恢复可写', () => {
      engine.run('CREATE TABLE test (id INTEGER);');
      engine.run('INSERT INTO test VALUES (1);');
      expect(() => engine.query('SELECT 1; DELETE FROM test', undefined, { readOnly: true })).toThrow(/单条/);
      expect(() => engine.query('DELETE FROM test', undefined, { readOnly: true })).toThrow();
      expect(engine.query('SELECT COUNT(*) FROM test', undefined, { readOnly: true }).values).toEqual([[1]]);
      expect(engine.query('SELECT 1;  -- 尾注释', undefined, { readOnly: true }).values).toEqual([[1]]);
      engine.run('INSERT INTO test VALUES (2);');
      expect(engine.query('SELECT COUNT(*) FROM test').values).toEqual([[2]]);
    });

    it('SQL 语法错误直接抛出由顶层统一记日志（底层不再记 error 去重）', () => {
      const sql = 'SELEC sensitive_default_log FROM nonexistent;';
      expect(() => engine.query(sql)).toThrow();

      // 底层只 throw：同一次失败不在引擎层刷 ERROR，避免与顶层重复。
      expect(logError_ACU).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // runBatch
  // ═══════════════════════════════════════════════════════════════
  describe('runBatch', () => {

    it('中间语句失败时 ROLLBACK 整个事务', () => {
      engine.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");

      // 第二条 INSERT 会因为主键冲突失败
      expect(() => engine.runBatch([
        "INSERT INTO test VALUES (2, '李四');",
        "INSERT INTO test VALUES (1, '重复');",  // 主键冲突
        "INSERT INTO test VALUES (3, '王五');",
      ])).toThrow('第 2 条语句失败');

      // 事务回滚，只有最初的张三
      const query = engine.query('SELECT COUNT(*) FROM test;');
      expect(query.values[0][0]).toBe(1);
    });

    it('错误信息包含失败的 SQL 语句', () => {
      engine.run('CREATE TABLE test (id INTEGER PRIMARY KEY);');
      try {
        engine.runBatch([
          'INSERT INTO test VALUES (1);',
          'INSERT INTO nonexistent_table VALUES (2);',
        ]);
        expect.unreachable('应该抛出错误');
      } catch (e: any) {
        expect(e.message).toContain('第 2 条语句失败');
        expect(e.message).toContain('nonexistent_table');
      }
    });

    it('finalize 可读取未提交数据并将结果随提交返回', () => {
      engine.run('CREATE TABLE test (id INTEGER);');

      const result = engine.runBatchWithFinalize(
        ['INSERT INTO test VALUES (1);'],
        undefined,
        () => engine.query('SELECT COUNT(*) FROM test;').values[0][0],
      );

      expect(result.totalChanges).toBe(1);
      expect(result.finalizeResult).toBe(1);
      expect(engine.query('SELECT COUNT(*) FROM test;').values[0][0]).toBe(1);
    });

    it('finalize 失败时回滚已执行但尚未提交的整批语句', () => {
      engine.run('CREATE TABLE test (id INTEGER);');

      expect(() => engine.runBatchWithFinalize(
        ['INSERT INTO test VALUES (1);'],
        undefined,
        () => {
          expect(engine.query('SELECT COUNT(*) FROM test;').values[0][0]).toBe(1);
          throw new Error('finalize failed');
        },
      )).toThrow('finalize failed');

      expect(engine.query('SELECT COUNT(*) FROM test;').values[0][0]).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getAllTableNames
  // ═══════════════════════════════════════════════════════════════
  describe('getAllTableNames', () => {
    it('包含 _acu_ 前缀的系统表', () => {
      engine.run('CREATE TABLE user_table (id INTEGER);');
      engine.run('CREATE TABLE _acu_meta (id INTEGER);');
      const names = engine.getAllTableNames();
      expect(names).toContain('user_table');
      expect(names).toContain('_acu_meta');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getTableInfo
  // ═══════════════════════════════════════════════════════════════
  describe('getTableInfo', () => {

    it('非法表名抛出错误', () => {
      expect(() => engine.getTableInfo('DROP TABLE; --')).toThrow('非法表名');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getTableDDL
  // ═══════════════════════════════════════════════════════════════
  describe('getTableDDL', () => {

    it('非法表名抛出错误', () => {
      expect(() => engine.getTableDDL('1invalid')).toThrow('非法表名');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // exportBinary / loadFromBinary
  // ═══════════════════════════════════════════════════════════════
  describe('exportBinary / loadFromBinary', () => {
    it('导出并恢复数据库', async () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");

      const binary = engine.exportBinary();
      expect(binary).toBeInstanceOf(Uint8Array);
      expect(binary.length).toBeGreaterThan(0);

      // 恢复到新引擎
      const engine2 = new SqliteEngine();
      await engine2.loadFromBinary(binary);
      const result = engine2.query('SELECT * FROM test;');
      expect(result.values).toEqual([[1, '张三']]);
      engine2.dispose();
    });

    // R1-07：坏数据恢复失败时旧库不能先被丢掉。
    it('R1-07：二进制数据损坏时 loadFromBinary 抛错且原库保持可用', async () => {
      engine.run('CREATE TABLE keep_me (id INTEGER);');
      engine.run('INSERT INTO keep_me VALUES (7);');

      await expect(engine.loadFromBinary(new TextEncoder().encode('这不是 SQLite 数据库文件'.repeat(20)))).rejects.toThrow();

      expect(engine.isReady).toBe(true);
      expect(engine.query('SELECT id FROM keep_me;').values).toEqual([[7]]);
    });
  });
});
