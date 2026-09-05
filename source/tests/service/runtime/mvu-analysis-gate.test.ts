/**
 * tests/service/runtime/mvu-analysis-gate.test.ts
 * [W4] MVU「额外模型解析」延后闸门 + [W5] 解析完成联动重跑 行为契约
 *
 * 覆盖（与需求逐条对应）：
 *   ① MVU 不在场 → 同步放行、零定时器、零行为差；
 *   ② isDuringExtraAnalysis()===true → 挂起，ended 后放行且只放行一次（重复触发并入同一次等待）；
 *   ③ 观察窗内收到 started → 转入挂起等待；
 *   ④ 观察窗窗满仍无 started → 放行；
 *   ⑤ 挂起满 240s → 强制放行 + logWarn；
 *   ⑥ 并发深度交叉：started×2 → ended×1 不放行，ended×2 才放行；
 *   ⑦ [W5] 已登记楼收到 ended → 两个集合记录被清 + 重跑一轮；未登记楼 ended → 不重跑；
 *   ⑧ 开关关闭 → 全部现状行为（不等待、不清记录、不重跑）；
 *   ⑨ ended 丢失（事件被吞）→ 2s 轮询见 flag false 放行。
 *
 * W1/W3 判重集合走真实 optimization-cache-storage（jsdom 下 window + localStorage 双层），
 * 因此 ⑦ 同时是「按 messageId 删除 API」与自动链判重语义的联合回归。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: { mvuGateEnabled: true } as any,
  chatKey: 'chat-a',
  chat: [] as any[],
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: h.settings,
  get currentChatFileIdentifier_ACU() { return h.chatKey; },
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
}));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: (...args: any[]) => h.logDebug(...args),
  logWarn_ACU: (...args: any[]) => h.logWarn(...args),
  logError_ACU: (...args: any[]) => h.logError(...args),
}));

import {
  MVU_ANALYSIS_ENDED_EVENT_ACU,
  MVU_ANALYSIS_STARTED_EVENT_ACU,
  MVU_GATE_MAX_WAIT_MS_ACU,
  MVU_GATE_OBSERVE_WINDOW_MS_ACU,
  MVU_GATE_POLL_INTERVAL_MS_ACU,
  MVU_RERUN_DEBOUNCE_MS_ACU,
  attachMvuAnalysisGate_ACU,
  getMvuAnalysisGateState_ACU,
  resetMvuAnalysisGateForTest_ACU,
  waitForMvuAnalysisToSettle_ACU,
  type MvuGateResult_ACU,
} from '../../../src/service/runtime/mvu-analysis-gate';
import {
  clearChainProcessed_ACU,
  findAutoOptimizationProcessedEntry_ACU,
  findAutoTableFillProcessedEntry_ACU,
  recordAutoOptimizationProcessed_ACU,
  recordAutoTableFillProcessed_ACU,
} from '../../../src/data/storage/optimization-cache-storage';

/** 假 window.Mvu：只暴露本模块用到的 isDuringExtraAnalysis。 */
function installFakeMvu(during = false): { during: boolean } {
  const state = { during };
  (window as any).Mvu = { isDuringExtraAnalysis: () => state.during };
  return state;
}

/** 假宿主 eventSource：与 SillyTavern_API_ACU.eventSource 同形状（on/off/手工 emit）。 */
function createFakeEventSource() {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  return {
    on: vi.fn((name: string, cb: (...args: any[]) => void) => {
      const list = handlers.get(name) || [];
      list.push(cb);
      handlers.set(name, list);
    }),
    off: vi.fn((name: string, cb: (...args: any[]) => void) => {
      const list = handlers.get(name) || [];
      handlers.set(name, list.filter((item) => item !== cb));
    }),
    emit: (name: string, ...args: any[]) => {
      (handlers.get(name) || []).slice().forEach((cb) => cb(...args));
    },
    handlerCount: (name: string) => (handlers.get(name) || []).length,
  };
}

/** 记录 promise 落定值而不 await 它（配合 fake timers 检查「是否还挂着」）。 */
function track(promise: Promise<MvuGateResult_ACU>) {
  const box: { value: MvuGateResult_ACU | null } = { value: null };
  let resolveCount = 0;
  void promise.then((value) => { box.value = value; resolveCount += 1; });
  return {
    box,
    get resolved() { return resolveCount; },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.settings.mvuGateEnabled = true;
  h.chatKey = 'chat-a';
  h.chat = [
    { is_user: true, message_id: 10, mes: '玩家：推门而入' },
    { is_user: false, message_id: 11, mes: '夜色漫过屋檐，她收起最后一封信。' },
  ];
  clearChainProcessed_ACU('content_replacement');
  clearChainProcessed_ACU('auto_table_fill');
  resetMvuAnalysisGateForTest_ACU();
  delete (window as any).Mvu;
});

afterEach(() => {
  resetMvuAnalysisGateForTest_ACU();
  delete (window as any).Mvu;
  vi.useRealTimers();
});

describe('① MVU 不在场：闸门零开销放行，与上线前逐字一致', () => {
  it('无 window.Mvu → 同步放行（reason=mvu_absent），不建任何定时器', async () => {
    const waiter = track(waitForMvuAnalysisToSettle_ACU());

    // 只让微任务跑完，不推进任何定时器
    await vi.advanceTimersByTimeAsync(0);

    expect(waiter.box.value).not.toBeNull();
    expect(waiter.box.value!.reason).toBe('mvu_absent');
    expect(waiter.box.value!.delayed).toBe(false);
    expect(waiter.box.value!.suspended).toBe(false);
    expect(waiter.box.value!.elapsedMs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('window.Mvu 存在但没有 isDuringExtraAnalysis → 同样按不在场放行（形状判定）', async () => {
    (window as any).Mvu = {};
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(0);
    expect(waiter.box.value!.reason).toBe('mvu_absent');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isDuringExtraAnalysis 抛错（第三方状态读不动）→ 按「不在解析」fail-open，走完观察窗照常放行', async () => {
    (window as any).Mvu = {
      isDuringExtraAnalysis: () => { throw new Error('mvu boom'); },
    };
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    expect(waiter.box.value!.reason).toBe('observation_window_elapsed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('读 window.Mvu 本身抛错（跨窗访问被拒）→ 按不在场放行，不抛给调用方', async () => {
    Object.defineProperty(window, 'Mvu', {
      get() { throw new Error('cross-origin'); },
      configurable: true,
    });
    try {
      const waiter = track(waitForMvuAnalysisToSettle_ACU());
      await vi.advanceTimersByTimeAsync(0);
      expect(waiter.box.value!.reason).toBe('mvu_absent');
    } finally {
      Object.defineProperty(window, 'Mvu', { value: undefined, configurable: true, writable: true });
    }
  });

  it('TT 场景：Mvu 只挂在 window.parent 上时同样识别为在场（parent 兜底）', async () => {
    const mvu = { isDuringExtraAnalysis: () => true };
    delete (window as any).Mvu;
    Object.defineProperty(window, 'parent', { value: { Mvu: mvu }, configurable: true, writable: true });
    try {
      const waiter = track(waitForMvuAnalysisToSettle_ACU());
      await vi.advanceTimersByTimeAsync(0);
      expect(waiter.box.value).toBeNull(); // 挂起了，说明 parent 上的实例被认出来了
      expect(getMvuAnalysisGateState_ACU().phase).toBe('suspend');
    } finally {
      Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
    }
  });
});

describe('② 解析在飞：挂起等待，ended 后放行且只放行一次', () => {
  it('flag true 入场 → 挂起；ended 到达 → 放行一次', async () => {
    const mvu = installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU + 1000);
    expect(waiter.box.value).toBeNull();
    expect(waiter.resolved).toBe(0);

    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);

    expect(waiter.box.value!.reason).toBe('analysis_ended');
    expect(waiter.box.value!.suspended).toBe(true);
    expect(waiter.box.value!.delayed).toBe(true);
    expect(waiter.resolved).toBe(1);
    expect(getMvuAnalysisGateState_ACU().depth).toBe(0);
  });

  it('同一防抖轮的重复触发并入同一次等待：ended 后创建者继续、合并方带 mergedIntoExisting 标记（消费点据此丢弃防双跑）', async () => {
    const mvu = installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const first = track(waitForMvuAnalysisToSettle_ACU());
    const second = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.box.value).toBeNull();
    expect(second.box.value).toBeNull();
    // 只有一处在飞（复用同一个等待），因此只登记了一次挂起日志
    expect(getMvuAnalysisGateState_ACU().waiting).toBe(true);

    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);

    expect(first.resolved).toBe(1);
    expect(second.resolved).toBe(1);
    expect(first.box.value!.reason).toBe('analysis_ended');
    expect(second.box.value!.reason).toBe('analysis_ended');
    // 创建者继续跑；合并方必须被标记丢弃（正文替换非幂等，两边都跑=同楼双烧 AI）
    expect(first.box.value!.mergedIntoExisting).toBe(false);
    expect(second.box.value!.mergedIntoExisting).toBe(true);
  });

  it('放行后再来一次触发 → 重新开观察窗（旧等待不复用、不残留深度）', async () => {
    const mvu = installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const first = track(waitForMvuAnalysisToSettle_ACU());
    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.box.value!.reason).toBe('analysis_ended');

    const second = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    expect(second.box.value!.reason).toBe('observation_window_elapsed');
  });
});

describe('③④ 观察窗：窗内 started 挂起，窗满无 started 放行', () => {
  it('入场时 flag 已 false，但宿主 ENDED→MVU started 滞后（≈3s）→ 窗内 started 仍被等到', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(3000);
    expect(waiter.box.value).toBeNull(); // 窗未满，继续等

    mvu.during = true;
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    // 已转入挂起态：观察窗到期不再放行
    expect(waiter.box.value).toBeNull();
    expect(getMvuAnalysisGateState_ACU().phase).toBe('suspend');

    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    expect(waiter.box.value!.reason).toBe('analysis_ended');
  });

  it('MVU 早退路径（连 started 都不发）→ 窗满无 started 照常放行', async () => {
    installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU - 1);
    expect(waiter.box.value).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(waiter.box.value!.reason).toBe('observation_window_elapsed');
    expect(waiter.box.value!.suspended).toBe(false);
    expect(waiter.box.value!.delayed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('started 事件丢失但 flag 翻 true → 轮询兜住，转入挂起而不是误放行', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    mvu.during = true;              // 没有 started 事件，只翻旗标
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    expect(waiter.box.value).toBeNull();
    expect(getMvuAnalysisGateState_ACU().phase).toBe('suspend');

    mvu.during = false;
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU);
    expect(waiter.box.value!.reason).toBe('poll_fallback');
  });
});

describe('⑤ 兜底超时：240s 强制放行 + logWarn', () => {
  it('解析一直不结束 → 到点放行并告警，自动链不会被永久挂死', async () => {
    installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_MAX_WAIT_MS_ACU - 1000);
    expect(waiter.box.value).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(waiter.box.value!.reason).toBe('timeout');
    expect(waiter.box.value!.suspended).toBe(true);
    expect(h.logWarn).toHaveBeenCalledWith(expect.stringContaining('[MVU联动] 等待解析超时，照常执行'));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('⑥ 并发深度交叉：started×2 → ended×1 不放行，ended×2 才放行', () => {
  it('两轮解析交叉/连发时按深度收口', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    mvu.during = true;
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    expect(getMvuAnalysisGateState_ACU().depth).toBe(2);

    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    expect(getMvuAnalysisGateState_ACU().depth).toBe(1);
    expect(waiter.box.value).toBeNull(); // 还有一轮在飞，不放行

    mvu.during = true;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    // 本轮 ended 早于 flag 复位（flag 在 finally 才 false）→ 250ms 复检收口
    expect(waiter.box.value).toBeNull();
    mvu.during = false;
    await vi.advanceTimersByTimeAsync(250);

    expect(waiter.box.value!.reason).toBe('analysis_ended');
    expect(getMvuAnalysisGateState_ACU().depth).toBe(0);
  });

  it('ended 比 started 多（异常/重复派发）不会把深度压成负数', async () => {
    installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    expect(getMvuAnalysisGateState_ACU().depth).toBe(0);
  });
});

describe('⑨ ended 丢失：2s 轮询第二把钥匙放行', () => {
  it('ended 没送达（宿主 eventSource 吞监听器异常）→ flag 翻 false 后轮询放行', async () => {
    const mvu = installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es, requestRerun: vi.fn() });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_POLL_INTERVAL_MS_ACU - 1);
    expect(waiter.box.value).toBeNull();

    mvu.during = false;   // 解析真的结束了，但 ended 事件没送达
    await vi.advanceTimersByTimeAsync(MVU_GATE_POLL_INTERVAL_MS_ACU);
    expect(waiter.box.value!.reason).toBe('poll_fallback');
    expect(waiter.box.value!.suspended).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('started 计数残留（多轮交叉里丢了 ended）→ 轮询按 flag 收口并把深度归位', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    mvu.during = true;
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);   // 两轮 started，只有一轮 ended 会来
    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    expect(waiter.box.value).toBeNull();       // 深度仍为 1，ended 钥匙不放行
    expect(getMvuAnalysisGateState_ACU().depth).toBe(1);

    await vi.advanceTimersByTimeAsync(MVU_GATE_POLL_INTERVAL_MS_ACU);
    expect(waiter.box.value!.reason).toBe('poll_fallback');
    // 幽灵深度已清零，不会把下一次判定永远挂起
    expect(getMvuAnalysisGateState_ACU().depth).toBe(0);
  });
});

describe('⑦ [W5] 解析完成 / 手动重试联动重跑', () => {
  function registerFloor(messageId: number, index = 1) {
    recordAutoOptimizationProcessed_ACU({
      messageId,
      messageIndex: index,
      contentHash: 'hash-before-analysis',
      chatKey: 'chat-a',
    });
    recordAutoTableFillProcessed_ACU({ messageId, messageIndex: index, chatKey: 'chat-a' });
  }

  it('已登记楼收到 ended → 两个集合记录都被清 + 重跑恰好一轮', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    const rerun = vi.fn();
    attachMvuAnalysisGate_ACU({ eventSource: es, requestRerun: rerun });
    registerFloor(11);
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chat-a')).not.toBeNull();
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chat-a')).not.toBeNull();

    mvu.during = true;
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);

    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU - 1);
    expect(rerun).not.toHaveBeenCalled(); // 3s 防抖窗口内还没重跑
    await vi.advanceTimersByTimeAsync(1);

    expect(rerun).toHaveBeenCalledTimes(1);
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chat-a')).toBeNull();
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chat-a')).toBeNull();
  });

  it('未登记楼收到 ended → 不重跑（自动轮尚未登记时的防双跑判据）', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    const rerun = vi.fn();
    attachMvuAnalysisGate_ACU({ eventSource: es, requestRerun: rerun });

    mvu.during = true;
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU + 1000);

    expect(rerun).not.toHaveBeenCalled();
  });

  it('同楼重复 ended → 3s 防抖合并成一次重跑', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    const rerun = vi.fn();
    attachMvuAnalysisGate_ACU({ eventSource: es, requestRerun: rerun });
    registerFloor(11);

    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(1000);
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);   // 同楼第二次 ended（重试连点）
    await vi.advanceTimersByTimeAsync(1000);
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);   // 第三次
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU + 1000);

    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('只有填表登记（正文替换未登记）也触发重跑，并清掉命中的那条', async () => {
    const es = createFakeEventSource();
    const rerun = vi.fn();
    installFakeMvu(false);
    attachMvuAnalysisGate_ACU({ eventSource: es, requestRerun: rerun });
    recordAutoTableFillProcessed_ACU({ messageId: 11, messageIndex: 1, chatKey: 'chat-a' });

    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU + 1);

    expect(rerun).toHaveBeenCalledTimes(1);
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chat-a')).toBeNull();
  });

  it('跨聊天 message_id 重号：登记属于别的聊天 → 本楼不受影响，不重跑', async () => {
    const es = createFakeEventSource();
    const rerun = vi.fn();
    installFakeMvu(false);
    attachMvuAnalysisGate_ACU({ eventSource: es, requestRerun: rerun });
    recordAutoTableFillProcessed_ACU({ messageId: 11, messageIndex: 1, chatKey: 'chat-other' });

    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU + 1);

    expect(rerun).not.toHaveBeenCalled();
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chat-a')).toBeNull();
  });

  it('未装配重跑入口（只有闸门没有 requestRerun）→ 判重记录原样保留', async () => {
    const es = createFakeEventSource();
    installFakeMvu(false);
    attachMvuAnalysisGate_ACU({ eventSource: es });
    registerFloor(11);

    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU + 1);

    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chat-a')).not.toBeNull();
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chat-a')).not.toBeNull();
  });
});

describe('⑧ 开关关闭：全部现状行为', () => {
  it('mvuGateEnabled=false → 解析在飞也立即放行，不建定时器', async () => {
    installFakeMvu(true);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    h.settings.mvuGateEnabled = false;

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(0);

    expect(waiter.box.value!.reason).toBe('gate_disabled');
    expect(waiter.box.value!.delayed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('mvuGateEnabled=false → ended 不清判重记录、不重跑', async () => {
    const es = createFakeEventSource();
    const rerun = vi.fn();
    installFakeMvu(false);
    attachMvuAnalysisGate_ACU({ eventSource: es, requestRerun: rerun });
    recordAutoTableFillProcessed_ACU({ messageId: 11, messageIndex: 1, chatKey: 'chat-a' });
    recordAutoOptimizationProcessed_ACU({ messageId: 11, messageIndex: 1, contentHash: 'x', chatKey: 'chat-a' });
    h.settings.mvuGateEnabled = false;

    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU + 1);

    expect(rerun).not.toHaveBeenCalled();
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chat-a')).not.toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chat-a')).not.toBeNull();
  });

  it('开关未落盘（undefined）按默认开处理', async () => {
    installFakeMvu(true);
    delete h.settings.mvuGateEnabled;
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(0);
    expect(waiter.box.value).toBeNull();
    expect(getMvuAnalysisGateState_ACU().waiting).toBe(true);
  });
});

describe('事件接线与卸载', () => {
  it('attach 注册 started/ended 两个监听；重复 attach 不叠加', () => {
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    expect(es.on).toHaveBeenCalledWith(MVU_ANALYSIS_STARTED_EVENT_ACU, expect.any(Function));
    expect(es.on).toHaveBeenCalledWith(MVU_ANALYSIS_ENDED_EVENT_ACU, expect.any(Function));
    expect(es.handlerCount(MVU_ANALYSIS_ENDED_EVENT_ACU)).toBe(1);

    const es2 = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es2 });
    expect(es.handlerCount(MVU_ANALYSIS_ENDED_EVENT_ACU)).toBe(0); // 旧监听已注销
    expect(es2.handlerCount(MVU_ANALYSIS_ENDED_EVENT_ACU)).toBe(1);
  });

  it('eventSource 缺失 → 不抛错，闸门仍按 flag + 观察窗判定', async () => {
    const mvu = installFakeMvu(false);
    expect(() => attachMvuAnalysisGate_ACU({ eventSource: null, requestRerun: vi.fn() })).not.toThrow();
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    expect(waiter.box.value!.reason).toBe('observation_window_elapsed');
    // 没有事件通道时，入场 flag true 仍走判定序①挂起（不依赖 started 事件）
    mvu.during = true;
    const second = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    expect(second.box.value).toBeNull();
    expect(getMvuAnalysisGateState_ACU().phase).toBe('suspend');
  });
});

describe('⑩ 自适应降窗：连续未见 started 的聊天免交每轮 5s 观察税', () => {
  /** 跑满一轮「窗满放行」（=一次 miss）。 */
  async function runWindowElapsedRound() {
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    expect(waiter.box.value!.reason).toBe('observation_window_elapsed');
  }

  it('连续 3 轮窗满未见 started → 第 4 轮同步放行（observation_bypassed，零定时器）', async () => {
    installFakeMvu(false);
    attachMvuAnalysisGate_ACU({ eventSource: createFakeEventSource() });

    await runWindowElapsedRound();
    await runWindowElapsedRound();
    expect(getMvuAnalysisGateState_ACU().observeBypassed).toBe(false); // 2 轮还不够
    await runWindowElapsedRound();
    expect(getMvuAnalysisGateState_ACU().observeBypassed).toBe(true);

    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(0); // 不推进任何定时器即放行
    expect(waiter.box.value!.reason).toBe('observation_bypassed');
    expect(waiter.box.value!.delayed).toBe(false);
    expect(waiter.box.value!.suspended).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('降窗后再见 started → 统计清零恢复开窗（模式切回自动重新生效）', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    await runWindowElapsedRound();
    await runWindowElapsedRound();
    await runWindowElapsedRound();
    expect(getMvuAnalysisGateState_ACU().observeBypassed).toBe(true);

    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    mvu.during = true;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    mvu.during = false;
    expect(getMvuAnalysisGateState_ACU().observeBypassed).toBe(false);
    expect(getMvuAnalysisGateState_ACU().observeMissCount).toBe(0);

    // 下一轮重新开观察窗（不再同步放行）
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU - 1);
    expect(waiter.box.value).toBeNull();
  });

  it('降窗期间 flag true 仍挂起（判定序①优先于降窗，真在飞不漏等）', async () => {
    const mvu = installFakeMvu(false);
    attachMvuAnalysisGate_ACU({ eventSource: createFakeEventSource() });
    await runWindowElapsedRound();
    await runWindowElapsedRound();
    await runWindowElapsedRound();

    mvu.during = true;
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(0);
    expect(waiter.box.value).toBeNull();
    expect(getMvuAnalysisGateState_ACU().phase).toBe('suspend');

    mvu.during = false;
    await vi.advanceTimersByTimeAsync(MVU_RERUN_DEBOUNCE_MS_ACU);
    expect(waiter.box.value!.reason).toBe('poll_fallback');
  });

  it('切聊天重置降窗（新聊天先付观察期）', async () => {
    installFakeMvu(false);
    attachMvuAnalysisGate_ACU({ eventSource: createFakeEventSource() });
    await runWindowElapsedRound();
    await runWindowElapsedRound();
    await runWindowElapsedRound();
    expect(getMvuAnalysisGateState_ACU().observeBypassed).toBe(true);

    h.chatKey = 'chat-b';
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU - 1);
    expect(waiter.box.value).toBeNull(); // 新聊天重新开窗
    await vi.advanceTimersByTimeAsync(1);
    expect(waiter.box.value!.reason).toBe('observation_window_elapsed');
  });

  it('miss 未达阈值时窗内见 started → 计数清零不累计成降窗', async () => {
    const mvu = installFakeMvu(false);
    const es = createFakeEventSource();
    attachMvuAnalysisGate_ACU({ eventSource: es });
    await runWindowElapsedRound();
    await runWindowElapsedRound();

    // 第 3 轮窗内真解析来了：started→ended 正常挂起放行（非窗满，不记 miss）
    const waiter = track(waitForMvuAnalysisToSettle_ACU());
    mvu.during = true;
    es.emit(MVU_ANALYSIS_STARTED_EVENT_ACU);
    mvu.during = false;
    es.emit(MVU_ANALYSIS_ENDED_EVENT_ACU);
    await vi.advanceTimersByTimeAsync(0);
    expect(waiter.box.value!.reason).toBe('analysis_ended');
    expect(getMvuAnalysisGateState_ACU().observeMissCount).toBe(0); // started 已清零

    // 下一轮仍开观察窗（没被 2+1 轮误降）
    const next = track(waitForMvuAnalysisToSettle_ACU());
    await vi.advanceTimersByTimeAsync(MVU_GATE_OBSERVE_WINDOW_MS_ACU - 1);
    expect(next.box.value).toBeNull();
  });
});
