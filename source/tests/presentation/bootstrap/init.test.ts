// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  chatChanged: undefined as undefined | ((name: string) => Promise<void>),
  chatMutationHandler: undefined as undefined | ((data: any) => Promise<void>),
  chatDeletedHandler: undefined as undefined | (() => void),
  messageSentHandler: undefined as undefined | ((messageId: any) => void),
  generationStartedHandler: undefined as undefined | ((type: any, params: any, dryRun: any) => void),
  generationStoppedHandler: undefined as undefined | (() => void),
  generationEndedHandler: undefined as undefined | ((...args: any[]) => void),
  afterCommandsHandler: undefined as undefined | ((type: any, params: any, dryRun: any) => void),
  settingsReadyHandler: undefined as undefined | (() => void),
  currentChatKey: '',
  api: {
    chat: [] as any[],
    chatId: '',
    // 桥接线全集：init.ts 逐个 if (eventTypes.X) 注册，mock 缺一个对应分支就整段不可达（V4-e）。
    eventTypes: {
      CHAT_CHANGED: 'chat',
      CHAT_DELETED: 'chatdeleted',
      MESSAGE_DELETED: 'deleted',
      MESSAGE_SWIPED: 'swiped',
      MESSAGE_SENT: 'messagesent',
      CHAT_COMPLETION_SETTINGS_READY: 'settingsready',
      GENERATION_STARTED: 'genstarted',
      GENERATION_STOPPED: 'genstopped',
      GENERATION_ENDED: 'genended',
      GENERATION_AFTER_COMMANDS: 'aftercommands',
    },
    eventSource: { on: vi.fn(), makeFirst: vi.fn(), makeLast: vi.fn(), emit: vi.fn() },
  } as any,
  gate: { lastUserMessageId: 7 as any, lastUserMessageText: 'stale', lastUserMessageAt: 1, lastUserSendIntentAt: 2, lastGeneration: { stale: true } as any, generationSeq: 0, activeGenerations: [] as any[] },
  resetTakeover: vi.fn(), dispose: vi.fn(), setData: vi.fn(), setTables: vi.fn(), setMessages: vi.fn(), setTotal: vi.fn(), setChat: vi.fn(),
  setChatMutationTimer: vi.fn(),
  notify: vi.fn(), resetScript: vi.fn(), loadPreset: vi.fn(), loadMessages: vi.fn(), refresh: vi.fn(),
  preload: vi.fn(), shouldRebuild: vi.fn(), rebuild: vi.fn(), restoreFlush: vi.fn(),
  processBeforeGen: vi.fn(),
  orchestrate: vi.fn(),
  shouldProcessSummary: vi.fn(),
  captureVault: vi.fn(),
  dormantAudit: vi.fn(),
  clearAutoFillDebounce: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: m.api }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: m.notify } } }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect', () => ({ attemptToLoadCoreApis_ACU: vi.fn(() => true), handleNewMessageDebounced_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ ensureInitialSeedCheckpoint_ACU: vi.fn(), handleChatCompletionReady_ACU: vi.fn(), loadPresetAndCleanCharacterData_ACU: m.loadPreset }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  chatMutationDebounceTimer_ACU: null, _set_chatMutationDebounceTimer_ACU: m.setChatMutationTimer, generationGate_ACU: m.gate,
  get currentChatFileIdentifier_ACU() { return m.currentChatKey; }, currentJsonTableData_ACU: null, discardLatestGenerationContext_ACU: vi.fn(), markUserSendIntent_ACU: vi.fn(), isProcessing_Plot_ACU: false, isQuietLikeGeneration_ACU: vi.fn(), isRecentUserSendIntent_ACU: vi.fn(), recordGenerationContext_ACU: vi.fn(), recordLastUserSend_ACU: vi.fn(), settings_ACU: { plotSettings: {} }, shouldProcessAutoTableUpdateForGenerationEnded_ACU: vi.fn(), shouldProcessPlotForGeneration_ACU: vi.fn(), shouldProcessSummaryVectorIndexForGeneration_ACU: (...args: any[]) => m.shouldProcessSummary(...args),
  _set_allChatMessages_ACU: m.setMessages, _set_currentChatFileIdentifier_ACU: (value: string) => { m.currentChatKey = value; m.setChat(value); }, _set_currentJsonTableData_ACU: m.setData, _set_independentTableStates_ACU: m.setTables, _set_isProcessing_Plot_ACU: vi.fn(), _set_lastTotalAiMessages_ACU: m.setTotal, abortOnChatMutation_ACU: vi.fn(), clearAutoFillDebounce_ACU: (...args: any[]) => m.clearAutoFillDebounce(...args), getChatMutationAbortSignal_ACU: () => null,
}));
vi.mock('../../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: vi.fn(), loadSettings_ACU: vi.fn() }));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ resetScriptStateForNewChat_ACU: m.resetScript }));
vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({ resetPlotAgentWorldbookSessionSnapshot_ACU: m.resetTakeover }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ reloadStorageProvider: vi.fn(), disposeStorageProvider: m.dispose }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: vi.fn(() => false) }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: m.loadMessages }));
vi.mock('../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: m.refresh }));

vi.mock('../../../src/shared/defaults-json.js', () => ({ DEFAULT_PLOT_SETTINGS_ACU: { loopSettings: {} } }));
vi.mock('../../../src/shared/utils', () => ({ cleanChatName_ACU: vi.fn((name: string) => name), logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/service/plot/plot-orchestrator', () => ({ orchestrateAfterCommandsStrategy1_ACU: vi.fn(), orchestrateAfterCommandsStrategy2_ACU: vi.fn() }));
vi.mock('../../../src/shared/host-input', () => ({ getSendTextareaValue_ACU: vi.fn(), setSendTextareaValue_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/plot-planning-ui', () => ({ runOptimizationLogicWithUI_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/summary-vector-index-ui', () => ({ processSummaryVectorIndexBeforeGenerationWithUI_ACU: (...args: any[]) => m.processBeforeGen(...args), shouldRebuildSummaryVectorIndexWithUI_ACU: (...args: any[]) => m.shouldRebuild(...args), rebuildCurrentSummaryVectorIndexWithUI_ACU: (...args: any[]) => m.rebuild(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-cache-service', () => ({ preloadSummaryVectorIndexCacheForCurrentChat_ACU: (...args: any[]) => m.preload(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({ restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU: (...args: any[]) => m.restoreFlush(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-realign-state', () => ({ markSummaryVectorIndexDirtyForRealign_ACU: vi.fn() }));
vi.mock('../../../src/service/chat/checkpoint-delete-guard', () => ({ captureCheckpointVaultForCurrentChat_ACU: (...args: any[]) => m.captureVault(...args), installCheckpointDeleteGuard_ACU: vi.fn() }));
// 启动版本校验走真实网络（raw.githubusercontent），测试必须掐掉。
vi.mock('../../../src/service/runtime/version-update-check', () => ({ checkDatabaseUpdateOnStartup_ACU: vi.fn(async () => {}) }));
vi.mock('../../../src/service/template/dormant-data-service', () => ({ auditDormantDataIntegrity_ACU: (...args: any[]) => m.dormantAudit(...args) }));

beforeAll(async () => {
  document.body.innerHTML = '<button id="send_but"></button><textarea id="send_textarea"></textarea>';
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as any);
  m.api.eventSource.on.mockImplementation((event: string, callback: any) => {
    if (event === 'chat') m.chatChanged = callback;
    if (event === 'deleted' || event === 'swiped') m.chatMutationHandler = callback;
    if (event === 'chatdeleted') m.chatDeletedHandler = callback;
    if (event === 'messagesent') m.messageSentHandler = callback;
    if (event === 'genstarted') m.generationStartedHandler = callback;
    if (event === 'genstopped') m.generationStoppedHandler = callback;
    if (event === 'genended') m.generationEndedHandler = callback;
    if (event === 'aftercommands') m.afterCommandsHandler = callback;
    if (event === 'settingsready') m.settingsReadyHandler = callback;
  });
  m.api.eventSource.makeFirst.mockImplementation((event: string, callback: any) => {
    if (event === 'genended') m.generationEndedHandler = callback;
  });
  m.api.eventSource.makeLast.mockImplementation((event: string, callback: any) => {
    if (event === 'settingsready') m.settingsReadyHandler = callback;
  });
  const { mainInitialize_ACU } = await import('../../../src/presentation/bootstrap/init');
  mainInitialize_ACU();
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  m.api.chat = [];
  m.currentChatKey = '';
  m.preload.mockResolvedValue({ success: true, skipped: true, reason: 'no_manifest', chunkCount: 0 });
  m.shouldRebuild.mockReturnValue(false);
  m.rebuild.mockResolvedValue(undefined);
  m.restoreFlush.mockResolvedValue(0);
  m.dormantAudit.mockReturnValue({ ok: true, issues: [] });
  m.processBeforeGen.mockResolvedValue({ success: true, skipped: true, reason: 'no_index_state' });
  m.orchestrate.mockResolvedValue({ action: 'passthrough' });
  m.shouldProcessSummary.mockReturnValue(false);
  Object.assign(m.gate, { lastUserMessageId: 7, lastUserMessageText: 'stale', lastUserMessageAt: 1, lastUserSendIntentAt: 2, lastGeneration: { stale: true }, generationSeq: 3, activeGenerations: [{ seq: 3 }] });
});

describe('mainInitialize_ACU CHAT_CHANGED 无活动聊天早退', () => {
  it('无效聊天名且无消息时清理运行时，并阻止后续聊天加载', async () => {
    expect(m.chatChanged).toBeTypeOf('function');
    await m.chatChanged!('');

    expect(m.resetTakeover).toHaveBeenCalledOnce();
    expect(m.dispose).toHaveBeenCalledOnce();
    expect(m.setData).toHaveBeenCalledWith(null);
    expect(m.setTables).toHaveBeenCalledWith({});
    expect(m.setMessages).toHaveBeenCalledWith([]);
    expect(m.setTotal).toHaveBeenCalledWith(0);
    expect(m.setChat).toHaveBeenCalledWith('');
    expect(m.notify).toHaveBeenCalledOnce();
    expect(m.resetScript).not.toHaveBeenCalled();
    expect(m.loadPreset).not.toHaveBeenCalled();
    expect(m.loadMessages).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.gate).toEqual({ lastUserMessageId: null, lastUserMessageText: '', lastUserMessageAt: 0, lastUserSendIntentAt: 0, lastGeneration: null, generationSeq: 0, activeGenerations: [] });
  });

  it('无效聊天名但仍有消息时不误清理运行时', async () => {
    m.api.chat = [{ mes: 'still active' }];
    await m.chatChanged!('');

    expect(m.resetTakeover).not.toHaveBeenCalled();
    expect(m.dispose).not.toHaveBeenCalled();
    expect(m.resetScript).toHaveBeenCalledWith('');
    expect(m.loadPreset).toHaveBeenCalledOnce();
  });
});

describe('mainInitialize_ACU CHAT_CHANGED 向量 flush 恢复编排', () => {
  it('missing-file 指示普通重建时按 preload→rebuild 顺序执行且不恢复旧 flush task', async () => {
    vi.useFakeTimers();
    m.api.chat = [{ mes: 'active' }];
    m.resetScript.mockImplementation(async (chatKey: string) => { m.currentChatKey = chatKey; });
    m.preload.mockResolvedValue({ success: true, skipped: true, reason: 'external_files_missing_state_cleared_rebuild_required', chunkCount: 0, chatStateCleared: true });
    m.shouldRebuild.mockReturnValue(true);
    const order: string[] = [];
    m.preload.mockImplementation(async () => { order.push('preload'); return { success: true, skipped: true, reason: 'external_files_missing_state_cleared_rebuild_required', chunkCount: 0, chatStateCleared: true }; });
    m.rebuild.mockImplementation(async () => { order.push('rebuild'); });
    m.restoreFlush.mockImplementation(async () => { order.push('restore'); return 0; });

    await m.chatChanged!('chat-a');
    await vi.advanceTimersByTimeAsync(1200);

    expect(order).toEqual(['preload', 'rebuild']);
    expect(m.restoreFlush).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('state-clear-failed 时不恢复持久化旧 flush task', async () => {
    vi.useFakeTimers();
    m.api.chat = [{ mes: 'active' }];
    m.resetScript.mockImplementation(async (chatKey: string) => { m.currentChatKey = chatKey; });
    m.preload.mockResolvedValue({ success: false, skipped: true, reason: 'external_files_missing_state_clear_save_failed', chunkCount: 0, chatStateCleared: false });

    await m.chatChanged!('chat-a');
    await vi.advanceTimersByTimeAsync(1200);

    expect(m.rebuild).not.toHaveBeenCalled();
    expect(m.restoreFlush).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('mainInitialize_ACU CHAT_CHANGED S0-4/S3-3 收尾', () => {
  it('延迟重建完成后捕获 checkpoint 保管库并做休眠自检', async () => {
    vi.useFakeTimers();
    m.api.chat = [{ mes: 'active' }];
    m.resetScript.mockImplementation(async (chatKey: string) => { m.currentChatKey = chatKey; });

    await m.chatChanged!('chat-a');
    await vi.advanceTimersByTimeAsync(1200);

    expect(m.captureVault).toHaveBeenCalled();
    expect(m.dormantAudit).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('mainInitialize_ACU 聊天变更防抖', () => {
  it('CHAT_CHANGED 同步作废在途的自动填表防抖定时器', async () => {
    m.api.chat = [{ mes: 'active' }];

    await m.chatChanged!('chat-a');

    // 旧定时器只在下一次同类事件里被覆盖清除；切聊天链必须自己清，
    // 否则 500ms 窗口后会在刚打开的新聊天上按「末楼 - 1」兜底跑填表。
    expect(m.clearAutoFillDebounce).toHaveBeenCalledOnce();
  });

  it('删除或滑动事件仅设置聊天变更 timer，并在 trailing 窗口后执行一轮', async () => {
    vi.useFakeTimers();
    expect(m.chatMutationHandler).toBeTypeOf('function');

    await m.chatMutationHandler!({});

    expect(m.setChatMutationTimer).toHaveBeenCalledOnce();
    expect(m.refresh).not.toHaveBeenCalled();
    // T2 调度器 trailing 窗口为 1200ms（旧行为 500ms）
    await vi.advanceTimersByTimeAsync(1199);
    expect(m.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(m.refresh).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('mainInitialize_ACU 宿主事件桥接线注册', () => {
  // V4-e：mock eventTypes 此前只有 3 个事件，init.ts 的 GENERATION_*/MESSAGE_SENT/
  // CHAT_DELETED/SETTINGS_READY 接线分支在测试里整段不可达——回归零感知。
  it('全部宿主事件 handler 均完成注册（含 GENERATION 三态与 MESSAGE_SENT）', () => {
    expect(m.chatChanged).toBeTypeOf('function');
    expect(m.chatMutationHandler).toBeTypeOf('function');
    expect(m.chatDeletedHandler).toBeTypeOf('function');
    expect(m.messageSentHandler).toBeTypeOf('function');
    expect(m.generationStartedHandler).toBeTypeOf('function');
    expect(m.generationStoppedHandler).toBeTypeOf('function');
    expect(m.generationEndedHandler).toBeTypeOf('function');
    expect(m.afterCommandsHandler).toBeTypeOf('function');
    expect(m.settingsReadyHandler).toBeTypeOf('function');
  });
});

