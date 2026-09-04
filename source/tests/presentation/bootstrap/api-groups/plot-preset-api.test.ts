import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { logWarn_ACU } from '../../../../src/shared/utils';
// 默认表结构单一来源：断言内置默认模板时直接比对同一份定义，不写第二份表名清单
import { buildDefaultTableTemplateObject_ACU, optionsSheet } from '../../../../src/shared/table-defaults/index.js';

function createApi() {
  let api: Record<string, Function>;
  api = createPlotPresetApi({ getApi: () => api } as any);
  return api;
}

const sheetKeysOf = (template: any) => Object.keys(template || {}).filter(key => key.startsWith('sheet_')).sort();

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // 宿主端点断链修复后，initGameSession 全程不得再请求任何静态资源
  fetchSpy = vi.fn(() => {
    throw new Error('initGameSession 不应发起任何 fetch 请求');
  });
  vi.stubGlobal('fetch', fetchSpy);
  mocks.resetFromTemplate.mockResolvedValue({ saved: true, messageIndex: 0, runtimeReady: true });
  mocks.reconcileTemplate.mockResolvedValue({ saved: true, messageIndex: 0, runtimeReady: true });
  mocks.isSqliteMode.mockReturnValue(false);
  mocks.didSqliteFallback.mockReturnValue(false);
  mocks.sanitizeTemplate.mockImplementation((template: any) => ({ templateStr: JSON.stringify(template) }));
  mocks.upsertTemplatePreset.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('initGameSession 内置默认模板（不再请求宿主静态资源）', () => {
  it('无参调用注入库内默认表结构构造出的模板，且全程零 fetch', async () => {
    const result = await createApi().initGameSession({ name: '测试角色' }, {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.resetFromTemplate).toHaveBeenCalledOnce();

    const injected = mocks.resetFromTemplate.mock.calls[0][0];
    const source = buildDefaultTableTemplateObject_ACU();
    // 形状正确进入 reset 链：对象（非字符串）+ 与单一来源同表集合 + 每表 row_id 表头 + mate
    expect(typeof injected).toBe('object');
    expect(Array.isArray(injected)).toBe(false);
    expect(sheetKeysOf(injected)).toEqual(sheetKeysOf(source));
    expect(sheetKeysOf(injected)).toContain(optionsSheet.uid);
    sheetKeysOf(injected).forEach((key) => {
      expect(injected[key].content[0][0]).toBe('row_id');
    });
    expect(injected.mate).toMatchObject({ type: 'chatSheets', version: 1 });
    expect(mocks.resetFromTemplate).toHaveBeenCalledWith(source, expect.objectContaining({
      reason: 'game_init', source: 'game_init', resetExistingTableData: true,
    }));
    expect(result).toMatchObject({ success: true, templateInjected: true });
  });

  it('内置默认模板走 reset=false 分支时同样进入协调入口，仍零 fetch', async () => {
    const result = await createApi().initGameSession({ name: '测试角色' }, {
      resetExistingTableData: false, loadPreset: false,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.resetFromTemplate).not.toHaveBeenCalled();
    const injected = mocks.reconcileTemplate.mock.calls[0][0];
    expect(sheetKeysOf(injected)).toEqual(sheetKeysOf(buildDefaultTableTemplateObject_ACU()));
    expect(result).toMatchObject({ success: true, templateInjected: true });
  });

  it('显式 options.templateData 旁路不变：原对象直传，不触发内置默认模板', async () => {
    const templateData = { sheet_custom: { uid: 'sheet_custom', name: '自定义表', content: [['row_id', '列']] } };

    const result = await createApi().initGameSession({}, { templateData, loadPreset: false });

    expect(mocks.resetFromTemplate.mock.calls[0][0]).toBe(templateData);
    expect(sheetKeysOf(mocks.resetFromTemplate.mock.calls[0][0])).toEqual(['sheet_custom']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, templateInjected: true });
  });

  it('options.templateData 传字符串时仍按既有兼容逻辑解析', async () => {
    const templateObj = { sheet_custom: { uid: 'sheet_custom', name: '自定义表', content: [['row_id', '列']] } };

    const result = await createApi().initGameSession({}, { templateData: JSON.stringify(templateObj), loadPreset: false });

    expect(mocks.resetFromTemplate.mock.calls[0][0]).toEqual(templateObj);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, templateInjected: true });
  });
});

describe('initGameSession 剧情推进预设（本库不内置预设）', () => {
  it('未提供 presetData：跳过加载、补 warning、不 throw 且初始化链不中断', async () => {
    const api = createApi();
    const importSpy = vi.fn();
    api.importPlotPresetFromData = importSpy;

    const result = await api.initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
    });

    expect(importSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, templateInjected: true, presetLoaded: false });
    expect(result.message).toBe('游戏初始化成功');
    expect(result.warning).toContain('未提供 presetData，跳过剧情推进预设加载（预设由内容方自备）');
    expect(mocks.saveSettings).toHaveBeenCalledOnce();
  });

  it('跳过文案追加到既有 warning 之后，不覆盖模板阶段 warning', async () => {
    mocks.isSqliteMode.mockReturnValue(true);
    mocks.didSqliteFallback.mockReturnValue(true);
    const api = createApi();

    const result = await api.initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
    });

    expect(result.warning).toContain('回退到原生模式');
    expect(result.warning).toContain('未提供 presetData，跳过剧情推进预设加载');
    expect(result.success).toBe(true);
  });

  it('loadPreset=false 显式关闭时不产生跳过 warning', async () => {
    const api = createApi();

    const result = await api.initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      loadPreset: false,
    });

    expect(result).toMatchObject({ success: true, presetLoaded: false });
    expect(result.warning).toBe('');
  });

  it('提供 presetData 时照旧走 importPlotPresetFromData（overwrite + switchTo）', async () => {
    const api = createApi();
    const presetData = { name: '内容方预设', prompts: [] };
    const importSpy = vi.fn(async () => ({ success: true, message: 'ok', presetName: '内容方预设' }));
    api.importPlotPresetFromData = importSpy;

    const result = await api.initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      presetData,
    });

    expect(importSpy).toHaveBeenCalledWith(presetData, { overwrite: true, switchTo: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, presetLoaded: true });
    expect(result.warning).not.toContain('跳过剧情推进预设加载');
  });

  it('presetData 导入失败仍不中断初始化链', async () => {
    const api = createApi();
    api.importPlotPresetFromData = vi.fn(async () => ({ success: false, message: 'JSON解析错误' }));

    const result = await api.initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      presetData: '{bad json',
    });

    expect(result).toMatchObject({ success: true, templateInjected: true, presetLoaded: false });
    expect(result.message).toBe('游戏初始化成功');
  });
});

describe('initGameSession options.presetName 弃用提示（fix8）', () => {
  it('presetName 非空且无 presetData 时 logWarn 一次，初始化语义不受影响', async () => {
    const result = await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      presetName: '旧剧情引导预设',
    });

    expect(vi.mocked(logWarn_ACU)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logWarn_ACU)).toHaveBeenCalledWith('[游戏初始化] options.presetName 已弃用：本库不读取该参数，剧情引导预设请改用 options.presetData 传入。本次调用将忽略 presetName。');
    // presetName 仍被忽略，初始化结果不受影响。
    expect(result).toMatchObject({ success: true, templateInjected: true, presetLoaded: false });
  });

  it('presetName 与 presetData 同时提供时不告警，照常走导入链', async () => {
    const api = createApi();
    const importSpy = vi.fn(async () => ({ success: true, message: 'ok', presetName: '内容方预设' }));
    api.importPlotPresetFromData = importSpy;

    const result = await api.initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      presetName: '旧剧情引导预设',
      presetData: { name: '内容方预设', prompts: [] },
    });

    expect(vi.mocked(logWarn_ACU)).not.toHaveBeenCalled();
    expect(importSpy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, presetLoaded: true });
  });

  it('无 presetName 时不告警', async () => {
    await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
    });

    expect(vi.mocked(logWarn_ACU)).not.toHaveBeenCalled();
  });
});
