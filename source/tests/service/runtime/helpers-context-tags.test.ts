/**
 * tests/service/runtime/helpers-context-tags.test.ts
 * 上下文标签提取/过滤 单元测试
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_PLOT_SETTINGS_ACU: {
    contextExtractRules: [{ start: '<plot', end: '</plot>' }],
    contextExtractTags: 'plot',
    contextExcludeRules: [{ start: '<system', end: '</system>' }],
    contextExcludeTags: 'system',
  },
}));

vi.mock('../../../src/shared/utils', () => ({
  normalizeExcludeRules_ACU: (rules: any[], legacyTags?: string) => {
    if (Array.isArray(rules) && rules.length > 0) return rules.filter(Boolean);
    if (legacyTags) {
      return legacyTags.split(',').map(t => t.trim()).filter(Boolean).map(t => ({
        start: `<${t.replace(/[<>]/g, '')}`,
        end: `</${t.replace(/[<>]/g, '')}>`,
      }));
    }
    return [];
  },
  normalizeExtractRules_ACU: (rules: any[], legacyTags?: string) => {
    if (Array.isArray(rules) && rules.length > 0) return rules.filter(Boolean);
    if (legacyTags) {
      return legacyTags.split(',').map(t => t.trim()).filter(Boolean).map(t => ({
        start: `<${t.replace(/[<>]/g, '')}`,
        end: `</${t.replace(/[<>]/g, '')}>`,
      }));
    }
    return [];
  },
}));

import {
  getDefaultPlotContextExtractRules_ACU,
  getDefaultPlotContextExcludeRules_ACU,
  applyExcludeRulesToText_ACU,
  applyContextTagFilters_ACU,
} from '../../../src/service/runtime/helpers-context-tags';

describe('getDefaultPlotContextExtractRules_ACU', () => {
  it('返回默认提取规则', () => {
    const rules = getDefaultPlotContextExtractRules_ACU();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });
});

describe('getDefaultPlotContextExcludeRules_ACU', () => {
  it('返回默认排除规则', () => {
    const rules = getDefaultPlotContextExcludeRules_ACU();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });
});

describe('applyExcludeRulesToText_ACU', () => {
  it('移除匹配的标签块', () => {
    const text = '前缀<system>系统内容</system>后缀';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<system', end: '</system>' }],
    });
    expect(result).toBe('前缀后缀');
  });
  it('多个排除规则同时生效', () => {
    const text = '<a>内容A</a>中间<b>内容B</b>';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [
        { start: '<a', end: '</a>' },
        { start: '<b', end: '</b>' },
      ],
    });
    expect(result).not.toContain('内容A');
    expect(result).not.toContain('内容B');
    expect(result).toContain('中间');
  });
  it('无匹配时原文不变', () => {
    const text = '普通文本';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<x', end: '</x>' }],
    });
    expect(result).toBe('普通文本');
  });
  it('空规则返回原文', () => {
    const text = '普通文本';
    expect(applyExcludeRulesToText_ACU(text, {})).toBe('普通文本');
  });
  it('空文本返回空', () => {
    expect(applyExcludeRulesToText_ACU('', { excludeRules: [{ start: '<a', end: '</a>' }] })).toBe('');
  });
  it('null 文本返回空字符串', () => {
    expect(applyExcludeRulesToText_ACU(null as any, {})).toBe('');
  });
  it('大小写不敏感匹配', () => {
    const text = '前缀<SYSTEM>内容</SYSTEM>后缀';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<system', end: '</system>' }],
    });
    expect(result).toBe('前缀后缀');
  });
  it('旧标签格式回退', () => {
    const text = '前缀<tag>内容</tag>后缀';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeTags: 'tag',
    });
    expect(result).toBe('前缀后缀');
  });
});

describe('applyContextTagFilters_ACU', () => {
  it('先提取后排除', () => {
    const text = '<plot>剧情内容<system>系统</system></plot>其他内容';
    const result = applyContextTagFilters_ACU(text, {
      extractRules: [{ start: '<plot', end: '</plot>' }],
      excludeRules: [{ start: '<system', end: '</system>' }],
    });
    expect(result).toContain('剧情内容');
    expect(result).not.toContain('系统');
    expect(result).not.toContain('其他内容');
  });
  it('无规则时返回原文', () => {
    expect(applyContextTagFilters_ACU('原文')).toBe('原文');
  });
});
