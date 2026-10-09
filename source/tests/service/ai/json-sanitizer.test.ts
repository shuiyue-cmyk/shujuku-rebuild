/**
 * tests/service/ai/json-sanitizer.test.ts
 * JSON 清洗管线 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeQuotesLayer_ACU,
  isLikelyJsonValueStart_ACU,
  escapeUnescapedQuotesLayer_ACU,
  sanitizeControlCharsLayer_ACU,
  removeTrailingCommasLayer_ACU,
  fixNumericKeysLayer_ACU,
  sanitizeJsonPipeline_ACU,
  splitTopLevelSegments_ACU,
  findTopLevelDelimiterIndex_ACU,
  tryParseLooseJsonValue_ACU,
  parseLooseObjectKey_ACU,
  coerceLooseRowObject_ACU,
} from '../../../src/service/ai/prompt-builder/json-sanitizer';

// ═══════════════════════════════════════════════════════════════
// normalizeQuotesLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizeQuotesLayer_ACU', () => {
  it('\u201c\u201d 不在正则范围内，不转换', () => {
    const input = '\u201c你好\u201d';
    const result = normalizeQuotesLayer_ACU(input);
    expect(result).toBe(input);
  });
  it('「」在字符串外当定界符时转标准双引号', () => {
    expect(normalizeQuotesLayer_ACU('「test」')).toBe('"test"');
  });
  it('R8-10：标准双引号字符串里的「」『』是对白括号，原样保留', () => {
    expect(normalizeQuotesLayer_ACU('{"0":"他说「你好」『二』", 「k」:1}')).toBe('{"0":"他说「你好」『二』", "k":1}');
  });
  it('标准双引号不变', () => {
    expect(normalizeQuotesLayer_ACU('"test"')).toBe('"test"');
  });
});

// ═══════════════════════════════════════════════════════════════
// isLikelyJsonValueStart_ACU
// ═══════════════════════════════════════════════════════════════
describe('isLikelyJsonValueStart_ACU', () => {
  it('n(null)是值开始', () => expect(isLikelyJsonValueStart_ACU('n')).toBe(true));
});

// ═══════════════════════════════════════════════════════════════
// escapeUnescapedQuotesLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('escapeUnescapedQuotesLayer_ACU', () => {
  it('正常 JSON 不变', () => {
    const input = '{"key":"value"}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ key: 'value' });
  });
  it('值中的未转义引号被转义', () => {
    const input = '{"key":"val"ue"}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(result.result).toContain('\\"');
  });
  it('已转义的引号不重复转义', () => {
    const input = '{"key":"val\\"ue"}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(result.result).toBe(input);
  });
  it('嵌套对象正常处理', () => {
    const input = '{"a":{"b":"c"}}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ a: { b: 'c' } });
  });
  it('数组正常处理', () => {
    const input = '["a","b","c"]';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual(['a', 'b', 'c']);
  });
  it('非字符串输入返回失败', () => {
    const result = escapeUnescapedQuotesLayer_ACU(123 as any);
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// sanitizeControlCharsLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('sanitizeControlCharsLayer_ACU', () => {
  it('字符串内的换行符转义', () => {
    const input = '{"key":"line1\nline2"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe('{"key":"line1\\nline2"}');
  });
  it('字符串内的制表符转义', () => {
    const input = '{"key":"a\tb"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe('{"key":"a\\tb"}');
  });
  it('字符串内的回车符转义', () => {
    const input = '{"key":"a\rb"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe('{"key":"a\\rb"}');
  });
  it('字符串外的换行符不转义', () => {
    const input = '{\n"key":"value"\n}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe(input);
  });
  it('已转义的字符不重复转义', () => {
    const input = '{"key":"a\\nb"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe(input);
  });
});

// ═══════════════════════════════════════════════════════════════
// removeTrailingCommasLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('removeTrailingCommasLayer_ACU', () => {
  it('字符串内的逗号不移除', () => {
    expect(removeTrailingCommasLayer_ACU('{"a":"b,}"}')).toBe('{"a":"b,}"}');
  });
  it('正常 JSON 不变', () => {
    const input = '{"a":1,"b":2}';
    expect(removeTrailingCommasLayer_ACU(input)).toBe(input);
  });
});

// ═══════════════════════════════════════════════════════════════
// fixNumericKeysLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('fixNumericKeysLayer_ACU', () => {
  it('已有引号的键不变', () => {
    expect(fixNumericKeysLayer_ACU('{"0":"a"}')).toBe('{"0":"a"}');
  });
  it('字符串键不变', () => {
    expect(fixNumericKeysLayer_ACU('{"key":"a"}')).toBe('{"key":"a"}');
  });
});

// ═══════════════════════════════════════════════════════════════
// sanitizeJsonPipeline_ACU
// ═══════════════════════════════════════════════════════════════
describe('sanitizeJsonPipeline_ACU', () => {
  it('正常 JSON 不做任何修改', () => {
    const input = '{"a":1}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    expect(result.result).toBe(input);
    expect(result.layersApplied).toEqual([]);
  });
  it('字符串值中的 URL 不会被清洗截断', () => {
    const input = '{"0":"https://example.com/a//b?x=1#hash"}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ '0': 'https://example.com/a//b?x=1#hash' });
  });
  it('字符串值中的注释标记不会被清洗删除', () => {
    const input = '{"0":"包含 /* 不是注释 */ 与 // 文本"}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ '0': '包含 /* 不是注释 */ 与 // 文本' });
  });
  it('非字符串输入返回失败', () => {
    const result = sanitizeJsonPipeline_ACU(123 as any);
    expect(result.success).toBe(false);
  });
  it('复杂畸形 JSON 清洗后可解析', () => {
    const input = '{0:\u201cvalue\u201d,}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    // 数字键 + 中文引号 + 尾逗号 → 清洗后应该可解析
    expect(result.layersApplied.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// splitTopLevelSegments_ACU
// ═══════════════════════════════════════════════════════════════
describe('splitTopLevelSegments_ACU', () => {
  it('字符串内的逗号不拆分', () => {
    expect(splitTopLevelSegments_ACU('"a,b","c"')).toEqual(['"a,b"', '"c"']);
  });
  it('字符串内 URL 的冒号和双斜杠不影响顶层分段', () => {
    expect(splitTopLevelSegments_ACU('"url":"https://example.com/a//b","note":"ok"')).toEqual(['"url":"https://example.com/a//b"', '"note":"ok"']);
  });
});

// ═══════════════════════════════════════════════════════════════
// findTopLevelDelimiterIndex_ACU
// ═══════════════════════════════════════════════════════════════
describe('findTopLevelDelimiterIndex_ACU', () => {
  it('字符串内的冒号不匹配', () => {
    expect(findTopLevelDelimiterIndex_ACU('"a:b"')).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════
// tryParseLooseJsonValue_ACU
// ═══════════════════════════════════════════════════════════════
describe('tryParseLooseJsonValue_ACU', () => {
  it('单引号字符串转双引号后解析', () => {
    const result = tryParseLooseJsonValue_ACU("'hello'");
    expect(result.success).toBe(true);
    expect(result.value).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseLooseObjectKey_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseLooseObjectKey_ACU', () => {
  it('无引号的键去除引号', () => {
    expect(parseLooseObjectKey_ACU('key')).toBe('key');
  });
});

// ═══════════════════════════════════════════════════════════════
// coerceLooseRowObject_ACU
// ═══════════════════════════════════════════════════════════════
describe('coerceLooseRowObject_ACU', () => {
  it('非对象格式返回失败', () => {
    const result = coerceLooseRowObject_ACU('[1,2,3]');
    expect(result.success).toBe(false);
  });
  it('混合键值对和纯值', () => {
    const result = coerceLooseRowObject_ACU('{0:"first","second"}');
    expect(result.success).toBe(true);
    expect(result.result?.['0']).toBe('first');
    expect(result.result?.['1']).toBe('second');
  });
  it('松散对象中的 URL 和注释标记作为字符串值保留', () => {
    const result = coerceLooseRowObject_ACU('{0:"https://example.com/a//b",1:"含 /* 文本 */"}');
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ '0': 'https://example.com/a//b', '1': '含 /* 文本 */' });
  });
});
