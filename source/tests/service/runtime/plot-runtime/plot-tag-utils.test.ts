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
  getNormalizedPlotMessageRole_ACU,
  extractLastTagContent_ACU,
  extractPlotTagsFromResponse_ACU,
  extractAllTagContents_ACU,
  getPlotPlaceholderTagNames_ACU,
  buildPlotTagMapFromText_ACU,
  buildPlotTagBlock_ACU,
  replacePlotTagPlaceholders_ACU,
  buildTaskWorldbookTriggerText_ACU,
  sortPlotTaskResults_ACU,
  aggregatePlotTaskTags_ACU,
  buildAggregatedPlotTagBlocks_ACU,
  buildPlotRawFallbackText_ACU,
  buildPlotSaveContentFromTaskResults_ACU,
  buildFinalPlotInjectionMessage_ACU,
  tryRenderPlotTemplateWithEjs_ACU,
  renderPlotTaskContentWithIsolatedVariables_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-tag-utils';

describe('getNormalizedPlotMessageRole_ACU', () => {
  it('AI → assistant', () => expect(getNormalizedPlotMessageRole_ACU('AI')).toBe('assistant'));
  it('ASSISTANT → assistant', () => expect(getNormalizedPlotMessageRole_ACU('ASSISTANT')).toBe('assistant'));
  it('SYSTEM → system', () => expect(getNormalizedPlotMessageRole_ACU('SYSTEM')).toBe('system'));
  it('USER → user', () => expect(getNormalizedPlotMessageRole_ACU('USER')).toBe('user'));
  it('null → user', () => expect(getNormalizedPlotMessageRole_ACU(null)).toBe('user'));
  it('空字符串 → user', () => expect(getNormalizedPlotMessageRole_ACU('')).toBe('user'));
});

describe('extractLastTagContent_ACU', () => {
  it('提取最后一个匹配标签的内容', () => {
    expect(extractLastTagContent_ACU('<plot>第一段</plot>中间<plot>第二段</plot>', 'plot')).toBe('第二段');
  });
  it('大小写不敏感', () => {
    expect(extractLastTagContent_ACU('<PLOT>内容</PLOT>', 'plot')).toBe('内容');
  });
  it('标签不存在返回 null', () => {
    expect(extractLastTagContent_ACU('普通文本', 'plot')).toBeNull();
  });
  it('空文本返回 null', () => {
    expect(extractLastTagContent_ACU('', 'plot')).toBeNull();
  });
  it('空标签名返回 null', () => {
    expect(extractLastTagContent_ACU('<plot>内容</plot>', '')).toBeNull();
  });
});

describe('extractAllTagContents_ACU', () => {
  it('提取所有匹配标签', () => {
    const result = extractAllTagContents_ACU('<a>1</a><a>2</a><a>3</a>', 'a');
    expect(result).toEqual(['1', '2', '3']);
  });
  it('无匹配返回空数组', () => {
    expect(extractAllTagContents_ACU('无标签', 'a')).toEqual([]);
  });
});

describe('getPlotPlaceholderTagNames_ACU', () => {
  it('提取占位符名称', () => {
    expect(getPlotPlaceholderTagNames_ACU('{{plot}}和{{directive}}')).toEqual(['plot', 'directive']);
  });
  it('去重', () => {
    expect(getPlotPlaceholderTagNames_ACU('{{a}}{{a}}')).toEqual(['a']);
  });
  it('无占位符返回空数组', () => {
    expect(getPlotPlaceholderTagNames_ACU('普通文本')).toEqual([]);
  });
});

describe('buildPlotTagBlock_ACU', () => {
  it('构建标签块', () => {
    expect(buildPlotTagBlock_ACU('plot', ['内容1', '内容2'])).toBe('<plot>内容1\n\n内容2</plot>');
  });
  it('单个内容', () => {
    expect(buildPlotTagBlock_ACU('plot', '内容')).toBe('<plot>内容</plot>');
  });
  it('空标签名返回空', () => {
    expect(buildPlotTagBlock_ACU('', '内容')).toBe('');
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
  it('空文本返回空 Map', () => {
    expect(buildPlotTagMapFromText_ACU('').size).toBe(0);
  });
});

describe('replacePlotTagPlaceholders_ACU', () => {
  it('替换占位符为标签块', () => {
    const map = new Map([['plot', ['剧情内容']]]);
    const result = replacePlotTagPlaceholders_ACU('指令：{{plot}}', map);
    expect(result).toContain('<plot>剧情内容</plot>');
  });
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
  it('无匹配占位符返回标签块（空内容）', () => {
    const map = new Map();
    const result = replacePlotTagPlaceholders_ACU('{{unknown}}', map);
    // buildPlotTagBlock_ACU 对 undefined 内容返回 '<unknown></unknown>'
    expect(result).toBe('<unknown></unknown>');
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
  it('同 stage 按 order 排序', () => {
    const results = [
      { stage: 1, order: 2, success: true },
      { stage: 1, order: 1, success: true },
    ];
    const sorted = sortPlotTaskResults_ACU(results);
    expect(sorted[0].order).toBe(1);
  });
  it('空数组返回空', () => {
    expect(sortPlotTaskResults_ACU([])).toEqual([]);
  });
  it('非数组返回空', () => {
    expect(sortPlotTaskResults_ACU(null as any)).toEqual([]);
  });
});

describe('aggregatePlotTaskTags_ACU', () => {
  it('聚合多个任务的标签', () => {
    const results = [
      { success: true, stage: 1, order: 0, extractedTags: { plot: '剧情1' } },
      { success: true, stage: 2, order: 0, extractedTags: { plot: '剧情2' } },
    ];
    const { aggregated } = aggregatePlotTaskTags_ACU(results);
    expect(aggregated.get('plot')).toEqual(['剧情1', '剧情2']);
  });
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
  it('单个结果直接返回', () => {
    const results = [{ success: true, stage: 1, order: 0, rawResponse: '原始文本' }];
    expect(buildPlotRawFallbackText_ACU(results)).toBe('原始文本');
  });
  it('多个结果带任务名', () => {
    const results = [
      { success: true, stage: 1, order: 0, rawResponse: '文本1', taskName: '任务A' },
      { success: true, stage: 2, order: 0, rawResponse: '文本2', taskName: '任务B' },
    ];
    const text = buildPlotRawFallbackText_ACU(results);
    expect(text).toContain('任务A');
    expect(text).toContain('任务B');
  });
  it('无成功结果返回空', () => {
    expect(buildPlotRawFallbackText_ACU([{ success: false }])).toBe('');
  });
});

describe('extractPlotTagsFromResponse_ACU', () => {
  it('提取指定标签', () => {
    const result = extractPlotTagsFromResponse_ACU('<plot>内容</plot>', 'plot');
    expect(result.extractedTags.plot).toBe('内容');
    expect(result.injectedFragments.length).toBe(1);
  });
  it('多个标签', () => {
    const result = extractPlotTagsFromResponse_ACU('<a>1</a><b>2</b>', 'a,b');
    expect(result.extractedTags.a).toBe('1');
    expect(result.extractedTags.b).toBe('2');
  });
  it('标签不存在时不包含', () => {
    const result = extractPlotTagsFromResponse_ACU('无标签', 'plot');
    expect(Object.keys(result.extractedTags).length).toBe(0);
  });
});

// ═══ tryRenderPlotTemplateWithEjs_ACU ═══
describe('tryRenderPlotTemplateWithEjs_ACU', () => {
  it('空内容返回空字符串', async () => {
    expect(await tryRenderPlotTemplateWithEjs_ACU('')).toBe('');
  });
  it('无 EjsTemplate 时返回原始内容', async () => {
    (globalThis as any).window = {};
    expect(await tryRenderPlotTemplateWithEjs_ACU('测试内容')).toBe('测试内容');
  });
  it('有 EjsTemplate 时调用渲染', async () => {
    (globalThis as any).window = {
      EjsTemplate: {
        evalTemplate: vi.fn(async (c: string) => `rendered:${c}`),
        prepareContext: vi.fn(async () => ({})),
      },
    };
    expect(await tryRenderPlotTemplateWithEjs_ACU('测试')).toBe('rendered:测试');
  });
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

// ═══ renderPlotTaskContentWithIsolatedVariables_ACU ═══
describe('renderPlotTaskContentWithIsolatedVariables_ACU', () => {
  it('渲染并返回内容', () => {
    const result = renderPlotTaskContentWithIsolatedVariables_ACU('测试内容', {
      allTablesJson: '{}',
      seedContentForConditional: '',
      lastPlotContent: '',
    });
    expect(result).toBe('测试内容');
  });
  it('空内容返回空', () => {
    const result = renderPlotTaskContentWithIsolatedVariables_ACU('', {
      allTablesJson: '{}',
      seedContentForConditional: '',
      lastPlotContent: '',
    });
    expect(result).toBe('');
  });
});

// ═══ buildAggregatedPlotTagBlocks_ACU ═══
describe('buildAggregatedPlotTagBlocks_ACU', () => {
  it('空 Map 返回空字符串', () => {
    expect(buildAggregatedPlotTagBlocks_ACU(new Map())).toBe('');
  });
  it('非 Map 返回空字符串', () => {
    expect(buildAggregatedPlotTagBlocks_ACU(null as any)).toBe('');
  });
  it('有数据时构建标签块', () => {
    const tags = new Map<string, any>();
    tags.set('plot', ['剧情内容']);
    tags.set('directive', ['指令内容']);
    const result = buildAggregatedPlotTagBlocks_ACU(tags);
    expect(result).toContain('<plot>');
    expect(result).toContain('<directive>');
  });
});

// ═══ buildPlotSaveContentFromTaskResults_ACU ═══
describe('buildPlotSaveContentFromTaskResults_ACU', () => {
  it('委托给 buildPlotRawFallbackText_ACU', () => {
    const results = [{ rawText: '任务1' }, { rawText: '任务2' }];
    const result = buildPlotSaveContentFromTaskResults_ACU(results);
    expect(typeof result).toBe('string');
  });
  it('空数组返回空', () => {
    expect(buildPlotSaveContentFromTaskResults_ACU([])).toBe('');
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
  it('空指令使用默认指令', () => {
    const result = buildFinalPlotInjectionMessage_ACU('', [], new Map());
    expect(result).toContain('SYSTEM_DIRECTIVE');
  });
});
