/**
 * tests/shared/json-helpers.test.ts
 * JSON 安全解析/序列化工具 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  safeJsonParseWithJsoncComments_ACU,
  safeJsonStringify_ACU,
  stripJsonCommentsPreservingStrings_ACU,
} from '../../src/shared/json-helpers';

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
});

describe('safeJsonParseWithJsoncComments_ACU', () => {
  it('解析包含字符串外注释的 JSONC', () => {
    const input = '{"a":1,// comment\n"b":"https://example.com/a//b"}';
    expect(safeJsonParseWithJsoncComments_ACU(input)).toEqual({ a: 1, b: 'https://example.com/a//b' });
  });
});

describe('safeJsonStringify_ACU', () => {

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
});
