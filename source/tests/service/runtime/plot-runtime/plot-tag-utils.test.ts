/**
 * tests/service/runtime/plot-runtime/plot-tag-utils.test.ts
 * 剧情标签工具纯函数 单元测试
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
  normalizePositiveInteger_ACU: (v: any, fb = 1) => {
    const n = parseInt(v, 10);
    return (Number.isFinite(n) && n > 0) ? n : fb;
  },
}));

vi.mock('../../../../src/service/runtime/template-vars', () => ({
  getTemplateVariableStores_ACU: vi.fn(() => ({
    randomVariables_ACU: {},
    calcVariables_ACU: {},
    maxVariables_ACU: {},
    minVariables_ACU: {},
  })),
  setTemplateVariableStores_ACU: vi.fn(),
  parseRandomTags_ACU: vi.fn((c: string) => c),
  replaceRandomVariables_ACU: vi.fn((c: string) => c),
  parseCalcTags_ACU: vi.fn((c: string) => c),
  parseMaxTags_ACU: vi.fn((c: string) => c),
  parseMinTags_ACU: vi.fn((c: string) => c),
  replaceCalcVariables_ACU: vi.fn((c: string) => c),
  replaceMaxVariables_ACU: vi.fn((c: string) => c),
  replaceMinVariables_ACU: vi.fn((c: string) => c),
  parseIfBlockRecursive_ACU: vi.fn((c: string) => c),
  replaceDbSqlVariables: vi.fn((c: string) => c),
}));

import {
  extractLastTagContent_ACU,
  extractPlotTagsFromResponse_ACU,
  buildPlotTagMapFromText_ACU,
  replacePlotTagPlaceholders_ACU,
  buildTaskWorldbookTriggerText_ACU,
  sortPlotTaskResults_ACU,
  aggregatePlotTaskTags_ACU,
  buildPlotRawFallbackText_ACU,
  buildFinalPlotInjectionMessage_ACU,
  tryRenderPlotTemplateWithEjs_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-tag-utils';

describe('extractLastTagContent_ACU', () => {
  it('大小写不敏感', () => {
    expect(extractLastTagContent_ACU('<PLOT>内容</PLOT>', 'plot')).toBe('内容');
  });
});

describe('buildPlotTagMapFromText_ACU', () => {
  it('从文本构建标签映射', () => {
    const map = buildPlotTagMapFromText_ACU('<a>1</a><b>2</b>');
    expect(map.get('a')).toEqual(['1']);
    expect(map.get('b')).toEqual(['2']);
  });
  it('指定标签名列表', () => {
    const map = buildPlotTagMapFromText_ACU('<a>1</a><b>2</b>', ['a']);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
  });
});

describe('replacePlotTagPlaceholders_ACU', () => {
  it('同一文本内重复占位符全部替换，且重复读取不消费内容', () => {
    const map = new Map([['recall', ['历史剧情']]]);
    const text = 'A={{recall}};B={{recall}}';
    const first = replacePlotTagPlaceholders_ACU(text, map);
    const second = replacePlotTagPlaceholders_ACU(text, map);
    expect(first).toBe('A=<recall>历史剧情</recall>;B=<recall>历史剧情</recall>');
    expect(second).toBe(first);
  });
  it('大小写不一致时仍可命中', () => {
    const map = new Map([['Recall', ['大小写稳健']]]);
    const result = replacePlotTagPlaceholders_ACU('命中={{recall}}', map);
    expect(result).toContain('<recall>大小写稳健</recall>');
  });
  it('本轮无有效内容时回退历史标签', () => {
    const current = new Map([['recall', ['   ']]]);
    const history = new Map([['recall', ['上一轮内容']]]);
    const result = replacePlotTagPlaceholders_ACU('内容={{recall}}', current, history);
    expect(result).toContain('<recall>上一轮内容</recall>');
  });
});

describe('buildTaskWorldbookTriggerText_ACU', () => {
  it('优先使用本轮 relayTagMap，缺失时回退 historyTagMap', () => {
    const promptGroup = [
      { role: 'user', content: 'A={{recall}}' },
      { role: 'assistant', content: 'B={{directive}}' },
    ];
    const relay = new Map<string, any>([['recall', ['本轮内容']]]);
    const history = new Map<string, any>([
      ['recall', ['历史内容']],
      ['directive', ['历史指令']],
    ]);

    const result = buildTaskWorldbookTriggerText_ACU(promptGroup, 'unused', relay, history);
    expect(result).toContain('<recall>本轮内容</recall>');
    expect(result).toContain('<directive>历史指令</directive>');
  });
});

describe('sortPlotTaskResults_ACU', () => {
  it('按 stage 排序', () => {
    const results = [
      { stage: 2, order: 0, success: true },
      { stage: 1, order: 0, success: true },
    ];
    const sorted = sortPlotTaskResults_ACU(results);
    expect(sorted[0].stage).toBe(1);
    expect(sorted[1].stage).toBe(2);
  });
});

describe('aggregatePlotTaskTags_ACU', () => {
  it('跳过失败的任务', () => {
    const results = [
      { success: false, stage: 1, order: 0, extractedTags: { plot: '失败' } },
      { success: true, stage: 2, order: 0, extractedTags: { plot: '成功' } },
    ];
    const { aggregated } = aggregatePlotTaskTags_ACU(results);
    expect(aggregated.get('plot')).toEqual(['成功']);
  });
});

describe('buildPlotRawFallbackText_ACU', () => {
  it('多个结果带任务名', () => {
    const results = [
      { success: true, stage: 1, order: 0, rawResponse: '文本1', taskName: '任务A' },
      { success: true, stage: 2, order: 0, rawResponse: '文本2', taskName: '任务B' },
    ];
    const text = buildPlotRawFallbackText_ACU(results);
    expect(text).toContain('任务A');
    expect(text).toContain('任务B');
  });
});

describe('extractPlotTagsFromResponse_ACU', () => {
  it('提取指定标签', () => {
    const result = extractPlotTagsFromResponse_ACU('<plot>内容</plot>', 'plot');
    expect(result.extractedTags.plot).toBe('内容');
    expect(result.injectedFragments.length).toBe(1);
  });
});

// ═══ tryRenderPlotTemplateWithEjs_ACU ═══
describe('tryRenderPlotTemplateWithEjs_ACU', () => {
  it('EjsTemplate 渲染失败时返回原始内容', async () => {
    (globalThis as any).window = {
      EjsTemplate: {
        evalTemplate: vi.fn(async () => { throw new Error('fail'); }),
        prepareContext: vi.fn(async () => ({})),
      },
    };
    expect(await tryRenderPlotTemplateWithEjs_ACU('原始')).toBe('原始');
  });
});

// ═══ buildFinalPlotInjectionMessage_ACU ═══
describe('buildFinalPlotInjectionMessage_ACU', () => {
  it('无标签无占位符时拼接指令和原始文本', () => {
    const result = buildFinalPlotInjectionMessage_ACU('指令', [{ rawText: '内容' }], new Map());
    expect(result).toContain('指令');
  });
  it('有标签无占位符时拼接标签块', () => {
    const tags = new Map<string, any>();
    tags.set('plot', ['剧情']);
    const result = buildFinalPlotInjectionMessage_ACU('指令', [], tags);
    expect(result).toContain('<plot>');
  });
  it('有占位符和匹配标签时替换占位符', () => {
    const tags = new Map<string, any>();
    tags.set('plot', ['剧情内容']);
    const result = buildFinalPlotInjectionMessage_ACU('{{plot}}指令', [], tags);
    expect(result).toContain('<plot>剧情内容</plot>');
    expect(result).not.toContain('{{plot}}');
  });
  it('重复占位符均替换，且 injectOnly 大小写不敏感不追加', () => {
    const tags = new Map<string, any>();
    tags.set('Plot', ['剧情内容']);
    tags.set('Directive', ['额外指令']);
    const result = buildFinalPlotInjectionMessage_ACU('{{plot}} + {{plot}}', [], tags, new Set(['directive']));
    expect(result).toContain('<plot>剧情内容</plot> + <plot>剧情内容</plot>');
    expect(result).not.toContain('<Directive>额外指令</Directive>');
  });
  it('空白内容标签不注入占位符', () => {
    const tags = new Map<string, any>();
    tags.set('plot', ['   ']);
    const result = buildFinalPlotInjectionMessage_ACU('前{{plot}}后', [], tags);
    expect(result).toContain('前后');
    expect(result).not.toContain('<plot>');
  });
  it('有占位符无标签时移除占位符', () => {
    const result = buildFinalPlotInjectionMessage_ACU('{{plot}}指令', [{ rawText: '内容' }], new Map());
    expect(result).not.toContain('{{plot}}');
  });
});
