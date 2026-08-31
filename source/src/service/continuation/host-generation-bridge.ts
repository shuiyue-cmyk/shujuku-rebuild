import { countAiMessages_ACU, isAiMessage_ACU, resolveGeneratedAiMessageIndex_ACU, type AutoFillIntent_ACU } from '../runtime/message-handler';
import { validateLoopTags_ACU } from '../loop/loop-evaluator';
import { logAgentSession_ACU } from './agent/agent-session-log';
import type { ContinuationPreparedTurnInstruction_ACU } from './stage-execution-engine';
import type { ContinuationHostGenerationCapture_ACU, TurnAttemptIdentity_ACU } from './model';
import type { ContinuationHostTurnAdapter_ACU } from './host-turn-adapter';

export interface ContinuationHostTurnRuntime_ACU {
  getChatIdentity(): string;
  getChat(): any[];
  readPendingHostTurn(): { settings: { loopTags: string; retryDelaySeconds?: number }; pending: { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU; status: 'awaiting_generation' | 'retry_ready' | 'exhausted' } } | null;
  readAutoContinueState(): { eligible: boolean; delaySeconds: number };
  continueTask(): Promise<{ preparedTurn?: ContinuationPreparedTurnInstruction_ACU; retryHostGeneration?: boolean }>;
  recordHostTurn(input: { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU }): Promise<unknown>;
  bindHostTurnGeneration(identity: TurnAttemptIdentity_ACU, generationSeq: number): Promise<void>;
  confirmCurrentTurn(identity: TurnAttemptIdentity_ACU, messageIndex?: number): Promise<unknown>;
  rejectHostTurnForMissingTags(input: { identity: TurnAttemptIdentity_ACU; messageIndex: number }): Promise<unknown>;
  rejectHostTurnForFailedGeneration(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  pauseForHostInputFailure(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  pauseForHostResultFailure(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  failHostTurnForStoppedGeneration(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
}

export interface ContinuationHostGenerationBridgeDependencies_ACU {
  runtime: ContinuationHostTurnRuntime_ACU;
  hostInput: ContinuationHostTurnAdapter_ACU;
  now(): number;
  wait(ms: number): Promise<void>;
  materializationRetries: number;
  materializationRetryDelayMs: number;
  /**
   * 作废在途的自动填表防抖（坏标签楼交还宿主 regenerate 重生成前的互斥钩子，见 onGenerationEnded）。
   * 缺省不做任何事（测试注入场景）。
   */
  invalidatePendingAutoFill?: () => void;
}

type StartedHostGeneration_ACU = { identity: TurnAttemptIdentity_ACU; sequence: number; bind: Promise<void> };

/**
 * The only bridge that may couple a prepared continuation turn to host input
 * and GENERATION_* events.
 *
 * 认领采用两层判定：
 * - 严格层：GENERATION_STARTED 在发送的同步窗口内到达时按序列号精确配对（历史行为）。
 * - 宽松层：参考最原始智能续写的状态法——持久化的 pendingHostTurn（awaiting_generation）
 *   就是"正在等待回复"的标志，任意非 quiet 的生成事件（由调用方经 allowLoose 过滤后）
 *   都可被认领；归属安全交给 resolveGeneratedAiMessageIndex_ACU 的唯一候选解析兜底。
 *   宿主的 GENERATION_STARTED 通常在点击发送后的微任务中才送达，严格层此时必然错过，
 *   没有宽松层就会永远收不到正文完成信号。
 */
export class ContinuationHostGenerationBridge_ACU {
  private sendingIdentity: TurnAttemptIdentity_ACU | null = null;
  private readonly startedByChat = new Map<string, StartedHostGeneration_ACU>();

  constructor(private readonly dependencies: ContinuationHostGenerationBridgeDependencies_ACU) {}

  /** 打断酒馆正在进行的正文生成。用户点停止时必须先走这里，否则正文写完仍会确认并自动续写。 */
  stopHostGeneration(): void {
    this.dependencies.hostInput.stopGeneration();
  }

  /** 桥内存中是否持有该聊天的活认领（发送窗口内或已认领生成开始）。用于区分真在飞与重载后的滞留态。 */
  hasLiveClaim(chatIdentity: string): boolean {
    if (this.sendingIdentity?.chatIdentity === chatIdentity) return true;
    return this.startedByChat.has(chatIdentity);
  }

  /**
   * 作废该聊天在桥内存里的生成开始认领。
   * 背景：startedByChat 只在生成结束/中止的正常出口删除。用户停止任务、放弃任务或一键清空之后
   * 不会再有归属它的 GENERATION_ENDED，条目永久残留：回到该聊天时宽松 STARTED 被存在性判定永久
   * 拒绝、宽松 ENDED 又被陈旧序列号拒绝——该聊天的续写链永久 BUSY 到刷新页面为止。
   * 因此 orchestrator 的三个作废出口（stopTask / abandonAndCreate / clearContinuationData）必须显式清一次。
   * @param chatIdentity 要清理认领的聊天身份
   * @returns 是否确实删除了一条认领（供测试与日志断言）
   */
  invalidateStartedByChat(chatIdentity: string): boolean {
    return this.startedByChat.delete(chatIdentity);
  }

  async send(prepared: ContinuationPreparedTurnInstruction_ACU): Promise<boolean> {
    const runtime = this.dependencies.runtime;
    if (prepared.identity.chatIdentity !== runtime.getChatIdentity()) return false;
    const chat = runtime.getChat();
    const capture: ContinuationHostGenerationCapture_ACU = {
      capturedAt: this.dependencies.now(),
      capturedChatLength: Array.isArray(chat) ? chat.length : 0,
      capturedAiFloorCount: Array.isArray(chat) ? chat.filter(message => message && !message.is_user && message?.extra?.type !== 'narrator').length : 0,
      generationSeq: null,
    };
    await runtime.recordHostTurn({ identity: prepared.identity, capture });
    this.sendingIdentity = prepared.identity;
    try {
      if (!this.dependencies.hostInput.send(prepared.instruction.instruction)) {
        await runtime.pauseForHostInputFailure(prepared.identity);
        return false;
      }
      return true;
    } finally {
      this.sendingIdentity = null;
    }
  }

  /**
   * 认领宿主生成开始事件。
   * 严格路径：发送同步窗口内到达（sendingIdentity 仍在）按历史行为配对。
   * 宽松路径（allowLoose，调用方已过滤 quiet/dryRun/automatic）：当前聊天存在未绑定
   * 序列号的等待轮时认领——宿主事件通常在发送返回后的微任务里才送达，没有这条路径
   * 生成开始永远配对不上（spv8.9.2 时代的状态法没有这个问题）。
   */
  onGenerationStarted(sequence: number, allowLoose = false): boolean {
    const runtime = this.dependencies.runtime;
    const identity = this.sendingIdentity;
    if (identity && identity.chatIdentity === runtime.getChatIdentity()) {
      const pending = runtime.readPendingHostTurn();
      if (!pending || pending.pending.identity.attemptId !== identity.attemptId || pending.pending.capture.generationSeq !== null) return false;
      this.startedByChat.set(identity.chatIdentity, { identity, sequence, bind: runtime.bindHostTurnGeneration(identity, sequence) });
      return true;
    }
    if (!allowLoose) return false;
    const chatIdentity = runtime.getChatIdentity();
    if (this.startedByChat.has(chatIdentity)) return false;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'awaiting_generation' || snapshot.pending.capture.generationSeq !== null) return false;
    const pendingIdentity = snapshot.pending.identity;
    this.startedByChat.set(chatIdentity, { identity: pendingIdentity, sequence, bind: runtime.bindHostTurnGeneration(pendingIdentity, sequence) });
    return true;
  }

  /**
   * 是否认领本次生成结束。严格路径按已认领的序列号精确匹配；
   * 宽松路径（allowLoose）参考 spv8.9.2 的状态法：只要当前聊天有等待中的宿主轮
   * 且序列号不冲突（未绑定或一致）就认领，归属由唯一候选解析器兜底。
   */
  claimsGenerationEnded(sequence: number | undefined, allowLoose = false): boolean {
    const runtime = this.dependencies.runtime;
    const started = this.startedByChat.get(runtime.getChatIdentity());
    if (started && sequence !== undefined && started.sequence === sequence) return true;
    if (!allowLoose) return false;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'awaiting_generation') return false;
    const boundSequence = snapshot.pending.capture.generationSeq ?? started?.sequence ?? null;
    return boundSequence === null || sequence === undefined || boundSequence === sequence;
  }

  async onGenerationEnded(eventMessageId: unknown, sequence: number | undefined, allowLoose = false): Promise<void> {
    if (!this.claimsGenerationEnded(sequence, allowLoose)) return;
    const chatIdentity = this.dependencies.runtime.getChatIdentity();
    const started = this.startedByChat.get(chatIdentity) ?? null;
    this.startedByChat.delete(chatIdentity);
    // 宽松路径没有 started 记录：身份以持久化等待轮为准。
    const claimedIdentity = started?.identity ?? this.dependencies.runtime.readPendingHostTurn()?.pending.identity;
    if (!claimedIdentity) return;
    try {
      if (started) await started.bind;
      const snapshot = this.dependencies.runtime.readPendingHostTurn();
      if (!snapshot || snapshot.pending.status !== 'awaiting_generation' || snapshot.pending.identity.attemptId !== claimedIdentity.attemptId) return;
      const boundSequence = snapshot.pending.capture.generationSeq;
      if (boundSequence !== null && sequence !== undefined && boundSequence !== sequence) return;
      const resolution = await this.resolveMessageIndex_ACU(eventMessageId, snapshot.pending.capture, chatIdentity);
      if (resolution.kind === 'no_reply') {
        // 生成失败/未产出正文：没有新楼层，走酒馆 Generate 对已有用户楼要回复，不重跑 Agent。
        await this.dependencies.runtime.rejectHostTurnForFailedGeneration(claimedIdentity);
        await this.autoRetryHostGenerationIfReady_ACU(claimedIdentity, snapshot.settings.retryDelaySeconds ?? 0);
        return;
      }
      if (resolution.kind === 'unsafe') {
        // 归属不安全（多候选歧义/快照失效）：自动重试可能删错楼，fail closed 交人工。
        await this.dependencies.runtime.pauseForHostResultFailure(claimedIdentity);
        return;
      }
      const messageIndex = resolution.messageIndex;
      const chat = this.dependencies.runtime.getChat();
      if (messageIndex !== chat.length - 1) {
        await this.dependencies.runtime.pauseForHostResultFailure(claimedIdentity);
        return;
      }
      const message = chat[messageIndex];
      if (!message || !validateLoopTags_ACU(String(message.mes ?? ''), snapshot.settings.loopTags)) {
        // [双写互斥] 坏标签楼将由宿主 regenerate 删掉重生成：本轮正文对应的
        // 自动填表防抖（GENERATION_ENDED 派发，500ms 窗口）此刻指向即将被删掉的楼，若让它到期
        // 就会对已删楼层跑一次填表，regenerate 后的第二次 ENDED 再填一次 → 双写。作废这条
        // pending debounce；重发成功后的第二次 ENDED 会正常派发填表，因此不会漏填。
        try { this.dependencies.invalidatePendingAutoFill?.(); } catch { /* 填表作废失败不阻断重试链 */ }
        await this.dependencies.runtime.rejectHostTurnForMissingTags({ identity: claimedIdentity, messageIndex });
        await this.autoRetryHostGenerationIfReady_ACU(claimedIdentity, snapshot.settings.retryDelaySeconds ?? 0);
        return;
      }
      await this.dependencies.runtime.confirmCurrentTurn(claimedIdentity, messageIndex);
    } catch {
      // A bridge failure must not leave an attributable turn indefinitely running.
      // The guarded fallback preserves a stale/persistence error when it can no
      // longer safely write the original task identity.
      try {
        await this.dependencies.runtime.pauseForHostResultFailure(claimedIdentity);
      } catch {
        // No safe write remains after a stale or persistence failure.
      }
      return;
    }
    await this.autoContinueAfterTurn_ACU();
  }

  /**
   * 宿主生成被中止（GENERATION_STOPPED）：等待中的宿主轮不会再有结束事件，
   * 转入 retry_ready + 暂停，用户可重试当前轮或继续/停止，不再卡死在等待态。
   */
  async onGenerationStopped(sequence: number | undefined): Promise<void> {
    const runtime = this.dependencies.runtime;
    const chatIdentity = runtime.getChatIdentity();
    const started = this.startedByChat.get(chatIdentity) ?? null;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'awaiting_generation') {
      // 没有任何等待轮能归属这条认领（轮次已被其他路径推进/清空），而中止之后也不会再有
      // GENERATION_ENDED：条目留在 Map 里就是永久残留——回到该聊天时宽松 STARTED 被存在性
      // 判定挡下、宽松 ENDED 被陈旧序列号挡下，续写链死锁到刷新。必须就地清掉。
      if (started) this.startedByChat.delete(chatIdentity);
      return;
    }
    const boundSequence = snapshot.pending.capture.generationSeq ?? started?.sequence ?? null;
    if (boundSequence !== null && sequence !== undefined && boundSequence !== sequence) {
      // 中止事件属于别的生成：只有当它正好是本条认领的那次生成时才清理（那次生成已经死了，
      // 不会再有 ENDED）；等待轮真正绑定的生成仍在飞时保留认领，不能误删。
      if (started && sequence === started.sequence) this.startedByChat.delete(chatIdentity);
      return;
    }
    this.startedByChat.delete(chatIdentity);
    if (started) {
      try { await started.bind; } catch { /* 绑定失败不阻碍中止转换 */ }
    }
    try {
      await runtime.failHostTurnForStoppedGeneration(snapshot.pending.identity);
    } catch {
      // 状态已变化（轮次已被其他路径推进/暂停）时无需补写。
    }
  }

  /**
   * 一轮正文确认成功后的自动续写：等待轮次延迟后自动触发下一轮，
   * 与正文重试自动链同构。资格在延迟前后各读一次——用户可能在延迟期间停止任务。
   * continueTask 的失败已由 orchestrator 落为 paused+lastError，这里不再改写状态。
   */
  private async autoContinueAfterTurn_ACU(): Promise<void> {
    const runtime = this.dependencies.runtime;
    const state = runtime.readAutoContinueState();
    if (!state.eligible) return;
    await this.dependencies.wait(state.delaySeconds * 1_000);
    if (!runtime.readAutoContinueState().eligible) return;
    try {
      const result = await runtime.continueTask();
      if (result.retryHostGeneration) await this.retryHostGeneration();
      else if (result.preparedTurn) await this.send(result.preparedTurn);
    } catch (error) {
      // 状态已由 orchestrator 记录（paused+lastError 或拒绝原因），自动链到此为止；
      // 但必须在会话流留痕——静默吞掉会让用户以为自动续写根本没触发。
      const message = error instanceof Error ? error.message : String(error);
      logAgentSession_ACU({ kind: 'run_failed', title: '自动续写已暂停', detail: `${message}\n进度已保留，输入新指令后发送即可继续。`, ok: false });
    }
  }

  /**
   * 解析本轮宿主正文的楼层归属。
   * - resolved：唯一候选，可安全确认。
   * - no_reply：物化等待耗尽仍无任何候选——生成失败或未产出正文，可安全自动重试
   *   （没有楼层被写入）。生成出错时宿主的 message_id 常为 undefined，非整数锚点
   *   不短路：解析器各锚点分支自带整数守卫，会自然落到捕获边界候选扫描。
   * - unsafe：多候选歧义 / 快照失效 / 聊天已切换——自动重试可能重复楼层，fail closed。
   */
  private async resolveMessageIndex_ACU(eventMessageId: unknown, capture: ContinuationHostGenerationCapture_ACU, chatIdentity: string): Promise<{ kind: 'resolved'; messageIndex: number } | { kind: 'no_reply' } | { kind: 'unsafe' }> {
    const anchor = Number.isInteger(eventMessageId) ? (eventMessageId as number) : Number.NaN;
    const intent: AutoFillIntent_ACU = { eventMessageId: anchor, chatKey: chatIdentity, isolationKey: '', capturedAt: capture.capturedAt, capturedChatLength: capture.capturedChatLength, capturedAiFloorCount: capture.capturedAiFloorCount, generationSeq: capture.generationSeq ?? undefined };
    for (let attempt = 0; attempt <= this.dependencies.materializationRetries; attempt += 1) {
      if (this.dependencies.runtime.getChatIdentity() !== chatIdentity) return { kind: 'unsafe' };
      const result = resolveGeneratedAiMessageIndex_ACU({ liveChat: this.dependencies.runtime.getChat(), intent });
      if (result.kind === 'resolved') return { kind: 'resolved', messageIndex: result.messageIndex };
      if (result.kind !== 'pending_materialization') return { kind: 'unsafe' };
      if (attempt === this.dependencies.materializationRetries) return { kind: 'no_reply' };
      await this.dependencies.wait(this.dependencies.materializationRetryDelayMs);
    }
    return { kind: 'no_reply' };
  }

  private async autoRetryHostGenerationIfReady_ACU(identity: TurnAttemptIdentity_ACU, retryDelaySeconds: number): Promise<void> {
    const afterReject = this.dependencies.runtime.readPendingHostTurn();
    if (afterReject?.pending.status !== 'retry_ready' || afterReject.pending.identity.attemptId !== identity.attemptId) return;
    await this.dependencies.wait(Math.max(0, retryDelaySeconds) * 1_000);
    await this.retryHostGeneration();
  }

  /**
   * 用酒馆自己的重新生成/生成链路重试当前轮，不再让 Agent 另造一条请求。
   * 末楼是 AI 时走 regenerate（酒馆会删掉该楼）；末楼不是 AI 时走 generate。
   */
  async retryHostGeneration(): Promise<boolean> {
    const runtime = this.dependencies.runtime;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'retry_ready') return false;
    if (snapshot.pending.identity.chatIdentity !== runtime.getChatIdentity()) return false;
    const chat = runtime.getChat();
    const lastIsAi = Array.isArray(chat) && chat.length > 0 && isAiMessage_ACU(chat[chat.length - 1]);
    const aiCount = countAiMessages_ACU(Array.isArray(chat) ? chat : []);
    const capture: ContinuationHostGenerationCapture_ACU = {
      capturedAt: this.dependencies.now(),
      capturedChatLength: lastIsAi ? Math.max(0, chat.length - 1) : (Array.isArray(chat) ? chat.length : 0),
      capturedAiFloorCount: lastIsAi ? Math.max(0, aiCount - 1) : aiCount,
      generationSeq: null,
    };
    await runtime.recordHostTurn({ identity: snapshot.pending.identity, capture });
    this.sendingIdentity = snapshot.pending.identity;
    try {
      if (!this.dependencies.hostInput.retryGeneration(lastIsAi ? 'regenerate' : 'generate')) {
        await runtime.pauseForHostInputFailure(snapshot.pending.identity);
        return false;
      }
      return true;
    } finally {
      this.sendingIdentity = null;
    }
  }
}
