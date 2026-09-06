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
  mvuStartedHandler: undefined as undefined | ((...args: any[]) => void),
  mvuEndedHandler: undefined as undefined | ((...args: any[]) => void),
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
  runtimeOnlyFlush: vi.fn(async () => ({ flushed: false, sheetKeys: [] })),
  ensureSeedCheckpoint: vi.fn(async () => false),
  recordGenerationContext: vi.fn(() => ({ seq: 1 })),
  consumeGenerationContext: vi.fn(() => ({ seq: 3, type: 'normal', params: {}, dryRun: false, at: 1 })),
  continuationBridge: undefined as undefined | { onGenerationStarted: any; claimsGenerationEnded: any; onGenerationEnded: any },
  handleNewMessage: vi.fn(),
  wasStoppedByUser: false,
  setWasStoppedByUser: vi.fn((value: boolean) => { m.wasStoppedByUser = value; }),
}));

vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: m.api }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: m.notify } } }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect', () => ({ attemptToLoadCoreApis_ACU: vi.fn(() => true), handleNewMessageDebounced_ACU: (...args: any[]) => m.handleNewMessage(...args) }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ ensureInitialSeedCheckpoint_ACU: (...args: any[]) => m.ensureSeedCheckpoint(...args), handleChatCompletionReady_ACU: vi.fn(), loadPresetAndCleanCharacterData_ACU: m.loadPreset }));
vi.mock('../../../src/service/table/runtime-only-pending-flush', () => ({ flushRuntimeOnlyPendingChanges_ACU: (...args: any[]) => m.runtimeOnlyFlush(...args) }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  chatMutationDebounceTimer_ACU: null, _set_chatMutationDebounceTimer_ACU: m.setChatMutationTimer, generationGate_ACU: m.gate,
  get currentChatFileIdentifier_ACU() { return m.currentChatKey; }, currentJsonTableData_ACU: null, consumeGenerationContextForEnded_ACU: (...args: any[]) => m.consumeGenerationContext(...args), discardLatestGenerationContext_ACU: vi.fn(), getCurrentIsolationKey_ACU: vi.fn(() => ''), markUserSendIntent_ACU: vi.fn(), isProcessing_Plot_ACU: false, isQuietLikeGeneration_ACU: vi.fn(), isRecentUserSendIntent_ACU: vi.fn(), recordGenerationContext_ACU: m.recordGenerationContext, recordLastUserSend_ACU: vi.fn(), settings_ACU: { plotSettings: {} }, shouldProcessAutoTableUpdateForGenerationEnded_ACU: vi.fn(), shouldProcessPlotForGeneration_ACU: vi.fn(), shouldProcessSummaryVectorIndexForGeneration_ACU: (...args: any[]) => m.shouldProcessSummary(...args),
  _set_allChatMessages_ACU: m.setMessages, _set_currentChatFileIdentifier_ACU: (value: string) => { m.currentChatKey = value; m.setChat(value); }, _set_currentJsonTableData_ACU: m.setData, _set_independentTableStates_ACU: m.setTables, _set_isProcessing_Plot_ACU: vi.fn(), _set_lastTotalAiMessages_ACU: m.setTotal, _set_wasStoppedByUser_ACU: m.setWasStoppedByUser, abortOnChatMutation_ACU: vi.fn(), clearAutoFillDebounce_ACU: (...args: any[]) => m.clearAutoFillDebounce(...args), getChatMutationAbortSignal_ACU: () => null,
}));
vi.mock('../../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: vi.fn(), loadSettings_ACU: vi.fn(), isSettingsStorageReadyForSave_ACU: vi.fn(() => true) }));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ resetScriptStateForNewChat_ACU: m.resetScript }));
// 续写宿主生成桥注册表：默认无注册实例（get 返回 undefined，init.ts 的 ?. 全部短路），
// 需要观测事件分类的用例把 m.continuationBridge 换成带 spy 的对象即可。
// register 必须返回可用的注销闭包——continuation-runtime 创建真实桥时会拿它做 dispose。
vi.mock('../../../src/service/continuation/host-generation-bridge-registry', () => ({
  registerContinuationHostGenerationBridge_ACU: vi.fn(() => () => undefined),
  getContinuationHostGenerationBridge_ACU: () => m.continuationBridge,
  resetContinuationHostGenerationBridgeForTests_ACU: vi.fn(),
}));
vi.mock('../../../src/service/continuation/internal-ai-events', () => ({ bindContinuationInternalAiGenerationStarted_ACU: vi.fn(), consumeContinuationInternalAiGenerationEnded_ACU: vi.fn(() => null) }));
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
    if (event === 'mag_variable_update_started') m.mvuStartedHandler = callback;
    if (event === 'mag_variable_update_ended') m.mvuEndedHandler = callback;
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
  m.wasStoppedByUser = false;
  // 事件桥与生成上下文消费口每轮回到「无注册桥 / 无上下文」的默认形态，
  // 避免续写事件用例的 mock 实现泄漏到后面的用例。
  m.continuationBridge = undefined;
  m.consumeGenerationContext.mockReturnValue(undefined);
  m.recordGenerationContext.mockReturnValue({ seq: 1 });
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
    expect(m.resetScript).toHaveBeenCalledWith('', { reason: 'chat_changed' });
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

// 自动填表按「终止」后 wasStoppedByUser 残留 true，评估闸会永久 user_aborted；
// 宿主每轮生成必须清掉上一轮残留，且必须早于本轮生成上下文记录，否则同轮仍按残留判定。
// 开局脚本可能只把行写进运行时（skipChatSave / isImportMode）。seed checkpoint 建立后会
// 从聊天重载运行时，未落盘的行会被直接丢弃，因此 seed 之前必须先物化回聊天。
describe('mainInitialize_ACU seed 前物化 runtime-only 未落盘变更', () => {
  async function armSeedGate() {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.isRecentUserSendIntent_ACU).mockReturnValue(true);
    vi.mocked(sm.isQuietLikeGeneration_ACU).mockReturnValue(false);
    vi.mocked(sm.shouldProcessPlotForGeneration_ACU).mockReturnValue(false);
  }

  it('GENERATION_AFTER_COMMANDS 在建立 seed checkpoint 之前先写回运行时未落盘变更', async () => {
    expect(m.afterCommandsHandler).toBeTypeOf('function');
    await armSeedGate();
    m.runtimeOnlyFlush.mockResolvedValue({ flushed: true, sheetKeys: ['sheet_a'] });
    m.ensureSeedCheckpoint.mockResolvedValue(false);

    await m.afterCommandsHandler!('text', {}, false);

    expect(m.runtimeOnlyFlush).toHaveBeenCalledWith('generation_after_commands_before_ai');
    expect(m.ensureSeedCheckpoint).toHaveBeenCalledTimes(1);
    expect(m.runtimeOnlyFlush.mock.invocationCallOrder[0])
      .toBeLessThan(m.ensureSeedCheckpoint.mock.invocationCallOrder[0]);
  });

  it('写回异常只记警告，不阻断 seed checkpoint 初始化', async () => {
    await armSeedGate();
    m.runtimeOnlyFlush.mockRejectedValue(new Error('flush exploded'));
    m.ensureSeedCheckpoint.mockResolvedValue(false);

    await m.afterCommandsHandler!('text', {}, false);

    expect(m.runtimeOnlyFlush).toHaveBeenCalledTimes(1);
    expect(m.ensureSeedCheckpoint).toHaveBeenCalledTimes(1);
  });
});

describe('mainInitialize_ACU GENERATION_STARTED 复位终止残留', () => {
  it('宿主开始生成时把残留 true 复位为 false', () => {
    m.wasStoppedByUser = true;

    m.generationStartedHandler!('text', {}, false);

    expect(m.setWasStoppedByUser).toHaveBeenCalledWith(false);
    expect(m.wasStoppedByUser).toBe(false);
    expect(m.setWasStoppedByUser.mock.invocationCallOrder[0])
      .toBeLessThan(m.recordGenerationContext.mock.invocationCallOrder[0]);
  });
});

// [152 收紧] GENERATION_ENDED 监听器必须把「新 AI 楼证据」签名交给门控：宿主 ended 只由 hideStopButton
// 派发，外部插件（sr 提示词查看器直接 Generate + stopGeneration、酒馆助手 generate/generateRaw、MVU 额外
// 模型收尾）会凭空补一条无配对的 ended，此前一律放行去拉填表 + 正文替换链，W1/W3 判重拦不住「该楼未处理过 /
// 首轮在飞」。签名由监听器读一次聊天数组派生（!is_user 口径，含 narrator），门控据此丢弃零产出假事件。
describe('mainInitialize_ACU GENERATION_ENDED 无配对假事件收紧', () => {
  // 本组用例会改写「内部 ended 专吞」的返回值并挂假定时器，无论断言是否命中都必须还原，
  // 否则后面的 GENERATION_ENDED 用例会静默早退（mockReturnValue 不是 vi.clearAllMocks 能清掉的）。
  afterEach(async () => {
    vi.useRealTimers();
    const internal = await import('../../../src/service/continuation/internal-ai-events');
    vi.mocked(internal.consumeContinuationInternalAiGenerationEnded_ACU).mockReturnValue(null);
  });

  it('监听器把事件时刻的 AI 楼签名交给门控（含 narrator 口径）', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    m.consumeGenerationContext.mockReturnValue(null);
    m.api.chat = [
      { is_user: false, message_id: 5 },
      { is_user: true, message_id: 6 },
      { is_user: false, extra: { type: 'narrator' }, message_id: 7 },
    ];

    m.generationEndedHandler!(8);

    expect(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).toHaveBeenCalledWith(null, { aiFloorCount: 2, latestAiMessageId: 7 });
    expect(m.handleNewMessage).toHaveBeenCalledTimes(1);
    expect(m.handleNewMessage).toHaveBeenCalledWith('GENERATION_ENDED', expect.objectContaining({ eventMessageId: 8 }));
  });

  it('无配对 + 门控判「零产出」丢弃时不再派发自动填表链（不再烧填表 / 正文替换 AI）', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(false);
    m.consumeGenerationContext.mockReturnValue(null);
    m.api.chat = [{ is_user: false, message_id: 5 }];

    m.generationEndedHandler!(6);

    expect(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).toHaveBeenCalledTimes(1);
    expect(m.handleNewMessage).not.toHaveBeenCalled();
  });

  it('签名按每次事件实时读取：新 AI 楼落地后交给门控的签名随之变化', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    m.consumeGenerationContext.mockReturnValue(null);
    m.api.chat = [{ is_user: false, message_id: 5 }];
    m.generationEndedHandler!(6);
    m.api.chat = [
      { is_user: false, message_id: 5 },
      { is_user: true, message_id: 6 },
      { is_user: false, message_id: 7 },
    ];
    m.generationEndedHandler!(8);

    const forwarded = vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mock.calls.map((call: any) => call[1]);
    expect(forwarded).toEqual([
      { aiFloorCount: 1, latestAiMessageId: 5 },
      { aiFloorCount: 2, latestAiMessageId: 7 },
    ]);
  });

  it('推演②：续写内部生成的 ended 仍在门控之前被专吞（不读签名、不派发）', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    const internal = await import('../../../src/service/continuation/internal-ai-events');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    // 本楼属于续写链内部的交火生成：门控拿不到这次 ended，签名也就无从计算。
    vi.mocked(internal.consumeContinuationInternalAiGenerationEnded_ACU)
      .mockReturnValue({ source: 'continuation_bridge', requestId: 'r-1' } as any);

    m.generationEndedHandler!(42);

    expect(m.consumeGenerationContext).toHaveBeenCalledOnce();
    expect(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).not.toHaveBeenCalled();
    expect(m.handleNewMessage).not.toHaveBeenCalled();
  });

  // 推演①：W5「MVU 解析完成 → 联动重跑」走 handleNewMessageDebounced_ACU 统一入口，
  // 不经 GENERATION_ENDED 门控，因此本次收紧不会把权威重跑轮一起丢掉。
  it('W5 MVU 解析结束的联动重跑不查询本门控', async () => {
    vi.useFakeTimers();
    const sm = await import('../../../src/service/runtime/state-manager');
    const cache = await import('../../../src/data/storage/optimization-cache-storage');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    m.currentChatKey = 'chat-mvu';
    m.api.chat = [{ is_user: false, message_id: 21 }];
    cache.recordAutoTableFillProcessed_ACU({ messageId: 21, messageIndex: 0, chatKey: 'chat-mvu', updatedAt: 1 });

    m.mvuEndedHandler!();
    await vi.advanceTimersByTimeAsync(3000);

    expect(m.handleNewMessage).toHaveBeenCalledWith('MVU_ANALYSIS_ENDED');
    expect(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).not.toHaveBeenCalled();
    cache.clearAutoTableFillProcessed_ACU();
    vi.useRealTimers();
  });
});

// 3cfddd：桥的认领开关由单一 allowLoose 布尔升级为事件分类上下文。init.ts 必须把
// quiet / dryRun / 自动触发三项如实上报——桥据此把「普通宽松认领」与「桥自己发起的
// 交火重试认领」分开，自动触发的生成不再有权认领别人的续写轮。
describe('mainInitialize_ACU 续写宿主生成事件上下文', () => {
  function bridge_ACU(claims = true) {
    const bridge = {
      onGenerationStarted: vi.fn(() => true),
      claimsGenerationEnded: vi.fn(() => claims),
      onGenerationEnded: vi.fn(),
    };
    m.continuationBridge = bridge;
    return bridge;
  }

  it('普通生成按完整上下文认领，且桥认领不短路常规填表派发', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.isQuietLikeGeneration_ACU).mockReturnValue(false);
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    m.recordGenerationContext.mockReturnValue({ seq: 3 } as any);
    m.consumeGenerationContext.mockReturnValue({ seq: 3, type: 'normal', params: {}, dryRun: false, at: 1 });
    const bridge = bridge_ACU();

    m.generationStartedHandler!('normal', {}, false);
    m.generationEndedHandler!(42);

    const context = { allowOrdinaryLooseClaim: true, automaticTrigger: false, quietLike: false, dryRun: false };
    expect(bridge.onGenerationStarted).toHaveBeenCalledWith(3, context);
    expect(bridge.claimsGenerationEnded).toHaveBeenCalledWith(3, context);
    expect(bridge.onGenerationEnded).toHaveBeenCalledWith(42, 3, context);
    // 常规管线照常收到一次完整意图快照（门控不再被桥读两次）。
    expect(m.handleNewMessage).toHaveBeenCalledTimes(1);
    expect(m.handleNewMessage).toHaveBeenCalledWith('GENERATION_ENDED', expect.objectContaining({ eventMessageId: 42 }));
  });

  it('桥未认领本次生成结束时只走常规填表，不把正文交给桥', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.isQuietLikeGeneration_ACU).mockReturnValue(false);
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    m.consumeGenerationContext.mockReturnValue({ seq: 3, type: 'normal', params: {}, dryRun: false, at: 1 });
    const bridge = bridge_ACU(false);

    m.generationEndedHandler!(42);

    expect(bridge.claimsGenerationEnded).toHaveBeenCalledWith(3, { allowOrdinaryLooseClaim: true, automaticTrigger: false, quietLike: false, dryRun: false });
    expect(bridge.onGenerationEnded).not.toHaveBeenCalled();
    expect(m.handleNewMessage).toHaveBeenCalledTimes(1);
  });

  it('quiet、dryRun 与自动触发的生成不开放普通宽松认领，但分类标记如实上报', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    const bridge = bridge_ACU(false);

    vi.mocked(sm.isQuietLikeGeneration_ACU).mockReturnValueOnce(true);
    m.generationStartedHandler!('quiet', {}, false);
    vi.mocked(sm.isQuietLikeGeneration_ACU).mockReturnValueOnce(false);
    m.generationStartedHandler!('normal', {}, true);
    vi.mocked(sm.isQuietLikeGeneration_ACU).mockReturnValueOnce(false);
    m.generationStartedHandler!('normal', { automatic_trigger: true }, false);

    // 这三类生成都不是用户点发送产生的，普通宽松认领会把别人的生成错认成续写轮。
    expect(bridge.onGenerationStarted).toHaveBeenCalledTimes(3);
    for (const call of bridge.onGenerationStarted.mock.calls) expect(call[1].allowOrdinaryLooseClaim).toBe(false);
    expect(bridge.onGenerationStarted.mock.calls.map(call => call[1])).toEqual([
      { allowOrdinaryLooseClaim: false, automaticTrigger: false, quietLike: true, dryRun: false },
      { allowOrdinaryLooseClaim: false, automaticTrigger: false, quietLike: false, dryRun: true },
      { allowOrdinaryLooseClaim: false, automaticTrigger: true, quietLike: false, dryRun: false },
    ]);

    m.consumeGenerationContext.mockReturnValue({ seq: 3, type: 'normal', params: { automatic_trigger: true }, dryRun: false, at: 1 });
    vi.mocked(sm.isQuietLikeGeneration_ACU).mockReturnValue(false);
    m.generationEndedHandler!(42);
    expect(bridge.claimsGenerationEnded).toHaveBeenLastCalledWith(3, { allowOrdinaryLooseClaim: false, automaticTrigger: true, quietLike: false, dryRun: false });
  });
});

describe('mainInitialize_ACU init 链 running 占用补跑', () => {
  function hangFirstChainRunOnLoadMessages() {
    let releaseA: (() => void) | null = null;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    let loadCalls = 0;
    m.loadMessages.mockImplementation(async () => {
      loadCalls += 1;
      if (loadCalls === 1) await gateA; // 链 A 挂起，占住 running
    });
    return { release: () => releaseA!() };
  }

  afterEach(() => {
    m.loadMessages.mockReset();
    m.loadMessages.mockResolvedValue(undefined);
  });

  it('重建链到达时 running 被占：登记待跑代次，运行中的链结束后补跑最新一次', async () => {
    vi.useFakeTimers();
    m.api.chat = [{ mes: 'active' }];
    m.resetScript.mockImplementation(async (chatKey: string) => { m.currentChatKey = chatKey; });
    const gate = hangFirstChainRunOnLoadMessages();

    await m.chatChanged!('chat-a');            // 排程链 A（代次 1）
    await vi.advanceTimersByTimeAsync(1200);    // A 开始执行并挂起在 loadMessages
    expect(m.loadMessages).toHaveBeenCalledTimes(1);

    await m.chatChanged!('chat-a');            // 排程链 B（代次 2）
    await vi.advanceTimersByTimeAsync(1200);    // B 到达：running 被占 → 登记待跑（不再静默丢弃）
    expect(m.loadMessages).toHaveBeenCalledTimes(1); // B 未执行

    gate.release();
    await vi.advanceTimersByTimeAsync(0);       // A 收尾 → finally 补跑 B（直接调用，非定时器）

    expect(m.loadMessages).toHaveBeenCalledTimes(2); // B 已补跑
    await vi.advanceTimersByTimeAsync(2400);
    expect(m.loadMessages).toHaveBeenCalledTimes(2); // 只补一次，无第三次
    vi.useRealTimers();
  });

  it('待跑代次被更晚排程取代时不补跑旧代次，由新链按其自身代次正常执行', async () => {
    vi.useFakeTimers();
    m.api.chat = [{ mes: 'active' }];
    m.resetScript.mockImplementation(async (chatKey: string) => { m.currentChatKey = chatKey; });
    const gate = hangFirstChainRunOnLoadMessages();

    await m.chatChanged!('chat-a');
    await vi.advanceTimersByTimeAsync(1200);    // A（代次 1）执行中挂起
    await m.chatChanged!('chat-a');
    await vi.advanceTimersByTimeAsync(1200);    // B（代次 2）到达 → 登记待跑
    await m.chatChanged!('chat-a');            // C（代次 3）排程，定时器未到

    gate.release();
    await vi.advanceTimersByTimeAsync(0);       // A 收尾：待跑代次 2 ≠ 最新 3 → 不补跑
    expect(m.loadMessages).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1200);    // C 的定时器到点 → 正常执行
    expect(m.loadMessages).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

// [W4/W5 MVU 联动接线] MVU 的解析事件走宿主 eventSource 同一总线：启动时必须把 started/ended 接上闸门，
// 否则闸门只能靠入场 flag 与观察窗判定，延后会不稳定；接线断在这里 = 整个联动静默失效。
describe('mainInitialize_ACU MVU 额外模型解析事件接线', () => {
  it('注册 mag_variable_update_started / _ended，事件入口真的写进闸门深度', async () => {
    const gate = await import('../../../src/service/runtime/mvu-analysis-gate');
    gate.resetMvuAnalysisGateForTest_ACU();

    expect(gate.MVU_ANALYSIS_STARTED_EVENT_ACU).toBe('mag_variable_update_started');
    expect(gate.MVU_ANALYSIS_ENDED_EVENT_ACU).toBe('mag_variable_update_ended');
    expect(typeof m.mvuStartedHandler).toBe('function');
    expect(typeof m.mvuEndedHandler).toBe('function');

    m.mvuStartedHandler!();
    expect(gate.getMvuAnalysisGateState_ACU().depth).toBe(1);
    m.mvuEndedHandler!();
    expect(gate.getMvuAnalysisGateState_ACU().depth).toBe(0);
    gate.resetMvuAnalysisGateForTest_ACU();
  });
});

// [幂等卫兵] mainInitialize_ACU 此前无自身幂等：重复进入（首次挂载失败 release 后二次启动 /
// 同 eventSource 二次调用）会重复注册全部事件监听（double-fire 主路径）并泄漏 chatId 轮询
// 定时器。修复：模块级 mainInitializeDone_ACU 卫兵，成功初始化一次即置位，重复进入 logDebug 早退。
describe('mainInitialize_ACU 幂等卫兵', () => {
  it('成功初始化后二次调用早退：不重复注册事件监听、不重复提示、不再尝试加载核心 API', async () => {
    const { mainInitialize_ACU } = await import('../../../src/presentation/bootstrap/init');
    const toast = await import('../../../src/presentation/theme/toast');
    const connect = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');
    const onBefore = m.api.eventSource.on.mock.calls.length;
    const makeFirstBefore = m.api.eventSource.makeFirst.mock.calls.length;
    const makeLastBefore = m.api.eventSource.makeLast.mock.calls.length;

    mainInitialize_ACU();

    // 卫兵早退先于 core API 加载尝试：不重复注册、不重复 toast、不二次加载。
    expect(m.api.eventSource.on.mock.calls.length).toBe(onBefore);
    expect(m.api.eventSource.makeFirst.mock.calls.length).toBe(makeFirstBefore);
    expect(m.api.eventSource.makeLast.mock.calls.length).toBe(makeLastBefore);
    expect(toast.showToastr_ACU).not.toHaveBeenCalled();
    expect(connect.attemptToLoadCoreApis_ACU).not.toHaveBeenCalled();
  });

  it('负向控制：core APIs 加载失败不置位卫兵（保留重试语义），恢复后可完成初始化，之后二次调用早退', async () => {
    vi.resetModules();
    const connect = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');
    vi.mocked(connect.attemptToLoadCoreApis_ACU).mockReturnValue(false);
    const toast = await import('../../../src/presentation/theme/toast');
    const { mainInitialize_ACU } = await import('../../../src/presentation/bootstrap/init');

    // 首次进入：core APIs 加载失败 → 不注册任何监听、不提示成功（走既有失败分支）。
    mainInitialize_ACU();
    expect(toast.showToastr_ACU).not.toHaveBeenCalled();
    expect(m.api.eventSource.on).not.toHaveBeenCalled();

    // 恢复后重试：卫兵未在失败路径置位，初始化可以完整完成（重试语义保留）。
    vi.mocked(connect.attemptToLoadCoreApis_ACU).mockReturnValue(true);
    mainInitialize_ACU();
    const registeredAfterFirstSuccess = m.api.eventSource.on.mock.calls.length;
    expect(registeredAfterFirstSuccess).toBeGreaterThan(0);
    expect(toast.showToastr_ACU).toHaveBeenCalledTimes(1);

    // 再次调用：卫兵早退，不重复注册、不重复提示。
    mainInitialize_ACU();
    expect(m.api.eventSource.on.mock.calls.length).toBe(registeredAfterFirstSuccess);
    expect(toast.showToastr_ACU).toHaveBeenCalledTimes(1);
  });
});

// [配对零产出证据] STARTED 冻结 ex 签名 → context → ENDED intent 的传递链。
// 只收紧「配对但零产出」子集：quiet/dryRun/续写桥逻辑不动，W5 重跑无 intent 不受影响。
describe('mainInitialize_ACU 配对零产出证据传递', () => {
  it('GENERATION_STARTED 把 ex 签名当第 4 参记入生成上下文', () => {
    m.api.chat = [
      { is_user: false, message_id: 5, mes: 'hello' },
      { is_user: true, message_id: 6, mes: 'hi' },
    ];
    m.generationStartedHandler!('normal', {}, false);
    expect(m.recordGenerationContext).toHaveBeenCalledWith(
      'normal', {}, false,
      { aiFloorCount: 1, latestAiMessageId: 5, latestContentHash: expect.any(String) },
    );
  });

  it('GENERATION_ENDED 把配对上下文的 preSignature 带进 intent', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    const preSignature = { aiFloorCount: 1, latestAiMessageId: 5, latestContentHash: 'deadbeef' };
    m.consumeGenerationContext.mockReturnValue({ seq: 9, type: 'normal', params: {}, dryRun: false, at: 1, preSignature });
    m.api.chat = [{ is_user: false, message_id: 5, mes: 'hello' }];

    m.generationEndedHandler!(6);

    expect(m.handleNewMessage).toHaveBeenCalledWith(
      'GENERATION_ENDED',
      expect.objectContaining({ eventMessageId: 6, preSignature }),
    );
  });

  it('无配对时 intent 的 preSignature 为 undefined（下游直接放行）', async () => {
    const sm = await import('../../../src/service/runtime/state-manager');
    vi.mocked(sm.shouldProcessAutoTableUpdateForGenerationEnded_ACU).mockReturnValue(true);
    m.consumeGenerationContext.mockReturnValue(null);
    m.api.chat = [{ is_user: false, message_id: 5, mes: 'hello' }];

    m.generationEndedHandler!(6);

    expect(m.handleNewMessage).toHaveBeenCalledWith(
      'GENERATION_ENDED',
      expect.objectContaining({ eventMessageId: 6, preSignature: undefined }),
    );
  });
});

