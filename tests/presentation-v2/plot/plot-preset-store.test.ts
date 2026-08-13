/**
 * plot-preset-store — D23 剧情推进页 store 语义
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSettings() {
  return {
    plotSettings: {
      enabled: false,
      promptPresets: [
        { name: '记忆召回', plotTasks: [{ id: 't1', name: 'A', stage: 1, order: 0 }] },
        { name: '低速推进', plotTasks: [{ id: 't2', name: 'B', stage: 1, order: 0 }] },
      ],
      lastUsedPresetName: '记忆召回',
    },
    plotApiPreset: '',
    plotTaskApiPresetOverridesById: {} as Record<string, string>,
    apiPresets: [
      { name: 'claude-fast', apiMode: 'custom', apiConfig: {}, tavernProfile: '' },
      { name: 'gpt-4o', apiMode: 'custom', apiConfig: {}, tavernProfile: '' },
    ],
  } as any;
}

async function importStore(settings: any) {
  vi.resetModules();
  const saveSettings = vi.fn(() => ({ saved: true }));
  const setGlobalPlotEnabled = vi.fn((val: boolean) => {
    if (settings.plotSettings) settings.plotSettings.enabled = val;
    return val;
  });

  // Stub out chat scope side-effects for deterministic store assertions.
  const switchCurrentChatPlotPreset = vi.fn((presetName: string) => {
    settings.__lastSwitchTo = presetName;
    return { presetName, isDefault: !presetName, followsGlobal: !presetName };
  });
  const applyGlobalPlotPresetSelectionForEditor = vi.fn((name: string) => {
    settings.plotSettings.lastUsedPresetName = name;
    return { presetName: name, isDefault: !name, previewSettings: settings.plotSettings };
  });

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-plot',
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
    setGlobalPlotEnabled_ACU: setGlobalPlotEnabled,
  }));

  // Spy on plot-logic but keep behavior for normalization helpers.
  const realLogic = await import('../../../src/service/plot/plot-logic');
  vi.doMock('../../../src/service/plot/plot-logic', () => ({
    ...realLogic,
    switchCurrentChatPlotPreset_ACU: switchCurrentChatPlotPreset,
    applyGlobalPlotPresetSelectionForEditor_ACU: applyGlobalPlotPresetSelectionForEditor,
    getCurrentRuntimePlotPresetName_ACU: () => settings.plotSettings?.lastUsedPresetName || '',
    getPlotPresetBindingForChat_ACU: () => null,
    clearPlotPresetBindingForChat_ACU: vi.fn(),
  }));

  const [{ setActivePinia, createPinia }, { usePlotPresetStore }] = await Promise.all([
    import('pinia'),
    import('../../../src/presentation-v2/stores/plot-preset-store'),
  ]);
  setActivePinia(createPinia());
  return {
    store: usePlotPresetStore(),
    saveSettings,
    setGlobalPlotEnabled,
    switchCurrentChatPlotPreset,
    applyGlobalPlotPresetSelectionForEditor,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('usePlotPresetStore', () => {
  it('refreshFromSettings 读取 enabled / presets / 默认 / 当前活动', async () => {
    const settings = createSettings();
    settings.plotSettings.enabled = true;
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.enabled).toBe(true);
    expect(store.presets).toHaveLength(2);
    expect(store.presets.map(p => p.name)).toEqual(['记忆召回', '低速推进']);
    expect(store.defaultPresetName).toBe('记忆召回');
    expect(store.activePresetName).toBe('记忆召回');
    expect(store.activePreset?.name).toBe('记忆召回');
    expect(store.defaultPresetTaskCount).toBe(1);
  });

  it('isChatOverridden 仅在当前聊天选择偏离全局默认时为 true', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    store.defaultPresetName = '记忆召回';
    store.activePresetName = '记忆召回';
    expect(store.isChatOverridden).toBe(false);

    store.activePresetName = '低速推进';
    expect(store.isChatOverridden).toBe(true);

    store.defaultPresetName = '';
    store.activePresetName = '';
    expect(store.isChatOverridden).toBe(false);
  });

  it('setEnabled 调 setGlobalPlotEnabled_ACU 并触发保存', async () => {
    const settings = createSettings();
    const { store, setGlobalPlotEnabled, saveSettings } = await importStore(settings);
    store.refreshFromSettings();

    store.setEnabled(true);

    expect(setGlobalPlotEnabled).toHaveBeenCalledWith(true);
    expect(saveSettings).toHaveBeenCalled();
    expect(store.enabled).toBe(true);
  });

  it('setActivePresetForCurrentChat 走 switchCurrentChatPlotPreset_ACU', async () => {
    const settings = createSettings();
    const { store, switchCurrentChatPlotPreset } = await importStore(settings);
    store.refreshFromSettings();

    const ok = store.setActivePresetForCurrentChat('低速推进');
    expect(ok).toBe(true);
    expect(switchCurrentChatPlotPreset).toHaveBeenCalledWith('低速推进', { source: 'ui_v2', save: true });
  });

  it('setDefaultPreset 走 applyGlobalPlotPresetSelectionForEditor_ACU', async () => {
    const settings = createSettings();
    const { store, applyGlobalPlotPresetSelectionForEditor } = await importStore(settings);
    store.refreshFromSettings();

    const ok = store.setDefaultPreset('低速推进');
    expect(ok).toBe(true);
    expect(applyGlobalPlotPresetSelectionForEditor).toHaveBeenCalledWith('低速推进', expect.objectContaining({ source: 'ui_v2_set_default' }));
  });

  it('setDefaultPreset 支持把默认预设设为全局默认', async () => {
    const settings = createSettings();
    const { store, applyGlobalPlotPresetSelectionForEditor } = await importStore(settings);
    store.refreshFromSettings();

    const ok = store.setDefaultPreset('');
    expect(ok).toBe(true);
    expect(applyGlobalPlotPresetSelectionForEditor).toHaveBeenCalledWith('', expect.objectContaining({ source: 'ui_v2_set_default' }));
  });

  it('setPageApiPreset 写回 settings.plotApiPreset 并保存', async () => {
    const settings = createSettings();
    const { store, saveSettings } = await importStore(settings);
    store.refreshFromSettings();

    store.setPageApiPreset('claude-fast');

    expect(store.pageApiPresetName).toBe('claude-fast');
    expect(settings.plotApiPreset).toBe('claude-fast');
    expect(saveSettings).toHaveBeenCalled();
  });

  it('setTaskApiOverride 写入 plotTaskApiPresetOverridesById；空字符串清除 override', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    store.setTaskApiOverride('t1', 'gpt-4o');
    expect(settings.plotTaskApiPresetOverridesById).toEqual({ t1: 'gpt-4o' });
    expect(store.taskApiOverrides.t1).toBe('gpt-4o');

    store.setTaskApiOverride('t1', '');
    expect(settings.plotTaskApiPresetOverridesById).toEqual({});
    expect(store.taskApiOverrides.t1).toBeUndefined();
  });

  it('savePreset 创建新预设并写回 promptPresets', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const ok = store.savePreset({
      name: '新预设',
      raw: {
        name: '新预设',
        plotTasks: [{ id: 'tn', name: 'NewTask', stage: 1, order: 0 }],
      },
    });

    expect(ok).toBe(true);
    expect(settings.plotSettings.promptPresets.map((p: any) => p.name)).toContain('新预设');
  });

  it('savePreset 更新当前活动预设时应用预设内的匹配替换参数', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const ok = store.savePreset({
      name: '记忆召回',
      raw: {
        name: '记忆召回',
        plotTasks: [{ id: 't1', name: 'A edited', stage: 1, order: 0 }],
        rateMain: 2.25,
        ratePersonal: 1.75,
        rateErotic: 0.5,
        rateCuckold: 1.25,
        recallCount: 42,
      },
    }, '记忆召回');

    expect(ok).toBe(true);
    const savedPreset = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '记忆召回');
    expect(savedPreset.rateMain).toBe(2.25);
    expect(savedPreset.recallCount).toBe(42);
    expect(settings.plotSettings.rateMain).toBe(2.25);
    expect(settings.plotSettings.ratePersonal).toBe(1.75);
    expect(settings.plotSettings.rateErotic).toBe(0.5);
    expect(settings.plotSettings.rateCuckold).toBe(1.25);
    expect(settings.plotSettings.recallCount).toBe(42);
  });

  it('deletePreset 删除并清理 lastUsedPresetName', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const ok = store.deletePreset('记忆召回');
    expect(ok).toBe(true);
    expect(settings.plotSettings.promptPresets.map((p: any) => p.name)).not.toContain('记忆召回');
    expect(settings.plotSettings.lastUsedPresetName).toBe('');
  });

  it('importPresetFromJson 重名时覆盖同名预设，保持旧 UI 导入语义', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const json = JSON.stringify([
      {
        name: '记忆召回',
        plotTasks: [{ id: 'tx', name: 'X', stage: 1, order: 0 }],
      },
    ]);
    const result = store.importPresetFromJson(json);
    expect(result).toBe('记忆召回');
    expect(settings.plotSettings.promptPresets.map((preset: any) => preset.name)).not.toContain('记忆召回 (2)');
    const imported = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '记忆召回');
    expect(imported.plotTasks[0].id).toBe('tx');
  });

  it('importPresetFromJson 保留剧情上下文过滤规则并移除旧字符串字段', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const json = JSON.stringify([
      {
        name: '带过滤预设',
        plotTasks: [{ id: 'tf', name: 'FilterTask', stage: 1, order: 0 }],
        contextExtractTags: 'recall',
        contextExcludeRules: [{ start: '<thinking>', end: '</thinking>' }],
      },
    ]);
    const result = store.importPresetFromJson(json);
    expect(result).toBe('带过滤预设');

    const imported = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '带过滤预设');
    expect(imported.contextExtractRules).toEqual([{ start: '<recall', end: '</recall>' }]);
    expect(imported.contextExcludeRules).toEqual([{ start: '<thinking>', end: '</thinking>' }]);
    expect(imported.contextExtractTags).toBeUndefined();
    expect(imported.contextExcludeTags).toBeUndefined();
  });

  it('importPresetFromJson 兼容旧 UI 导出的数组根节点格式', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const json = JSON.stringify([
      {
        name: '旧导出预设',
        plotTasks: [{ id: 'legacy-task', name: '旧任务', stage: 2, order: 0 }],
      },
    ]);
    const result = store.importPresetFromJson(json);
    expect(result).toBe('旧导出预设');

    const imported = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '旧导出预设');
    expect(imported).toBeDefined();
    expect(imported.plotTasks).toHaveLength(1);
    expect(imported.plotTasks[0].id).toBe('legacy-task');
    expect(imported.plotTasks[0].name).toBe('旧任务');
    expect(imported.plotTasks[0].stage).toBe(2);
  });

  it('importPresetFromJson 一次导入数组内多个有效预设并返回第一个名称', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const json = JSON.stringify([
      {
        name: '第一项',
        plotTasks: [{ id: 'one', name: 'One', stage: 1, order: 0 }],
      },
      {
        name: '第二项',
        plotTasks: [{ id: 'two', name: 'Two', stage: 1, order: 0 }],
      },
    ]);
    const result = store.importPresetFromJson(json);
    expect(result).toBe('第一项');
    expect(settings.plotSettings.promptPresets.map((preset: any) => preset.name)).toContain('第一项');
    expect(settings.plotSettings.promptPresets.map((preset: any) => preset.name)).toContain('第二项');
  });

  it('importPresetFromJson 缺少有效 name 时返回 null，不创建“导入预设”默认内容', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const result = store.importPresetFromJson(JSON.stringify([{ plotTasks: [{ id: 'missing-name' }] }]));
    expect(result).toBeNull();
    expect(settings.plotSettings.promptPresets.map((preset: any) => preset.name)).not.toContain('导入预设');
  });

  it('importPresetFromJson 对象根节点返回 null，不接受 v2 私有格式', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const result = store.importPresetFromJson(JSON.stringify({
      name: '对象根预设',
      plotTasks: [{ id: 'object-root' }],
    }));
    expect(result).toBeNull();
    expect(settings.plotSettings.promptPresets.map((preset: any) => preset.name)).not.toContain('对象根预设');
  });

  it('exportPresetAsJson 使用数组根节点，兼容旧 UI 导入', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const json = store.exportPresetAsJson('记忆召回');
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe('记忆召回');
  });

  it('exportPresetAsJson 省略等于默认值的匹配替换参数', async () => {
    const settings = createSettings();
    Object.assign(settings.plotSettings.promptPresets[0], {
      rateMain: 1,
      ratePersonal: 1,
      rateErotic: 0,
      rateCuckold: 1,
      recallCount: 20,
    });
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const parsed = JSON.parse(store.exportPresetAsJson('记忆召回')!);
    expect(parsed[0].rateMain).toBeUndefined();
    expect(parsed[0].ratePersonal).toBeUndefined();
    expect(parsed[0].rateErotic).toBeUndefined();
    expect(parsed[0].rateCuckold).toBeUndefined();
    expect(parsed[0].recallCount).toBeUndefined();
  });

  it('exportPresetAsJson 保留非默认匹配替换参数', async () => {
    const settings = createSettings();
    Object.assign(settings.plotSettings.promptPresets[0], {
      rateMain: 1.5,
      ratePersonal: 1,
      rateErotic: 0,
      rateCuckold: 1,
      recallCount: 12,
    });
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    const parsed = JSON.parse(store.exportPresetAsJson('记忆召回')!);
    expect(parsed[0].rateMain).toBe(1.5);
    expect(parsed[0].recallCount).toBe(12);
    expect(parsed[0].ratePersonal).toBeUndefined();
    expect(parsed[0].rateErotic).toBeUndefined();
    expect(parsed[0].rateCuckold).toBeUndefined();
  });

  it('importPresetFromJson 非法 JSON 返回 null', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.importPresetFromJson('not json')).toBeNull();
  });
});
