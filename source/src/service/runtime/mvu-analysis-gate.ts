/**
 * service/runtime/mvu-analysis-gate.ts — [W4] MVU「额外模型解析」延后闸门 + [W5] 解析完成联动重跑
 *
 * 需求（用户拍板）：
 *   1. MVU 用「额外模型解析」时，本库的自动填表 + 自动正文替换要等 MVU 解析完成后再跑；
 *   2. MVU 手动重试解析成功后，本库要再跑一轮填表 + 正文替换。
 *
 * 铁律：MVU 未装 / 未启用 / 开关（settings.mvuGateEnabled）关闭时，本模块对既有链路**零行为差**——
 * 判定同步立即返回，不建定时器、不挂监听、不读缓存集合，也就不存在任何新增失败面。
 * 本闸门位于 v9.1.10 已上线的 W1（正文替换 messageId+内容指纹判重）/ W3（填表 messageId+chatKey 判重）
 * 的**上游**：它只推迟自动链的开跑时点，不改动任何判重语义。
 *
 * ── MVU 协议实据（MVU@61010da 已核查，本模块据此实现，勿再考证）──
 * · 挂载：window.Mvu（global/index.ts:172，多实例优先；卸载时 unset）。TT 下也可能挂在 window.parent，
 *   因此解析顺序 = 自身 window 优先 → parent 兜底（全程 try/catch，取不到就当 MVU 不在场）。
 * · 状态：isDuringExtraAnalysis(): boolean —— 布尔非计数；置位在解析请求发起处
 *   （invoke_extra_model.ts:184），复位在 finally（:202）；并发第二发立即 return null 且**不产 started/ended**，
 *   所以「started 深度计数」只可能来自真实的多轮交叉，不会因并发第二发少一次 ended 而挂死。
 * · 事件：mag_variable_update_started / mag_variable_update_ended（variable_def.ts:180/235/238），
 *   通道 = 宿主 eventSource（与 SillyTavern_API_ACU.eventSource 同一总线，TT 下与宿主同 window）。
 *   started/ended 只包 updateVariables 解析段（update_variables.ts:699→1472）；
 *   ended 成功/失败/异常都会发（on_message_received.ts:73 无条件）；
 *   早退路径（自动请求关 / 首楼 / 非 name2 / 内容<5 / 无 stat_data）连 started 都不发——
 *   这正是「观察窗窗满无 started → 放行」必须存在的理由。
 * · ended 时剧情正文已写入稳定（解析结果在 started 之前就已写，on_message_received.ts:56-66）→ 放行即读到最终正文。
 * · 手动重试（button.ts:434-527）：裁旧块 + 回滚变量后 onMessageReceived(force) —— 同路径、同事件，不经 3s 节流；
 *   「随 AI 输出」模式下按钮守卫直接 return，零事件（本模块因此不会误重跑）。
 * · 就绪事件 global_Mvu_initialized 无需订阅：本模块每次判定都惰性读 window.Mvu，挂载/卸载自然跟随。
 *
 * ── 为什么观察窗 5000ms、兜底超时 240000ms ──
 * 宿主 GENERATION_ENDED → MVU 真正 started 之间最长滞后 ≈3s（_.throttle(3000, {trailing}) + await），
 * 所以闸门不能只等 started，必须先开 5000ms 观察窗；单轮解析内部是串行重试、无总时长上限，
 * 所以挂起等待必须有 240s 兜底：超时强制放行 + logWarn，绝不把自动链永久挂死。
 *
 * ── 为什么 ended 之外还要 2s 轮询 ──
 * 宿主 eventSource 会吞监听器异常（不能假设 ended 必达），所以等待期间每 2s 轮询一次
 * isDuringExtraAnalysis 作第二把钥匙：已进入挂起态（started 至少见过一次 / flag 曾为 true）且此刻
 * flag 已 false → 同样放行，并把残留的 started 深度归零，避免丢失的 ended 留下幽灵深度把下一轮永远挂在等待里。
 *
 * ── 自适应降窗（免交「装了 MVU 但根本不用额外解析」那部分人的每轮 5s 观察税）──
 * 同一聊天连续 MVU_GATE_OBSERVE_MISS_LIMIT_ACU 轮观察窗窗满、从未见过一次 started
 * （典型即「随 AI 输出」模式：零 started/ended、flag 恒 false）→ 该聊天的后续触发跳过观察窗
 * （reason=observation_bypassed，同步放行、零定时器）。安全性：
 *   · 判定序①（flag true → 挂起）排在降窗之前：真有解析在飞时照样等，降窗只免掉「等 started」这一段；
 *   · 极小竞态窗（降窗放行后 MVU 才在毫秒级发起 started）→ 本库这一轮与解析并发，但该楼跑完会登记，
 *     解析 ended 时 [W5] 联动按「已登记 → 清记录 → 重跑」补一轮权威轮，正确性靠 W5 闭环兜底，不靠观察窗；
 *   · 一旦再见到 started，统计立即清零并恢复开窗（用户把模式切回「额外模型解析」时联动自动重新生效）；
 *   · 切聊天重置统计（单槽按 chatKey 匹配）：新聊天先走满 3 轮观察期再降窗，不继承旧聊天的结论。
 * 不做「读 MVU 设置项」来探测模式：角色卡 effective_settings 可以覆盖更新方式，探测误判的代价是直接抢跑；
 * 数据驱动降窗的最坏代价只是「新聊天头 3 轮各多等 5s」，宁保守勿抢跑。
 *
 * ── [W5] 无死循环自证 ──
 * 重跑只是再走一次既有自动链入口（填表 + 正文替换）。本库正文替换写回走
 * setChatMessages(..., { refresh: 'affected' })（service/chat/chat-service.ts:1154），
 * 宿主只在 createChatMessages 路径派发 MESSAGE_RECEIVED（ST 源码 chat_message.ts:385 / :403），
 * refresh:'affected' 不产 MESSAGE_RECEIVED → MVU 不会被本库写回拉起重新解析 → 不会再产生新的 ended
 * → 重跑自身不再触发第二轮重跑。第二重保险：W5 的触发判据是「收到 ended 时本楼已在 W1/W3 登记」，
 * 而自动轮的登记发生在 ended 之后（挂起中放行的那轮还没跑完/没登记），天然区分、不会自激。
 */

import {
  currentChatFileIdentifier_ACU,
  settings_ACU,
} from './state-manager';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import {
  findAutoOptimizationProcessedEntry_ACU,
  findAutoTableFillProcessedEntry_ACU,
  removeAutoChainProcessedForMessage_ACU,
} from '../../data/storage/optimization-cache-storage';
import { resolveLatestAiFloor_ACU } from '../table/auto-fill-echo-guard';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

// ═══ 协议常量 ═══

/** MVU 解析开始事件名（variable_def.ts:180）。 */
export const MVU_ANALYSIS_STARTED_EVENT_ACU = 'mag_variable_update_started';
/** MVU 解析结束事件名（variable_def.ts:235 / :238）。 */
export const MVU_ANALYSIS_ENDED_EVENT_ACU = 'mag_variable_update_ended';

/** 观察窗：宿主 ENDED → MVU started 最长滞后 ≈3s（throttle trailing + await），留 5s。 */
export const MVU_GATE_OBSERVE_WINDOW_MS_ACU = 5000;
/** 第二把钥匙：等待期间轮询 isDuringExtraAnalysis 的间隔。 */
export const MVU_GATE_POLL_INTERVAL_MS_ACU = 2000;
/** 兜底超时：单轮解析无上限（内部串行重试），4 分钟强制放行，绝不挂死自动链。 */
export const MVU_GATE_MAX_WAIT_MS_ACU = 240000;
/** ended 早于 flag 复位（flag 在 finally 才 false）时的短复检，避免白等一个 2s 轮询。 */
export const MVU_GATE_ENDED_SETTLE_MS_ACU = 250;
/** [W5] 同楼重复 ended 的合并窗口。 */
export const MVU_RERUN_DEBOUNCE_MS_ACU = 3000;
/** 自适应降窗：同一聊天连续 N 轮观察窗窗满未见 started 后跳过观察窗。 */
export const MVU_GATE_OBSERVE_MISS_LIMIT_ACU = 3;

/** 放行原因。 */
export type MvuGateReason_ACU =
  | 'gate_disabled'                  // 开关关闭 → 现状逐字不变
  | 'mvu_absent'                     // MVU 不在场 → 零开销放行
  | 'observation_window_elapsed'     // 观察窗窗满仍无 started → 放行（记一次 miss）
  | 'observation_bypassed'           // 自适应降窗：本聊天连续未见 started，跳过观察窗同步放行
  | 'analysis_ended'                 // ended 到达且深度归零、flag false → 放行
  | 'poll_fallback'                  // ended 丢失，轮询见 flag false → 放行（并把残留深度归零）
  | 'timeout'                        // 240s 兜底 → 强制放行
  | 'gate_error';                    // 闸门自身异常 → fail-open 放行

export interface MvuGateResult_ACU {
  /** 放行原因。 */
  reason: MvuGateReason_ACU;
  /** 是否真的推迟了调用方（观察窗也算推迟；降窗放行与不在场一样不推迟）。 */
  delayed: boolean;
  /** 是否进入过「解析在飞」挂起态（started 见过 / flag 曾为 true）。 */
  suspended: boolean;
  /** 本次判定耗时（同步放行为 0）。 */
  elapsedMs: number;
  /** 放行时的 started 深度（正常应为 0）。 */
  depth: number;
}

/** 宿主 eventSource 的最小形状（TT 下与 MVU 同一总线）。 */
export interface MvuEventSourceLike_ACU {
  on?: (event: string, handler: (...args: any[]) => void) => any;
  off?: (event: string, handler: (...args: any[]) => void) => any;
}

export interface MvuGateAttachOptions_ACU {
  /** 宿主 eventSource；缺失时闸门退化为 flag + 轮询判定（观察窗失去 started 捕获，仍安全放行）。 */
  eventSource?: MvuEventSourceLike_ACU | null;
  /** [W5] 重跑入口：装配方注入「走既有自动链统一入口再跑一轮」的调用（避免 service 反向依赖 presentation）。 */
  requestRerun?: (() => void | Promise<void>) | null;
}

interface MvuGateWait_ACU {
  startedAt: number;
  phase: 'observe' | 'suspend';
  settled: boolean;
  promise: Promise<MvuGateResult_ACU>;
  resolve: (result: MvuGateResult_ACU) => void;
  windowTimer: any;
  pollTimer: any;
  deadlineTimer: any;
  settleTimer: any;
}

// ═══ 模块状态 ═══

/** started 深度计数（支持交叉 / 连发）；ended 只减到 0，绝不负数。 */
let mvuAnalysisDepth_ACU = 0;
/** 当前在飞的闸门等待；非空时新的触发并入同一次等待（复用既有防抖旗标语义，不另造并发队列）。 */
let pendingGateWait_ACU: MvuGateWait_ACU | null = null;
let mvuRerunHandler_ACU: (() => void | Promise<void>) | null = null;
let detachMvuListeners_ACU: (() => void) | null = null;
let mvuRerunTimer_ACU: any = null;
let mvuRerunMessageId_ACU: string | null = null;
/** 自适应降窗统计（单槽：只有当前活跃聊天有意义；切聊天即重置，见 noteObservationMiss_ACU）。 */
const observeStats_ACU = { chatKey: '', missCount: 0 };

// ═══ MVU 在场判定 ═══

/**
 * 取 MVU 实例：自身 window 优先，parent 兜底（TT 下可能挂在 window.parent），全程 try/catch。
 * 取不到返回 null（= MVU 不在场 → 闸门零开销放行）。
 */
export function resolveMvuInstance_ACU(): any | null {
  try {
    const selfWin: any = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    if (selfWin && selfWin.Mvu) return selfWin.Mvu;
    const parentWin: any = selfWin && typeof selfWin.parent !== 'undefined' ? selfWin.parent : null;
    if (parentWin && parentWin !== selfWin && parentWin.Mvu) return parentWin.Mvu;
  } catch (error) {
    // 跨窗访问被拒 / 环境无 window：按不在场处理，闸门放行。
    return null;
  }
  return null;
}

/** MVU 在场且 API 形状可用（window.Mvu + typeof isDuringExtraAnalysis === 'function'）。 */
export function isMvuAnalysisHostPresent_ACU(): boolean {
  const mvu = resolveMvuInstance_ACU();
  return !!mvu && typeof mvu.isDuringExtraAnalysis === 'function';
}

/**
 * MVU 是否正在额外模型解析。
 * 读不到实例 / 调用抛错 / 返回值非 true → 一律 false（fail-open，与「MVU 未装」同一放行路径）。
 */
export function isMvuExtraAnalysisInProgress_ACU(): boolean {
  try {
    const mvu = resolveMvuInstance_ACU();
    if (!mvu || typeof mvu.isDuringExtraAnalysis !== 'function') return false;
    return mvu.isDuringExtraAnalysis() === true;
  } catch (error) {
    return false;
  }
}

/** 联动开关（settings 体系，默认开）：关 = 现状逐字不变（W4 不等待、W5 不清记录不重跑）。 */
export function isMvuAnalysisGateEnabled_ACU(): boolean {
  try {
    return settings_ACU?.mvuGateEnabled !== false;
  } catch (error) {
    return true;
  }
}

/** 调试/测试用只读快照。 */
export function getMvuAnalysisGateState_ACU(): { depth: number; waiting: boolean; phase: string; rerunScheduled: boolean; observeMissCount: number; observeBypassed: boolean } {
  return {
    depth: mvuAnalysisDepth_ACU,
    waiting: !!pendingGateWait_ACU && !pendingGateWait_ACU.settled,
    phase: pendingGateWait_ACU && !pendingGateWait_ACU.settled ? pendingGateWait_ACU.phase : 'idle',
    rerunScheduled: !!mvuRerunTimer_ACU,
    observeMissCount: observeStats_ACU.missCount,
    observeBypassed: isObservationBypassed_ACU(),
  };
}

// ═══ 自适应降窗统计 ═══

/** 本聊天是否已攒够 miss（窗满未见 started）到降窗阈值；chatKey 不匹配（切了聊天）一律不降。 */
function isObservationBypassed_ACU(): boolean {
  return observeStats_ACU.missCount >= MVU_GATE_OBSERVE_MISS_LIMIT_ACU
    && observeStats_ACU.chatKey === currentObservationChatKey_ACU();
}

function currentObservationChatKey_ACU(): string {
  try {
    return String(currentChatFileIdentifier_ACU ?? '');
  } catch (error) {
    return '';
  }
}

/** 记一次「观察窗窗满未见 started」：换聊天先重置再 +1，恰达阈值时提示一次。 */
function noteObservationMiss_ACU(): void {
  const chatKey = currentObservationChatKey_ACU();
  if (observeStats_ACU.chatKey !== chatKey) {
    observeStats_ACU.chatKey = chatKey;
    observeStats_ACU.missCount = 0;
  }
  observeStats_ACU.missCount += 1;
  if (observeStats_ACU.missCount === MVU_GATE_OBSERVE_MISS_LIMIT_ACU) {
    logDebug_ACU(`[MVU联动] 本聊天连续 ${MVU_GATE_OBSERVE_MISS_LIMIT_ACU} 轮观察窗未见额外模型解析，后续触发跳过观察窗（真解析在飞时仍由 isDuringExtraAnalysis 挂起）`);
  }
}

/** 真见过解析 → 降窗统计立即作废，恢复开窗（模式切回时联动自动重新生效）。 */
function resetObservationStats_ACU(): void {
  observeStats_ACU.chatKey = '';
  observeStats_ACU.missCount = 0;
}

// ═══ [W4] 闸门 ═══

function buildGateResult(
  wait: MvuGateWait_ACU | null,
  reason: MvuGateReason_ACU,
  delayed: boolean,
  suspended: boolean,
): MvuGateResult_ACU {
  return {
    reason,
    delayed,
    suspended,
    elapsedMs: wait ? Math.max(0, Date.now() - wait.startedAt) : 0,
    depth: mvuAnalysisDepth_ACU,
  };
}

function releaseGateWait_ACU(wait: MvuGateWait_ACU, reason: MvuGateReason_ACU): void {
  if (wait.settled) return;
  wait.settled = true;
  if (wait.windowTimer) { clearTimeout(wait.windowTimer); wait.windowTimer = null; }
  if (wait.pollTimer) { clearTimeout(wait.pollTimer); wait.pollTimer = null; }
  if (wait.deadlineTimer) { clearTimeout(wait.deadlineTimer); wait.deadlineTimer = null; }
  if (wait.settleTimer) { clearTimeout(wait.settleTimer); wait.settleTimer = null; }
  // 先摘旗标再 resolve：让同步链路上的下一次判定能开新窗（不并入已结束的旧等待）。
  if (pendingGateWait_ACU === wait) pendingGateWait_ACU = null;

  if (reason === 'timeout') {
    logWarn_ACU('[MVU联动] 等待解析超时，照常执行');
  } else {
    logDebug_ACU(
      `[MVU联动] 闸门放行：reason=${reason}，等待 ${Math.max(0, Date.now() - wait.startedAt)}ms，深度=${mvuAnalysisDepth_ACU}`,
    );
  }
  // 自适应降窗计数：窗满未见 started 才记 miss（挂起后放行说明解析真实存在，不记）。
  if (reason === 'observation_window_elapsed') noteObservationMiss_ACU();
  wait.resolve(buildGateResult(wait, reason, true, wait.phase === 'suspend'));
}

/** 第一把钥匙（ended）的收口判定：深度归零且 flag false 才放行；轮询钥匙见 schedulePollTick。 */
function tryReleaseSuspendedGate_ACU(wait: MvuGateWait_ACU, reason: MvuGateReason_ACU): boolean {
  if (wait.settled || wait.phase !== 'suspend') return false;
  if (mvuAnalysisDepth_ACU > 0) return false;
  if (isMvuExtraAnalysisInProgress_ACU()) return false;
  releaseGateWait_ACU(wait, reason);
  return true;
}

/** 观察窗 → 挂起态：只有真见过解析（started / flag true）才开始计 240s 兜底与轮询收口。 */
function enterSuspendPhase_ACU(wait: MvuGateWait_ACU): void {
  if (wait.settled || wait.phase === 'suspend') return;
  wait.phase = 'suspend';
  if (wait.windowTimer) { clearTimeout(wait.windowTimer); wait.windowTimer = null; }
  const remaining = MVU_GATE_MAX_WAIT_MS_ACU - (Date.now() - wait.startedAt);
  if (remaining <= 0) {
    releaseGateWait_ACU(wait, 'timeout');
    return;
  }
  wait.deadlineTimer = setTimeout(() => releaseGateWait_ACU(wait, 'timeout'), remaining);
  logDebug_ACU(`[MVU联动] 检测到额外模型解析在飞（深度=${mvuAnalysisDepth_ACU}），自动填表与正文替换延后执行`);
}

function schedulePollTick(wait: MvuGateWait_ACU, delay: number): void {
  if (wait.settled) return;
  wait.pollTimer = setTimeout(() => {
    wait.pollTimer = null;
    if (wait.settled) return;
    const inProgress = isMvuExtraAnalysisInProgress_ACU();
    if (inProgress) {
      // 观察窗内 flag 翻 true（started 事件丢失场景）→ 同样转入挂起态。
      if (wait.phase === 'observe') {
        if (mvuAnalysisDepth_ACU <= 0) mvuAnalysisDepth_ACU = 1;
        enterSuspendPhase_ACU(wait);
      }
      schedulePollTick(wait, MVU_GATE_POLL_INTERVAL_MS_ACU);
      return;
    }
    if (wait.phase === 'suspend') {
      // 第二把钥匙：进入挂起态本身就意味着「started 至少见过一次」（flag true 入场或 started 事件），
      // 此刻 flag 已 false → 解析确实结束，只是 ended 没送达（宿主 eventSource 会吞监听器异常）。
      // 深度按 0 归位，避免丢失的 ended 把幽灵深度留给下一轮，让下一次判定永远挂起。
      mvuAnalysisDepth_ACU = 0;
      releaseGateWait_ACU(wait, 'poll_fallback');
      return;
    }
    schedulePollTick(wait, MVU_GATE_POLL_INTERVAL_MS_ACU);
  }, delay);
}

/**
 * [W4] 自动链统一入口前的延后闸门。
 *
 * 判定序（与需求一致）：
 *   ① isDuringExtraAnalysis() === true → 直接挂起等待（优先于降窗：真在飞绝不抢跑）；
 *   ② 否则：本聊天已自适应降窗 → 同步放行、不开窗不建定时器；未降窗才开 5s 观察窗，
 *      窗内收到 started（深度 +1，支持交叉/连发）→ 挂起等待；窗满无 started → 放行并记一次 miss；
 *   ③ 挂起后按三把钥匙放行：ended（深度 -1，归零且 flag false）/ 2s 轮询兜底 / 240s 超时强制放行。
 *
 * 同一时刻只有一个在飞等待：重复触发（同一防抖轮的重复 ENDED）并入同一次等待，放行后各自继续跑，
 * 由既有链路的楼层解析自然取最新楼判定，不做并发排队。
 */
export function waitForMvuAnalysisToSettle_ACU(): Promise<MvuGateResult_ACU> {
  // 只释放「本次调用自己创建的」等待：异常发生在建 wait 之前时，绝不能顺手把别人在飞的等待放掉。
  let ownWait_ACU: MvuGateWait_ACU | null = null;
  try {
    if (!isMvuAnalysisGateEnabled_ACU()) {
      return Promise.resolve(buildGateResult(null, 'gate_disabled', false, false));
    }
    if (!isMvuAnalysisHostPresent_ACU()) {
      return Promise.resolve(buildGateResult(null, 'mvu_absent', false, false));
    }
    if (pendingGateWait_ACU && !pendingGateWait_ACU.settled) {
      logDebug_ACU('[MVU联动] 已有等待在飞，本次触发并入同一次等待（不另造并发队列）');
      return pendingGateWait_ACU.promise;
    }

    // 注意：promise 不能在 new Promise 的执行器里自引用（TDZ），先取 resolve，再回填 wait。
    let resolveGate_ACU: ((result: MvuGateResult_ACU) => void) | null = null;
    const promise = new Promise<MvuGateResult_ACU>((resolve) => { resolveGate_ACU = resolve; });
    const wait: MvuGateWait_ACU = {
      startedAt: Date.now(),
      phase: 'observe',
      settled: false,
      promise,
      resolve: (result: MvuGateResult_ACU) => { (resolveGate_ACU || (() => undefined))(result); },
      windowTimer: null,
      pollTimer: null,
      deadlineTimer: null,
      settleTimer: null,
    };
    ownWait_ACU = wait;
    pendingGateWait_ACU = wait;

    // ① 解析已在飞 → 直接挂起（判定序①优先于降窗）。
    if (isMvuExtraAnalysisInProgress_ACU()) {
      if (mvuAnalysisDepth_ACU <= 0) mvuAnalysisDepth_ACU = 1;
      enterSuspendPhase_ACU(wait);
    } else if (isObservationBypassed_ACU()) {
      // ②降窗：本聊天连续窗满未见 started → 不开窗、不建定时器，同步放行。
      // 竞态兜底：放行后若 MVU 才起解析，其 ended 会经 [W5]「已登记→清记录→重跑」补权威轮。
      if (pendingGateWait_ACU === wait) pendingGateWait_ACU = null;
      return Promise.resolve(buildGateResult(null, 'observation_bypassed', false, false));
    } else {
      // ②开窗等 started。
      wait.windowTimer = setTimeout(() => releaseGateWait_ACU(wait, 'observation_window_elapsed'), MVU_GATE_OBSERVE_WINDOW_MS_ACU);
    }
    // 轮询在两个阶段都跑：观察窗内兜住 started 丢失，挂起期兜住 ended 丢失。
    schedulePollTick(wait, MVU_GATE_POLL_INTERVAL_MS_ACU);
    return promise;
  } catch (error) {
    // 闸门自身异常绝不能拖累既有链路：fail-open 放行；自己创建的等待就地收口，不留悬挂定时器。
    logWarn_ACU('[MVU联动] 闸门判定异常，照常执行:', error);
    if (ownWait_ACU && !ownWait_ACU.settled) releaseGateWait_ACU(ownWait_ACU, 'gate_error');
    return Promise.resolve(buildGateResult(null, 'gate_error', false, false));
  }
}

/** MVU started 事件入口（幂等于事件总线；深度 +1）。 */
export function notifyMvuAnalysisStarted_ACU(): void {
  mvuAnalysisDepth_ACU += 1;
  // 真见过解析 → 降窗统计立即作废，恢复开窗（模式切回时联动自动重新生效）。
  resetObservationStats_ACU();
  const wait = pendingGateWait_ACU;
  if (wait && !wait.settled && wait.phase === 'observe') enterSuspendPhase_ACU(wait);
}

/** MVU ended 事件入口：深度 -1（不低于 0）→ 收口判定；随后走 [W5] 联动重跑判定。 */
export function notifyMvuAnalysisEnded_ACU(): void {
  mvuAnalysisDepth_ACU = Math.max(0, mvuAnalysisDepth_ACU - 1);
  const wait = pendingGateWait_ACU;
  if (wait && !wait.settled) {
    if (!tryReleaseSuspendedGate_ACU(wait, 'analysis_ended')) {
      // ended 早于 flag 复位（is_during_extra_analysis 在 finally 才 false）→ 250ms 后复检，
      // 再兜不住仍有 2s 轮询与 240s 超时。
      if (wait.phase === 'suspend' && !wait.settled && !wait.settleTimer) {
        wait.settleTimer = setTimeout(() => {
          wait.settleTimer = null;
          tryReleaseSuspendedGate_ACU(wait, 'analysis_ended');
        }, MVU_GATE_ENDED_SETTLE_MS_ACU);
      }
    }
  }
  scheduleMvuRerunForLatestProcessedFloor_ACU();
}

// ═══ [W5] 解析完成 / 手动重试联动 ═══

/**
 * 收到 ended 后判断要不要再跑一轮自动链。
 *
 * 判据 = 「本楼在 W1/W3 已处理集合里有登记」：
 *   · 有登记 → 说明解析发生在「本库已跑完之后」（手动重试，或观察窗/降窗误判场景）→ 清该楼两集合记录 + 重跑；
 *   · 无登记 → 自动轮还没跑完/没登记（挂起中放行的那轮）→ 不重跑。这条判据天然区分两种时序，防双跑。
 * 3s 防抖合并同楼重复 ended；重跑走既有统一入口，因此同样过 W4 闸门（若又有解析在飞则再等）。
 */
export function scheduleMvuRerunForLatestProcessedFloor_ACU(): void {
  try {
    if (!isMvuAnalysisGateEnabled_ACU()) return;      // 开关关 = 现状逐字不变
    if (!mvuRerunHandler_ACU) return;                 // 未装配重跑入口（例如 eventSource 缺失）
    const floor = resolveLatestAiFloor_ACU(getChatArray_ACU());
    const messageId = floor?.messageId;
    if (messageId === null || messageId === undefined) return;
    const chatKey = String(currentChatFileIdentifier_ACU ?? '');
    const hasReplacement = !!findAutoOptimizationProcessedEntry_ACU(messageId, chatKey);
    const hasTableFill = !!findAutoTableFillProcessedEntry_ACU(messageId, chatKey);
    if (!hasReplacement && !hasTableFill) {
      logDebug_ACU(`[MVU联动] 第 ${floor!.messageIndex} 楼尚未登记自动链完成记录，本次解析结束不触发重跑`);
      return;
    }
    const target = String(messageId);
    if (mvuRerunTimer_ACU && mvuRerunMessageId_ACU === target) return; // 同楼重复 ended → 合并
    if (mvuRerunTimer_ACU) clearTimeout(mvuRerunTimer_ACU);
    mvuRerunMessageId_ACU = target;
    mvuRerunTimer_ACU = setTimeout(() => {
      mvuRerunTimer_ACU = null;
      mvuRerunMessageId_ACU = null;
      void runMvuRerun_ACU(target, chatKey, hasReplacement, hasTableFill);
    }, MVU_RERUN_DEBOUNCE_MS_ACU);
  } catch (error) {
    logWarn_ACU('[MVU联动] 解析完成联动重跑判定失败（跳过本次重跑，不影响既有链路）:', error);
  }
}

async function runMvuRerun_ACU(
  messageId: string,
  chatKey: string,
  hasReplacement: boolean,
  hasTableFill: boolean,
): Promise<void> {
  try {
    // 先清记录再重跑：W3 只比 messageId，不清就永远不会再填；W1 比内容指纹，MVU 改写正文后本就不拦，
    // 一并清除是为了让「重跑成功」重新获得一份干净的完成凭证，而不是留着上一轮的旧指纹。
    const removed = removeAutoChainProcessedForMessage_ACU(messageId, chatKey);
    logDebug_ACU(
      `[MVU联动] 解析完成联动重跑：清除 messageId=${messageId} 判重记录（正文替换 ${removed.content_replacement} 条 / 自动填表 ${removed.auto_table_fill} 条；命中 替换=${hasReplacement} 填表=${hasTableFill}）`,
    );
    await mvuRerunHandler_ACU?.();
  } catch (error) {
    logWarn_ACU('[MVU联动] 解析完成联动重跑失败:', error);
  }
}

// ═══ 装配 / 卸载 ═══

/**
 * 装配 MVU 联动：注册 started/ended 监听，并注入 [W5] 的重跑入口。
 * 由 presentation/bootstrap/init.ts 在宿主 eventSource 就绪后调用一次；重复调用先卸后装（幂等）。
 * @returns 注销函数
 */
export function attachMvuAnalysisGate_ACU(options: MvuGateAttachOptions_ACU = {}): () => void {
  detachMvuAnalysisGateListeners_ACU();
  mvuRerunHandler_ACU = typeof options.requestRerun === 'function' ? options.requestRerun : null;

  const eventSource = options.eventSource;
  if (!eventSource || typeof eventSource.on !== 'function') {
    logDebug_ACU('[MVU联动] 宿主 eventSource 不可用：未注册解析事件监听，闸门退化为 flag + 观察窗 + 轮询判定。');
    return () => undefined;
  }
  const onStarted = (): void => { notifyMvuAnalysisStarted_ACU(); };
  const onEnded = (): void => { notifyMvuAnalysisEnded_ACU(); };
  try {
    eventSource.on(MVU_ANALYSIS_STARTED_EVENT_ACU, onStarted);
    eventSource.on(MVU_ANALYSIS_ENDED_EVENT_ACU, onEnded);
    detachMvuListeners_ACU = () => {
      try {
        if (typeof eventSource.off === 'function') {
          eventSource.off(MVU_ANALYSIS_STARTED_EVENT_ACU, onStarted);
          eventSource.off(MVU_ANALYSIS_ENDED_EVENT_ACU, onEnded);
        }
      } catch (error) {
        logDebug_ACU('[MVU联动] 注销 MVU 解析事件监听失败:', error);
      }
    };
    logDebug_ACU('[MVU联动] 已注册 MVU 额外模型解析事件监听（started / ended）。');
  } catch (error) {
    logWarn_ACU('[MVU联动] 注册 MVU 解析事件监听失败，闸门退化为 flag + 观察窗 + 轮询判定:', error);
  }
  return () => detachMvuAnalysisGateListeners_ACU();
}

/** 注销 started/ended 监听（保留已排队的等待、重跑与降窗统计，交由 resetForTest 清理）。 */
export function detachMvuAnalysisGateListeners_ACU(): void {
  if (detachMvuListeners_ACU) {
    const detach = detachMvuListeners_ACU;
    detachMvuListeners_ACU = null;
    detach();
  }
}

/** 测试专用：清空深度、在飞等待、重跑定时器与降窗统计，并注销监听。 */
export function resetMvuAnalysisGateForTest_ACU(): void {
  detachMvuAnalysisGateListeners_ACU();
  mvuRerunHandler_ACU = null;
  mvuAnalysisDepth_ACU = 0;
  resetObservationStats_ACU();
  if (mvuRerunTimer_ACU) { clearTimeout(mvuRerunTimer_ACU); mvuRerunTimer_ACU = null; }
  mvuRerunMessageId_ACU = null;
  const wait = pendingGateWait_ACU;
  if (wait) {
    pendingGateWait_ACU = null;
    if (!wait.settled) {
      wait.settled = true;
      if (wait.windowTimer) clearTimeout(wait.windowTimer);
      if (wait.pollTimer) clearTimeout(wait.pollTimer);
      if (wait.deadlineTimer) clearTimeout(wait.deadlineTimer);
      if (wait.settleTimer) clearTimeout(wait.settleTimer);
      wait.resolve(buildGateResult(wait, 'gate_error', true, wait.phase === 'suspend'));
    }
  }
}
