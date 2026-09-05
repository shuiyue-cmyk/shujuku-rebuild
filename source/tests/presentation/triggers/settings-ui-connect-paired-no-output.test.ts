/**
 * tests/presentation/triggers/settings-ui-connect-paired-no-output.test.ts
 * handleNewMessageDebounced_ACU「配对零产出」收紧的七项推演落测。
 *
 * 背景：sr 提示词查看器调宿主真 Generate('normal') → 宿主发真 GENERATION_STARTED →
 * 本库入栈 → 查看器 stopGeneration 先 hideStopButton 发 ENDED 后才发 STOPPED →
 * ENDED 消费到查看器自己的上下文走「配对路径」放行。STARTED 时刻冻结的 AI 楼三元组
 * （楼数/id/末楼内容哈希）随 intent.preSignature 携带；防抖到期时三元组完全相同
 * （含双 null）即零产出 → 跳过自动链并记 paired_ended_no_new_output。
 *
 * 推演：①查看器（配对+零产出）→跳过；②真生成（新楼）→放行；③swipe/同楼换内容
 * （id 同+hash 变）→放行；④regenerate（id 变）→放行；⑤新楼 mes 缺失双 null 但
 * count/id 同→跳过；⑥preSignature 缺失（旧上下文）→放行；⑦W5 重跑（无 intent）→不受影响。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  let chat: any[] = [];
  return {
    getChat: () => chat,
    setChat: (next: any[]) => { chat = next; },
    setAutoFillTimer: vi.fn(),
    loadAllChatMessages: vi.fn(),
    triggerAutomaticUpdateIfNeeded: vi.fn(),
    evaluateNewMessageAction: vi.fn(),
    resolveGeneratedAiMessageIndex: vi.fn(),
    logAutoFillSkip: vi.fn(),
    logDebug: vi.fn(),
    startRuntimePerformanceSpan: vi.fn(() => ({ id: 'span', end: vi.fn() })),
    maybeLiftWorldbookSuppression: vi.fn(),
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
  allChatMessages_ACU: [],
  coreApisAreReady_ACU: true,
  currentChatFileIdentifier_ACU: 'chat-a',
  currentJsonTableData_ACU: null,
  settings_ACU: { contentOptimizationSettings: {} },
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  getCurrentIsolationKey_ACU: () => '',
  _set_coreApisAreReady_ACU: vi.fn(),
  _set_lastTotalAiMessages_ACU: vi.fn(),
  _set_allChatMessages_ACU: vi.fn(),
  _set_currentChatFileIdentifier_AC: vi.fn(),
  _set_currentJsonTableData_ACU: vi.fn(),
  _set_independentTableStates_ACU: vi.fn(),
  _set_isProcessing_Plot_ACU: vi.fn(),
  _set_isAutoUpdatingCard_ACU: vi.fn(),
  _set_wasStoppedByUser_ACU: vi.fn(),
  _set_autoFillDebounceTimer_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(),
  generationGate_ACU: { lastGeneration: null },
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => m.getChat(),
  saveChatToHost_ACU: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: m.loadAllChatMessages,
}));

vi.mock('../../../src/service/runtime/message-handler', () => ({
  evaluateNewMessageAction_ACU: m.evaluateNewMessageAction,
  resolveGeneratedAiMessageIndex_ACU: m.resolveGeneratedAiMessageIndex,
}));

vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger', () => ({
  triggerAutomaticUpdateIfNeeded_ACU: m.triggerAutomaticUpdateIfNeeded,
}));

vi.mock('../../../src/shared/trigger-diagnostics', () => ({
  logAutoFillSkip_ACU: m.logAutoFillSkip,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: m.logDebug,
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(),
  cleanChatName_ACU: vi.fn(),
  escapeHtml_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/runtime-performance', () => ({
  startRuntimePerformanceSpan_ACU: m.startRuntimePerformanceSpan,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  maybeLiftWorldbookSuppression_ACU: m.maybeLiftWorldbookSuppression,
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  autoFillDebounceTimer_ACU: null,
  _set_autoFillDebounceTimer_ACU: m.setAutoFillTimer,
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  _set_wasStoppedByUser_ACU: vi.fn(),
  manualExtraHint_ACU: '',
  getCharCardPromptFromUI_ACU: vi.fn(),
  renderPromptSegments_ACU: vi.fn(),
}));

import { handleNewMessageDebounced_ACU } from '../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect';
import { resolveAiFloorSignatureEx_ACU } from '../../../src/service/table/auto-fill-echo-guard';

const user = { is_user: true, mes: '用户消息' };
const aiMsg = (id: number, mes?: any) => {
  const message: any = { is_user: false, message_id: id };
  if (mes !== undefined) message.mes = mes;
  return message;
};

const baseIntent = {
  eventMessageId: 1,
  chatKey: 'chat-a',
  isolationKey: '',
  capturedAt: Date.now(),
  capturedChatLength: 2,
  capturedAiFloorCount: 1,
};

function mockResolvedAt(messageIndex: number) {
  m.resolveGeneratedAiMessageIndex.mockReset();
  m.resolveGeneratedAiMessageIndex.mockReturnValue({ kind: 'resolved', messageIndex });
}

function mockUpdateOnly(lastMessageIndex: number) {
  m.evaluateNewMessageAction.mockReset();
  m.evaluateNewMessageAction.mockReturnValue({ action: 'update_only', reason: 'No content optimization configured', lastMessageIndex });
}

beforeEach(() => {
  vi.useFakeTimers();
  m.loadAllChatMessages.mockResolvedValue(undefined);
  m.triggerAutomaticUpdateIfNeeded.mockResolvedValue(undefined);
  m.triggerAutomaticUpdateIfNeeded.mockClear();
  m.logAutoFillSkip.mockReset();
  m.resolveGeneratedAiMessageIndex.mockReset();
  m.evaluateNewMessageAction.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('handleNewMessageDebounced_ACU 配对零产出收紧', () => {
  it('推演①：查看器（配对+零产出）→跳过自动链并记 paired_ended_no_new_output', async () => {
    const startChat = [user, aiMsg(10, '旧正文')];
    m.setChat(startChat);
    const preSignature = resolveAiFloorSignatureEx_ACU(startChat);
    mockResolvedAt(1);
    mockUpdateOnly(1);

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent, preSignature });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).toHaveBeenCalledWith(
      'paired_ended_no_new_output',
      expect.objectContaining({ eventType: 'GENERATION_ENDED', eventMessageId: 1, aiFloorCount: 1 }),
    );
    expect(m.evaluateNewMessageAction).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
  });

  it('推演②：真生成（新楼）→放行', async () => {
    const startChat = [user, aiMsg(10, '旧正文')];
    m.setChat([...startChat, aiMsg(11, '本轮新正文')]);
    const preSignature = resolveAiFloorSignatureEx_ACU(startChat);
    mockResolvedAt(2);
    mockUpdateOnly(2);

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent, preSignature });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).not.toHaveBeenCalledWith('paired_ended_no_new_output', expect.anything());
    expect(m.evaluateNewMessageAction).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('推演③：swipe/同楼换内容（id 同+hash 变）→放行', async () => {
    const startChat = [user, aiMsg(10, '旧正文')];
    m.setChat([user, aiMsg(10, 'swipe 后新正文')]);
    const preSignature = resolveAiFloorSignatureEx_ACU(startChat);
    mockResolvedAt(1);
    mockUpdateOnly(1);

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent, preSignature });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).not.toHaveBeenCalledWith('paired_ended_no_new_output', expect.anything());
    expect(m.evaluateNewMessageAction).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('推演④：regenerate（id 变）→放行', async () => {
    const startChat = [user, aiMsg(10, '旧正文')];
    m.setChat([user, aiMsg(11, '旧正文')]);
    const preSignature = resolveAiFloorSignatureEx_ACU(startChat);
    mockResolvedAt(1);
    mockUpdateOnly(1);

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent, preSignature });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).not.toHaveBeenCalledWith('paired_ended_no_new_output', expect.anything());
    expect(m.evaluateNewMessageAction).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('推演⑤：mes 缺失双 null 但 count/id 同→跳过', async () => {
    const startChat = [user, aiMsg(10)];
    m.setChat([user, aiMsg(10)]);
    const preSignature = resolveAiFloorSignatureEx_ACU(startChat);
    expect(preSignature.latestContentHash).toBeNull();
    mockResolvedAt(1);
    mockUpdateOnly(1);

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent, preSignature });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).toHaveBeenCalledWith(
      'paired_ended_no_new_output',
      expect.objectContaining({ eventType: 'GENERATION_ENDED' }),
    );
    expect(m.evaluateNewMessageAction).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
  });

  it('推演⑥：preSignature 缺失（旧上下文）→放行', async () => {
    m.setChat([user, aiMsg(10, '旧正文')]);
    mockResolvedAt(1);
    mockUpdateOnly(1);

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).not.toHaveBeenCalledWith('paired_ended_no_new_output', expect.anything());
    expect(m.evaluateNewMessageAction).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('推演⑦：W5 重跑（无 intent）→不受影响', async () => {
    m.setChat([user, aiMsg(10, '旧正文')]);
    mockUpdateOnly(1);

    const promise = handleNewMessageDebounced_ACU('MVU_ANALYSIS_ENDED');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).not.toHaveBeenCalledWith('paired_ended_no_new_output', expect.anything());
    expect(m.resolveGeneratedAiMessageIndex).not.toHaveBeenCalled();
    expect(m.evaluateNewMessageAction).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), undefined,
    );
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });
});
