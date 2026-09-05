import { logDebug_ACU, logWarn_ACU } from './utils';

const AUTO_FILL_SKIP_WARN_REASONS_ACU = new Set<AutoFillSkipReason_ACU>([
  'ambiguous_generated_ai_message',
  'generated_ai_message_not_materialized',
  'resolved_message_not_ai',
]);

export type AutoFillSkipReason_ACU =
  | 'quiet_or_background_generation'
  | 'user_aborted'
  | 'core_apis_not_ready'
  | 'empty_chat'
  | 'last_message_not_ai'
  | 'generated_ai_message_not_materialized'
  | 'ambiguous_generated_ai_message'
  | 'resolved_message_not_ai'
  | 'different_character'
  | 'message_evaluation_skipped'
  | 'chat_changed'
  | 'auto_update_coalesced'
  | 'preconditions_failed'
  | 'no_tables_due'
  /** 同一楼已成功自动填表后，宿主又派发了一条 GENERATION_ENDED（外部插件回声）→ 自动填表入口短路 */
  | 'duplicate_auto_fill_ended'
  /** 无配对上下文的 GENERATION_ENDED，且自上次门控放行以来 AI 楼零产出（外部插件假事件 / 查看器中途停止）→ 门控源头丢弃 */
  | 'unpaired_ended_no_new_output';

export interface AutoFillSkipContext_ACU {
  eventType?: string;
  messageId?: unknown;
  /** 事件锚点楼层号（宿主 GENERATION_ENDED 参数，不承诺是 AI 楼层） */
  eventMessageId?: unknown;
  chatKey?: string;
  isolationKey?: string;
  /** 防抖回调执行时的当前隔离键（用于区分“捕获时”与“执行时”） */
  liveIsolationKey?: string;
  lastGenerationType?: unknown;
  aiFloorCount?: number;
  /** 无配对 ENDED 判重：门控上次放行时最新 AI 楼的 message_id */
  latestAiMessageId?: number | null;
  /** 捕获时聊天数组长度 */
  capturedChatLength?: number;
  /** 捕获时 AI 楼层数 */
  capturedAiFloorCount?: number;
  /** 防抖回调执行时的聊天数组长度 */
  liveChatLength?: number;
  /** 防抖回调执行时的 AI 楼层数 */
  liveAiFloorCount?: number;
  /** 最终解析出的本轮 AI 楼层索引 */
  resolvedMessageIndex?: number;
  /** 解析阶段的候选楼层索引 */
  candidateIndexes?: number[];
  inFlight?: boolean;
  /** 前置检查失败分支的稳定原因码（来自 checkAutoUpdatePreConditions_ACU） */
  preconditionReason?: string;
}

export function logAutoFillSkip_ACU(
  reason: AutoFillSkipReason_ACU,
  context: AutoFillSkipContext_ACU = {},
): void {
  const {
    eventType,
    messageId,
    eventMessageId,
    chatKey,
    isolationKey,
    liveIsolationKey,
    lastGenerationType,
    aiFloorCount,
    capturedChatLength,
    capturedAiFloorCount,
    liveChatLength,
    liveAiFloorCount,
    resolvedMessageIndex,
    candidateIndexes,
    inFlight,
    preconditionReason,
    latestAiMessageId,
  } = context;
  const log = AUTO_FILL_SKIP_WARN_REASONS_ACU.has(reason) ? logWarn_ACU : logDebug_ACU;
  log('[AutoFill] Trigger skipped', {
    reason,
    eventType,
    messageId,
    eventMessageId,
    chatKey,
    isolationKey,
    liveIsolationKey,
    lastGenerationType,
    aiFloorCount,
    capturedChatLength,
    capturedAiFloorCount,
    liveChatLength,
    liveAiFloorCount,
    resolvedMessageIndex,
    candidateIndexes,
    inFlight,
    preconditionReason,
    latestAiMessageId,
  });
}
