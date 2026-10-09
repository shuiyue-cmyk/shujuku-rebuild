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
  it('无匹配时原文不变', () => {
    const text = '普通文本';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<x', end: '</x>' }],
    });
    expect(result).toBe('普通文本');
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
  it('同一标签的多个并列块全部删除', () => {
    const text = '前缀<a>内容一</a>中间<a>内容二</a>后缀';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<a', end: '</a>' }],
    });
    expect(result).toBe('前缀中间后缀');
  });
  it('同一标签嵌套时删除完整外层范围', () => {
    const text = '前缀<a>外层<a>内层</a>尾部</a>后缀';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<a', end: '</a>' }],
    });
    expect(result).toBe('前缀后缀');
  });
  it('重复标签大小写混合时全部删除', () => {
    const text = '前缀<A>内容一</a>中间<a>内容二</A>后缀';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<a', end: '</a>' }],
    });
    expect(result).toBe('前缀中间后缀');
  });
  it('保留未配对边界并只删除完整配对', () => {
    const text = '孤立结束</a>前缀<a>完整内容</a>后缀<a>孤立开始';
    const result = applyExcludeRulesToText_ACU(text, {
      excludeRules: [{ start: '<a', end: '</a>' }],
    });
    expect(result).toBe('孤立结束</a>前缀后缀<a>孤立开始');
  });

});
