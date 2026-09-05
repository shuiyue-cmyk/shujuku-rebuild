import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  wasStopped: false,
  executePlan: vi.fn(),
  logSkip: vi.fn(),
  buildPlan: vi.fn(() => ({ tablesToUpdate: [{ sheetKey: 'sheet_0' }], updateGroups: { group_1: {} } })),
  getChat: vi.fn(() => [{ is_user: true }, { is_user: false }]),
  preCheck: { canProceed: true, reason: '' },
}));

// 自动填表「已处理集合」的内存替身（真实实现走 window + localStorage，本文件只验接线）
const guardStore = vi.hoisted(() => ({ fill: new Map<string, any>() }));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  getCharCardPromptFromUI_ACU: vi.fn(), isAutoUpdatingCard_ACU: false,
  renderPromptSegments_ACU: vi.fn(), get wasStoppedByUser_ACU() { return m.wasStopped; },
  _set_isAutoUpdatingCard_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500, abortAllActiveRequests_ACU: vi.fn(),
  allChatMessages_ACU: [{ is_user: true }, { is_user: false }], coreApisAreReady_ACU: true,
  currentJsonTableData_ACU: { sheet_0: {} }, getCurrentIsolationKey_ACU: vi.fn(() => ''),
  lastTotalAiMessages_ACU: 1, settings_ACU: { autoUpdateEnabled: true, maxConcurrentGroups: 1, toastMuteEnabled: true },
  currentChatFileIdentifier_ACU: 'test-chat',
  _set_coreApisAreReady_ACU: vi.fn(), _set_lastTotalAiMessages_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(), _set_wasStoppedByUser_ACU: vi.fn(),
}));
vi.mock('../../../src/service/table/update-scheduler', () => ({
  checkAutoUpdatePreConditions_ACU: vi.fn(() => m.preCheck),
  handleFloorIncreaseDelay_ACU: vi.fn(async () => undefined),
  buildAutoUpdatePlan_ACU: (...args: any[]) => m.buildPlan(...args),
  executeAutoUpdatePlan_ACU: (...args: any[]) => m.executePlan(...args),
}));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: (...args: any[]) => m.getChat(...args), saveChatToHost_ACU: vi.fn() }));
vi.mock('../../../src/shared/runtime-performance', () => ({ startRuntimePerformanceSpan_ACU: vi.fn(() => ({ id: 'span', end: vi.fn() })) }));
vi.mock('../../../src/shared/trigger-diagnostics', () => ({ logAutoFillSkip_ACU: (...args: any[]) => m.logSkip(...args) }));
vi.mock('../../../src/service/template/chat-scope', () => ({ getSortedSheetKeys_ACU: vi.fn(() => ['sheet_0']) }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: vi.fn(() => true) }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/update-status-display', () => ({ updateCardUpdateStatusDisplay_ACU: vi.fn() }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(), isSummaryOrOutlineTable_ACU: vi.fn() }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: vi.fn(), updateReadableLorebookEntry_ACU: vi.fn() }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ getStorageProvider: vi.fn(() => ({ getCurrentData: vi.fn() })) }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: {} }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-config', () => ({ purgeOldLayerData_ACU: vi.fn() }));
vi.mock('../../../src/service/table/update-orchestrator', () => ({ processGroupedRuntimeChunk_ACU: vi.fn() }));
vi.mock('../../../src/data/storage/optimization-cache-storage', () => ({
  saveOptimizationBaseToCache_ACU: vi.fn(),
  loadOptimizationBaseFromCache_ACU: vi.fn(() => null),
  findAutoOptimizationProcessedEntry_ACU: vi.fn(() => null),
  recordAutoOptimizationProcessed_ACU: vi.fn(() => null),
  findAutoTableFillProcessedEntry_ACU: (messageId: any) => guardStore.fill.get(String(messageId)) || null,
  recordAutoTableFillProcessed_ACU: (payload: any) => {
    if (payload?.messageId === null || payload?.messageId === undefined) return null;
    const entry = { ...payload, messageId: String(payload.messageId) };
    guardStore.fill.set(entry.messageId, entry);
    return entry;
  },
}));

async function settleMicrotasks() { await Promise.resolve(); await Promise.resolve(); }

describe('triggerAutomaticUpdateIfNeeded_ACU 并发补跑', () => {
  beforeEach(() => { m.wasStopped = false; m.executePlan.mockReset(); m.logSkip.mockReset(); m.buildPlan.mockReset(); m.preCheck = { canProceed: true, reason: '' }; });

  it('前置检查失败时记录稳定原因码到诊断日志', async () => {
    m.preCheck = { canProceed: false, reason: 'Pre-flight checks failed.', code: 'runtime_not_ready' };
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.logSkip).toHaveBeenCalledWith('preconditions_failed', expect.objectContaining({
      preconditionReason: 'runtime_not_ready',
    }));
    // fail-closed：前置检查失败时只记录一次 skip，不构建也不执行更新计划。
    expect(m.logSkip).toHaveBeenCalledTimes(1);
    expect(m.buildPlan).not.toHaveBeenCalled();
    expect(m.executePlan).not.toHaveBeenCalled();
  });

  it('执行中到达多个触发时合并为一次后续执行', async () => {
    let releaseFirst!: () => void;
    let releaseFollowUp!: () => void;
    m.executePlan
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = () => resolve({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false }); }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseFollowUp = () => resolve({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false }); }));

    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const first = triggerAutomaticUpdateIfNeeded_ACU({ runId: 'first' });
    await settleMicrotasks();
    await triggerAutomaticUpdateIfNeeded_ACU({ runId: 'second' });
    await triggerAutomaticUpdateIfNeeded_ACU({ runId: 'third' });
    expect(m.logSkip).toHaveBeenCalledWith('auto_update_coalesced', { inFlight: true });

    releaseFirst();
    await first;
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(2);
    releaseFollowUp();
    await settleMicrotasks();
  });

  it('用户停止后清除 pending 触发而不补跑', async () => {
    let releaseFirst!: () => void;
    m.executePlan.mockImplementationOnce(() => new Promise(resolve => {
      releaseFirst = () => resolve({
        failedGroups: 0,
        errors: [],
        autoMergeTriggered: false,
        autoMergeSuccess: false,
      });
    }));

    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const first = triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    await triggerAutomaticUpdateIfNeeded_ACU();
    m.wasStopped = true;

    releaseFirst();
    await first;
    await settleMicrotasks();

    expect(m.executePlan).toHaveBeenCalledTimes(1);
    expect(m.logSkip).toHaveBeenCalledWith('auto_update_coalesced', { inFlight: true });
  });

  it('自动填表入口复位 wasStoppedByUser（e6f8ef38：残留 true 会永久 user_aborted 死锁）', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const { _set_wasStoppedByUser_ACU } = await import('../../../src/service/runtime/state-manager');
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    // 本文件唯一 setter 调用点=入口复位行；删源码该行此断言即红。
    expect(_set_wasStoppedByUser_ACU).toHaveBeenCalledWith(false);
  });
});

// ═══ [W3] 自动填表回声防重：同一楼第二条 GENERATION_ENDED 不再拉起填表 ═══
describe('triggerAutomaticUpdateIfNeeded_ACU 回声防重', () => {
  const okResult = { success: true, totalGroups: 1, failedGroups: 0, errors: [] };

  function twoFloorChat(aiMessageId: number | null) {
    return [
      { is_user: true, message_id: 10, mes: '玩家行动' },
      { is_user: false, message_id: aiMessageId, mes: '夜色漫过屋檐。' },
    ];
  }

  beforeEach(() => {
    guardStore.fill.clear();
    m.wasStopped = false;
    m.executePlan.mockReset();
    m.logSkip.mockReset();
    m.buildPlan.mockReset();
    m.preCheck = { canProceed: true, reason: '' };
    m.getChat.mockImplementation(() => twoFloorChat(11));
  });

  it('①首轮成功提交后登记该楼；同一 messageId 的第二条回声触发直接跳过（不构建计划、不调 AI）', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    m.executePlan.mockResolvedValue(okResult);

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(1);
    expect(guardStore.fill.has('11')).toBe(true);

    // 宿主对本楼再派发一条 GENERATION_ENDED（无配对上下文 → 门控放行）
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(1);
    expect(m.buildPlan).toHaveBeenCalledTimes(1);
    expect(m.logSkip).toHaveBeenCalledWith('duplicate_auto_fill_ended', expect.objectContaining({
      messageId: 11,
      resolvedMessageIndex: 1,
    }));
  });

  it('②正文替换写回改了同一楼内容后，回声填表仍跳过（messageId 级判重不被内容联动误发）', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    m.executePlan.mockResolvedValue(okResult);

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(1);

    // 模拟正文自动替换把同一 messageId 的楼层内容改掉（内容基准会把它骗成「新内容」）
    m.getChat.mockImplementation(() => [
      { is_user: true, message_id: 10, mes: '玩家行动' },
      { is_user: false, message_id: 11, mes: '★正文替换链改写后的新内容★' },
    ]);

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(1);
  });

  it('③新 messageId（新一轮生成）正常触发，不被上一楼记录拦截', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    m.executePlan.mockResolvedValue(okResult);

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(guardStore.fill.has('11')).toBe(true);

    m.getChat.mockImplementation(() => [
      { is_user: true, message_id: 10 },
      { is_user: false, message_id: 11 },
      { is_user: true, message_id: 12 },
      { is_user: false, message_id: 13 },
    ]);
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();

    expect(m.executePlan).toHaveBeenCalledTimes(2);
    expect(guardStore.fill.has('13')).toBe(true);
  });

  it('④拿不到 message_id 时判重完全失效（一律放行，保持既有行为）', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    m.getChat.mockImplementation(() => twoFloorChat(null));
    m.executePlan.mockResolvedValue(okResult);

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();

    expect(m.executePlan).toHaveBeenCalledTimes(2);
    expect(guardStore.fill.size).toBe(0);
  });

  it('空计划（本轮无表到期）不登记：回声仍走原有 no_tables_due 判定，不会被误标成已填完', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    m.buildPlan.mockImplementation(() => ({ tablesToUpdate: [], updateGroups: {}, boundary: { fullCheckpointIndices: [], requiresBoundaryStaging: false } }));

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();

    expect(m.executePlan).not.toHaveBeenCalled();
    expect(m.logSkip).toHaveBeenCalledWith('no_tables_due', expect.anything());
    expect(guardStore.fill.size).toBe(0);
  });

  it('部分分组失败不登记：回声保留为合法重试路径', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    m.executePlan.mockResolvedValue({ success: false, totalGroups: 2, failedGroups: 1, errors: ['group_1 失败'] });

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(guardStore.fill.size).toBe(0);

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(2);
  });

  it('用户终止本轮不登记（避免把没填完的楼层标成已填）', async () => {
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    m.executePlan.mockImplementation(async () => {
      m.wasStopped = true;
      return { success: true, totalGroups: 1, failedGroups: 0, errors: [] };
    });

    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(guardStore.fill.size).toBe(0);
  });

  it('手动填表入口不挂在自动守卫链路上（守卫只在自动入口一处生效）', async () => {
    const triggerSource = readFileSync('src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts', 'utf8');
    const manualSource = readFileSync('src/presentation/triggers/update-process.ts', 'utf8');

    // 判重调用点在自动入口里恰好一次；手动/补填实现文件完全不引用守卫
    expect(triggerSource.match(/shouldSkipDuplicateAutoTableFill_ACU\(/g) || []).toHaveLength(1);
    expect(manualSource).not.toContain('auto-fill-echo-guard');
    expect(manualSource).not.toContain('shouldSkipDuplicateAutoTableFill_ACU');
  });
});

// ═══ [静默进度框] 「自动填表进行中」常驻 toast 不受静默提示框拦截（MANUAL_TABLE 类别在白名单）═══
describe('triggerAutomaticUpdateIfNeeded_ACU 静默进度框', () => {
  const okResult = { success: true, totalGroups: 1, failedGroups: 0, errors: [] };

  beforeEach(() => {
    guardStore.fill.clear();
    m.wasStopped = false;
    m.executePlan.mockReset();
    m.logSkip.mockReset();
    m.buildPlan.mockReset();
    m.preCheck = { canProceed: true, reason: '' };
    m.getChat.mockImplementation(() => [
      { is_user: true, message_id: 10, mes: '玩家行动' },
      { is_user: false, message_id: 11, mes: '夜色漫过屋檐。' },
    ]);
  });

  afterEach(async () => {
    // isSqliteMode/showToastr/settings 均为跨用例共享 mock，必须显式回滚默认实现
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const toast = await import('../../../src/presentation/theme/toast');
    toast.showToastr_ACU.mockReset();
    toast.showToastr_ACU.mockImplementation(undefined);
    const state = await import('../../../src/service/runtime/state-manager');
    (state.settings_ACU as any).toastMuteEnabled = true;
  });

  async function runGroupedFill(mute: boolean) {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(false);   // 非 SQLite=分组并发路径（常驻进度框所在分支）
    const state = await import('../../../src/service/runtime/state-manager');
    (state.settings_ACU as any).toastMuteEnabled = mute;
    const toast = await import('../../../src/presentation/theme/toast');
    const fakeToast = { find: vi.fn(() => ({ text: vi.fn() })) };
    toast.showToastr_ACU.mockReturnValue(fakeToast as any);
    m.executePlan.mockResolvedValue(okResult);
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    return toast.showToastr_ACU;
  }

  it('静默开启+分组模式：仍创建常驻进度 toast（timeOut:0 + manual_table 白名单类别），填表开始即提示进行中', async () => {
    const showToastr = await runGroupedFill(true);
    // 首条「检测到 N 个表格需要更新」公告 + 常驻进度框；进度框必须存在且带进行中文案与终止按钮形状
    const progressCall = showToastr.mock.calls.find((args: any[]) =>
      args[0] === 'info' && String(args[1]).includes('自动填表正在准备') && args[2]?.timeOut === 0);
    expect(progressCall).toBeTruthy();
    expect(progressCall![2].acuToastCategory).toBe('manual_table'); // 静默白名单类别，toast 层不会拦截
  });

  it('静默关闭：同样创建常驻进度 toast（本改动不改变非静默路径）', async () => {
    const showToastr = await runGroupedFill(false);
    const progressCall = showToastr.mock.calls.find((args: any[]) =>
      args[0] === 'info' && String(args[1]).includes('自动填表正在准备') && args[2]?.timeOut === 0);
    expect(progressCall).toBeTruthy();
    expect(progressCall![2].acuToastCategory).toBe('manual_table');
  });
});
