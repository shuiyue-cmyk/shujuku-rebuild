/**
 * tests/presentation/sql-console.test.ts
 * SQL 控制台单元测试 — isSelectQuery + addHistory + executeSql
 *
 * 策略：mock provider + mock jQuery 对象，测试核心逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../src/shared/constants', () => ({
  SCRIPT_ID_PREFIX_ACU: 'acu',
}));

vi.mock('../../src/shared/html-helpers', () => ({
  escapeHtml_ACU: vi.fn((s: string) => s),
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/dom-utils', () => ({
  jQuery_API_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/theme/toast', () => ({
  showToastr_ACU: vi.fn(),
}));

let mockIsSqliteMode = true;
vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mockIsSqliteMode),
}));

const mockExecuteQuery = vi.fn(() => ({ columns: ['id'], values: [[1]], rowCount: 1 }));
const mockExecuteMutation = vi.fn(() => ({ errors: [], changes: 1 }));
const mockExecuteSqlMutation = vi.fn(async (_options: any) => ({ errors: [], changes: 1 }));
const mockResolveReadSql = vi.hoisted(() => vi.fn((sql: string) => ({ sql, tableRebindCount: 0, columnRebindCount: 0 })));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: vi.fn(async () => ({
    executeQuery: mockExecuteQuery,
    executeMutation: mockExecuteMutation,
  })),
}));

vi.mock('../../src/presentation/state/ui-refs', () => ({
  $popupInstance_ACU: null,
}));

vi.mock('../../src/presentation/bootstrap/api-groups/sql-api', () => ({
  createSqlApi: vi.fn(() => ({
    executeSqlMutation: mockExecuteSqlMutation,
  })),
}));

vi.mock('../../src/service/runtime/read-query-resolver', () => ({
  resolveCurrentRuntimeReadSql_ACU: mockResolveReadSql,
}));

import {
  isSelectQuery,
  addHistory,
  sqlHistory,
  MAX_HISTORY,
  executeSql,
} from '../../src/presentation/pages/sql-console';

// ═══════════════════════════════════════════════════════════════
// isSelectQuery
// ═══════════════════════════════════════════════════════════════
describe('isSelectQuery', () => {
  it('SELECT 返回 true', () => {
    expect(isSelectQuery('SELECT * FROM inventory;')).toBe(true);
  });

  it('PRAGMA 返回 true', () => {
    expect(isSelectQuery('PRAGMA table_info(inventory);')).toBe(true);
  });

  it('EXPLAIN 返回 true', () => {
    expect(isSelectQuery('EXPLAIN QUERY PLAN SELECT 1;')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isSelectQuery('select * from t;')).toBe(true);
    expect(isSelectQuery('pragma table_info(t);')).toBe(true);
  });

  it('前导空格', () => {
    expect(isSelectQuery('  SELECT 1;')).toBe(true);
  });

  it('INSERT 返回 false', () => {
    expect(isSelectQuery("INSERT INTO t VALUES (1);")).toBe(false);
  });

  it('UPDATE 返回 false', () => {
    expect(isSelectQuery('UPDATE t SET x = 1;')).toBe(false);
  });

  it('DELETE 返回 false', () => {
    expect(isSelectQuery('DELETE FROM t;')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isSelectQuery('')).toBe(false);
  });

  it('WITH SELECT 返回 true，WITH 写语句与多语句返回 false', () => {
    expect(isSelectQuery('WITH rows AS (SELECT 1) SELECT * FROM rows;')).toBe(true);
    expect(isSelectQuery('WITH rows AS (SELECT 1) DELETE FROM t;')).toBe(false);
    expect(isSelectQuery('SELECT 1; DELETE FROM t;')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// addHistory
// ═══════════════════════════════════════════════════════════════
describe('addHistory', () => {
  beforeEach(() => {
    sqlHistory.length = 0;
  });

  it('添加成功记录', () => {
    addHistory('SELECT 1;', true);
    expect(sqlHistory.length).toBe(1);
    expect(sqlHistory[0].sql).toBe('SELECT 1;');
    expect(sqlHistory[0].success).toBe(true);
    expect(sqlHistory[0].timestamp).toBeGreaterThan(0);
  });

  it('添加失败记录', () => {
    addHistory('INVALID SQL', false);
    expect(sqlHistory[0].success).toBe(false);
  });

  it('新记录在前（unshift）', () => {
    addHistory('第一条', true);
    addHistory('第二条', true);
    expect(sqlHistory[0].sql).toBe('第二条');
    expect(sqlHistory[1].sql).toBe('第一条');
  });

  it('超过 MAX_HISTORY 时截断', () => {
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      addHistory(`SQL ${i}`, true);
    }
    expect(sqlHistory.length).toBe(MAX_HISTORY);
  });
});

// ═══════════════════════════════════════════════════════════════
// executeSql
// ═══════════════════════════════════════════════════════════════
describe('executeSql', () => {
  let $resultArea: any;
  let $execStatus: any;

  beforeEach(() => {
    vi.clearAllMocks();
    sqlHistory.length = 0;
    $resultArea = { html: vi.fn() };
    $execStatus = { html: vi.fn() };
  });

  it('SELECT 查询调用 executeQuery', async () => {
    mockExecuteQuery.mockReturnValue({ columns: ['id'], values: [[1]], rowCount: 1 });
    await executeSql('SELECT * FROM t;', $resultArea, $execStatus);
    expect(mockResolveReadSql).toHaveBeenCalledWith('SELECT * FROM t;');
    expect(mockExecuteQuery).toHaveBeenCalledWith('SELECT * FROM t;');
    expect($execStatus.html).toHaveBeenCalledWith(expect.stringContaining('1 行'));
  });

  it('SELECT 查询无结果', async () => {
    mockExecuteQuery.mockReturnValue({ columns: ['id'], values: [], rowCount: 0 });
    await executeSql('SELECT * FROM t WHERE 1=0;', $resultArea, $execStatus);
    expect($resultArea.html).toHaveBeenCalledWith(expect.stringContaining('无结果'));
  });

  it('INSERT 变更调用 SQL API 公共提交模型', async () => {
    mockExecuteSqlMutation.mockResolvedValue({ errors: [], changes: 1 });
    await executeSql("INSERT INTO t VALUES (1);", $resultArea, $execStatus);
    expect(mockExecuteSqlMutation).toHaveBeenCalledWith({ sql: "INSERT INTO t VALUES (1);", trackingSheetKeys: [] });
    expect(mockExecuteMutation).not.toHaveBeenCalled();
    expect($execStatus.html).toHaveBeenCalledWith(expect.stringContaining('1 行受影响'));
  });

  it('变更失败显示错误', async () => {
    mockExecuteSqlMutation.mockResolvedValue({ errors: ['SQL 语法错误'], changes: 0 });
    await executeSql('INVALID SQL', $resultArea, $execStatus);
    expect($resultArea.html).toHaveBeenCalledWith(expect.stringContaining('SQL 语法错误'));
    expect($execStatus.html).toHaveBeenCalledWith(expect.stringContaining('失败'));
  });

  it('provider 抛出异常时显示错误', async () => {
    mockExecuteQuery.mockImplementation(() => { throw new Error('数据库未初始化'); });
    await executeSql('SELECT 1;', $resultArea, $execStatus);
    expect($resultArea.html).toHaveBeenCalledWith(expect.stringContaining('数据库未初始化'));
    expect($execStatus.html).toHaveBeenCalledWith(expect.stringContaining('失败'));
  });

  it('执行后记录历史（成功）', async () => {
    mockExecuteQuery.mockReturnValue({ columns: ['id'], values: [[1]], rowCount: 1 });
    await executeSql('SELECT 1;', $resultArea, $execStatus);
    expect(sqlHistory.length).toBe(1);
    expect(sqlHistory[0].success).toBe(true);
  });

  it('执行后记录历史（失败）', async () => {
    mockExecuteSqlMutation.mockResolvedValue({ errors: ['错误'], changes: 0 });
    await executeSql('BAD SQL', $resultArea, $execStatus);
    expect(sqlHistory.length).toBe(1);
    expect(sqlHistory[0].success).toBe(false);
  });

  it('PRAGMA 走查询路径', async () => {
    mockExecuteQuery.mockReturnValue({ columns: ['name'], values: [['inventory']], rowCount: 1 });
    await executeSql('PRAGMA table_info(inventory);', $resultArea, $execStatus);
    expect(mockExecuteQuery).toHaveBeenCalled();
    expect(mockExecuteMutation).not.toHaveBeenCalled();
  });
});
