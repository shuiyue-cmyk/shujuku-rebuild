/**
 * tests/data/sqlite/sql-normalizer.test.ts — SQL 规范化模块测试
 *
 * 覆盖范围：
 * - normalizeSqlStructure: 全角兼容字符 → ASCII（结构位置）
 * - normalizeSqlStructure: 字符串字面量内不修改
 * - normalizeSqlStructure: 行注释内不修改
 * - normalizeConstrainedValue: code_index 白名单字段规范化
 * - normalizeConstrainedValue: 非白名单字段不修改
 * - normalizeStatementValues: INSERT 语句值规范化
 * - normalizeStatementValues: UPDATE 语句值规范化
 * - normalizeStatementValues: 无法安全修复的值保留原样
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeSqlStructure,
  normalizeConstrainedValue,
  normalizeStatementValues,
  getNormalizedColumnNames,
} from '../../../src/data/sqlite/sql-normalizer';

// ═══════════════════════════════════════════════════════════════
// normalizeSqlStructure
// ═══════════════════════════════════════════════════════════════

describe('normalizeSqlStructure', () => {
  // --- 全角运算符转换 ---

  it('应将全角等号 ＝ 转换为 ASCII =', () => {
    const sql = 'CHECK(quantity >＝ 0)';
    expect(normalizeSqlStructure(sql)).toBe('CHECK(quantity >= 0)');
  });

  it('应将全角大于号 ＞ 转换为 ASCII >', () => {
    const sql = 'CHECK(age ＞ 0)';
    expect(normalizeSqlStructure(sql)).toBe('CHECK(age > 0)');
  });

  it('应将全角小于号 ＜ 转换为 ASCII <', () => {
    const sql = 'CHECK(age ＜ 150)';
    expect(normalizeSqlStructure(sql)).toBe('CHECK(age < 150)');
  });

  it('应将全角加号 ＋ 转换为 ASCII +', () => {
    const sql = 'SET quantity = quantity ＋ 1';
    expect(normalizeSqlStructure(sql)).toBe('SET quantity = quantity + 1');
  });

  it('应将全角减号 － 转换为 ASCII -', () => {
    const sql = 'SET quantity = quantity － 1';
    expect(normalizeSqlStructure(sql)).toBe('SET quantity = quantity - 1');
  });

  // --- 全角括号转换 ---

  it('应将全角括号（）转换为 ASCII ()', () => {
    const sql = 'CHECK(status IN （\'active\', \'inactive\'）)';
    expect(normalizeSqlStructure(sql)).toBe("CHECK(status IN ('active', 'inactive'))");
  });

  // --- 全角逗号转换 ---

  it('应将全角逗号，转换为 ASCII ,', () => {
    const sql = "INSERT INTO t (a，b) VALUES (1，2)";
    expect(normalizeSqlStructure(sql)).toBe('INSERT INTO t (a,b) VALUES (1,2)');
  });

  // --- 全角空格转换 ---

  it('应将全角空格转换为半角空格（结构位置）', () => {
    const sql = 'SELECT　*　FROM　t';
    expect(normalizeSqlStructure(sql)).toBe('SELECT * FROM t');
  });

  // --- 组合场景：真实 DDL ---

  it('应正确处理包含多种全角字符的 DDL', () => {
    const ddl = "CREATE TABLE test (id INTEGER PRIMARY KEY, qty INTEGER CHECK(qty >＝0），name TEXT)";
    const expected = "CREATE TABLE test (id INTEGER PRIMARY KEY, qty INTEGER CHECK(qty >=0),name TEXT)";
    expect(normalizeSqlStructure(ddl)).toBe(expected);
  });

  // --- 字符串字面量保护 ---

  it('不应修改字符串字面量内的全角字符', () => {
    const sql = "INSERT INTO t (name) VALUES ('包含，全角；标点＞的文本')";
    expect(normalizeSqlStructure(sql)).toBe("INSERT INTO t (name) VALUES ('包含，全角；标点＞的文本')");
  });

  it('应同时修改结构位置和保留字符串内内容', () => {
    const sql = "INSERT INTO t（name）VALUES ('全角，标点')";
    // 全角括号转为 ASCII 括号，不会额外添加空格
    const expected = "INSERT INTO t(name)VALUES ('全角，标点')";
    expect(normalizeSqlStructure(sql)).toBe(expected);
  });

  // --- 转义引号处理 ---

  it('应正确处理 SQL 转义引号（连续两个单引号）', () => {
    const sql = "INSERT INTO t (name) VALUES ('O''Brien，test')";
    // 字符串内的全角逗号不应被转换
    expect(normalizeSqlStructure(sql)).toBe("INSERT INTO t (name) VALUES ('O''Brien，test')");
  });

  it('在转义引号后的结构位置应正常转换', () => {
    // 转义引号 '' 后紧跟的全角逗号（在结构位置）应被转换
    const sql = "INSERT INTO t (name，age) VALUES ('O''Brien'，25)";
    const expected = "INSERT INTO t (name,age) VALUES ('O''Brien',25)";
    expect(normalizeSqlStructure(sql)).toBe(expected);
  });

  // --- 行注释保护 ---

  it('不应修改行注释中的全角字符', () => {
    const sql = "CREATE TABLE t (id INTEGER -- 这是，注释\n);";
    expect(normalizeSqlStructure(sql)).toBe("CREATE TABLE t (id INTEGER -- 这是，注释\n);");
  });

  it('应在注释结束后恢复结构位置的转换', () => {
    const sql = "CREATE TABLE t (id INTEGER -- 注释；\nname TEXT CHECK(name ＜＞'')，age INTEGER)";
    const expected = "CREATE TABLE t (id INTEGER -- 注释；\nname TEXT CHECK(name <>''),age INTEGER)";
    expect(normalizeSqlStructure(sql)).toBe(expected);
  });

  // --- 无需修改的场景 ---

  it('不包含全角字符时应原样返回', () => {
    const sql = "CREATE TABLE t (id INTEGER PRIMARY KEY);";
    expect(normalizeSqlStructure(sql)).toBe(sql);
  });

  it('空字符串应原样返回', () => {
    expect(normalizeSqlStructure('')).toBe('');
  });

  it('null 应原样返回', () => {
    expect(normalizeSqlStructure(null as any)).toBeNull();
  });

  it('undefined 应原样返回', () => {
    expect(normalizeSqlStructure(undefined as any)).toBeUndefined();
  });

  // --- 真实用户场景：导致 near "0" syntax error 的 DDL ---

  it('应修复导致 near "0" syntax error 的全角等号 DDL', () => {
    const ddl = "CREATE TABLE inventory ( -- 物品表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >＝ 0), -- 数量\n);";
    const expected = "CREATE TABLE inventory ( -- 物品表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 0), -- 数量\n);";
    expect(normalizeSqlStructure(ddl)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════
// normalizeConstrainedValue
// ═══════════════════════════════════════════════════════════════

describe('normalizeConstrainedValue', () => {
  // --- code_index 规范化 ---

  it('应将小写 code_index 转为大写', () => {
    expect(normalizeConstrainedValue('code_index', 'am0001')).toBe('AM0001');
  });

  it('应将混合大小写 code_index 规范化', () => {
    expect(normalizeConstrainedValue('code_index', 'Am0002')).toBe('AM0002');
  });

  it('应去除首尾空格', () => {
    expect(normalizeConstrainedValue('code_index', ' AM0001 ')).toBe('AM0001');
  });

  it('应将全角字母数字转换为半角', () => {
    // ＡＭ０００１ → AM0001
    expect(normalizeConstrainedValue('code_index', '\uff21\uff2d\uff10\uff10\uff10\uff11')).toBe('AM0001');
  });

  it('应同时处理全角字母数字和大小写', () => {
    // ａｍ０００１ → AM0001
    expect(normalizeConstrainedValue('code_index', '\uff41\uff2d\uff10\uff10\uff10\uff11')).toBe('AM0001');
  });

  it('应处理有空格的全角字母数字', () => {
    // ' ＡＭ０００１ ' → 'AM0001'
    expect(normalizeConstrainedValue('code_index', ' \uff21\uff2d\uff10\uff10\uff10\uff11 ')).toBe('AM0001');
  });

  // --- 不应修改非法值（规范化后仍不合法） ---

  it('应保留不满足 GLOB 模式的非法值（如 AM12）', () => {
    // AM12 只有 2 位数字，不满足 AM[0-9][0-9][0-9][0-9]，但不做伪造
    expect(normalizeConstrainedValue('code_index', 'am12')).toBe('AM12');
  });

  it('应保留不满足 GLOB 模式的非法值（如 AX0001）', () => {
    // AX0001 前缀不是 AM，不做伪造
    expect(normalizeConstrainedValue('code_index', 'ax0001')).toBe('AX0001');
  });

  it('应保留超长非法值（如 AM00001）', () => {
    // 5 位数字，不做截断
    expect(normalizeConstrainedValue('code_index', 'am00001')).toBe('AM00001');
  });

  // --- 非白名单字段 ---

  it('不应修改非白名单字段的值', () => {
    expect(normalizeConstrainedValue('chronicle_text', 'am0001')).toBe('am0001');
  });

  it('不应修改 description 字段的值', () => {
    expect(normalizeConstrainedValue('description', 'ＡＢＣ')).toBe('ＡＢＣ');
  });

  it('应忽略列名大小写', () => {
    expect(normalizeConstrainedValue('CODE_INDEX', 'am0001')).toBe('AM0001');
    expect(normalizeConstrainedValue('Code_Index', 'am0001')).toBe('AM0001');
  });

  // --- null / undefined ---

  it('null 应返回 null', () => {
    expect(normalizeConstrainedValue('code_index', null)).toBeNull();
  });

  it('undefined 应返回 null', () => {
    expect(normalizeConstrainedValue('code_index', undefined)).toBeNull();
  });

  it('空列名应返回原值', () => {
    expect(normalizeConstrainedValue('', 'test')).toBe('test');
  });
});

// ═══════════════════════════════════════════════════════════════
// normalizeStatementValues
// ═══════════════════════════════════════════════════════════════

describe('normalizeStatementValues', () => {
  // --- INSERT 语句 ---

  it('应规范化 INSERT 语句中 code_index 的值', () => {
    const sql = "INSERT INTO chronicle (row_id, code_index, summary) VALUES (1, 'am0002', 'test summary');";
    const expected = "INSERT INTO chronicle (row_id, code_index, summary) VALUES (1, 'AM0002', 'test summary');";
    expect(normalizeStatementValues(sql)).toBe(expected);
  });

  it('应规范化 INSERT 中全角字母数字的 code_index', () => {
    const sql = "INSERT INTO chronicle (code_index) VALUES ('\uff21\uff2d\uff10\uff10\uff10\uff11');";
    const expected = "INSERT INTO chronicle (code_index) VALUES ('AM0001');";
    expect(normalizeStatementValues(sql)).toBe(expected);
  });

  it('不应修改 INSERT 中非白名单字段的值', () => {
    const sql = "INSERT INTO chronicle (row_id, summary) VALUES (1, 'am0001 test');";
    expect(normalizeStatementValues(sql)).toBe(sql);
  });

  it('不应修改 INSERT 中不带引号的数字值', () => {
    const sql = "INSERT INTO chronicle (row_id, code_index) VALUES (1, 'AM0002');";
    expect(normalizeStatementValues(sql)).toBe(sql);
  });

  // --- UPDATE 语句 ---

  it('应规范化 UPDATE 语句中 code_index 的值', () => {
    const sql = "UPDATE chronicle SET code_index = 'am0003' WHERE row_id = 1;";
    const expected = "UPDATE chronicle SET code_index = 'AM0003' WHERE row_id = 1;";
    expect(normalizeStatementValues(sql)).toBe(expected);
  });

  it('不应修改 UPDATE 中非白名单字段', () => {
    const sql = "UPDATE chronicle SET summary = 'am0001 summary' WHERE row_id = 1;";
    expect(normalizeStatementValues(sql)).toBe(sql);
  });

  // --- 非 INSERT/UPDATE 语句 ---

  it('不应修改 SELECT 语句', () => {
    const sql = "SELECT * FROM chronicle WHERE code_index = 'am0001';";
    expect(normalizeStatementValues(sql)).toBe(sql);
  });

  it('不应修改 DELETE 语句', () => {
    const sql = "DELETE FROM chronicle WHERE code_index = 'am0001';";
    expect(normalizeStatementValues(sql)).toBe(sql);
  });

  // --- 边界条件 ---

  it('空字符串应原样返回', () => {
    expect(normalizeStatementValues('')).toBe('');
  });

  it('不含白名单字段的 INSERT 应原样返回', () => {
    const sql = "INSERT INTO inventory (row_id, item_name) VALUES (1, '恢复药');";
    expect(normalizeStatementValues(sql)).toBe(sql);
  });

  // --- 含转义引号的值 ---

  it('应正确处理值中包含转义引号的情况', () => {
    const sql = "INSERT INTO t (code_index) VALUES ('AM''0001');";
    // AM'0001 → 规范化后是 AM'0001（因为 NFKC 不会改变单引号），所以大写后仍是 AM'0001
    // 这个值本身不满足 GLOB 模式，但规范化函数只负责大写/NFKC，不做模式验证
    const expected = "INSERT INTO t (code_index) VALUES ('AM''0001');";
    expect(normalizeStatementValues(sql)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════
// getNormalizedColumnNames
// ═══════════════════════════════════════════════════════════════

describe('getNormalizedColumnNames', () => {
  it('应返回已注册的规范化列名列表', () => {
    const names = getNormalizedColumnNames();
    expect(names).toContain('code_index');
    expect(names.length).toBeGreaterThanOrEqual(1);
  });
});
