import { describe, expect, it, vi } from 'vitest';
import { ContinuationHostGenerationBridge_ACU } from '../../../src/service/continuation/host-generation-bridge';

const identity = { chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-a', attemptId: 'attempt-a' };

function createHarness(options: { tags?: string; chat?: any[]; send?: boolean; onWait?: () => void; autoContinueStates?: Array<{ eligible: boolean; delaySeconds: number }>; invalidatePendingAutoFill?: () => void } = {}) {
  let chat = options.chat ?? [{ is_user: true }];
  let chatIdentity = 'chat-a';
  let pending: any = null;
  const autoContinueStates = [...(options.autoContinueStates ?? [])];
  const retryPreparedTurn: any = { identity, instruction: { instruction: '重试后的最终普通文本' } };
  const continuePreparedTurn: any = { identity, instruction: { instruction: '自动续写的下一轮文本' } };
  const retryCurrentTurn = vi.fn(async () => ({ preparedTurn: retryPreparedTurn }));
  const continueTask = vi.fn(async () => ({ preparedTurn: continuePreparedTurn }));
  const runtime = {
    getChatIdentity: () => chatIdentity, getChat: () => chat,
    readPendingHostTurn: () => pending ? { settings: { loopTags: options.tags ?? '<ok>' }, pending } : null,
    readAutoContinueState: vi.fn(() => autoContinueStates.length ? autoContinueStates.shift()! : { eligible: false, delaySeconds: 0 }),
    continueTask,
    retryCurrentTurn,
    recordHostTurn: vi.fn(async ({ identity: sent, capture }) => { pending = { identity: sent, capture, retryCount: 0, status: 'awaiting_generation' }; }),
    bindHostTurnGeneration: vi.fn(async (_identity, generationSeq) => { pending = { ...pending, capture: { ...pending.capture, generationSeq } }; }),
    confirmCurrentTurn: vi.fn(async () => { pending = null; }),
    rejectHostTurnForMissingTags: vi.fn(async () => { pending = { ...pending, status: 'retry_ready' }; }),
    rejectHostTurnForFailedGeneration: vi.fn(async () => { pending = { ...pending, status: 'retry_ready' }; }),
    pauseForHostInputFailure: vi.fn(async () => { pending = { ...pending, status: 'exhausted' }; }),
    pauseForHostResultFailure: vi.fn(async () => { pending = { ...pending, status: 'exhausted' }; }),
    failHostTurnForStoppedGeneration: vi.fn(async () => { pending = { ...pending, status: 'retry_ready' }; }),
  };
  const hostInput = { send: vi.fn(() => options.send ?? true), removeLastMessage: vi.fn(async () => { chat = chat.slice(0, -1); return true; }) };
  const wait = vi.fn(async () => options.onWait?.());
  const bridge = new ContinuationHostGenerationBridge_ACU({ runtime, hostInput, now: () => 100, wait, materializationRetries: 1, materializationRetryDelayMs: 0, ...(options.invalidatePendingAutoFill ? { invalidatePendingAutoFill: options.invalidatePendingAutoFill } : {}) });
  return { bridge, runtime, hostInput, retryCurrentTurn, continueTask, wait, setChat: (value: any[]) => { chat = value; }, setChatIdentity: (value: string) => { chatIdentity = value; } };
}

describe('ContinuationHostGenerationBridge_ACU', () => {
  const prepared: any = { identity, instruction: { instruction: '最终普通文本' } };

  it('persists identity before host send, then uniquely confirms the matching materialized reply', async () => {
    const h = createHarness();
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await expect(h.bridge.send(prepared)).resolves.toBe(true);
    expect(h.runtime.recordHostTurn).toHaveBeenCalledBefore(h.hostInput.send as any);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>正文', message_id: 9 }]);
    await h.bridge.onGenerationEnded(9, 7);
    expect(h.runtime.bindHostTurnGeneration).toHaveBeenCalledWith(identity, 7);
    expect(h.runtime.confirmCurrentTurn).toHaveBeenCalledWith(identity);
    expect(h.runtime.rejectHostTurnForMissingTags).not.toHaveBeenCalled();
  });

  it('waits for a makeFirst-era AI floor to materialize before resolving the claimed host result', async () => {
    let setChat: (value: any[]) => void;
    const h = createHarness({ onWait: () => setChat([{ is_user: true }, { is_user: false, mes: '<ok>延迟物化', message_id: 9 }]) });
    setChat = h.setChat;
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);

    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.confirmCurrentTurn).toHaveBeenCalledWith(identity);
  });

  it('pauses instead of claiming a host send whose input adapter is unavailable', async () => {
    const h = createHarness({ send: false });
    await expect(h.bridge.send(prepared)).resolves.toBe(false);
    expect(h.runtime.pauseForHostInputFailure).toHaveBeenCalledWith(identity);
    expect(h.bridge.onGenerationStarted(7)).toBe(false);
  });

  it('retries the same attempt when the uniquely resolved reply misses required tags', async () => {
    const h = createHarness({ tags: '<required>' });
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(h.hostInput.send.mock.calls.length === 1 ? 7 : 8); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '正文', message_id: 9 }]);
    await h.bridge.onGenerationEnded(9, 7);
    expect(h.runtime.rejectHostTurnForMissingTags).toHaveBeenCalledWith({ identity, messageIndex: 1 });
    expect(h.hostInput.removeLastMessage).toHaveBeenCalledOnce();
    expect(h.retryCurrentTurn).toHaveBeenCalledOnce();
    expect(h.hostInput.send).toHaveBeenCalledTimes(2);
    expect(h.hostInput.send).toHaveBeenLastCalledWith('重试后的最终普通文本');
    expect(h.runtime.confirmCurrentTurn).not.toHaveBeenCalled();
  });

  it('pauses without retrying when the invalid reply is no longer the host tail', async () => {
    const h = createHarness({ tags: '<required>' });
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '正文', message_id: 9 }, { is_user: true, mes: '较新的用户输入' }]);

    await h.bridge.onGenerationEnded(9, 7);

    expect(h.hostInput.removeLastMessage).not.toHaveBeenCalled();
    expect(h.runtime.pauseForHostResultFailure).toHaveBeenCalledWith(identity);
    expect(h.runtime.rejectHostTurnForMissingTags).not.toHaveBeenCalled();
    expect(h.retryCurrentTurn).not.toHaveBeenCalled();
  });

  it('pauses without retrying when the host cannot confirm removal of the invalid reply', async () => {
    const h = createHarness({ tags: '<required>' });
    h.hostInput.removeLastMessage.mockResolvedValueOnce(false);
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '正文', message_id: 9 }]);

    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.pauseForHostResultFailure).toHaveBeenCalledWith(identity);
    expect(h.runtime.rejectHostTurnForMissingTags).not.toHaveBeenCalled();
    expect(h.retryCurrentTurn).not.toHaveBeenCalled();
  });

  it('pauses without retrying when a successful deletion is not reflected in the live chat', async () => {
    const h = createHarness({ tags: '<required>' });
    h.hostInput.removeLastMessage.mockResolvedValueOnce(true);
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '正文', message_id: 9 }]);

    await h.bridge.onGenerationEnded(9, 7);

    expect(h.hostInput.removeLastMessage).toHaveBeenCalledOnce();
    expect(h.runtime.pauseForHostResultFailure).toHaveBeenCalledWith(identity);
    expect(h.runtime.rejectHostTurnForMissingTags).not.toHaveBeenCalled();
    expect(h.retryCurrentTurn).not.toHaveBeenCalled();
  });

  it('does not claim or advance a host generation after the active chat changes', async () => {
    const h = createHarness();
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>正文', message_id: 9 }]);
    h.setChatIdentity('chat-b');

    expect(h.bridge.claimsGenerationEnded(7)).toBe(false);
    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.confirmCurrentTurn).not.toHaveBeenCalled();
    expect(h.runtime.pauseForHostResultFailure).not.toHaveBeenCalled();
    expect(h.runtime.rejectHostTurnForMissingTags).not.toHaveBeenCalled();
  });

  it('auto-retries the current turn when an errored generation ends without a message id or new floor', async () => {
    const h = createHarness();
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(h.hostInput.send.mock.calls.length === 1 ? 7 : 8); return true; });
    await h.bridge.send(prepared);

    // 生成出错：GENERATION_ENDED 携带 undefined message_id，聊天里没有任何新楼层。
    await h.bridge.onGenerationEnded(undefined, 7);

    expect(h.runtime.rejectHostTurnForFailedGeneration).toHaveBeenCalledWith(identity);
    expect(h.runtime.pauseForHostResultFailure).not.toHaveBeenCalled();
    expect(h.retryCurrentTurn).toHaveBeenCalledOnce();
    expect(h.hostInput.send).toHaveBeenCalledTimes(2);
    expect(h.hostInput.send).toHaveBeenLastCalledWith('重试后的最终普通文本');
    expect(h.runtime.confirmCurrentTurn).not.toHaveBeenCalled();
  });

  it('auto-retries when the anchored reply never materializes in the live chat', async () => {
    const h = createHarness();
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);

    // 事件带整数锚点但楼层始终未物化（生成失败没有写入正文）：物化等待耗尽后走自动重试。
    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.rejectHostTurnForFailedGeneration).toHaveBeenCalledWith(identity);
    expect(h.runtime.pauseForHostResultFailure).not.toHaveBeenCalled();
    expect(h.retryCurrentTurn).toHaveBeenCalledOnce();
  });

  it('fails closed when the host event has ambiguous AI candidates', async () => {
    const h = createHarness();
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>a' }, { is_user: false, mes: '<ok>b' }]);
    await h.bridge.onGenerationEnded(99, 7);
    expect(h.runtime.pauseForHostResultFailure).toHaveBeenCalledWith(identity);
    expect(h.runtime.confirmCurrentTurn).not.toHaveBeenCalled();
  });

  it('auto-continues the next turn after a confirmed reply, honoring the loop delay', async () => {
    const h = createHarness({ autoContinueStates: [{ eligible: true, delaySeconds: 5 }, { eligible: true, delaySeconds: 5 }] });
    h.hostInput.send.mockImplementationOnce(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>正文', message_id: 9 }]);
    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.confirmCurrentTurn).toHaveBeenCalledWith(identity);
    expect(h.wait).toHaveBeenCalledWith(5_000);
    expect(h.continueTask).toHaveBeenCalledOnce();
    expect(h.hostInput.send).toHaveBeenLastCalledWith('自动续写的下一轮文本');
  });

  it('abandons the auto-continue when eligibility is lost during the delay', async () => {
    const h = createHarness({ autoContinueStates: [{ eligible: true, delaySeconds: 5 }, { eligible: false, delaySeconds: 0 }] });
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>正文', message_id: 9 }]);
    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.confirmCurrentTurn).toHaveBeenCalledWith(identity);
    expect(h.continueTask).not.toHaveBeenCalled();
    expect(h.hostInput.send).toHaveBeenCalledOnce();
  });

  it('claims and confirms the ended generation in loose mode when no synchronous start pairing exists', async () => {
    const h = createHarness();
    // 宿主 GENERATION_STARTED 在发送返回后的微任务里才送达：不模拟同步配对。
    await expect(h.bridge.send(prepared)).resolves.toBe(true);
    expect(h.bridge.hasLiveClaim('chat-a')).toBe(false);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>正文', message_id: 9 }]);

    expect(h.bridge.claimsGenerationEnded(7, false)).toBe(false);
    expect(h.bridge.claimsGenerationEnded(7, true)).toBe(true);
    await h.bridge.onGenerationEnded(9, 7, true);

    expect(h.runtime.confirmCurrentTurn).toHaveBeenCalledWith(identity);
    expect(h.runtime.pauseForHostResultFailure).not.toHaveBeenCalled();
  });

  it('binds a loosely claimed generation start so the strict ended path matches later', async () => {
    const h = createHarness();
    await h.bridge.send(prepared);

    expect(h.bridge.onGenerationStarted(7, true)).toBe(true);
    expect(h.runtime.bindHostTurnGeneration).toHaveBeenCalledWith(identity, 7);
    expect(h.bridge.hasLiveClaim('chat-a')).toBe(true);
    expect(h.bridge.claimsGenerationEnded(7)).toBe(true);
  });

  it('rejects a loose claim whose sequence conflicts with the bound generation', async () => {
    const h = createHarness();
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);

    expect(h.bridge.claimsGenerationEnded(8, true)).toBe(false);
    await h.bridge.onGenerationEnded(9, 8, true);
    expect(h.runtime.confirmCurrentTurn).not.toHaveBeenCalled();
  });

  it('converts an awaiting turn to retry-ready when its host generation is stopped', async () => {
    const h = createHarness();
    await h.bridge.send(prepared);

    await h.bridge.onGenerationStopped(undefined);

    expect(h.runtime.failHostTurnForStoppedGeneration).toHaveBeenCalledWith(identity);
    expect(h.runtime.readPendingHostTurn()!.pending.status).toBe('retry_ready');
  });

  it('ignores a stopped generation whose sequence belongs to another generation', async () => {
    const h = createHarness();
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);

    await h.bridge.onGenerationStopped(8);

    expect(h.runtime.failHostTurnForStoppedGeneration).not.toHaveBeenCalled();
  });

  it('clears the stale started claim when the stopped event arrives for a turn that is no longer awaiting', async () => {
    const h = createHarness();
    await h.bridge.send(prepared);
    // 宽松认领建立：桥内存里有了该聊天的条目。
    expect(h.bridge.onGenerationStarted(7, true)).toBe(true);
    expect(h.bridge.hasLiveClaim('chat-a')).toBe(true);

    // 等待轮被其他路径推进（这里模拟归属失败落 exhausted）：中止事件不再会带出 ENDED。
    await h.runtime.pauseForHostResultFailure(identity);
    await h.bridge.onGenerationStopped(7);

    // 条目必须被清掉，否则该聊天永久拒宽松认领（V3-d 泄漏）。
    expect(h.bridge.hasLiveClaim('chat-a')).toBe(false);
  });

  it('clears the started claim when the stopped sequence matches it even though the bound turn differs', async () => {
    const h = createHarness();
    await h.bridge.send(prepared);
    expect(h.bridge.onGenerationStarted(7, true)).toBe(true);

    // 等待轮改绑到别的生成（序列号 8），桥里仍留着序列号 7 的认领。
    await h.runtime.recordHostTurn({ identity, capture: { capturedAt: 200, capturedChatLength: 1, capturedAiFloorCount: 0, generationSeq: 8 } });

    // 中止事件说的是 7 那次生成：它已经死了，条目必须清掉。
    await h.bridge.onGenerationStopped(7);
    expect(h.bridge.hasLiveClaim('chat-a')).toBe(false);

    // 反过来：中止事件属于第三方生成（9）时不能误删仍在飞的认领。
    await h.runtime.recordHostTurn({ identity, capture: { capturedAt: 300, capturedChatLength: 1, capturedAiFloorCount: 0, generationSeq: null } });
    expect(h.bridge.onGenerationStarted(9, true)).toBe(true);
    await h.bridge.onGenerationStopped(11);
    expect(h.bridge.hasLiveClaim('chat-a')).toBe(true);
  });

  it('invalidateStartedByChat lets the same chat identity make a fresh loose claim', async () => {
    const h = createHarness();
    await h.bridge.send(prepared);
    expect(h.bridge.onGenerationStarted(7, true)).toBe(true);
    expect(h.bridge.claimsGenerationEnded(8, true)).toBe(false);

    // orchestrator 的停止/放弃/清空出口调用它；随后同一聊天重建等待轮应能重新宽松认领。
    expect(h.bridge.invalidateStartedByChat('chat-a')).toBe(true);
    expect(h.bridge.invalidateStartedByChat('chat-a')).toBe(false);
    await h.runtime.recordHostTurn({ identity, capture: { capturedAt: 200, capturedChatLength: 1, capturedAiFloorCount: 0, generationSeq: null } });

    expect(h.bridge.onGenerationStarted(9, true)).toBe(true);
    expect(h.bridge.claimsGenerationEnded(9, true)).toBe(true);
  });

  it('swallows an auto-continue failure without overwriting the recorded task state', async () => {
    const h = createHarness({ autoContinueStates: [{ eligible: true, delaySeconds: 0 }, { eligible: true, delaySeconds: 0 }] });
    h.continueTask.mockRejectedValueOnce(new Error('已被用户停止'));
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>正文', message_id: 9 }]);

    await expect(h.bridge.onGenerationEnded(9, 7)).resolves.toBeUndefined();

    expect(h.continueTask).toHaveBeenCalledOnce();
    expect(h.runtime.pauseForHostResultFailure).not.toHaveBeenCalled();
    expect(h.hostInput.send).toHaveBeenCalledOnce();
  });

  // [V3-g 双写互斥] 删楼重发与自动填表防抖（500ms）之间必须有互斥：坏标签楼将被删除，
  // 指向它的 pending 填表若照常到期，重发的第二次 ENDED 会再填一次 → 同一轮双写。
  it('invalidates the pending auto-fill debounce when the tag-missing reply is deleted for retry', async () => {
    const invalidatePendingAutoFill = vi.fn();
    const h = createHarness({ tags: '<required>', invalidatePendingAutoFill });
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(h.hostInput.send.mock.calls.length === 1 ? 7 : 8); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '正文', message_id: 9 }]);

    await h.bridge.onGenerationEnded(9, 7);

    expect(h.hostInput.removeLastMessage).toHaveBeenCalledOnce();
    expect(invalidatePendingAutoFill).toHaveBeenCalledOnce();
    expect(h.runtime.rejectHostTurnForMissingTags).toHaveBeenCalledWith({ identity, messageIndex: 1 });
    expect(h.retryCurrentTurn).toHaveBeenCalledOnce();
  });

  it('does not invalidate the pending auto-fill when the tag-missing reply cannot be deleted', async () => {
    const invalidatePendingAutoFill = vi.fn();
    const h = createHarness({ tags: '<required>', invalidatePendingAutoFill });
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    // 坏标签楼不再是末楼：走 fail-closed 暂停，没有删楼，也就不该吞掉与本轮无关的填表。
    h.setChat([{ is_user: true }, { is_user: false, mes: '正文', message_id: 9 }, { is_user: true, mes: '较新的用户输入' }]);

    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.pauseForHostResultFailure).toHaveBeenCalledWith(identity);
    expect(invalidatePendingAutoFill).not.toHaveBeenCalled();
  });

  it('does not invalidate the pending auto-fill after a confirmed turn', async () => {
    const invalidatePendingAutoFill = vi.fn();
    const h = createHarness({ invalidatePendingAutoFill });
    h.hostInput.send.mockImplementation(() => { h.bridge.onGenerationStarted(7); return true; });
    await h.bridge.send(prepared);
    h.setChat([{ is_user: true }, { is_user: false, mes: '<ok>正文', message_id: 9 }]);

    await h.bridge.onGenerationEnded(9, 7);

    expect(h.runtime.confirmCurrentTurn).toHaveBeenCalledWith(identity);
    expect(invalidatePendingAutoFill).not.toHaveBeenCalled();
  });
});
