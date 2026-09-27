/**
 * tests/service/table/cold-replay-yield-wiring-2.test.ts
 * P1-c 续：另外两处冷合并入口接上让步预算 + 聊天变更取消信号。
 *
 * 覆盖两处此前未接线的冷入口：
 *   ① service/table/sql-table-service.ts::loadFromChat（切聊 / 冷加载，SQLite 模式）
 *   ② service/worldbook/pipeline.ts::updateReadableLorebookEntry_ACU 的冷启动分支
 *      （交火 / 世界书派生刷新；dataOverride 与 isImport 分支不经回放，语义不变）
 *
 * 观测方式沿用 tests/service/table/cold-replay-yield-wiring.test.ts：
 * 让步体现为 setTimeout(..., 0) 宏任务，这里对宏任务计数，不依赖墙钟时间。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLongHistoryFixture_ACU } from './v2-long-history-fixture';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  jsonTableData: null as any,
  isolationKey: '',
  chatKey: 'cold-chat',
  abortSignal: null as AbortSignal | null,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mocks.chat,
  saveChatToHost_ACU: vi.fn(async () => undefined),
}));

vi.mock('../../../src/service/runtime/state-manager', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/service/runtime/state-manager')>();
  return {
    ...actual,
    get currentJsonTableData_ACU() { return mocks.jsonTableData; },
    _set_currentJsonTableData_ACU: (value: any) => { mocks.jsonTableData = value; },
    getCurrentIsolationKey_ACU: () => mocks.isolationKey,
    get currentChatFileIdentifier_ACU() { return mocks.chatKey; },
    getChatMutationAbortSignal_ACU: () => mocks.abortSignal,
  };
});

/** 统计一次调用期间发生的「让出宏任务」次数（setTimeout(..., 0)）。 */
async function countYields<T>(action: () => Promise<T>): Promise<{ result: T; yields: number }> {
  const originalSetTimeout = globalThis.setTimeout;
  let yields = 0;
  globalThis.setTimeout = ((handler: any, timeout?: number, ...args: any[]) => {
    if (timeout === 0) yields += 1;
    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof globalThis.setTimeout;
  try {
    const result = await action();
    return { result, yields };
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

beforeEach(() => {
  mocks.chat = buildLongHistoryFixture_ACU().chat;
  mocks.jsonTableData = null;
  mocks.isolationKey = '';
  mocks.chatKey = 'cold-chat';
  mocks.abortSignal = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../../src/service/runtime/helpers-remaining');
  vi.doUnmock('../../../src/service/runtime/helpers-data-merge');
  vi.doUnmock('../../../src/service/worldbook/pipeline');
});

describe('冷合并入口接线 · sql-table-service.loadFromChat', () => {
  it('以统一预算 + 聊天变更取消信号调用冷回放 merge 入口', async () => {
    const merge = vi.fn(async () => null);
    vi.doMock('../../../src/service/runtime/helpers-data-merge', async importOriginal => {
      const actual = await importOriginal<typeof import('../../../src/service/runtime/helpers-data-merge')>();
      return { ...actual, mergeAllIndependentTables_ACU: merge };
    });
    const { COLD_REPLAY_YIELD_BUDGET_MS_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const controller = new AbortController();
    mocks.abortSignal = controller.signal;
    const { SqlTableService } = await import('../../../src/service/table/sql-table-service');

    await new SqlTableService().loadFromChat();

    expect(merge).toHaveBeenCalledWith({
      yieldBudgetMs: COLD_REPLAY_YIELD_BUDGET_MS_ACU,
      signal: controller.signal,
    });
  });

  it('长链在极小预算下让出 ≥1 次、不传预算时 0 次，两者合并结果逐字相同', async () => {
    vi.doMock('../../../src/service/runtime/helpers-data-merge', async importOriginal => {
      const actual = await importOriginal<typeof import('../../../src/service/runtime/helpers-data-merge')>();
      return actual;
    });
    const { mergeAllIndependentTables_ACU } = await import('../../../src/service/runtime/helpers-data-merge');
    mocks.jsonTableData = null;

    const baseline = await countYields(() => mergeAllIndependentTables_ACU());
    expect(baseline.result).toBeTruthy();
    expect(baseline.yields).toBe(0);

    const yielded = await countYields(() => mergeAllIndependentTables_ACU({ yieldBudgetMs: 1 }));
    expect(yielded.yields).toBeGreaterThan(0);
    expect(yielded.result).toEqual(baseline.result);
  });

  it('切聊打断：真实回放在 frame 边界中止，loadFromChat 不发布半成品状态并回报可区分失败码', async () => {
    // 走真实 merge + 真实回放核心：切聊（abortOnChatMutation）已把全局信号置为 aborted，
    // 回放在第一个 frame 边界抛 V2ReplayAbortedError，loadFromChat 必须按「中止」返回。
    mocks.abortSignal = AbortSignal.abort();
    const { SqlTableService } = await import('../../../src/service/table/sql-table-service');
    const service = new SqlTableService();

    const result = await service.loadFromChat();

    expect(result.loaded).toBe(false);
    expect(result.source).toBe('empty');
    expect(result.error).toMatch(/^replay_aborted:/);
    // 半成品防线：中止后不得进入 loadFromData（不建表、不灌数据、不发布视图）。
    expect(service.isReady()).toBe(false);
    expect(mocks.jsonTableData).toBeNull();
  });

  it('同样的已中止信号下，merge 入口自身也让出 0 次并在回放核心抛中止', async () => {
    mocks.abortSignal = AbortSignal.abort();
    const { mergeAllIndependentTables_ACU } = await import('../../../src/service/runtime/helpers-data-merge');
    const { COLD_REPLAY_YIELD_BUDGET_MS_ACU, V2ReplayAbortedError_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    await expect(mergeAllIndependentTables_ACU({
      yieldBudgetMs: COLD_REPLAY_YIELD_BUDGET_MS_ACU,
      signal: mocks.abortSignal,
    })).rejects.toBeInstanceOf(V2ReplayAbortedError_ACU);
  });
});

describe('冷合并入口接线 · worldbook pipeline 冷启动分支', () => {
  it('以统一预算 + 聊天变更取消信号调用冷回放 merge 入口', async () => {
    const merge = vi.fn(async () => ({ mate: {}, sheet_a: { name: 'A', content: [[null, '列1'], [null, '值']] } }));
    vi.doMock('../../../src/service/runtime/helpers-remaining', () => ({
      consumeLastMergeQuarantinedSheetKeys_ACU: vi.fn(() => []),
      consumeLastMergeWarnings_ACU: vi.fn(() => []),
      formatJsonToReadable_ACU: vi.fn(() => ({ readableText: '内容', importantPersonsTable: null, summaryTable: null, outlineTable: null })),
      maybeLiftWorldbookSuppression_ACU: vi.fn(),
      mergeAllIndependentTables_ACU: merge,
      shouldSuppressWorldbookInjection_ACU: vi.fn(() => false),
    }));
    const { COLD_REPLAY_YIELD_BUDGET_MS_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const controller = new AbortController();
    mocks.abortSignal = controller.signal;
    const { updateReadableLorebookEntry_ACU } = await import('../../../src/service/worldbook/pipeline');

    await updateReadableLorebookEntry_ACU(false, false);

    expect(merge).toHaveBeenCalledWith({
      yieldBudgetMs: COLD_REPLAY_YIELD_BUDGET_MS_ACU,
      signal: controller.signal,
    });
  });

  it('让出期间切聊：合并结果作废，不写内存表数据也不更新世界书条目', async () => {
    const setData = vi.fn();
    vi.doMock('../../../src/service/runtime/state-manager', async importOriginal => {
      const actual = await importOriginal<typeof import('../../../src/service/runtime/state-manager')>();
      return {
        ...actual,
        get currentJsonTableData_ACU() { return mocks.jsonTableData; },
        _set_currentJsonTableData_ACU: setData,
        getCurrentIsolationKey_ACU: () => mocks.isolationKey,
        get currentChatFileIdentifier_ACU() { return mocks.chatKey; },
        getChatMutationAbortSignal_ACU: () => null,
      };
    });
    const updateImportantPersons = vi.fn();
    const updateSummary = vi.fn();
    const updateOutline = vi.fn();
    const updateCustom = vi.fn();
    vi.doMock('../../../src/service/worldbook/injection-engine', async importOriginal => {
      const actual = await importOriginal<typeof import('../../../src/service/worldbook/injection-engine')>();
      return {
        ...actual,
        updateImportantPersonsRelatedEntries_ACU: updateImportantPersons,
        updateSummaryTableEntries_ACU: updateSummary,
        updateOutlineTableEntry_ACU: updateOutline,
        updateCustomTableExports_ACU: updateCustom,
      };
    });
    // 让出窗口模拟：merge 在「让出」之后才 resolve，期间聊天身份已切到另一条。
    const merged = { mate: {}, sheet_a: { name: 'A', content: [[null, '列1'], [null, '旧聊天值']] } };
    const merge = vi.fn(async () => {
      mocks.chatKey = 'other-chat';
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return merged;
    });
    vi.doMock('../../../src/service/runtime/helpers-remaining', () => ({
      consumeLastMergeQuarantinedSheetKeys_ACU: vi.fn(() => []),
      consumeLastMergeWarnings_ACU: vi.fn(() => []),
      formatJsonToReadable_ACU: vi.fn(() => ({ readableText: '内容', importantPersonsTable: null, summaryTable: null, outlineTable: null })),
      maybeLiftWorldbookSuppression_ACU: vi.fn(),
      mergeAllIndependentTables_ACU: merge,
      shouldSuppressWorldbookInjection_ACU: vi.fn(() => false),
    }));
    const { updateReadableLorebookEntry_ACU } = await import('../../../src/service/worldbook/pipeline');

    await updateReadableLorebookEntry_ACU(false, false);

    expect(merge).toHaveBeenCalledTimes(1);
    expect(setData).not.toHaveBeenCalled();
    expect(updateImportantPersons).not.toHaveBeenCalled();
    expect(updateSummary).not.toHaveBeenCalled();
    expect(updateOutline).not.toHaveBeenCalled();
    expect(updateCustom).not.toHaveBeenCalled();
  });

  it('dataOverride / isImport 分支不经回放，行为逐字不变', async () => {
    const merge = vi.fn(async () => null);
    vi.doMock('../../../src/service/runtime/helpers-remaining', () => ({
      consumeLastMergeQuarantinedSheetKeys_ACU: vi.fn(() => []),
      consumeLastMergeWarnings_ACU: vi.fn(() => []),
      formatJsonToReadable_ACU: vi.fn(() => ({ readableText: '内容', importantPersonsTable: null, summaryTable: null, outlineTable: null })),
      maybeLiftWorldbookSuppression_ACU: vi.fn(),
      mergeAllIndependentTables_ACU: merge,
      shouldSuppressWorldbookInjection_ACU: vi.fn(() => false),
    }));
    const { updateReadableLorebookEntry_ACU } = await import('../../../src/service/worldbook/pipeline');
    const override = { mate: {}, sheet_a: { name: 'A', content: [[null, '列1'], [null, '提交值']] } };

    await updateReadableLorebookEntry_ACU(true, false, null, override);

    expect(merge).not.toHaveBeenCalled();
  });
});
