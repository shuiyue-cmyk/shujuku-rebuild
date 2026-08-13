// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  reload: vi.fn(),
  isSqlite: vi.fn(),
  refreshUI: vi.fn(),
  findTable: vi.fn(),
  buildScope: vi.fn(),
  markDirty: vi.fn(),
  timer: { value: null as any },
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  get chatMutationDebounceTimer_ACU() { return h.timer.value; },
  _set_chatMutationDebounceTimer_ACU: (v: any) => { h.timer.value = v; },
  currentChatFileIdentifier_ACU: 'chat-1',
  getCurrentIsolationKey_ACU: () => 'iso-1',
}));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: h.reload,
}));
vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: h.isSqlite,
}));
vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: h.refreshUI,
}));
vi.mock('../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: h.findTable,
  buildSummaryVectorIndexArchiveScopeKey_ACU: h.buildScope,
}));
vi.mock('../../src/service/vector/summary-vector-index-realign-state', () => ({
  markSummaryVectorIndexDirtyForRealign_ACU: h.markDirty,
}));
vi.mock('../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn() }));

import {
  scheduleChatMutationRefresh_ACU,
  cancelPendingChatMutationRefresh_ACU,
  __resetChatMutationSchedulerForTests_ACU,
} from '../../src/presentation/bootstrap/chat-mutation-scheduler';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetChatMutationSchedulerForTests_ACU();
  h.timer.value = null;
  h.isSqlite.mockReturnValue(false);
  h.reload.mockResolvedValue(undefined);
  h.refreshUI.mockResolvedValue({ ok: true });
  h.findTable.mockReturnValue({ summaryKey: 'summary-1' });
  h.buildScope.mockReturnValue('scope-1');
  h.markDirty.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushAll() {
  await vi.runAllTicks();
  await vi.advanceTimersByTimeAsync(5000);
  await vi.runAllTicks();
}

describe('chat mutation scheduler', () => {
  it('连续 5 次事件在 1200ms 内只执行 1 轮', async () => {
    for (let i = 0; i < 5; i++) {
      scheduleChatMutationRefresh_ACU('chat_modified_swiped');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(h.refreshUI).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1200);
    expect(h.refreshUI).toHaveBeenCalledTimes(1);
  });

  it('每 1000ms 触发一次共 4 次，第 3000ms 处必须已强制执行', async () => {
    for (let i = 0; i < 4; i++) {
      scheduleChatMutationRefresh_ACU('chat_modified_swiped');
      await vi.advanceTimersByTimeAsync(1000);
    }
    // 第 3 次触发时（now=3000）应满足 MAX_WAIT_MS 强制立即执行
    expect(h.refreshUI).toHaveBeenCalledTimes(1);
  });

  it('执行中再次触发 → 结束后再跑 1 轮且不重叠', async () => {
    let resolveRefresh!: (v: any) => void;
    h.refreshUI.mockImplementationOnce(() => new Promise(res => { resolveRefresh = res; }));
    h.refreshUI.mockResolvedValue({ ok: true });

    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    await vi.advanceTimersByTimeAsync(1200);
    // 第一轮开始执行（refreshUI 挂起中）
    expect(h.refreshUI).toHaveBeenCalledTimes(1);

    // 执行中触发新事件
    scheduleChatMutationRefresh_ACU('chat_modified_deleted');
    await vi.advanceTimersByTimeAsync(1200);
    // 第二轮还在排队（running 为 true，不并发）
    expect(h.refreshUI).toHaveBeenCalledTimes(1);

    resolveRefresh!({ ok: true });
    await vi.advanceTimersByTimeAsync(1300);
    // 第一轮结束后再跑第二轮
    expect(h.refreshUI).toHaveBeenCalledTimes(2);
  });

  it('refreshUI 抛错时 markDirty 仍被调用', async () => {
    h.refreshUI.mockRejectedValue(new Error('ui boom'));
    scheduleChatMutationRefresh_ACU('chat_modified_deleted');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.markDirty).toHaveBeenCalledTimes(1);
    expect(h.markDirty).toHaveBeenCalledWith('scope-1', 'chat_modified_deleted');
  });

  it('聊天切换取消待执行调度', async () => {
    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    cancelPendingChatMutationRefresh_ACU();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.refreshUI).not.toHaveBeenCalled();
  });

  it('SQLite 模式重建内存数据库后再刷新', async () => {
    h.isSqlite.mockReturnValue(true);
    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.refreshUI).toHaveBeenCalledTimes(1);
  });
});
