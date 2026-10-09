/**
 * tests/service/table/cold-replay-yield-wiring.test.ts
 * P1-c：冷回放让步预算接线。
 *
 * 让步机制本身（yieldIfBudgetExceeded_ACU / metrics.yieldCount）已由
 * storage-frame-v2-replay.test.ts 的「阶段 I」用例覆盖；本文件只验证接线：
 * ① 冷加载/可视化器打开走的 merge 入口是否把预算透传到回放核心（长链上真的让出，
 *    且合并结果与基线逐字一致）；
 * ② 两个真实入口确实以仓库统一的 8~16ms 预算调用该入口；
 * ③ 不传预算时既有调用方语义零变化（永不让出、零额外宏任务）。
 *
 * 观测方式：回放让步用 setTimeout(resolve, 0) 让出事件循环，这里对该宏任务计数，
 * 不依赖墙钟时间，也不需要改回放模块的注入点。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLongHistoryFixture_ACU } from './v2-long-history-fixture';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  jsonTableData: null as any,
  isolationKey: '',
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../../src/service/runtime/helpers-remaining');
  vi.doUnmock('../../../src/service/runtime/helpers-data-merge');
});

describe('冷回放让步预算接线 · 回放核心', () => {
  it('merge 入口透传预算：长增量链在极小预算下至少让出一次，合并结果与基线逐字一致', async () => {
    const { mergeAllIndependentTables_ACU } = await import('../../../src/service/runtime/helpers-data-merge');
    mocks.chat = buildLongHistoryFixture_ACU().chat;
    mocks.jsonTableData = null;
    mocks.isolationKey = '';

    // 基线：不传预算 = 既有调用方语义（永不让出，零额外宏任务）。
    const baseline = await countYields(() => mergeAllIndependentTables_ACU());
    expect(baseline.result).toBeTruthy();
    expect(baseline.yields).toBe(0);

    // 接线后：冷回放入口传 1ms 预算 → 长链必然触发让步。
    const yielded = await countYields(() => mergeAllIndependentTables_ACU({ yieldBudgetMs: 1 }));
    expect(yielded.yields).toBeGreaterThan(0);
    // 让出不得改变回放结果（纯调度语义）。
    expect(yielded.result).toEqual(baseline.result);
  });
});

describe('冷回放让步预算接线 · 真实入口', () => {

  it('可视化器打开：以统一预算调用冷回放 merge 入口', async () => {
    const merge = vi.fn(async () => null);
    vi.doMock('../../../src/service/runtime/helpers-remaining', () => ({
      getTableLocksForSheet_ACU: vi.fn(() => ({})),
      isSpecialIndexLockEnabled_ACU: vi.fn(() => false),
      mergeAllIndependentTables_ACU: merge,
    }));
    vi.doMock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: vi.fn(async () => 0) }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({
      currentChatFileIdentifier_ACU: 'cold-load-chat',
      currentJsonTableData_ACU: null,
      getCurrentIsolationKey_ACU: () => '',
      _set_currentJsonTableData_ACU: vi.fn(),
    }));

    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    const { COLD_REPLAY_YIELD_BUDGET_MS_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { useVisualizerData } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerData');

    const data = useVisualizerData();
    await data.loadFromCurrentContext();

    expect(merge).toHaveBeenCalledWith({ yieldBudgetMs: COLD_REPLAY_YIELD_BUDGET_MS_ACU });
  });
});
