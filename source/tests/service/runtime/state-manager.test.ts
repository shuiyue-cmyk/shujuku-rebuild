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
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU: '',
  DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU: '',
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
  markUserSendIntent_ACU,
  isRecentUserSendIntent_ACU,
  recordLastUserSend_ACU,
  recordGenerationContext_ACU,
  isQuietLikeGeneration_ACU,
  isRecentUserSend_ACU,
  shouldProcessPlotForGeneration_ACU,
  shouldProcessAutoTableUpdateForGenerationEnded_ACU,
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
  // [152 收紧] AI 楼签名是门控唯一的跨轮状态，每轮回到「启动后尚未放行」形态。
  // 清空后再断言一次：哪天有人把这个字段摘掉/改名（或换了个整对象重置），这里先红，
  // 而不是让「无配对 + 签名相同 → 丢弃」的用例静默假绿。
  generationGate_ACU.lastEndedFloorSignature_ACU = null;
  expect(generationGate_ACU.lastEndedFloorSignature_ACU).toBeNull();
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

// ═══ markUserSendIntent_ACU ═══
describe('markUserSendIntent_ACU', () => {
  it('设置 lastUserSendIntentAt 为当前时间', () => {
    const before = Date.now();
    markUserSendIntent_ACU();
    const after = Date.now();
    expect(generationGate_ACU.lastUserSendIntentAt).toBeGreaterThanOrEqual(before);
    expect(generationGate_ACU.lastUserSendIntentAt).toBeLessThanOrEqual(after);
  });
});

// ═══ isRecentUserSendIntent_ACU ═══
describe('isRecentUserSendIntent_ACU', () => {
  it('未设置 intent 时返回 false', () => {
    generationGate_ACU.lastUserSendIntentAt = 0;
    expect(isRecentUserSendIntent_ACU()).toBe(false);
  });

  it('刚设置的 intent 返回 true', () => {
    markUserSendIntent_ACU();
    expect(isRecentUserSendIntent_ACU()).toBe(true);
  });

  it('超过 TTL 后返回 false', () => {
    generationGate_ACU.lastUserSendIntentAt = Date.now() - USER_SEND_TRIGGER_TTL_MS_ACU - 1;
    expect(isRecentUserSendIntent_ACU()).toBe(false);
  });
});

// ═══ recordLastUserSend_ACU ═══
describe('recordLastUserSend_ACU', () => {
  it('chat 为空时不记录', () => {
    mockGetChatArray.mockReturnValue([]);
    recordLastUserSend_ACU(0);
    expect(generationGate_ACU.lastUserMessageId).toBeNull();
  });

  it('messageId 不是数字时不记录', () => {
    mockGetChatArray.mockReturnValue([{ is_user: true, mes: 'hello' }]);
    recordLastUserSend_ACU('abc' as any);
    expect(generationGate_ACU.lastUserMessageId).toBeNull();
  });

  it('消息不是用户消息时不记录', () => {
    mockGetChatArray.mockReturnValue([{ is_user: false, mes: 'AI回复' }]);
    recordLastUserSend_ACU(0);
    expect(generationGate_ACU.lastUserMessageId).toBeNull();
  });

  it('有效用户消息时记录', () => {
    const chat = [{ is_user: true, mes: '你好' }];
    mockGetChatArray.mockReturnValue(chat);
    const before = Date.now();
    recordLastUserSend_ACU(0);
    const after = Date.now();
    expect(generationGate_ACU.lastUserMessageId).toBe(0);
    expect(generationGate_ACU.lastUserMessageText).toBe('你好');
    expect(generationGate_ACU.lastUserMessageAt).toBeGreaterThanOrEqual(before);
    expect(generationGate_ACU.lastUserMessageAt).toBeLessThanOrEqual(after);
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
  it('记录生成上下文', () => {
    const before = Date.now();
    recordGenerationContext_ACU('normal', { prompt: 'test' }, false);
    const after = Date.now();
    expect(generationGate_ACU.lastGeneration).toBeDefined();
    expect(generationGate_ACU.lastGeneration.type).toBe('normal');
    expect(generationGate_ACU.lastGeneration.params).toEqual({ prompt: 'test' });
    expect(generationGate_ACU.lastGeneration.dryRun).toBe(false);
    expect(generationGate_ACU.lastGeneration.at).toBeGreaterThanOrEqual(before);
    expect(generationGate_ACU.lastGeneration.at).toBeLessThanOrEqual(after);
  });

  it('前台生成结束时先消费自身上下文，后续 quiet 生成不影响本轮判定', () => {
    recordGenerationContext_ACU('normal', {}, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(true);

    recordGenerationContext_ACU('quiet', { quiet_prompt: '第三方插件后台任务' }, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });

});

// ═══ isQuietLikeGeneration_ACU ═══
describe('isQuietLikeGeneration_ACU', () => {
  it('type 为 quiet 时返回 true', () => {
    expect(isQuietLikeGeneration_ACU('quiet', {})).toBe(true);
  });

  it('params.quiet_prompt 有内容时返回 true', () => {
    expect(isQuietLikeGeneration_ACU('normal', { quiet_prompt: '静默提示' })).toBe(true);
  });

  it('params.quiet_prompt 为空字符串时返回 false', () => {
    expect(isQuietLikeGeneration_ACU('normal', { quiet_prompt: '' })).toBe(false);
  });

  it('params.quiet_prompt 为纯空白时返回 false', () => {
    expect(isQuietLikeGeneration_ACU('normal', { quiet_prompt: '   ' })).toBe(false);
  });

  it('普通生成返回 false', () => {
    expect(isQuietLikeGeneration_ACU('normal', {})).toBe(false);
  });

  it('params 为 null 时返回 false', () => {
    expect(isQuietLikeGeneration_ACU('normal', null)).toBe(false);
  });
});

// ═══ isRecentUserSend_ACU ═══
describe('isRecentUserSend_ACU', () => {
  it('未记录用户消息时返回 false', () => {
    generationGate_ACU.lastUserMessageAt = 0;
    expect(isRecentUserSend_ACU()).toBe(false);
  });

  it('刚记录的用户消息返回 true', () => {
    generationGate_ACU.lastUserMessageAt = Date.now();
    expect(isRecentUserSend_ACU()).toBe(true);
  });

  it('超过 TTL 后返回 false', () => {
    generationGate_ACU.lastUserMessageAt = Date.now() - USER_SEND_TRIGGER_TTL_MS_ACU - 1;
    expect(isRecentUserSend_ACU()).toBe(false);
  });
});

// ═══ shouldProcessPlotForGeneration_ACU ═══
describe('shouldProcessPlotForGeneration_ACU', () => {
  it('dryRun 时返回 false', () => {
    expect(shouldProcessPlotForGeneration_ACU('normal', {}, true)).toBe(false);
  });

  it('plotSettings 未启用时返回 false', () => {
    // settings_ACU.plotSettings.enabled 默认可能为 undefined
    _set_settings_ACU({ plotSettings: { enabled: false } });
    expect(shouldProcessPlotForGeneration_ACU('normal', {}, false)).toBe(false);
  });

  it('quiet 类型生成时返回 false', () => {
    _set_settings_ACU({ plotSettings: { enabled: true } });
    expect(shouldProcessPlotForGeneration_ACU('quiet', {}, false)).toBe(false);
  });

  it('automatic_trigger 时返回 false', () => {
    _set_settings_ACU({ plotSettings: { enabled: true } });
    expect(shouldProcessPlotForGeneration_ACU('normal', { automatic_trigger: true }, false)).toBe(false);
  });

  it('有新鲜用户消息时返回 true', () => {
    _set_settings_ACU({ plotSettings: { enabled: true } });
    const chat = [{ is_user: true, mes: '你好' }];
    mockGetChatArray.mockReturnValue(chat);
    generationGate_ACU.lastUserMessageId = 0;
    generationGate_ACU.lastUserMessageAt = Date.now();
    expect(shouldProcessPlotForGeneration_ACU('normal', {}, false)).toBe(true);
  });

  it('有新鲜 intent 时返回 true', () => {
    _set_settings_ACU({ plotSettings: { enabled: true } });
    mockGetChatArray.mockReturnValue([]);
    generationGate_ACU.lastUserSendIntentAt = Date.now();
    expect(shouldProcessPlotForGeneration_ACU('normal', {}, false)).toBe(true);
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
  it('无 lastGeneration 时返回 true', () => {
    generationGate_ACU.lastGeneration = null;
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(true);
  });

  it('dryRun 时返回 false', () => {
    recordGenerationContext_ACU('normal', {}, true);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });

  it('quiet 类型时返回 false', () => {
    recordGenerationContext_ACU('quiet', {}, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });

  it('quiet_prompt 有内容时返回 false', () => {
    recordGenerationContext_ACU('normal', { quiet_prompt: '静默' }, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });

  it('automatic_trigger 时返回 false', () => {
    recordGenerationContext_ACU('normal', { automatic_trigger: true }, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(false);
  });

  it('正常生成时返回 true', () => {
    recordGenerationContext_ACU('normal', {}, false);
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU()).toBe(true);
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
  it('_set_settings_ACU 更新 settings', () => {
    const newSettings = { apiConfig: { url: 'http://test' } };
    _set_settings_ACU(newSettings);
    // 通过 getCurrentIsolationKey_ACU 间接验证 settings 已更新
    expect(getCurrentIsolationKey_ACU()).toBe('');
  });

  it('_set_pendingBaseStatePlacement_ACU 更新状态', async () => {
    const { pendingBaseStatePlacement_ACU: before } = await import('../../../src/service/runtime/state-manager');
    _set_pendingBaseStatePlacement_ACU(true);
    const mod = await import('../../../src/service/runtime/state-manager');
    expect(mod.pendingBaseStatePlacement_ACU).toBe(true);
    _set_pendingBaseStatePlacement_ACU(false);
  });

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

  it('abortAllActiveRequests_ACU 中止失败不影响其他', () => {
    const c1 = { abort: vi.fn(() => { throw new Error('abort error'); }) };
    const c2 = { abort: vi.fn() };
    trackAbortController_ACU(c1);
    trackAbortController_ACU(c2);
    expect(() => abortAllActiveRequests_ACU()).not.toThrow();
    expect(c2.abort).toHaveBeenCalled();
    expect(activeAbortControllers_ACU.size).toBe(0);
  });

  it('abortOnChatMutation_ACU 中止活跃请求并轮换全局信号（删楼/ROLL/切聊天场景）', () => {
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
