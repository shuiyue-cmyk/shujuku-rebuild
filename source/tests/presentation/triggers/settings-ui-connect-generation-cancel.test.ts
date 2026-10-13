/**
 * tests/presentation/triggers/settings-ui-connect-generation-cancel.test.ts
 * 重新生成 / 删楼 / 切换版本时作废排队中的自动任务（移植上游 2657754a + f874c888，按本库单入口管线改写）。
 *
 * 以下为沿用的闸门测试脚手架说明：
 * [W4 延后闸门] 消费点集成回归：handleNewMessageDebounced_ACU 在防抖到期后、
 * 楼层解析与两链分叉之前过闸，因此「自动填表 + 正文替换」被同一次等待一起延后，只延后一次。
 *
 * 覆盖：
 *   · MVU 不在场 → 防抖到期即跑（与闸门上线前逐字一致，无额外定时器）；
 *   · 解析在飞 → 防抖到期不跑，ended 后放行且两条链各跑一次；
 *   · 等待期间切聊天 → 放行后由既有 chatKey 复检丢弃，不污染新会话；
 *   · 开关关闭 → 解析在飞也照常立即执行（现状行为）；
 *   · 观察窗内 started → 同样挂起（宿主 ENDED→MVU started 的 ≈3s 滞后场景）。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  settings: { contentOptimizationSettings: {} } as any,
  chatKey: 'chat-a',
  evaluateNewMessageAction: vi.fn(),
  resolveGeneratedAiMessageIndex: vi.fn(),
  logAutoFillSkip: vi.fn(),
  loadAllChatMessages: vi.fn(),
  executeContentOptimization: vi.fn(async () => true),
  triggerAutomaticUpdateIfNeeded: vi.fn(async () => undefined),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  chat: [] as any[],
  foregroundActive: false,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  autoFillDebounceTimer_ACU: null,
  _set_autoFillDebounceTimer_ACU: vi.fn(),
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  _set_wasStoppedByUser_ACU: vi.fn(),
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
  get currentChatFileIdentifier_ACU() { return m.chatKey; },
  getCurrentIsolationKey_ACU: () => '',
  getAutoFillStopEpoch_ACU: () => 0,
  hasActiveForegroundGeneration_ACU: () => m.foregroundActive,
  coreApisAreReady_ACU: true,
  settings_ACU: m.settings,
}));
vi.mock('../../../src/service/runtime/message-handler', () => ({
  evaluateNewMessageAction_ACU: m.evaluateNewMessageAction,
  resolveGeneratedAiMessageIndex_ACU: m.resolveGeneratedAiMessageIndex,
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: m.loadAllChatMessages }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger', () => ({
  triggerAutomaticUpdateIfNeeded_ACU: (...args: any[]) => m.triggerAutomaticUpdateIfNeeded(...args),
}));
vi.mock('../../../src/shared/trigger-diagnostics', () => ({ logAutoFillSkip_ACU: m.logAutoFillSkip }));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => m.chat }));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => m.chat }));
vi.mock('../../../src/presentation/components/optimization-ui', () => ({
  executeContentOptimization_ACU: (...args: any[]) => m.executeContentOptimization(...args),
}));
vi.mock('../../../src/shared/runtime-performance', () => ({
  startRuntimePerformanceSpan_ACU: () => ({ id: 'span', end: vi.fn() }),
}));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: (...args: any[]) => m.logDebug(...args),
  logWarn_ACU: (...args: any[]) => m.logWarn(...args),
  logError_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ maybeLiftWorldbookSuppression_ACU: vi.fn() }));

import {
  MVU_ANALYSIS_ENDED_EVENT_ACU,
  MVU_ANALYSIS_STARTED_EVENT_ACU,
  MVU_GATE_OBSERVE_WINDOW_MS_ACU,
  attachMvuAnalysisGate_ACU,
  resetMvuAnalysisGateForTest_ACU,
} from '../../../src/service/runtime/mvu-analysis-gate';
import { cancelPendingAutoTasks_ACU, handleNewMessageDebounced_ACU } from '../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect';

const baseIntent = {
  eventMessageId: 1,
  chatKey: 'chat-a',
  isolationKey: '',
  capturedAt: 0,
  capturedChatLength: 2,
  capturedAiFloorCount: 1,
};

function installFakeMvu(during = false): { during: boolean } {
  const state = { during };
  (window as any).Mvu = { isDuringExtraAnalysis: () => state.during };
  return state;
}

function createFakeEventSource() {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  return {
    on: vi.fn((name: string, cb: (...args: any[]) => void) => {
      const list = handlers.get(name) || [];
      list.push(cb);
      handlers.set(name, list);
    }),
    off: vi.fn(),
    emit: (name: string, ...args: any[]) => {
      (handlers.get(name) || []).slice().forEach((cb) => cb(...args));
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  m.chatKey = 'chat-a';
  m.chat = [
    { is_user: true, message_id: 0, mes: '玩家：推门而入' },
    { is_user: false, message_id: 1, mes: '夜色漫过屋檐。' },
  ];
  m.loadAllChatMessages.mockResolvedValue(undefined);
  m.resolveGeneratedAiMessageIndex.mockReturnValue({ kind: 'resolved', messageIndex: 1 });
  m.evaluateNewMessageAction.mockReturnValue({
    action: 'optimize_parallel',
    reason: 'Parallel mode enabled',
    lastMessageIndex: 1,
  });
  m.foregroundActive = false;
  resetMvuAnalysisGateForTest_ACU();
  delete (window as any).Mvu;
});

afterEach(() => {
  resetMvuAnalysisGateForTest_ACU();
  delete (window as any).Mvu;
  vi.useRealTimers();
});

describe('排队中的自动任务在重新生成 / 删楼 / 切换版本时作废', () => {
  it('防抖期间作废：填表与正文替换都不跑，并记 generation_changed', async () => {
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    cancelPendingAutoTasks_ACU('generation_started');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.executeContentOptimization).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
    expect(m.logAutoFillSkip).toHaveBeenCalledWith('generation_changed', expect.objectContaining({ eventType: 'GENERATION_ENDED' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('等 MVU 解析期间作废：解析结束后也不再跑', async () => {
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    installFakeMvu(true);

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    cancelPendingAutoTasks_ACU('message_deleted');
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU + 500);
    await promise;

    expect(m.executeContentOptimization).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
  });

  it('作废发生在排队之前：之后排队的任务照常执行', async () => {
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    cancelPendingAutoTasks_ACU('message_swiped');
    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.executeContentOptimization).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('正文还在生成时不启动，记 generation_in_progress', async () => {
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    m.foregroundActive = true;

    const promise = handleNewMessageDebounced_ACU('MVU_ANALYSIS_ENDED');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.executeContentOptimization).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
    expect(m.logAutoFillSkip).toHaveBeenCalledWith('generation_in_progress', expect.objectContaining({ eventType: 'MVU_ANALYSIS_ENDED' }));
  });

  it('等 MVU 期间作废后，新一轮并入同一次等待：由新一轮接手，两条链各只跑一次', async () => {
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    installFakeMvu(true);

    const oldRun = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    cancelPendingAutoTasks_ACU('generation_started');
    const newRun = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent, eventMessageId: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();

    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    (window as any).Mvu.isDuringExtraAnalysis = () => false;
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU + 3000);
    await Promise.all([oldRun, newRun]);

    expect(m.executeContentOptimization).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });
});
