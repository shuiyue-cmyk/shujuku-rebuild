/**
 * tests/data/gateways/chat-save-coalescer.test.ts
 * 填表运行期的宿主全量存盘合并（参考上游 PR #70，按我方口径重写）。
 * 只 mock 宿主 API 与日志，直测 chat-gateway 的调度本体。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSillyTavern, mockLogWarn, saveChat, mockHost } = vi.hoisted(() => {
  // currentChatId=null：宿主不暴露聊天 id，按同一聊天处理
  const mockHost = { currentChatId: null as string | null };
  return {
    mockHost,
    mockSillyTavern: {
      getCurrentChatId: () => (mockHost.currentChatId === null ? undefined : mockHost.currentChatId),
    } as any,
    mockLogWarn: vi.fn(),
    saveChat: vi.fn(),
  };
});

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
  jQuery_API_ACU: {},
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: mockLogWarn,
  cleanChatName_ACU: (name: string) => name.replace(/\.jsonl$|\.json$/i, ''),
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  getHostRequestHeaders_ACU: () => ({}),
}));

import {
  beginChatSaveCoalescing_ACU,
  CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU,
  endChatSaveCoalescing_ACU,
  flushChatSaveOnPageHidden_ACU,
  forceFlushChatSave_ACU,
  hasPendingCoalescedChatSave_ACU,
  installChatSavePageHideFlush_ACU,
  resetChatSaveCoalescerForTests_ACU,
  saveChatToHost_ACU,
  saveChatToHostCoalesced_ACU,
  saveChatToHostStrict_ACU,
} from '../../../src/data/gateways/chat-gateway';

/** 每次调用都挂起的 saveChat；release() 放行最早的一次。 */
function installGatedSaveChat() {
  const gates: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  saveChat.mockImplementation(() => new Promise<void>((resolve, reject) => { gates.push({ resolve, reject }); }));
  return {
    calls: () => saveChat.mock.calls.length,
    release: () => { gates.shift()?.resolve(); },
    fail: (error: Error) => { gates.shift()?.reject(error); },
  };
}

const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockHost.currentChatId = null;
  resetChatSaveCoalescerForTests_ACU();
  saveChat.mockReset().mockResolvedValue(undefined);
  mockSillyTavern.saveChat = saveChat;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetChatSaveCoalescerForTests_ACU();
});

describe('窗口外：与直接存盘等价', () => {
  it('一次调用一次真存盘', async () => {
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
  });

  it('在途期间的后续调用合并进尾随环，不重复排宿主队列，也不丢数据', async () => {
    const gate = installGatedSaveChat();
    const first = saveChatToHostCoalesced_ACU();
    await flushMicrotasks();
    const second = saveChatToHostCoalesced_ACU();
    await flushMicrotasks();
    expect(gate.calls()).toBe(1);
    gate.release();
    await flushMicrotasks();
    expect(gate.calls()).toBe(2);
    gate.release();
    await Promise.all([first, second]);
    expect(gate.calls()).toBe(2);
  });

  it('saveChat 缺失时静默返回并告警', async () => {
    delete mockSillyTavern.saveChat;
    await expect(saveChatToHostCoalesced_ACU()).resolves.toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('真存盘失败时首个调用方感知失败，改动留待下一次补存', async () => {
    saveChat.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveChatToHostCoalesced_ACU()).rejects.toThrow('disk full');
    expect(hasPendingCoalescedChatSave_ACU()).toBe(true);
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
  });
});

describe('填表运行窗口', () => {
  it('窗口内多批只记下改动不存盘，窗口结束补存一次', async () => {
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    await saveChatToHostCoalesced_ACU();
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    await endChatSaveCoalescing_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
  });

  it('嵌套窗口（并发分组 / 外层编排）只在最外层结束时补存', async () => {
    beginChatSaveCoalescing_ACU();
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    await endChatSaveCoalescing_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    await saveChatToHostCoalesced_ACU();
    await endChatSaveCoalescing_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('窗口内没有改动时结束不存盘', async () => {
    beginChatSaveCoalescing_ACU();
    await endChatSaveCoalescing_ACU();
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('窗口内发生一次 strict 全量存盘后，结束时不再重复存', async () => {
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    await saveChatToHostStrict_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    await endChatSaveCoalescing_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('窗口内我方任一次普通全量存盘同样覆盖已记下的改动', async () => {
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    await saveChatToHost_ACU();
    await endChatSaveCoalescing_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('存盘进行中才记下的改动不算已保存：那次存盘结束后仍会补存', async () => {
    beginChatSaveCoalescing_ACU();
    const gate = installGatedSaveChat();
    const strict = saveChatToHostStrict_ACU();
    await flushMicrotasks();
    await saveChatToHostCoalesced_ACU();
    gate.release();
    await strict;
    expect(hasPendingCoalescedChatSave_ACU()).toBe(true);
    saveChat.mockReset().mockResolvedValue(undefined);
    await endChatSaveCoalescing_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
  });

  it('窗口内恰有补存在途时，批次不干等存盘；在途的补存环顺带把这次改动也存上', async () => {
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    const gate = installGatedSaveChat();
    const hidden = flushChatSaveOnPageHidden_ACU('visibilitychange');
    await flushMicrotasks();
    expect(gate.calls()).toBe(1);
    let batchReturned = false;
    const batch = saveChatToHostCoalesced_ACU().then(() => { batchReturned = true; });
    await flushMicrotasks();
    expect(batchReturned).toBe(true);
    gate.release();
    await flushMicrotasks();
    expect(gate.calls()).toBe(2);
    gate.release();
    await Promise.all([hidden, batch]);
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
    await endChatSaveCoalescing_ACU();
    expect(gate.calls()).toBe(2);
  });

  it('窗口持续超过上限时兜底定时器强制补存一次', async () => {
    vi.useFakeTimers();
    resetChatSaveCoalescerForTests_ACU();
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU);
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
    await endChatSaveCoalescing_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('结束时补存失败不抛错，改动保留到下一次冲洗', async () => {
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    saveChat.mockRejectedValueOnce(new Error('host busy'));
    await expect(endChatSaveCoalescing_ACU()).resolves.toBeUndefined();
    expect(hasPendingCoalescedChatSave_ACU()).toBe(true);
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
  });
});

describe('聊天归属与页面隐藏', () => {
  it('记下改动后已切到别的聊天：冲洗时作废旧聊天的改动，不把新聊天存一遍', async () => {
    mockHost.currentChatId = 'chat-a';
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    mockHost.currentChatId = 'chat-b';
    await endChatSaveCoalescing_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    expect(hasPendingCoalescedChatSave_ACU()).toBe(false);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('页面转入后台时立即补存运行中记下的改动（手机切后台最容易被系统杀掉）', async () => {
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    await flushChatSaveOnPageHidden_ACU('visibilitychange');
    expect(saveChat).toHaveBeenCalledTimes(1);
    // 运行还没结束：之后的批次照样合并
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    await endChatSaveCoalescing_ACU();
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('没有待存改动时页面转入后台不存盘', async () => {
    await flushChatSaveOnPageHidden_ACU('pagehide');
    expect(saveChat).not.toHaveBeenCalled();
  });
});

describe('页面隐藏补存的注册', () => {
  function stubPage() {
    const docListeners: Record<string, () => void> = {};
    const winListeners: Record<string, () => void> = {};
    const fakeDoc = {
      visibilityState: 'visible',
      addEventListener: vi.fn((type: string, fn: () => void) => { docListeners[type] = fn; }),
    };
    const fakeWin = { addEventListener: vi.fn((type: string, fn: () => void) => { winListeners[type] = fn; }) };
    vi.stubGlobal('document', fakeDoc);
    vi.stubGlobal('window', fakeWin);
    return { fakeDoc, fakeWin, docListeners, winListeners };
  }

  it('转为 hidden 与 pagehide 时补存；仍可见时不存', async () => {
    const page = stubPage();
    installChatSavePageHideFlush_ACU();
    beginChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    page.docListeners.visibilitychange();
    await flushMicrotasks();
    expect(saveChat).not.toHaveBeenCalled();
    page.fakeDoc.visibilityState = 'hidden';
    page.docListeners.visibilitychange();
    await flushMicrotasks();
    expect(saveChat).toHaveBeenCalledTimes(1);
    await saveChatToHostCoalesced_ACU();
    page.winListeners.pagehide();
    await flushMicrotasks();
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('重复注册只挂一次监听', () => {
    const page = stubPage();
    installChatSavePageHideFlush_ACU();
    installChatSavePageHideFlush_ACU();
    expect(page.fakeDoc.addEventListener).toHaveBeenCalledTimes(1);
    expect(page.fakeWin.addEventListener).toHaveBeenCalledTimes(1);
  });
});
