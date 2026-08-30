import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  autoFillTimer: null as ReturnType<typeof setTimeout> | null,
  setAutoFillTimer: vi.fn((timer: ReturnType<typeof setTimeout>) => { m.autoFillTimer = timer; }),
  chatKey: 'chat-a',
  evaluateNewMessageAction: vi.fn(),
  resolveGeneratedAiMessageIndex: vi.fn(),
  logAutoFillSkip: vi.fn(),
  loadAllChatMessages: vi.fn(),
  triggerAutomaticUpdateIfNeeded: vi.fn(),
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  autoFillDebounceTimer_ACU: m.autoFillTimer,
  _set_autoFillDebounceTimer_ACU: m.setAutoFillTimer,
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  manualExtraHint_ACU: '',
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
  get currentChatFileIdentifier_ACU() { return m.chatKey; },
  getCurrentIsolationKey_ACU: () => '',
  coreApisAreReady_ACU: true,
  settings_ACU: { contentOptimizationSettings: {} },
}));
vi.mock('../../../src/service/runtime/message-handler', () => ({
  evaluateNewMessageAction_ACU: m.evaluateNewMessageAction,
  resolveGeneratedAiMessageIndex_ACU: m.resolveGeneratedAiMessageIndex,
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: m.loadAllChatMessages }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger', () => ({ triggerAutomaticUpdateIfNeeded_ACU: m.triggerAutomaticUpdateIfNeeded }));
vi.mock('../../../src/shared/trigger-diagnostics', () => ({ logAutoFillSkip_ACU: m.logAutoFillSkip }));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => [{ is_user: true }, { is_user: false }] }));
vi.mock('../../../src/shared/runtime-performance', () => ({ startRuntimePerformanceSpan_ACU: () => ({ id: 'span', end: vi.fn() }) }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ maybeLiftWorldbookSuppression_ACU: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  m.autoFillTimer = null;
  m.chatKey = 'chat-a';
});

describe('handleNewMessageDebounced_ACU 防抖隔离', () => {
  it('仅写入自动填表专用 timer 槽', async () => {
    vi.useFakeTimers();
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    await handleNewMessageDebounced_ACU('GENERATION_ENDED');

    expect(m.setAutoFillTimer).toHaveBeenCalledOnce();
    expect(m.autoFillTimer).not.toBeNull();
  });
});

describe('handleNewMessageDebounced_ACU 跨聊天身份复检', () => {
  beforeEach(() => {
    m.loadAllChatMessages.mockResolvedValue(undefined);
    m.evaluateNewMessageAction.mockReturnValue({ action: 'update_only', reason: 'ok', lastMessageIndex: 1 });
  });

  it('intent 缺失时仍复检聊天身份：切聊天后旧 debounce 不在新聊天上填表', async () => {
    vi.useFakeTimers();
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    // 排程时点在当前聊天；intent 缺失（宿主给的 message_id 不是整数）走的就是这条路。
    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED');
    // 防抖窗口内切了聊天。
    m.chatKey = 'chat-b';
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).toHaveBeenCalledWith('chat_changed', expect.objectContaining({ chatKey: 'chat-a' }));
    expect(m.evaluateNewMessageAction).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
  });

  it('intent 缺失但聊天未变时照常填表（复检不得误伤正常链路）', async () => {
    vi.useFakeTimers();
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).not.toHaveBeenCalled();
    expect(m.evaluateNewMessageAction).toHaveBeenCalledOnce();
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledOnce();
  });
});
