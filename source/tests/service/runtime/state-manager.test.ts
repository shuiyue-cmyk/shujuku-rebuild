/**
 * tests/service/runtime/state-manager.test.ts
 * 运行时状态管理器 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockGetChatArray,
  mockLogAutoFillSkip,
} = vi.hoisted(() => ({
  mockGetChatArray: vi.fn(() => []),
  mockLogAutoFillSkip: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
}));

// 门控收紧后要能观测「丢弃原因」，日志通道本身不参与判定。
vi.mock('../../../src/shared/trigger-diagnostics', () => ({
  logAutoFillSkip_ACU: mockLogAutoFillSkip,
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_CHAR_CARD_PROMPT_ACU: '',
  DEFAULT_PLOT_SETTINGS_ACU: {},
}));

vi.mock('../../../src/shared/defaults', () => ({
  DEFAULT_AUTO_UPDATE_FREQUENCY_ACU: 3,
  DEFAULT_AUTO_UPDATE_THRESHOLD_ACU: 5,
  DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU: 1000,
  defaultVectorMemoryConfig_ACU: {},
}));

import {
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU,
  USER_SEND_TRIGGER_TTL_MS_ACU,
  generationGate_ACU,
  loopState_ACU,
  planningGuard_ACU,
  isRecentUserSendIntent_ACU,
  recordLastUserSend_ACU,
  recordGenerationContext_ACU,
  resolveGenerationContextForEnded_ACU,
  consumeGenerationContextForEnded_ACU,
  discardLatestGenerationContext_ACU,
  isQuietLikeGeneration_ACU,
  isRecentUserSend_ACU,
  shouldProcessPlotForGeneration_ACU,
  shouldProcessAutoTableUpdateForGenerationEnded_ACU,
  markChatChangedForEndedGate_ACU,
  requestTableFillStop_ACU,
  isTableFillStopRequested_ACU,
  isAutoUpdatingCard_ACU,
  markStoppedSendForRetry_ACU,
  clearStoppedSendRetry_ACU,
  isRetryOfStoppedSend_ACU,
  getCurrentIsolationKey_ACU,
  settings_ACU,
  _set_settings_ACU,
  _set_currentJsonTableData_ACU,
  _set_currentChatFileIdentifier_ACU,
  _set_coreApisAreReady_ACU,
  _set_allChatMessages_ACU,
  _set_lastTotalAiMessages_ACU,
  _set_isProcessing_Plot_ACU,
  _set_abortController_ACU,
  _set_tempPlotToSave_ACU,
  _set_pendingBaseStatePlacement_ACU,
  _set_suppressWorldbookInjectionInGreeting_ACU,
  _set_independentTableStates_ACU,
  _set_currentAbortController_ACU,
  _set_isAutoUpdatingCard_ACU,
  _set_manualExtraHint_ACU,
  _set_wasStoppedByUser_ACU,
  _set_autoFillDebounceTimer_ACU,
  _set_chatMutationDebounceTimer_ACU,
  trackAbortController_ACU,
  untrackAbortController_ACU,
  abortAllActiveRequests_ACU,
  abortOnChatMutation_ACU,
  getChatMutationAbortSignal_ACU,
  activeAbortControllers_ACU,
} from '../../../src/service/runtime/state-manager';

beforeEach(() => {
  vi.clearAllMocks();
  // 重置 generationGate
  generationGate_ACU.lastUserMessageId = null;
  generationGate_ACU.lastUserMessageText = '';
  generationGate_ACU.lastUserMessageAt = 0;
  generationGate_ACU.lastUserSendIntentAt = 0;
  generationGate_ACU.lastGeneration = null;
  generationGate_ACU.generationSeq = 0;
  generationGate_ACU.activeGenerations = [];
  (generationGate_ACU as any).generationEndMatchQuarantineUntil_ACU = 0;
  // [152 收紧] AI 楼签名是门控唯一的跨轮状态，每轮回到「启动后尚未放行」形态。
  // 清空后再断言一次：哪天有人把这个字段摘掉/改名（或换了个整对象重置），这里先红，
  // 而不是让「无配对 + 签名相同 → 丢弃」的用例静默假绿。
  generationGate_ACU.lastEndedFloorSignature_ACU = null;
  expect(generationGate_ACU.lastEndedFloorSignature_ACU).toBeNull();
  (generationGate_ACU as any).awaitingChatBaseline_ACU = false;
  // 重置 loopState
  loopState_ACU.isLooping = false;
  loopState_ACU.isRetrying = false;
  loopState_ACU.timerId = null;
  loopState_ACU.retryCount = 0;
  loopState_ACU.startTime = 0;
  loopState_ACU.totalDuration = 0;
  loopState_ACU.tickInterval = null;
  loopState_ACU.awaitingReply = false;
  // 重置 planningGuard
  planningGuard_ACU.inProgress = false;
  planningGuard_ACU.ignoreNextGenerationEndedCount = 0;
  // 重置 activeAbortControllers
  activeAbortControllers_ACU.clear();
});

// ═══ 常量验证 ═══
describe('常量导出', () => {
  it('NEW_MESSAGE_DEBOUNCE_DELAY_ACU 为 500', () => {
    expect(NEW_MESSAGE_DEBOUNCE_DELAY_ACU).toBe(500);
  });

  it('USER_SEND_TRIGGER_TTL_MS_ACU 为 12000', () => {
    expect(USER_SEND_TRIGGER_TTL_MS_ACU).toBe(12000);
  });
});

// ═══ isRecentUserSendIntent_ACU ═══
describe('isRecentUserSendIntent_ACU', () => {

  it('超过 TTL 后返回 false', () => {
    generationGate_ACU.lastUserSendIntentAt = Date.now() - USER_SEND_TRIGGER_TTL_MS_ACU - 1;
    expect(isRecentUserSendIntent_ACU()).toBe(false);
  });
});

// ═══ recordLastUserSend_ACU ═══
describe('recordLastUserSend_ACU', () => {

  it('消息不是用户消息时不记录', () => {
    mockGetChatArray.mockReturnValue([{ is_user: false, mes: 'AI回复' }]);
    recordLastUserSend_ACU(0);
    expect(generationGate_ACU.lastUserMessageId).toBeNull();
  });

  it('mes 为 undefined 时记录空字符串', () => {
    const chat = [{ is_user: true }];
    mockGetChatArray.mockReturnValue(chat);
    recordLastUserSend_ACU(0);
    expect(generationGate_ACU.lastUserMessageText).toBe('');
  });
});

// ═══ recordGenerationContext_ACU ═══
describe('recordGenerationContext_ACU', () => {

  it('前台生成结束时先消费自身上下文，后续 quiet 生成不影响本轮判定', () => {
    recordGenerationContext_ACU('normal', {}, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(true);

    recordGenerationContext_ACU('quiet', { quiet_prompt: '第三方插件后台任务' }, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });

  it('dry-run 上下文不入配对：真实 STARTED 之后插入的 dry-run 不会吞掉真实 ENDED', () => {
    const real = recordGenerationContext_ACU('normal', {}, false);
    // 宿主 token 计数的 dry-run：只派发 STARTED、不发 ENDED
    recordGenerationContext_ACU('normal', {}, true);

    const consumed = consumeGenerationContextForEnded_ACU();
    expect(consumed?.seq).toBe(real.seq);
    expect(consumed?.dryRun).toBe(false);
    // dry-run 上下文已被丢掉，不再残留为下一轮的幽灵配对
    expect(generationGate_ACU.activeGenerations).toHaveLength(0);
  });

  it('栈里只剩 dry-run 上下文时按无配对处理，不冒充真实生成', () => {
    recordGenerationContext_ACU('normal', {}, true);
    expect(consumeGenerationContextForEnded_ACU()).toBeNull();
  });

  it('dryRun 为非布尔真值时同样不入配对（与门控的真值口径同进同退）', () => {
    const real = recordGenerationContext_ACU('normal', {}, false);
    recordGenerationContext_ACU('normal', {}, 1 as any);
    expect(consumeGenerationContextForEnded_ACU()?.seq).toBe(real.seq);
  });

  it('GENERATION_STOPPED 同样跳过未闭合的 dry-run，返回真实上下文（桥侧绑定见 host-generation-bridge 单测）', () => {
    const real = recordGenerationContext_ACU('normal', {}, false);
    recordGenerationContext_ACU('normal', {}, true);   // dry-run：不会被「停止」，但会占住栈顶
    expect(discardLatestGenerationContext_ACU()?.seq).toBe(real.seq);
    expect(generationGate_ACU.activeGenerations).toHaveLength(0);
  });

});

// issue #2 实锤（debug 日志）：思考档开到 xhigh 时一次重新生成要 90~110 秒，超过 60 秒的上下文有效期，
// ENDED 变成「无配对」；TT 的消息没有 message_id，重新生成前后 AI 楼数又相同，于是被当成外部插件的
// 假 ENDED 丢掉（unpaired_ended_no_new_output），自动填表不跑。
describe('前台生成上下文的有效期', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('前台生成跑了 95 秒才结束，仍能配对到自己的上下文', () => {
    const regenerate = recordGenerationContext_ACU('regenerate', {}, false);
    vi.advanceTimersByTime(95_000);

    expect(resolveGenerationContextForEnded_ACU()).toEqual({ status: 'matched', context: regenerate });
  });

  it('长时间生成后，配对放行不受「楼数相同、无 message_id」的无配对收紧影响', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = { aiFloorCount: 6, latestAiMessageId: null };
    recordGenerationContext_ACU('regenerate', {}, false);
    vi.advanceTimersByTime(95_000);

    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(undefined, { aiFloorCount: 6, latestAiMessageId: null })).toBe(true);
  });

  it('quiet 上下文仍按 60 秒过期（后台生成未必有配对的 ENDED）', () => {
    recordGenerationContext_ACU('quiet', { quiet_prompt: '后台任务' }, false);
    vi.advanceTimersByTime(61_000);

    expect(resolveGenerationContextForEnded_ACU().status).toBe('none');
  });

  it('新的前台 STARTED 顶掉旧的未闭合前台上下文（宿主不会同时跑两个前台生成），不判歧义', () => {
    recordGenerationContext_ACU('normal', {}, false); // 例如早退的生成：发了 STARTED、没有 ENDED
    vi.advanceTimersByTime(120_000);
    const regenerate = recordGenerationContext_ACU('regenerate', {}, false);

    expect(resolveGenerationContextForEnded_ACU()).toEqual({ status: 'matched', context: regenerate });
  });

  it('dry-run 不顶掉在飞的前台上下文', () => {
    const real = recordGenerationContext_ACU('normal', {}, false);
    recordGenerationContext_ACU('normal', {}, true);

    expect(resolveGenerationContextForEnded_ACU().context?.seq).toBe(real.seq);
  });

  it('前台生成期间的 quiet 生成仍与前台并存（照旧按歧义处理），不被顶掉', () => {
    recordGenerationContext_ACU('normal', {}, false);
    recordGenerationContext_ACU('quiet', { quiet_prompt: '后台任务' }, false);

    expect(resolveGenerationContextForEnded_ACU().status).toBe('ambiguous');
  });

  it('前台上下文也有上限：30 分钟仍未结束则过期', () => {
    recordGenerationContext_ACU('normal', {}, false);
    vi.advanceTimersByTime(31 * 60_000);

    expect(resolveGenerationContextForEnded_ACU().status).toBe('none');
  });
});

describe('resolveGenerationContextForEnded_ACU — 并发结束配对', () => {
  const pre0 = { aiFloorCount: 2, latestAiMessageId: 20, latestContentHash: 'pre-0' };
  const pre1 = { aiFloorCount: 3, latestAiMessageId: 30, latestContentHash: 'pre-1' };
  const endedAfterOutput = { aiFloorCount: 3, latestAiMessageId: 31, latestContentHash: 'ended-1' };
  const endedQuiet = { aiFloorCount: 3, latestAiMessageId: 31, latestContentHash: 'ended-1' };

  it('normal 与 quiet 反向交错时不能 LIFO 吃掉 quiet，签名无法唯一证明则 fail closed', () => {
    recordGenerationContext_ACU('normal', {}, false, pre0);
    recordGenerationContext_ACU('quiet', { quiet_prompt: '后台任务' }, false, pre0);

    const result = resolveGenerationContextForEnded_ACU(endedAfterOutput);

    expect(result).toEqual({ status: 'ambiguous', context: null });
    expect(generationGate_ACU.activeGenerations).toHaveLength(0);
    // 反向到达的第二个 ENDED 也不得把已失配的 normal 当成 quiet 的后续收尾。
    expect(resolveGenerationContextForEnded_ACU(endedAfterOutput)).toEqual({ status: 'ambiguous', context: null });
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(undefined, endedAfterOutput)).toBe(false);
  });

  it('即使两个上下文的 preSignature 不同，ENDED 无 id 时仍不把较早 normal 误认成 quiet 的收尾', () => {
    recordGenerationContext_ACU('normal', {}, false, pre0);
    recordGenerationContext_ACU('quiet', { quiet_prompt: '后台任务' }, false, pre1);

    const result = resolveGenerationContextForEnded_ACU(endedQuiet);

    expect(result.status).toBe('ambiguous');
    expect(result.context).toBeNull();
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });

  it('只剩一个上下文时按唯一活动上下文配对，不受 preSignature 是否变化影响', () => {
    const normal = recordGenerationContext_ACU('normal', {}, false, pre0);

    expect(resolveGenerationContextForEnded_ACU(endedAfterOutput)).toEqual({
      status: 'matched',
      context: normal,
    });
  });
});

// ═══ isQuietLikeGeneration_ACU ═══
describe('isQuietLikeGeneration_ACU', () => {

  it('params.quiet_prompt 有内容时返回 true', () => {
    expect(isQuietLikeGeneration_ACU('normal', { quiet_prompt: '静默提示' })).toBe(true);
  });

  it('params.quiet_prompt 为纯空白时返回 false', () => {
    expect(isQuietLikeGeneration_ACU('normal', { quiet_prompt: '   ' })).toBe(false);
  });
});

// ═══ isRecentUserSend_ACU ═══
describe('isRecentUserSend_ACU', () => {

  it('超过 TTL 后返回 false', () => {
    generationGate_ACU.lastUserMessageAt = Date.now() - USER_SEND_TRIGGER_TTL_MS_ACU - 1;
    expect(isRecentUserSend_ACU()).toBe(false);
  });
});

// ═══ shouldProcessPlotForGeneration_ACU ═══
describe('shouldProcessPlotForGeneration_ACU', () => {

  it('本库停掉的那次发送：同一聊天的下一次「重新生成」补跑剧情推进；换了聊天或已清除则不补跑', () => {
    _set_settings_ACU({ plotSettings: { enabled: true } });
    mockGetChatArray.mockReturnValue([]);
    generationGate_ACU.lastUserMessageAt = 0;
    generationGate_ACU.lastUserSendIntentAt = 0;
    _set_currentChatFileIdentifier_ACU('chat-a');
    expect(shouldProcessPlotForGeneration_ACU('regenerate', {}, false)).toBe(false);
    markStoppedSendForRetry_ACU();
    expect(isRetryOfStoppedSend_ACU('regenerate')).toBe(true);
    expect(isRetryOfStoppedSend_ACU('normal')).toBe(false);
    expect(shouldProcessPlotForGeneration_ACU('regenerate', {}, false)).toBe(true);
    _set_currentChatFileIdentifier_ACU('chat-b');
    expect(shouldProcessPlotForGeneration_ACU('regenerate', {}, false)).toBe(false);
    _set_currentChatFileIdentifier_ACU('chat-a');
    clearStoppedSendRetry_ACU();
    expect(shouldProcessPlotForGeneration_ACU('regenerate', {}, false)).toBe(false);
  });

  it('无新鲜消息也无新鲜 intent 时返回 false', () => {
    _set_settings_ACU({ plotSettings: { enabled: true } });
    mockGetChatArray.mockReturnValue([]);
    generationGate_ACU.lastUserMessageAt = 0;
    generationGate_ACU.lastUserSendIntentAt = 0;
    expect(shouldProcessPlotForGeneration_ACU('normal', {}, false)).toBe(false);
  });
});

// ═══ shouldProcessAutoTableUpdateForGenerationEnded_ACU ═══
describe('shouldProcessAutoTableUpdateForGenerationEnded_ACU', () => {

  it('dry-run 上下文不入配对：其后 ENDED 走无配对路径（签名缺失时保守放行）', () => {
    recordGenerationContext_ACU('normal', {}, true);
    // dry-run 只发 STARTED、不发 ENDED（GENERATION_ENDED 唯一 emit 点 hideStopButton 带 NOOP 守卫）
    // ⇒ 它不能充当配对上下文，弹栈时被丢弃；「配对 dryRun ⇒ 跳过」现在只由显式传入上下文的判据承担
    // （见同族 describe 的 paired({ dryRun: true }) 用例）。
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(true);
    expect(generationGate_ACU.activeGenerations).toHaveLength(0);
  });

  it('quiet 类型时返回 false', () => {
    recordGenerationContext_ACU('quiet', {}, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });
});

// ═══ [152 收紧] 无配对 ENDED 必须有「新 AI 楼证据」═══
// 宿主 GENERATION_ENDED 唯一 emit 点 = hideStopButton，外部插件（酒馆助手 generate/generateRaw、
// sr 提示词查看器 Generate + stopGeneration、MVU 额外模型收尾）会凭空派发 ended。这些事件没有配对
// 上下文，此前一律放行去拉填表 + 正文替换链。收紧只作用于「无配对」子集：签名与上次放行完全相同即
// 零新 AI 楼 → 源头丢弃；配对（g 存在）路径的结论一字不动。
describe('shouldProcessAutoTableUpdateForGenerationEnded_ACU 无配对 ENDED 的新 AI 楼证据', () => {
  const signature = (aiFloorCount: number, latestAiMessageId: number | null) => ({ aiFloorCount, latestAiMessageId });
  const paired = (over: any = {}) => ({ seq: 1, type: 'normal', params: {}, dryRun: false, at: Date.now(), ...over });

  it('无配对 + 签名与上次放行完全相同 → 丢弃并记 unpaired_ended_no_new_output', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(2, 9))).toBe(false);
    expect(mockLogAutoFillSkip).toHaveBeenCalledWith('unpaired_ended_no_new_output', { aiFloorCount: 2, latestAiMessageId: 9 });
    // 拒绝不更新签名；同楼再来假 ended 仍稳定丢弃，不是只挡一次。
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(2, 9));
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(2, 9))).toBe(false);
    expect(mockLogAutoFillSkip).toHaveBeenCalledTimes(2);
  });

  it('切换 / 新建聊天后第一条无配对 ENDED 只立新聊天基线、不放行；之后有新 AI 楼才放行（移植上游 54366b0c）', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    markChatChangedForEndedGate_ACU();
    // 宿主载入新聊天时收起停止按钮派发的 ended：新聊天的楼层签名与旧聊天不同，但这不是一次生成
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(5, 30))).toBe(false);
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(5, 30));
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(5, 30))).toBe(false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(6, 32))).toBe(true);
  });

  it('切聊天后宿主没派发载入时的 ENDED：等基线过期作废，之后的真实回复不会被吞', () => {
    vi.useFakeTimers();
    try {
      generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
      markChatChangedForEndedGate_ACU();
      vi.advanceTimersByTime(60_000);
      expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(6, 32))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('切换聊天后有配对的真实生成照常放行，并结束「等基线」状态', () => {
    markChatChangedForEndedGate_ACU();
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(paired() as any, signature(3, 12))).toBe(true);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(4, 14))).toBe(true);
  });

  it('无配对 + AI 楼数增加 → 放行，并且放行时登记当次签名', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(3, 10))).toBe(true);
    expect(mockLogAutoFillSkip).not.toHaveBeenCalled();
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(3, 10));
    // 真产出之后紧跟的外部回声（同楼零产出）→ 按新签名丢弃。
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(3, 10))).toBe(false);
  });

  it('推演⑤：无配对 + 楼数相同但最新楼 message_id 变化（regenerate）→ 放行', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(2, 12))).toBe(true);
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(2, 12));
  });

  it('推演⑥：无配对 + message_id 未变但楼数增加（群聊代打 / 开场白新楼）→ 放行', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(3, 9))).toBe(true);
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(3, 9));
  });

  it('无配对 + 启动后首次（既有签名为 null）→ 保守放行并登记', () => {
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toBeNull();
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(2, 9))).toBe(true);
    expect(mockLogAutoFillSkip).not.toHaveBeenCalled();
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(2, 9));
  });

  it('推演④：无配对 + 只有 user 楼新增（查看器 send_if_empty）→ 签名不变 → 丢弃', () => {
    // 签名由调用方按 !is_user 口径算：user 楼不进 aiFloorCount，也不改最新 AI 楼 message_id。
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(2, 9))).toBe(false);
    expect(mockLogAutoFillSkip).toHaveBeenCalledTimes(1);
  });

  it('无配对 + 调用方没读聊天数组（签名 undefined/null）→ 逐字保持既有放行，且不抹掉既有签名', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null)).toBe(true);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, undefined)).toBe(true);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, null)).toBe(true);
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(2, 9));
    expect(mockLogAutoFillSkip).not.toHaveBeenCalled();
  });

  it('门控自行消费上下文的历史调用形状（省略 context）同样适用收紧规则', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(1, 3);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(undefined, signature(1, 3))).toBe(false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(undefined, signature(2, 4))).toBe(true);
  });

  it('配对上下文拒绝（dryRun / quiet / quiet_prompt / automatic_trigger）语义一字不变', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(paired({ dryRun: true }), signature(2, 9))).toBe(false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(paired({ type: 'quiet' }), signature(2, 9))).toBe(false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(paired({ params: { quiet_prompt: '静默' } }), signature(2, 9))).toBe(false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(paired({ params: { automatic_trigger: true } }), signature(2, 9))).toBe(false);
    // 配对拒绝不写无配对原因，也不登记签名。
    expect(mockLogAutoFillSkip).not.toHaveBeenCalled();
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(2, 9));
  });

  it('真实生成被未闭合的 dry-run 压在栈顶时仍放行（此前会双双静默跳过填表与正文替换）', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    recordGenerationContext_ACU('normal', {}, false);   // 真实生成的 STARTED
    recordGenerationContext_ACU('normal', {}, true);    // dry-run STARTED：宿主不发它的 ENDED
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(undefined, signature(3, 10))).toBe(true);
    expect(mockLogAutoFillSkip).not.toHaveBeenCalled();
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(3, 10));
  });

  it('栈里只剩 dry-run 上下文 + 零产出签名 → 仍按无配对丢弃（不误开自动链）', () => {
    generationGate_ACU.lastEndedFloorSignature_ACU = signature(2, 9);
    recordGenerationContext_ACU('normal', {}, true);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(undefined, signature(2, 9))).toBe(false);
    expect(mockLogAutoFillSkip).toHaveBeenCalledWith('unpaired_ended_no_new_output', { aiFloorCount: 2, latestAiMessageId: 9 });
  });

  it('配对普通生成即使零产出也照样放行（收紧不碰配对路径），但会登记当次签名', () => {
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(paired(), signature(2, 9))).toBe(true);
    expect(mockLogAutoFillSkip).not.toHaveBeenCalled();
    expect(generationGate_ACU.lastEndedFloorSignature_ACU).toEqual(signature(2, 9));
  });

  it('推演③：真实一轮（配对放行）之后，外部插件的同楼假 ended 在门控源头就被丢弃', () => {
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(paired(), signature(4, 11))).toBe(true);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(null, signature(4, 11))).toBe(false);
    expect(mockLogAutoFillSkip).toHaveBeenCalledWith('unpaired_ended_no_new_output', { aiFloorCount: 4, latestAiMessageId: 11 });
  });
});

// ═══ getCurrentIsolationKey_ACU ═══
describe('getCurrentIsolationKey_ACU', () => {
  it('隔离未启用时返回空字符串', () => {
    _set_settings_ACU({ dataIsolationEnabled: false, dataIsolationCode: 'abc' });
    expect(getCurrentIsolationKey_ACU()).toBe('');
  });

  it('隔离启用时返回隔离码', () => {
    _set_settings_ACU({ dataIsolationEnabled: true, dataIsolationCode: 'test_code' });
    expect(getCurrentIsolationKey_ACU()).toBe('test_code');
  });

  it('隔离启用但隔离码为空时返回空字符串', () => {
    _set_settings_ACU({ dataIsolationEnabled: true, dataIsolationCode: '' });
    expect(getCurrentIsolationKey_ACU()).toBe('');
  });
});

// ═══ Setter 函数 ═══
describe('Setter 函数', () => {

  it('自动填表与聊天变更防抖 timer 独立保存', async () => {
    const autoFillTimer = { kind: 'auto-fill' };
    const chatMutationTimer = { kind: 'chat-mutation' };

    _set_autoFillDebounceTimer_ACU(autoFillTimer);
    _set_chatMutationDebounceTimer_ACU(chatMutationTimer);

    const mod = await import('../../../src/service/runtime/state-manager');
    expect(mod.autoFillDebounceTimer_ACU).toBe(autoFillTimer);
    expect(mod.chatMutationDebounceTimer_ACU).toBe(chatMutationTimer);

    _set_autoFillDebounceTimer_ACU(null);
    _set_chatMutationDebounceTimer_ACU(null);
  });
});

// ═══ AbortController 管理 ═══
describe('AbortController 管理', () => {
  it('trackAbortController_ACU 添加到集合', () => {
    const controller = { abort: vi.fn() };
    trackAbortController_ACU(controller);
    expect(activeAbortControllers_ACU.has(controller)).toBe(true);
  });

  it('trackAbortController_ACU null 不添加', () => {
    trackAbortController_ACU(null);
    expect(activeAbortControllers_ACU.size).toBe(0);
  });

  it('untrackAbortController_ACU 从集合移除', () => {
    const controller = { abort: vi.fn() };
    trackAbortController_ACU(controller);
    untrackAbortController_ACU(controller);
    expect(activeAbortControllers_ACU.has(controller)).toBe(false);
  });

  it('untrackAbortController_ACU null 不报错', () => {
    expect(() => untrackAbortController_ACU(null)).not.toThrow();
  });

  it('abortAllActiveRequests_ACU 中止所有并清空', () => {
    const c1 = { abort: vi.fn() };
    const c2 = { abort: vi.fn() };
    trackAbortController_ACU(c1);
    trackAbortController_ACU(c2);
    abortAllActiveRequests_ACU();
    expect(c1.abort).toHaveBeenCalled();
    expect(c2.abort).toHaveBeenCalled();
    expect(activeAbortControllers_ACU.size).toBe(0);
  });

  it('R10A-19：abortAllActiveRequests_ACU({ keepPlot: true }) 只中止填表请求，剧情推进请求保留在登记中', () => {
    const table = { abort: vi.fn() };
    const plot = { abort: vi.fn() };
    trackAbortController_ACU(table);
    trackAbortController_ACU(plot, 'plot');

    abortAllActiveRequests_ACU({ keepPlot: true });

    expect(table.abort).toHaveBeenCalled();
    expect(plot.abort).not.toHaveBeenCalled();
    expect(activeAbortControllers_ACU.has(plot)).toBe(true);
    abortAllActiveRequests_ACU();
    expect(plot.abort).toHaveBeenCalled();
    expect(activeAbortControllers_ACU.size).toBe(0);
  });

  it('终止填表锁存到本轮结束：一次性停止标记被复位后仍算已终止；本轮放开「正在填表」才解除', () => {
    const fill = { abort: vi.fn() };
    const plot = { abort: vi.fn() };
    trackAbortController_ACU(fill);
    trackAbortController_ACU(plot, 'plot');
    _set_isAutoUpdatingCard_ACU(true);
    requestTableFillStop_ACU();
    expect(fill.abort).toHaveBeenCalled();
    expect(plot.abort).not.toHaveBeenCalled();
    // 新一轮填表开跑 / 宿主新生成会复位一次性标记
    _set_wasStoppedByUser_ACU(false);
    expect(isTableFillStopRequested_ACU()).toBe(true);
    // 「终止」不再立即放开「正在填表」，旧轮收尾期间新一轮进不来
    expect(isAutoUpdatingCard_ACU).toBe(true);
    _set_isAutoUpdatingCard_ACU(false);
    expect(isTableFillStopRequested_ACU()).toBe(false);
    abortAllActiveRequests_ACU();
  });

  it('终止后本轮迟迟不结束：30 秒后仍是同一轮就强制放开；期间已换新一轮则不动', () => {
    vi.useFakeTimers();
    try {
      _set_isAutoUpdatingCard_ACU(true);
      requestTableFillStop_ACU();
      vi.advanceTimersByTime(29_000);
      expect(isAutoUpdatingCard_ACU).toBe(true);
      vi.advanceTimersByTime(2_000);
      expect(isAutoUpdatingCard_ACU).toBe(false);

      _set_isAutoUpdatingCard_ACU(true);
      requestTableFillStop_ACU();
      _set_isAutoUpdatingCard_ACU(false);
      _set_isAutoUpdatingCard_ACU(true); // 新一轮
      vi.advanceTimersByTime(31_000);
      expect(isAutoUpdatingCard_ACU).toBe(true);
      _set_isAutoUpdatingCard_ACU(false);
    } finally {
      vi.useRealTimers();
      _set_wasStoppedByUser_ACU(false);
    }
  });

  it('abortAllActiveRequests_ACU 中止失败不影响其他', () => {
    const c1 = { abort: vi.fn(() => { throw new Error('abort error'); }) };
    const c2 = { abort: vi.fn() };
    trackAbortController_ACU(c1);
    trackAbortController_ACU(c2);
    expect(() => abortAllActiveRequests_ACU()).not.toThrow();
    expect(c2.abort).toHaveBeenCalled();
    expect(activeAbortControllers_ACU.size).toBe(0);
  });

  it('abortOnChatMutation_ACU 中止活跃请求并轮换全局信号（切聊天场景）', () => {
    const c = { abort: vi.fn() };
    trackAbortController_ACU(c);
    const s1 = getChatMutationAbortSignal_ACU();
    expect(s1).not.toBeNull();
    expect(s1!.aborted).toBe(false);

    abortOnChatMutation_ACU();

    // 活跃请求被中止且清空
    expect(c.abort).toHaveBeenCalled();
    expect(activeAbortControllers_ACU.size).toBe(0);
    // 旧信号已 abort，新请求拿到的是重建后的新信号
    expect(s1!.aborted).toBe(true);
    const s2 = getChatMutationAbortSignal_ACU();
    expect(s2).not.toBeNull();
    expect(s2!.aborted).toBe(false);
    expect(s2).not.toBe(s1);
  });
});

// ═══ planningGuard_ACU ═══
describe('planningGuard_ACU', () => {
  it('初始状态正确', () => {
    expect(planningGuard_ACU.inProgress).toBe(false);
    expect(planningGuard_ACU.ignoreNextGenerationEndedCount).toBe(0);
  });

  it('可以修改状态', () => {
    planningGuard_ACU.inProgress = true;
    planningGuard_ACU.ignoreNextGenerationEndedCount = 2;
    expect(planningGuard_ACU.inProgress).toBe(true);
    expect(planningGuard_ACU.ignoreNextGenerationEndedCount).toBe(2);
  });
});
