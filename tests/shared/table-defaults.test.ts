/**
 * tests/shared/table-defaults.test.ts
 * 默认表模板 DDL 放宽规则 单元测试
 */
import { describe, expect, it } from 'vitest';
import { relaxDefaultTableDdl_ACU } from '../../src/shared/table-defaults/index.js';

describe('relaxDefaultTableDdl_ACU', () => {
  it('删除表级约束后不会在闭合括号前留下尾逗号', () => {
    const ddl = `CREATE TABLE test_table (
  row_id INTEGER PRIMARY KEY CHECK (row_id > 0), -- 行号
  name TEXT NOT NULL UNIQUE, -- 名称
  status TEXT DEFAULT 'active', -- 状态
  UNIQUE (name)
);`;

    const relaxed = relaxDefaultTableDdl_ACU(ddl);

    expect(relaxed).not.toContain(',\n);');
    expect(relaxed).toContain('row_id INTEGER PRIMARY KEY, -- 行号');
    expect(relaxed).toContain('name TEXT, -- 名称');
    expect(relaxed).toContain('status TEXT -- 状态');
    expect(relaxed).not.toMatch(/\bNOT\s+NULL\b/i);
    expect(relaxed).not.toMatch(/\bUNIQUE\b/i);
    expect(relaxed).not.toMatch(/\bCHECK\b/i);
    expect(relaxed).not.toMatch(/\bDEFAULT\b/i);
  });

  it('保留闭合行注释并清理其前一列尾逗号', () => {
    const ddl = `CREATE TABLE test_table (
  row_id INTEGER PRIMARY KEY, -- 行号
  value TEXT,
  PRIMARY KEY (row_id)
); -- end`;

    const relaxed = relaxDefaultTableDdl_ACU(ddl);

    expect(relaxed).toContain('value TEXT\n); -- end');
    expect(relaxed).not.toContain('value TEXT,\n); -- end');
  });
});
