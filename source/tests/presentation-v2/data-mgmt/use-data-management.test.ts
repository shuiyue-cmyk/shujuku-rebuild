/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatState = { id: 'chat', fullRange: false };
const restoreCheckpoint = vi.fn(async () => ({ success: true, postCondition: { ok: true } }));

async function loadFlow() {
  vi.resetModules();
  chatState.id = 'chat';
  chatState.fullRange = false;
  restoreCheckpoint.mockClear();
  const settings: any = {
    dataIsolationCode: 'alpha', deleteStartFloor: 1, deleteEndFloor: null,
    retainRecentLayers: 100, charCardPrompt: [], storageMode: 'native',
    tableKeyOrder: ['sheet_a'], tableUpdateLocks: { 'chat::alpha': { sheet_a: { rows: [1] } } },
  };
  const chat: any[] = [{
    is_user: false,
    TavernDB_ACU_ScopedConfig: { version: 1, template: { alpha: { mode: 'chat_override', templateStr: 'old' } } },
    TavernDB_ACU_InternalSheetGuide: { version: 2, tags: { alpha: { old: true } } },
  }];
  const history = ['alpha', 'beta'];
  const switchIsolation = vi.fn(async (code: string) => { settings.dataIsolationCode = code; });
  const removeHistory = vi.fn((code: string) => history.splice(history.indexOf(code), 1));
  const deleteGenerated = vi.fn(async () => undefined);
  const clearTemplateSnapshots = vi.fn(async () => {
    chat[0].TavernDB_ACU_ScopedConfig = null;
    chat[0].TavernDB_ACU_InternalSheetGuide = null;
  });
  const clearTableLocks = vi.fn(() => { settings.tableUpdateLocks = {}; });
  const clearPlotSnapshots = vi.fn(async () => undefined);
  const applyTemplateScope = vi.fn();
  const applyTemplateSnapshot = vi.fn();
  const applyCombinedImport = vi.fn();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' as const }));
  const overrideLatest = vi.fn(async () => 2);
  const deleteScoped = vi.fn(async () => ({ path: 'range' as const, deletedCount: 2 }));
  const reloadProvider = vi.fn(async () => undefined);
  const loadOrCreate = vi.fn(async () => undefined);
  const refreshMerged = vi.fn(async () => undefined);
  const cleanupWorldbook = vi.fn(async () => 1);
  const scan = vi.fn(async () => [{ isolationKey: 'alpha', status: 'ok', requiresConfirmation: false, message: 'ok', isCurrentIsolation: true }]);
  const prepare = vi.fn(async () => ({ planId: 'plan-1', status: 'recoverable_orphan_data_replace', isolationKey: 'alpha', requiresConfirmation: true, message: 'recover' }));
  const commit = vi.fn(async () => ({ status: 'committed', planId: 'plan-1' }));

  vi.doMock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: settings, get currentChatFileIdentifier_ACU() { return chatState.id; }, currentJsonTableData_ACU: { sheet_a: {} }, getCurrentIsolationKey_ACU: () => settings.dataIsolationCode }));
  vi.doMock('../../../src/service/table/table-checkpoint-transfer', async (importOriginal) => ({ ...(await importOriginal<any>()), restoreTableCheckpointToLatestAi_ACU: restoreCheckpoint }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: applyTemplateScope, applyCombinedSettingsImport_ACU: applyCombinedImport, getDataIsolationHistory_ACU: () => [...history], removeDataIsolationHistory_ACU: removeHistory, saveSettings_ACU: saveSettings, switchIsolationProfile_ACU: switchIsolation }));
  vi.doMock('../../../src/service/settings/settings-write-service', () => ({ resetAllPromptsToDefault_ACU: vi.fn(() => ({ ok: true, code: 'ok', changed: true })) }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => chat, deleteLocalDataWithScope_ACU: deleteScoped, isFullRangeDeletionRequest_ACU: () => chatState.fullRange, overrideLatestLayerWithTemplateCore_ACU: overrideLatest }));
  vi.doMock('../../../src/service/table/table-service', () => ({ loadOrCreateJsonTableFromChatHistory_ACU: loadOrCreate }));
  vi.doMock('../../../src/service/worldbook/worldbook-cleanup', () => ({ cleanupWorldbookEntriesAfterDataDeletion_ACU: cleanupWorldbook }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({ deleteAllGeneratedEntries_ACU: deleteGenerated, refreshMergedDataAndNotify_ACU: refreshMerged }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    clearCurrentChatTemplateSnapshots_ACU: clearTemplateSnapshots,
    sanitizeChatSheetsObject_ACU: (value: any) => value,
  }));
  vi.doMock('../../../src/service/runtime/helpers-table-lock', () => ({ clearCurrentTableLocks_ACU: clearTableLocks }));
  vi.doMock('../../../src/service/plot/plot-logic', () => ({ clearCurrentChatPlotPresetOverride_ACU: clearPlotSnapshots }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({ getCurrentStorageMode: () => 'native', isSqliteMode: () => false }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({ reloadStorageProvider: reloadProvider }));
  vi.doMock('../../../src/service/table/table-v2-recovery-service', () => ({ scanV2IsolationDiagnostics_ACU: scan, prepareV2Recovery_ACU: prepare, commitPreparedV2Recovery_ACU: commit }));
  vi.doMock('../../../src/service/template/template-preset-service', () => ({ applyTemplateSnapshotToScope_ACU: applyTemplateSnapshot, getDefaultTemplateSnapshot_ACU: vi.fn(() => ({ templateStr: '{"mate":{"type":"chatSheets","version":1}}' })) }));

  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const [{ useDataManagement }, { useToastStore }] = await Promise.all([
    import('../../../src/presentation-v2/composables/useDataManagement'),
    import('../../../src/presentation-v2/stores/toast-store'),
  ]);
  const toast = useToastStore();
  const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => {});
  const toastError = vi.spyOn(toast, 'error').mockImplementation(() => {});
  const toastWarning = vi.spyOn(toast, 'warning').mockImplementation(() => {});
  return { flow: useDataManagement(), settings, chat, history, switchIsolation, removeHistory, deleteGenerated, clearTemplateSnapshots, clearTableLocks, clearPlotSnapshots, applyTemplateScope, applyTemplateSnapshot, applyCombinedImport, saveSettings, overrideLatest, deleteScoped, reloadProvider, loadOrCreate, refreshMerged, cleanupWorldbook, scan, prepare, commit, toast, toastSuccess, toastError, toastWarning };
}

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useDataManagement', () => {
  // R10A-01：危险操作的路径与聊天在确认前冻结，执行时核对；切了聊天就不执行，路径以确认时为准。
  it('R10A-01：确认期间切换聊天时删除不执行并提示', async () => {
    const d = await loadFlow();
    const scope = d.flow.captureActionScope();
    const expectedPath = d.flow.resolveDeletionPath('all');
    chatState.id = 'other-chat';

    await d.flow.deleteLocalData('all', { expectedPath, scope });

    expect(d.deleteScoped).not.toHaveBeenCalled();
    expect(d.toastWarning).toHaveBeenCalledWith(expect.stringContaining('切换'), expect.anything());
  });

  it('R10A-01：确认前判定为按范围删除时，执行沿用确认时的路径交给服务层核对', async () => {
    const d = await loadFlow();
    const scope = d.flow.captureActionScope();
    const expectedPath = d.flow.resolveDeletionPath('all');
    expect(expectedPath).toBe('range');
    chatState.fullRange = true; // 确认期间楼层变化：此刻重算会变成硬清空

    await d.flow.deleteLocalData('all', { expectedPath, scope });

    expect(d.deleteScoped).toHaveBeenCalledWith('all', 1, null, 'range');
  });

  it('R10A-01：确认期间切换聊天时不恢复 Checkpoint', async () => {
    const d = await loadFlow();
    const scope = d.flow.captureActionScope();
    chatState.id = 'other-chat';

    await d.flow.restoreTableCheckpoint({} as any, {}, scope);

    expect(restoreCheckpoint).not.toHaveBeenCalled();
    expect(d.toastWarning).toHaveBeenCalledWith(expect.stringContaining('切换'), expect.anything());
  });

  it('V2 诊断与恢复只透传服务端冻结的 planId 和确认值', async () => {
    const d = await loadFlow();
    await d.flow.scanV2IsolationDiagnostics();
    expect(d.scan).toHaveBeenCalledOnce();
    expect(d.prepare).not.toHaveBeenCalled();
    expect(d.flow.v2IsolationDiagnostics.value).toHaveLength(1);

    await d.flow.prepareV2Recovery();
    await d.flow.commitV2Recovery(true);
    expect(d.prepare).toHaveBeenCalledOnce();
    expect(d.commit).toHaveBeenCalledWith('plan-1', { confirmOrphanDataReplace: true });
  });

  // R10A-04：恢复默认是多步 await 序列，每一步都现读当前聊天；切了聊天必须停在原地。
  it('R10A-04：确认期间切换聊天时恢复默认不执行任何步骤', async () => {
    const d = await loadFlow();
    const scope = d.flow.captureActionScope();
    chatState.id = 'other-chat';

    await d.flow.resetAllDefaults({ clearPlotSnapshots: true, clearTemplateSnapshots: true }, scope);

    expect(d.clearPlotSnapshots).not.toHaveBeenCalled();
    expect(d.clearTemplateSnapshots).not.toHaveBeenCalled();
    expect(d.toastWarning).toHaveBeenCalledWith(expect.stringContaining('切换'), expect.anything());
  });

  it('R10A-04：恢复默认中途切换聊天时后续步骤不落到新聊天', async () => {
    const d = await loadFlow();
    d.clearPlotSnapshots.mockImplementationOnce(async () => { chatState.id = 'other-chat'; });

    await d.flow.resetAllDefaults({ clearPlotSnapshots: true, clearTemplateSnapshots: true, restoreTemplateAndPrompts: true });

    expect(d.clearPlotSnapshots).toHaveBeenCalledOnce();
    expect(d.clearTemplateSnapshots).not.toHaveBeenCalled();
    expect(d.applyTemplateSnapshot).not.toHaveBeenCalled();
    expect(d.saveSettings).not.toHaveBeenCalled();
    expect(d.toastError).toHaveBeenCalledWith(expect.stringContaining('切换'));
  });

  it('恢复默认模板失败时回滚 settings、聊天 scope 和 guide 清理', async () => {
    const d = await loadFlow();
    d.applyTemplateSnapshot.mockResolvedValue({ saved: false, error: '模拟模板 blocker' });

    await d.flow.resetAllDefaults({
      restoreTemplateAndPrompts: true,
      clearTemplateSnapshots: true,
      clearPlotSnapshots: true,
      clearTableLocks: true,
      clearTableOrder: true,
    });

    expect(d.settings.tableKeyOrder).toEqual(['sheet_a']);
    expect(d.settings.tableUpdateLocks).toEqual({ 'chat::alpha': { sheet_a: { rows: [1] } } });
    expect(d.chat[0].TavernDB_ACU_ScopedConfig).toEqual({
      version: 1,
      template: { alpha: { mode: 'chat_override', templateStr: 'old' } },
    });
    expect(d.chat[0].TavernDB_ACU_InternalSheetGuide).toEqual({ version: 2, tags: { alpha: { old: true } } });
    expect(d.toastError).toHaveBeenCalled();
  });

  it('purge 成功时不在 UI 层 reload（回落由 purge 服务内部完成），只刷新合并视图与 toast', async () => {
    const d = await loadFlow();
    d.deleteScoped.mockResolvedValueOnce({
      path: 'purge',
      result: {
        saved: true,
        clearedMessageCount: 12,
        removedMetadata: ['_acu_chat_sheet_guide', '_acu_chat_template_scope'],
      },
    });

    await d.flow.deleteLocalData('all');

    // S1-1：runtime 回落由 purge 服务内部完成，UI 层不再 loadOrCreate/reloadProvider；
    // 世界书清理也由 purge 内部完成。UI 层只刷新合并视图让面板展示模板空结构。
    expect(d.loadOrCreate).not.toHaveBeenCalled();
    expect(d.reloadProvider).not.toHaveBeenCalled();
    expect(d.refreshMerged).toHaveBeenCalledOnce();
    expect(d.cleanupWorldbook).not.toHaveBeenCalled();
    expect(d.deleteGenerated).not.toHaveBeenCalled();
    // 本页 refresh 与成功 toast 保留。
    expect(d.toastSuccess).toHaveBeenCalled();
  });

  it('R10A-18：硬清空后的刷新失败会被捕获并提示，忙碌态等刷新结束才解除', async () => {
    const d = await loadFlow();
    d.deleteScoped.mockResolvedValueOnce({
      path: 'purge',
      result: { saved: true, clearedMessageCount: 2, removedMetadata: [] },
    });
    let rejectRefresh!: (error: unknown) => void;
    d.refreshMerged.mockImplementationOnce(() => new Promise((_, reject) => { rejectRefresh = reject; }));

    const pending = d.flow.deleteLocalData('all');
    await vi.waitFor(() => expect(d.refreshMerged).toHaveBeenCalledOnce());
    expect(d.flow.busyAction.value).not.toBe('');
    rejectRefresh(new Error('刷新失败'));
    await pending;

    expect(d.flow.busyAction.value).toBe('');
    expect(d.toastError).toHaveBeenCalled();
    expect(d.toastSuccess).not.toHaveBeenCalled();
  });

  it('purge 失败时不走成功路径，不触发任何 reload/持久化/世界书调用', async () => {
    const d = await loadFlow();
    d.deleteScoped.mockResolvedValueOnce({
      path: 'purge',
      result: {
        saved: false,
        clearedMessageCount: 0,
        removedMetadata: [],
        error: '保存失败，已回滚。',
      },
    });

    await d.flow.deleteLocalData('all');

    expect(d.toastError).toHaveBeenCalled();
    expect(d.toastSuccess).not.toHaveBeenCalled();
    expect(d.loadOrCreate).not.toHaveBeenCalled();
    expect(d.reloadProvider).not.toHaveBeenCalled();
    expect(d.refreshMerged).not.toHaveBeenCalled();
    expect(d.cleanupWorldbook).not.toHaveBeenCalled();
  });

  it('purge 带 cleanupWarnings 时展示 warning，仍刷新合并视图但不在 UI 层重载', async () => {
    const d = await loadFlow();
    d.deleteScoped.mockResolvedValueOnce({
      path: 'purge',
      result: {
        saved: true,
        clearedMessageCount: 3,
        removedMetadata: [],
        cleanupWarnings: ['世界书清理失败。'],
      },
    });

    await d.flow.deleteLocalData('all');

    expect(d.toastWarning).toHaveBeenCalled();
    expect(d.loadOrCreate).not.toHaveBeenCalled();
    expect(d.reloadProvider).not.toHaveBeenCalled();
    expect(d.refreshMerged).toHaveBeenCalledOnce();
    expect(d.cleanupWorldbook).not.toHaveBeenCalled();
  });

});

