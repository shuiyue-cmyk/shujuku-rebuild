// @vitest-environment node
/**
 * tests/data/sqlite/sql-wasm-locator.test.ts
 * 验证 resolveSqlWasmUrl_ACU 多形态解析。
 *
 * 注意：vitest 在 node 下运行时 import.meta.url 恒可用（file:// 指向源文件目录），
 * 因此「扩展形态」天然优先于 location/兜底形态。测试聚焦可验证的契约：
 * - 显式覆盖（http/https）优先于 import.meta.url；
 * - 非法协议被忽略并告警，回落到扩展形态；
 * - 扩展形态用 import.meta.url 所在目录拼文件名；
 * - 日志只输出 origin + pathname，不打印 query。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  originalOverride: undefined as unknown,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: (...args: any[]) => h.logDebug(...args),
  logWarn_ACU: (...args: any[]) => h.logWarn(...args),
  logError_ACU: vi.fn(),
}));

import { resolveSqlWasmUrl_ACU } from '../../../src/data/sqlite/sql-wasm-locator';

beforeEach(() => {
  vi.clearAllMocks();
  h.originalOverride = (globalThis as any).ACU_SQL_WASM_URL_ACU;
  delete (globalThis as any).ACU_SQL_WASM_URL_ACU;
});

afterEach(() => {
  if (h.originalOverride === undefined) delete (globalThis as any).ACU_SQL_WASM_URL_ACU;
  else (globalThis as any).ACU_SQL_WASM_URL_ACU = h.originalOverride;
});

describe('resolveSqlWasmUrl_ACU', () => {
  it('显式覆盖 http(s) 优先于 import.meta.url', () => {
    (globalThis as any).ACU_SQL_WASM_URL_ACU = 'https://cdn.example.com/sqljs/';
    expect(resolveSqlWasmUrl_ACU('sql-wasm.wasm')).toBe('https://cdn.example.com/sqljs/sql-wasm.wasm');
  });

  it('显式覆盖缺少尾斜杠时自动补全', () => {
    (globalThis as any).ACU_SQL_WASM_URL_ACU = 'https://cdn.example.com/sqljs';
    expect(resolveSqlWasmUrl_ACU('sql-wasm.wasm')).toBe('https://cdn.example.com/sqljs/sql-wasm.wasm');
  });

  it('非法协议（file:/data:）忽略并警告，回落到 node_modules 形态', () => {
    (globalThis as any).ACU_SQL_WASM_URL_ACU = 'file:///C:/wasm/sql-wasm.wasm';
    const url = resolveSqlWasmUrl_ACU('sql-wasm.wasm');
    expect(h.logWarn).toHaveBeenCalled();
    // 回落：node 环境命中 node_modules/sql.js/dist（真实 wasm 位置）
    expect(url).toMatch(/node_modules\/sql\.js\/dist\/sql-wasm\.wasm$/);
  });

  it('node 环境优先命中 node_modules/sql.js/dist', () => {
    const url = resolveSqlWasmUrl_ACU('sql-wasm.wasm');
    expect(url).toMatch(/node_modules\/sql\.js\/dist\/sql-wasm\.wasm$/);
  });


  it('显式覆盖带 query 时丢弃 query（不传播到 wasm URL）', () => {
    (globalThis as any).ACU_SQL_WASM_URL_ACU = 'https://cdn.example.com/sqljs?token=secret';
    const url = resolveSqlWasmUrl_ACU('sql-wasm.wasm');
    // base 视为目录补斜杠 → 相对解析替换 pathname 末段并丢弃 query
    expect(url).toBe('https://cdn.example.com/sqljs/sql-wasm.wasm');
    const logged = h.logDebug.mock.calls.map((call: any[]) => String(call[0] || '')).join('\n');
    expect(logged).not.toContain('token');
  });

  it('解析成功后日志只输出 origin + pathname，不打印 query', () => {
    (globalThis as any).ACU_SQL_WASM_URL_ACU = 'https://cdn.example.com/sqljs/';
    resolveSqlWasmUrl_ACU('sql-wasm.wasm');
    const logged = h.logDebug.mock.calls.map((call: any[]) => String(call[0] || '')).join('\n');
    expect(logged).toContain('https://cdn.example.com/sqljs/sql-wasm.wasm');
  });
});
