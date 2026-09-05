/**
 * tests/service/optimization/content-optimization.test.ts
 * 正文优化服务 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockSaveCache,
  mockLoadCache,
  mockFindProcessed,
  mockRecordProcessed,
  mockFilterExclusions,
} = vi.hoisted(() => ({
  mockSettings: {
    contentOptimizationSettings: { maxOptimizations: 10, loopCount: 1, retryCount: 3 },
    plotSettings: {},
  } as any,
  mockSaveCache: vi.fn(),
  mockLoadCache: vi.fn(() => null),
  // 自动替换「已处理集合」存储适配器桩
  mockFindProcessed: vi.fn(() => null),
  mockRecordProcessed: vi.fn(() => null),
  // 写回保护桩：默认全部保留（等价于未配置排除规则）
  mockFilterExclusions: vi.fn((content: string, optimizations: any[]) => ({
    kept: optimizations,
    dropped: [],
    ranges: [],
  })),
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU: [],
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: null,
  currentChatFileIdentifier_ACU: 'test-chat',
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getPersonaDescription_ACU: vi.fn(() => ''),
  getCharDescription_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/text-optimization', () => ({
  applyOptimizations_ACU: vi.fn((content: string) => content),
  filterOptimizationsByExcludeRules_ACU: mockFilterExclusions,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/data/storage/optimization-cache-storage', () => ({
  saveOptimizationBaseToCache_ACU: mockSaveCache,
  loadOptimizationBaseFromCache_ACU: mockLoadCache,
  findAutoOptimizationProcessedEntry_ACU: mockFindProcessed,
  recordAutoOptimizationProcessed_ACU: mockRecordProcessed,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  formatOutlineTableForPlot_ACU: vi.fn(() => ''),
  formatSummaryIndexForPlot_ACU: vi.fn(() => ({ success: false })),
  getLatestAIMessageContent_ACU: vi.fn(() => ''),
  getLatestUserMessageContent_ACU: vi.fn(() => ''),
  composeSeedMatchContent_ACU: (userContent: string, aiContent: string) => [userContent, aiContent].filter(Boolean).join('\n'),
  getPlotFromHistory_ACU: vi.fn(() => ''),
  getWorldbookContentForPlot_ACU: vi.fn(async () => ''),
  parseCalcTags_ACU: vi.fn((s: string) => s),
  parseIfBlockRecursive_ACU: vi.fn((s: string) => s),
  parseMaxTags_ACU: vi.fn((s: string) => s),
  parseMinTags_ACU: vi.fn((s: string) => s),
  parseRandomTags_ACU: vi.fn((s: string) => s),
  replaceCalcVariables_ACU: vi.fn((s: string) => s),
  replaceMaxVariables_ACU: vi.fn((s: string) => s),
  replaceMinVariables_ACU: vi.fn((s: string) => s),
  replaceRandomVariables_ACU: vi.fn((s: string) => s),
}));

vi.mock('../../../src/shared/defaults', () => ({
  buildDefaultContentOptimizationPromptGroup_ACU: vi.fn(() => []),
  defaultVectorMemoryConfig_ACU: {
    enabled: false,
    threshold: 50,
    archiveTriggerCount: 9,
    archiveBatchSize: 3,
    archiveMaxConcurrency: 3,
    summaryIndexArchiveMaxConcurrency: 30,
    summaryIndexArchiveEmbeddingConcurrency: 3,
    topK: 200,
    minScore: 0.45,
    embeddingEndpoint: '',
    embeddingApiKey: '',
    embeddingModel: '',
    rerankEndpoint: '',
    rerankApiKey: '',
    rerankModel: '',
  },
}));

vi.mock('../../../src/service/runtime/template-vars/sql-query-var', () => ({
  replaceDbSqlVariables: vi.fn((s: string) => s),
}));

import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import {
  setLastOptimizationBase_ACU,
  getLastOptimizationBase_ACU,
  computeAutoOptimizationContentHash_ACU,
  shouldSkipDuplicateAutoContentOptimization_ACU,
  recordAutoContentOptimizationProcessed_ACU,
  cancelContentOptimization_ACU,
  ensureOptimizationNotCancelled_ACU,
  _set_contentOptimizationAbortRequested_ACU,
  _set_optimizationProgressToast_ACU,
  optimizationProgressToast_ACU,
} from '../../../src/service/optimization/content-optimization';

beforeEach(() => {
  vi.clearAllMocks();
  _set_contentOptimizationAbortRequested_ACU(false);
  mockLoadCache.mockReturnValue(null);
});

// ═══ setLastOptimizationBase_ACU ═══
describe('setLastOptimizationBase_ACU', () => {
  it('保存优化基准', () => {
    const result = setLastOptimizationBase_ACU({
      messageIndex: 5,
      messageId: 'msg1',
      baseContent: '原始内容',
    });
    expect(result.messageIndex).toBe(5);
    expect(result.messageId).toBe('msg1');
    expect(result.baseContent).toBe('原始内容');
    expect(result.updatedAt).toBeGreaterThan(0);
    expect(mockSaveCache).toHaveBeenCalled();
  });

  it('空 payload 使用默认值', () => {
    const result = setLastOptimizationBase_ACU();
    expect(result.messageIndex).toBe(-1);
    expect(result.messageId).toBeNull();
    expect(result.baseContent).toBe('');
  });

  it('非整数 messageIndex 使用 -1', () => {
    const result = setLastOptimizationBase_ACU({ messageIndex: 'abc' });
    expect(result.messageIndex).toBe(-1);
  });
});

// ═══ getLastOptimizationBase_ACU ═══
describe('getLastOptimizationBase_ACU', () => {
  it('有内存缓存时返回内存缓存', () => {
    setLastOptimizationBase_ACU({ messageIndex: 3, baseContent: '缓存内容' });
    const result = getLastOptimizationBase_ACU();
    expect(result).not.toBeNull();
    expect(result!.baseContent).toBe('缓存内容');
  });

  it('无内存缓存时从持久化缓存加载', () => {
    mockLoadCache.mockReturnValue({ messageIndex: 2, baseContent: '持久化内容' });
    // 先清除内存缓存
    setLastOptimizationBase_ACU({ baseContent: '' });
    const result = getLastOptimizationBase_ACU();
    expect(result).not.toBeNull();
    expect(result!.baseContent).toBe('持久化内容');
  });

  it('无任何缓存时返回 null', () => {
    // 清除内存缓存
    setLastOptimizationBase_ACU({ baseContent: '' });
    mockLoadCache.mockReturnValue(null);
    const result = getLastOptimizationBase_ACU();
    expect(result).toBeNull();
  });
});

// ═══ cancelContentOptimization_ACU ═══
describe('cancelContentOptimization_ACU', () => {
  it('取消优化', () => {
    const result = cancelContentOptimization_ACU();
    expect(result.cancelled).toBe(true);
    expect(result.reason).toContain('终止');
  });

  it('自定义取消原因', () => {
    const result = cancelContentOptimization_ACU('自定义原因');
    expect(result.reason).toBe('自定义原因');
  });
});

// ═══ ensureOptimizationNotCancelled_ACU ═══
describe('ensureOptimizationNotCancelled_ACU', () => {
  it('未取消时不抛错', () => {
    _set_contentOptimizationAbortRequested_ACU(false);
    expect(() => ensureOptimizationNotCancelled_ACU()).not.toThrow();
  });

  it('已取消时抛错', () => {
    cancelContentOptimization_ACU();
    expect(() => ensureOptimizationNotCancelled_ACU()).toThrow('终止');
  });
});

// ═══ _set_contentOptimizationAbortRequested_ACU ═══
describe('_set_contentOptimizationAbortRequested_ACU', () => {
  it('设置为 true 后 ensureOptimizationNotCancelled 抛错', () => {
    _set_contentOptimizationAbortRequested_ACU(true);
    expect(() => ensureOptimizationNotCancelled_ACU()).toThrow();
  });
  it('设置为 false 后 ensureOptimizationNotCancelled 不抛错', () => {
    _set_contentOptimizationAbortRequested_ACU(false);
    expect(() => ensureOptimizationNotCancelled_ACU()).not.toThrow();
  });
});

// ═══ _set_optimizationProgressToast_ACU ═══
describe('_set_optimizationProgressToast_ACU', () => {
  it('设置 toast 值后变量更新为该值', () => {
    const toast = { message: '优化中...' };
    _set_optimizationProgressToast_ACU(toast);
    expect(optimizationProgressToast_ACU).toBe(toast);
    expect(optimizationProgressToast_ACU.message).toBe('优化中...');
  });
  it('设置为 null 后变量为 null', () => {
    _set_optimizationProgressToast_ACU({ message: '先设置一个值' });
    expect(optimizationProgressToast_ACU).not.toBeNull();
    _set_optimizationProgressToast_ACU(null);
    expect(optimizationProgressToast_ACU).toBeNull();
  });
});

// ═══ performContentOptimization_ACU ═══
describe('performContentOptimization_ACU', () => {
  it('API 调用成功且解析成功时返回优化结果', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    const { applyOptimizations_ACU } = await import('../../../src/shared/text-optimization');
    vi.mocked(callAIWithPreset_ACU).mockResolvedValue(JSON.stringify({
      optimizations: [
        { type: 'replace', original: '旧文本', optimized: '新文本', plan: '优化计划' },
      ],
      summary: '优化总结',
    }));
    vi.mocked(applyOptimizations_ACU).mockReturnValue('优化后的内容');

    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU('原始内容', { currentLoop: 1 });
    expect(result.success).toBe(true);
    expect(result.optimizations).toBeDefined();
    expect(result.optimizedContent).toBe('优化后的内容');
  });

  it('API 返回空响应时所有重试失败', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    vi.mocked(callAIWithPreset_ACU).mockResolvedValue('');

    mockSettings.contentOptimizationSettings = { maxOptimizations: 10, loopCount: 1, retryCount: 1 };
    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU('内容', {});
    expect(result.success).toBe(false);
    expect(result.retryExhausted).toBe(true);
  });

  it('API 抛错时重试后失败', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    vi.mocked(callAIWithPreset_ACU).mockRejectedValue(new Error('网络错误'));

    mockSettings.contentOptimizationSettings = { maxOptimizations: 10, loopCount: 1, retryCount: 1 };
    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU('内容', {});
    expect(result.success).toBe(false);
  });

  it('seed 匹配内容组合用户+AI 输入（composeSeedMatchContent：AI-only 会漏用户触发的 seed 条件）', async () => {
    const helpers = await import('../../../src/service/runtime/helpers-remaining');
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    const { applyOptimizations_ACU } = await import('../../../src/shared/text-optimization');
    vi.mocked(callAIWithPreset_ACU).mockResolvedValue(JSON.stringify({
      optimizations: [{ type: 'replace', original: '旧文本', optimized: '新文本', plan: '优化计划' }],
      summary: '优化总结',
    }));
    vi.mocked(applyOptimizations_ACU).mockReturnValue('优化后的内容');
    vi.mocked(helpers.getLatestUserMessageContent_ACU).mockReturnValue('玩家：发动突袭');
    vi.mocked(helpers.getLatestAIMessageContent_ACU).mockReturnValue('AI：战况推进');
    // 提示词必须非空，否则 messages.forEach 不执行，条件模板分支根本走不到。
    mockSettings.contentOptimizationSettings = {
      maxOptimizations: 10, loopCount: 1, retryCount: 1,
      promptGroup: [{ role: 'user', content: '<seed:突袭>请优化正文</seed>' }],
    };

    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU('原始内容', { currentLoop: 1 });
    expect(result.success).toBe(true);

    // context.seedContent 必须含用户楼内容（mock compose=user\nAI join）；
    // 调用点回退成 AI-only（content-optimization.ts 的 composeSeedMatchContent_ACU 少传实参）即红。
    const call = vi.mocked(helpers.parseIfBlockRecursive_ACU).mock.calls
      .find(c => c.some(a => a && typeof a === 'object' && 'seedContent' in (a as any)));
    expect(call).toBeTruthy();
    const ctx = call!.find(a => a && typeof a === 'object' && 'seedContent' in (a as any)) as any;
    expect(ctx.seedContent).toContain('玩家：发动突袭');
    expect(ctx.seedContent).toContain('AI：战况推进');
  });
});

// ═══ [W2] 标签排除规则 · 写回保护接线（performContentOptimization_ACU）═══
describe('标签排除规则写回保护接线（performContentOptimization_ACU）', () => {
  const COMMENT_RULES = [{ start: '<!--', end: '-->' }];

  beforeEach(() => {
    // 上游用例用 mockReturnValue 覆盖过实现，这里显式恢复默认「全部保留」实现
    mockFilterExclusions.mockImplementation((content: string, optimizations: any[]) => ({
      kept: optimizations,
      dropped: [],
      ranges: [],
    }));
  });

  it('命中排除段的建议被丢弃：不进入 result.optimizations、不参与写回、不占「共 N 处改进」', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    const { applyOptimizations_ACU } = await import('../../../src/shared/text-optimization');
    const content = '夜色漫过屋檐。<!-- 作者注：伏笔保持原样 -->';
    const kept = [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过瓦檐', plan: '改写' }];
    const dropped = [{ index: 2, original: '伏笔保持原样', reason: '命中排除段 9-26', range: { start: 9, end: 26 } }];

    mockSettings.contentOptimizationSettings = {
      maxOptimizations: 10, loopCount: 1, retryCount: 1,
      excludeRules: COMMENT_RULES, excludeTags: '',
    };
    mockFilterExclusions.mockReturnValue({ kept, dropped, ranges: [{ start: 9, end: 26 }] });
    vi.mocked(callAIWithPreset_ACU).mockResolvedValue(JSON.stringify({
      optimizations: [
        { type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过瓦檐', plan: '改写' },
        { type: 'replace', original: '伏笔保持原样', optimized: '伏笔被改写', plan: '不该动' },
      ],
      summary: '两条建议',
    }));

    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU(content, { currentLoop: 1 });

    expect(result.success).toBe(true);
    // 计数口径：调用方按 result.optimizations.length 统计「共 N 处改进」→ 丢弃项不占数
    expect(result.optimizations).toHaveLength(1);
    expect(result.optimizations[0].original).toBe('夜色漫过屋檐');
    // 排除规则确实透传到了写回保护
    expect(mockFilterExclusions).toHaveBeenCalledWith(
      content,
      expect.any(Array),
      { excludeRules: COMMENT_RULES, excludeTags: '' },
    );
    // 写回只喂保留下来的建议
    expect(vi.mocked(applyOptimizations_ACU).mock.calls.some(call => call[1] === kept)).toBe(true);
  });

  it('未配置排除规则时行为不变：全部建议原样透传（回归锁）', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    const content = '普通正文，没有任何注释段。';
    const parsed = [{ type: 'replace', original: '普通正文', optimized: '更好的正文', plan: '改写' }];

    mockSettings.contentOptimizationSettings = { maxOptimizations: 10, loopCount: 1, retryCount: 1 };
    vi.mocked(callAIWithPreset_ACU).mockResolvedValue(JSON.stringify({
      optimizations: parsed, summary: '一条建议',
    }));

    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU(content, { currentLoop: 1 });

    expect(result.success).toBe(true);
    expect(result.optimizations).toHaveLength(1);
    expect(result.optimizations).toEqual(parsed);
    expect(mockFilterExclusions).toHaveBeenCalledWith(
      content, expect.any(Array), { excludeRules: undefined, excludeTags: undefined },
    );
  });
});

// ═══ [W1] 自动正文替换 · 已处理集合判重（service 层入口）═══
describe('自动替换判重 service 入口', () => {
  beforeEach(() => {
    mockFindProcessed.mockReturnValue(null);
  });

  it('messageId 缺失 → 直接放行，不查记录', () => {
    expect(shouldSkipDuplicateAutoContentOptimization_ACU(null, '正文')).toBe(false);
    expect(shouldSkipDuplicateAutoContentOptimization_ACU(undefined, '正文')).toBe(false);
    expect(mockFindProcessed).not.toHaveBeenCalled();
  });

  it('内容为空 → 放行（宁多跑一次，绝不误拦）', () => {
    expect(shouldSkipDuplicateAutoContentOptimization_ACU(11, '')).toBe(false);
    expect(shouldSkipDuplicateAutoContentOptimization_ACU(11, null as any)).toBe(false);
    expect(mockFindProcessed).not.toHaveBeenCalled();
  });

  it('无该楼记录 → 放行', () => {
    mockFindProcessed.mockReturnValue(null);
    expect(shouldSkipDuplicateAutoContentOptimization_ACU(11, '优化后的正文')).toBe(false);
    expect(mockFindProcessed).toHaveBeenCalledWith(11, 'test-chat');
  });

  it('有记录且内容指纹一致 → 跳过（内容未变）', () => {
    mockFindProcessed.mockReturnValue({
      messageIndex: 3, messageId: '11',
      contentHash: computeAutoOptimizationContentHash_ACU('优化后的正文'),
      chatKey: 'test-chat', updatedAt: 1,
    });
    expect(shouldSkipDuplicateAutoContentOptimization_ACU(11, '优化后的正文')).toBe(true);
  });

  it('有记录但内容已变化 → 放行（正常执行并随后更新记录）', () => {
    mockFindProcessed.mockReturnValue({
      messageIndex: 3, messageId: '11',
      contentHash: computeAutoOptimizationContentHash_ACU('优化后的正文'),
      chatKey: 'test-chat', updatedAt: 1,
    });
    expect(shouldSkipDuplicateAutoContentOptimization_ACU(11, '优化后的正文！被改过了')).toBe(false);
  });

  it('登记：按写回后内容计算 sha256 指纹并交给存储层（复用仓内 helper）', () => {
    mockRecordProcessed.mockImplementation((payload: any) => payload);
    const recorded = recordAutoContentOptimizationProcessed_ACU({
      messageIndex: 4, messageId: 12, content: '写回后的正文',
    });

    expect(mockRecordProcessed).toHaveBeenCalledTimes(1);
    const payload = mockRecordProcessed.mock.calls[0][0] as any;
    expect(payload.messageId).toBe(12);
    expect(payload.messageIndex).toBe(4);
    expect(payload.contentHash).toBe(sha256HexSync_ACU('写回后的正文'));
    expect(payload.chatKey).toBe('test-chat');
    expect(payload.updatedAt).toBeGreaterThan(0);
    expect(recorded).toMatchObject({ messageId: 12 });
  });

  it('登记：messageId / 内容缺失时不写记录', () => {
    expect(recordAutoContentOptimizationProcessed_ACU({ messageId: null, content: 'x' })).toBeNull();
    expect(recordAutoContentOptimizationProcessed_ACU({ content: 'x' })).toBeNull();
    expect(recordAutoContentOptimizationProcessed_ACU({ messageId: 5, content: '' })).toBeNull();
    expect(recordAutoContentOptimizationProcessed_ACU()).toBeNull();
    expect(mockRecordProcessed).not.toHaveBeenCalled();
  });

  it('指纹与内容一一对应：不同内容不同指纹，相同内容相同指纹', () => {
    expect(computeAutoOptimizationContentHash_ACU('A')).toBe(computeAutoOptimizationContentHash_ACU('A'));
    expect(computeAutoOptimizationContentHash_ACU('A')).not.toBe(computeAutoOptimizationContentHash_ACU('B'));
    expect(computeAutoOptimizationContentHash_ACU(null as any)).toBe(sha256HexSync_ACU(''));
  });
});
