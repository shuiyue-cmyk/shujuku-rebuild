/**
 * tests/integration/sqlite-full-chain.test.ts
 * I5 集成测试：SQLite 模式完整链路
 * 验证 JSON → SQL 建表 → INSERT → SELECT → 导出 → JSON 的完整往返
 * 使用真实 sql.js（如果可用），否则跳过
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import chineseDdlFixture from '../fixtures/migrations/spv7.9/sql-ddl-chinese-comments.json';

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('纪要')),
}));

vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

// 导入 schema-mapper 的纯函数（不需要 mock）
import {
  generateDDL,
  generateFallbackDDL,
  generateInserts,
  parseDDLTableName,
  parseDDLColumnNames,
  resultToContent,
} from '../../src/data/sqlite/schema-mapper';

describe('I5: SQLite 模式完整链路（纯函数层）', () => {
  const testSheet = {
    name: '背包物品表',
    content: [
      ['row_id', '物品名', '数量', '品质'],
      ['1', '铁剑', '3', '普通'],
      ['2', '药水', '10', '稀有'],
    ],
    sourceData: {
      note: '背包物品',
      ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT, -- 物品名\n  quantity INTEGER, -- 数量\n  quality TEXT -- 品质\n)',
      initNode: '', deleteNode: '', updateNode: '', insertNode: '',
    },
  };

  describe('DDL 生成与解析往返', () => {
    it('有 sourceData.ddl 时直接使用 DDL', () => {
      const ddl = generateDDL(testSheet as any);
      expect(ddl).toContain('CREATE TABLE');
      // generateDDL 直接使用 sourceData.ddl 中的 canonical 物理表名
      expect(ddl).toContain('inventory');
    });

    it('无 DDL 时使用 fallback DDL 生成', () => {
      const ddl = generateFallbackDDL('test_table', ['row_id', 'colA', 'colB']);
      expect(ddl).toContain('CREATE TABLE');
      // fallback DDL 内部可能对表名做转换
      expect(ddl.length).toBeGreaterThan(0);
    });
  });

  it('合成 spv7.9 中文 DDL fixture 保留物理标识符与中文注释', () => {
    const ddl = generateDDL(chineseDdlFixture as any);

    expect(parseDDLTableName(ddl)).toBe('inventory');
    expect(parseDDLColumnNames(ddl)).toEqual(['row_id', 'item_name', 'quantity']);
    expect(ddl).toContain('-- 物品名');
    expect(ddl).toContain('-- 数量');
  });

  describe('INSERT SQL 生成', () => {
    it('从 Sheet 数据生成 INSERT 语句', () => {
      const inserts = generateInserts(testSheet as any, '背包物品表');
      expect(inserts.length).toBe(2); // 2 行数据
      expect(inserts[0]).toContain('INSERT');
    });
  });

  describe('resultToContent — SQL 结果转 Sheet content', () => {
    it('将 SQL 查询结果转为 Sheet content 格式', () => {
      const columns = ['row_id', '物品名', '数量'];
      const values = [['1', '铁剑', 3], ['2', '药水', 10]];
      const content = resultToContent(columns, values);
      expect(content.length).toBe(3); // header + 2 rows
      expect(content[0]).toEqual(['row_id', '物品名', '数量']);
      expect(content[1][1]).toBe('铁剑');
    });

    it('空结果返回只有 header 的 content', () => {
      const content = resultToContent(['col1', 'col2'], []);
      expect(content.length).toBe(1);
      expect(content[0]).toEqual(['col1', 'col2']);
    });
  });

  describe('DDL 中的特殊字符处理', () => {
    it('列名包含空格时生成有效 DDL', () => {
      const ddl = generateFallbackDDL('test_table', ['row_id', 'col name', 'another_col']);
      expect(ddl).toContain('CREATE TABLE');
      expect(ddl.length).toBeGreaterThan(0);
    });

    it('英文表名和列名生成有效 DDL', () => {
      const ddl = generateFallbackDDL('test_table', ['row_id', 'col1', 'col2']);
      expect(ddl).toContain('CREATE TABLE');
      expect(ddl.length).toBeGreaterThan(0);
    });
  });
});