import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resetFromTemplate: vi.fn(),
  reconcileTemplate: vi.fn(),
  isSqliteMode: vi.fn(() => false),
  reloadStorage: vi.fn(),
  didSqliteFallback: vi.fn(() => false),
  sanitizeTemplate: vi.fn((template: any) => ({ templateStr: JSON.stringify(template) })),
  upsertTemplatePreset: vi.fn(() => true),
  saveSettings: vi.fn(),
  refreshPreset: vi.fn(),
  switchPreset: vi.fn(() => ({ presetName: '西幻剧情引导', followsGlobal: false })),
  emitMessageUpdated: vi.fn(),
  notifyTableUpdate: vi.fn(),
}));

vi.mock('../../../../src/shared/env', () => ({
  topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: mocks.notifyTableUpdate } },
}));
vi.mock('../../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: { eventTypes: { MESSAGE_UPDATED: 'MESSAGE_UPDATED' }, eventSource: { emit: mocks.emitMessageUpdated } },
}));
vi.mock('../../../../src/shared/template-preset-utils', () => ({
  deriveTemplatePresetNameForImport_ACU: vi.fn(({ presetName }: any) => String(presetName || '').trim()),
}));
vi.mock('../../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../../src/service/runtime/state-manager', () => ({ settings_ACU: { plotSettings: { promptPresets: [] } } }));
vi.mock('../../../../src/service/plot/plot-logic', () => ({
  getCurrentRuntimePlotPresetName_ACU: vi.fn(),
  normalizePlotPresetExcludeRules_ACU: vi.fn((preset: any) => preset),
  switchCurrentChatPlotPreset_ACU: mocks.switchPreset,
}));
vi.mock('../../../../src/service/table/template-state-reset', () => ({
  resetCurrentChatTableStateFromTemplate_ACU: mocks.resetFromTemplate,
}));
vi.mock('../../../../src/service/template/template-preset-service', () => ({
  applyChatTemplateSnapshotWithReconciliation_ACU: mocks.reconcileTemplate,
  upsertTemplatePreset_ACU: mocks.upsertTemplatePreset,
}));
vi.mock('../../../../src/service/template/chat-scope', () => ({
  sanitizeTemplateSnapshotForChat_ACU: mocks.sanitizeTemplate,
}));
vi.mock('../../../../src/service/table/storage-mode', () => ({ isSqliteMode: mocks.isSqliteMode }));
vi.mock('../../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: mocks.reloadStorage,
  didSqliteFallbackAfterReload_ACU: mocks.didSqliteFallback,
}));
vi.mock('../../../../src/presentation/components/settings-ui-helpers', () => ({ saveSettingsAndNotify_ACU: mocks.saveSettings }));
vi.mock('../../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshPresetUIAfterSwitch_ACU: mocks.refreshPreset }));

import { createPlotPresetApi } from '../../../../src/presentation/bootstrap/api-groups/plot-preset-api';

function createApi() {
  let api: Record<string, Function>;
  api = createPlotPresetApi({ getApi: () => api } as any);
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resetFromTemplate.mockResolvedValue({ saved: true, messageIndex: 0, runtimeReady: true });
  mocks.reconcileTemplate.mockResolvedValue({ saved: true, messageIndex: 0, runtimeReady: true });
  mocks.isSqliteMode.mockReturnValue(false);
  mocks.didSqliteFallback.mockReturnValue(false);
  mocks.sanitizeTemplate.mockImplementation((template: any) => ({ templateStr: JSON.stringify(template) }));
  mocks.upsertTemplatePreset.mockReturnValue(true);
});

describe('initGameSession 模板重置契约', () => {
  it('reset=true 通过单一原子入口写入模板，而不调用旧的 delete/guide-only 链路', async () => {
    const templateData = { mate: { type: 'chatSheets', version: 1 }, sheet_legacy: { uid: 'sheet_legacy', name: '角色', content: [['row_id', '名称'], ['seed-1', '助手']] } };

    const result = await createApi().initGameSession({}, { templateData, loadPreset: false });

    expect(mocks.resetFromTemplate).toHaveBeenCalledWith(templateData, expect.objectContaining({
      presetName: '', source: 'game_init', reason: 'game_init', resetExistingTableData: true,
    }));
    expect(result).toMatchObject({ success: true, templateInjected: true });
  });

  it('reset 成功后用已提交的规范化模板注册预设，而非原始缺列输入', async () => {
    const templateData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary_log: { uid: 'sheet_summary_log', name: 'SummaryLog', content: [['时间', '摘要'], ['T1', '事件']] },
    };
    const committedTemplateData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary_log: { uid: 'sheet_summary_log', name: 'SummaryLog', content: [['row_id', '时间', '摘要'], ['1', 'T1', '事件']] },
    };
    mocks.resetFromTemplate.mockResolvedValueOnce({
      saved: true, messageIndex: 0, runtimeReady: true, normalizedTemplateData: committedTemplateData,
    });

    const result = await createApi().initGameSession({}, {
      templateData, templatePresetName: '规范化预设', loadPreset: false,
    });

    expect(result).toMatchObject({ success: true, templateInjected: true });
    expect(mocks.sanitizeTemplate).toHaveBeenCalledWith(committedTemplateData);
    expect(mocks.sanitizeTemplate).not.toHaveBeenCalledWith(templateData);
    expect(mocks.upsertTemplatePreset).toHaveBeenCalledWith('规范化预设', JSON.stringify(committedTemplateData));
  });

  it('原子提交失败时返回失败，不能以 guide-only fallback 伪造模板注入成功', async () => {
    mocks.resetFromTemplate.mockResolvedValueOnce({ saved: false, error: '严格保存失败，状态已回滚。' });

    const result = await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      loadPreset: false,
    });

    expect(result).toMatchObject({ success: false, templateInjected: false });
    expect(result.message).toContain('严格保存失败');
  });

  it('reset=false 不执行破坏性重置，而是进入既有模板协调入口', async () => {
    const templateData = { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } };

    const result = await createApi().initGameSession({}, { templateData, loadPreset: false, resetExistingTableData: false });

    expect(mocks.resetFromTemplate).not.toHaveBeenCalled();
    expect(mocks.reconcileTemplate).toHaveBeenCalledWith(templateData, expect.objectContaining({
      source: 'game_init', presetName: '', destructiveChangeConfirmed: false,
    }));
    expect(result).toMatchObject({ success: true, templateInjected: true });
  });

  it('模板提交后不在 await initGameSession 的调用栈内刷新宿主消息或第三方 iframe', async () => {
    const result = await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      loadPreset: false,
    });

    expect(result).toMatchObject({ success: true, templateInjected: true });
    expect(mocks.emitMessageUpdated).not.toHaveBeenCalled();
    expect(mocks.notifyTableUpdate).not.toHaveBeenCalled();
    expect(mocks.saveSettings).toHaveBeenCalledOnce();
  });

  it('SQLite 重载回退后保留已提交状态，并向调用方报告 runtime warning', async () => {
    mocks.isSqliteMode.mockReturnValue(true);
    mocks.didSqliteFallback.mockReturnValue(true);

    const result = await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      loadPreset: false,
    });

    expect(mocks.reloadStorage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, templateInjected: true, runtimeReady: false });
    expect(result.warning).toContain('回退到原生模式');
  });
});
