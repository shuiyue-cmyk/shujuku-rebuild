/**
 * tests/presentation/triggers/settings-ui-connect-mvu-gate.test.ts
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
  settings: { mvuGateEnabled: true, contentOptimizationSettings: {} } as any,
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
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  autoFillDebounceTimer_ACU: null,
  _set_autoFillDebounceTimer_ACU: vi.fn(),
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  _set_wasStoppedByUser_ACU: vi.fn(),
  manualExtraHint_ACU: '',
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
  get currentChatFileIdentifier_ACU() { return m.chatKey; },
  getCurrentIsolationKey_ACU: () => '',
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
import { handleNewMessageDebounced_ACU } from '../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect';

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
  m.settings.mvuGateEnabled = true;
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
  resetMvuAnalysisGateForTest_ACU();
  delete (window as any).Mvu;
});

afterEach(() => {
  resetMvuAnalysisGateForTest_ACU();
  delete (window as any).Mvu;
  vi.useRealTimers();
});

describe('MVU 不在场：闸门零行为差', () => {
  it('防抖到期即跑两条链，且不留任何定时器（与闸门上线前逐字一致）', async () => {
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.executeContentOptimization).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
    expect(m.logDebug).not.toHaveBeenCalledWith(expect.stringContaining('[MVU联动] 闸门放行'));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('解析在飞：填表与正文替换一起延后，只延后一次', () => {
  it('flag true → 防抖到期不跑；ended 后两条链各跑一次', async () => {
    const mvu = installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500 + MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    // 已越过防抖 + 观察窗仍在挂起：连聊天加载都没开始
    expect(m.loadAllChatMessages).not.toHaveBeenCalled();
    expect(m.executeContentOptimization).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();

    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(m.executeContentOptimization).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
    expect(m.logDebug).toHaveBeenCalledWith(expect.stringContaining('reason=analysis_ended'));
  });

  it('观察窗内才 started（宿主 ENDED→MVU 滞后 ≈3s）→ 同样挂起，窗满不放行', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500 + 3000);
    mvu.during = true;
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    expect(m.executeContentOptimization).not.toHaveBeenCalled();

    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(m.executeContentOptimization).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('等待期间切聊天 → 放行后由既有 chatKey 复检丢弃，不给新会话填表', async () => {
    const mvu = installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(1000);
    m.chatKey = 'chat-b';           // 挂起期间用户切了聊天
    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(m.logAutoFillSkip).toHaveBeenCalledWith('chat_changed', expect.objectContaining({ chatKey: 'chat-a' }));
    expect(m.evaluateNewMessageAction).not.toHaveBeenCalled();
    expect(m.executeContentOptimization).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
  });

  it('挂起期间第二条 ENDED 起新一轮链路 → 并入后合并方被丢弃，两条链共只执行一次（防同楼双烧 AI）', async () => {
    const mvu = installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    // 第一轮：防抖到期后进闸门挂起
    const first = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    expect(m.loadAllChatMessages).not.toHaveBeenCalled();

    // 第二轮（日志实证场景：MVU 内部重试 29s 后再发一条 ENDED，防抖早已过期=全新链路）→ 并入同一等待
    const second = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    expect(m.loadAllChatMessages).not.toHaveBeenCalled();

    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(0);

    // 只有创建者继续：聊天加载/两链各恰好一次；合并方带丢弃日志不出第二次
    expect(m.loadAllChatMessages).toHaveBeenCalledTimes(1);
    expect(m.executeContentOptimization).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
    expect(m.logDebug).toHaveBeenCalledWith(expect.stringContaining('本轮丢弃（防同楼双跑）'));
  });
});

describe('开关关闭：现状逐字不变', () => {
  it('mvuGateEnabled=false → 解析在飞也照常立即执行，不进观察窗', async () => {
    installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    m.settings.mvuGateEnabled = false;

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.executeContentOptimization).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
    // attach 期的注册日志与开关无关；这里断言的是「运行期没有任何等待/放行痕迹」。
    expect(m.logDebug).not.toHaveBeenCalledWith(expect.stringContaining('[MVU联动] 闸门放行'));
    expect(m.logDebug).not.toHaveBeenCalledWith(expect.stringContaining('检测到额外模型解析在飞'));
    expect(vi.getTimerCount()).toBe(0);
  });
});

// 闸门只能挂在两链分叉之前的唯一入口上：下沉到任一条链都会「一条链等、另一条链抢跑」，
// 或者同一轮里等两次。这里用源码形状断言把消费点钉死（与 exec-auto-dedup 的源码守卫同一手法）。
describe('闸门消费点形状（源码守卫）', () => {
  it('settings-ui-connect 里闸门调用恰好一处，且早于楼层解析与两链分叉', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      'src/presentation/triggers/settings-ui-sync/settings-ui-connect.ts',
      'utf8',
    );
    expect(source.match(/await waitForMvuAnalysisToSettle_ACU\(\)/g)).toHaveLength(1);

    const gateAt = source.indexOf('await waitForMvuAnalysisToSettle_ACU()');
    expect(gateAt).toBeGreaterThan(-1);
    // 两条链的分叉调用、以及本轮楼层解析，全部排在闸门之后
    expect(source.indexOf('executeContentOptimization_ACU(result.lastMessageIndex!)')).toBeGreaterThan(gateAt);
    expect(source.indexOf('triggerAutomaticUpdateIfNeeded_ACU(performanceContext)')).toBeGreaterThan(gateAt);
    expect(source.indexOf('resolveGeneratedAiMessageIndex_ACU({ liveChat, intent })')).toBeGreaterThan(gateAt);
    // 聊天身份复检也在闸门之后：等待期间切聊天由既有复检丢弃（见上方集成用例）
    expect(source.indexOf('currentChatFileIdentifier_ACU !== scheduledChatKey_ACU')).toBeGreaterThan(gateAt);
  });
});
