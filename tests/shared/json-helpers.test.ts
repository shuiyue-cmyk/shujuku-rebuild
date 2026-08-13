/**
 * tests/shared/json-helpers.test.ts
 * JSON 安全解析/序列化工具 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  safeJsonParse_ACU,
  safeJsonParseWithJsoncComments_ACU,
  safeJsonStringify_ACU,
  stripJsonCommentsPreservingStrings_ACU,
} from '../../src/shared/json-helpers';

describe('safeJsonParse_ACU', () => {
  it('正常 JSON 字符串解析成功', () => {
    expect(safeJsonParse_ACU('{"a":1}')).toEqual({ a: 1 });
  });

  it('数组 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('字符串 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('"hello"')).toBe('hello');
  });

  it('数字 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('42')).toBe(42);
  });

  it('null JSON 解析成功', () => {
    expect(safeJsonParse_ACU('null')).toBeNull();
  });

  it('非法 JSON 返回默认 fallback（null）', () => {
    expect(safeJsonParse_ACU('{invalid}')).toBeNull();
  });

  it('非法 JSON 返回自定义 fallback', () => {
    expect(safeJsonParse_ACU('{invalid}', { default: true })).toEqual({ default: true });
  });

  it('空字符串返回 fallback', () => {
    expect(safeJsonParse_ACU('')).toBeNull();
  });

  it('undefined 字符串返回 fallback', () => {
    expect(safeJsonParse_ACU('undefined')).toBeNull();
  });

  it('嵌套对象解析成功', () => {
    const json = '{"a":{"b":{"c":1}}}';
    expect(safeJsonParse_ACU(json)).toEqual({ a: { b: { c: 1 } } });
  });

  it('含中文的 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('{"名字":"铁剑"}')).toEqual({ 名字: '铁剑' });
  });
});

describe('stripJsonCommentsPreservingStrings_ACU', () => {
  it('保留字符串值中的 URL 双斜杠', () => {
    const input = '{"url":"https://example.com/a//b?x=1#hash"}';
    expect(stripJsonCommentsPreservingStrings_ACU(input)).toBe(input);
  });

  it('保留字符串值中的行注释标记文本', () => {
    const input = '{"text":"请访问 // 这不是注释"}';
    expect(stripJsonCommentsPreservingStrings_ACU(input)).toBe(input);
  });

  it('保留字符串值中的块注释标记文本', () => {
    const input = '{"text":"包含 /* 不是注释 */ 的说明"}';
    expect(stripJsonCommentsPreservingStrings_ACU(input)).toBe(input);
  });

  it('正确处理字符串内转义引号后的注释标记', () => {
    const input = '{"escaped":"他说\\\"//不是注释\\\""}';
    expect(stripJsonCommentsPreservingStrings_ACU(input)).toBe(input);
  });

  it('剥离字符串外的行注释', () => {
    const input = '{"a":1}// comment\n';
    expect(stripJsonCommentsPreservingStrings_ACU(input)).toBe('{"a":1}\n');
  });

  it('剥离字符串外的块注释', () => {
    const input = '{"a":1,/* block */"b":2}';
    expect(stripJsonCommentsPreservingStrings_ACU(input)).toBe('{"a":1, "b":2}');
  });
});

describe('safeJsonParseWithJsoncComments_ACU', () => {
  it('解析包含字符串外注释的 JSONC', () => {
    const input = '{"a":1,// comment\n"b":"https://example.com/a//b"}';
    expect(safeJsonParseWithJsoncComments_ACU(input)).toEqual({ a: 1, b: 'https://example.com/a//b' });
  });

  it('非法 JSONC 返回 fallback', () => {
    expect(safeJsonParseWithJsoncComments_ACU('{invalid}', { ok: false })).toEqual({ ok: false });
  });
});

describe('safeJsonStringify_ACU', () => {
  it('正常对象序列化成功', () => {
    expect(safeJsonStringify_ACU({ a: 1 })).toBe('{"a":1}');
  });

  it('数组序列化成功', () => {
    expect(safeJsonStringify_ACU([1, 2, 3])).toBe('[1,2,3]');
  });

  it('null 序列化成功', () => {
    expect(safeJsonStringify_ACU(null)).toBe('null');
  });

  it('字符串序列化成功', () => {
    expect(safeJsonStringify_ACU('hello')).toBe('"hello"');
  });

  it('循环引用返回默认 fallback', () => {
    const obj: any = {};
    obj.self = obj;
    expect(safeJsonStringify_ACU(obj)).toBe('{}');
  });

  it('循环引用返回自定义 fallback', () => {
    const obj: any = {};
    obj.self = obj;
    expect(safeJsonStringify_ACU(obj, '[]')).toBe('[]');
  });

  it('含中文的对象序列化成功', () => {
    const result = safeJsonStringify_ACU({ 名字: '铁剑' });
    expect(result).toContain('铁剑');
  });
});
