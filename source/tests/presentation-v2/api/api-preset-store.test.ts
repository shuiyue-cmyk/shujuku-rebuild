/**
 * API preset store — 阶段 1 API 预设语义
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      {
        name: 'alpha',
        apiMode: 'custom',
        apiConfig: { url: 'https://alpha.test', apiKey: 'ka', model: 'ma', max_tokens: 1000, temperature: 0.7 },
      },
      {
        name: 'beta',
        apiMode: 'custom',
        apiConfig: { url: 'https://beta.test', apiKey: '', model: 'beta-model', max_tokens: 60000, temperature: 1 },
      },
    ],
    defaultApiPresetName: 'alpha',
    apiPresetBindingsByChat: {},
    tableApiPreset: 'beta',
    plotApiPreset: 'beta',
    contentOptimizationSettings: { apiPreset: 'beta' },
    tableApiPresetOverridesByName: { SheetA: 'beta', SheetB: 'other' },
  };
}

async function importStore(settings: any, chatKey = 'chat-A') {
  vi.resetModules();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: chatKey,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  const fetchModels = vi.fn(async () => ({ success: true, models: ['m1', 'm2'] }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [{ id: 'profile-beta', name: 'Beta Profile' }],
    fetchAvailableModels_ACU: fetchModels,
  }));
  const [{ setActivePinia, createPinia }, { useApiPresetStore }] = await Promise.all([
    import('pinia'),
    import('../../../src/presentation-v2/stores/api-preset-store'),
  ]);
  setActivePinia(createPinia());
  return { store: useApiPresetStore(), saveSettings, fetchModels };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useApiPresetStore', () => {
  it('从旧 settings 读取预设、默认项和当前聊天回退', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.presets.map(p => p.name)).toEqual(['alpha', 'beta']);
    expect(store.defaultApiPresetName).toBe('alpha');
    expect(store.activePresetName).toBe('alpha');
    expect(store.currentChatKey).toBe('chat-A');
  });

  it('没有预设时仍能识别当前 API 配置是否可用', async () => {
    const settings = createSettings();
    settings.apiPresets = [];
    settings.defaultApiPresetName = '';
    settings.apiMode = 'custom';
    settings.apiConfig = { url: 'https://direct.test', apiKey: '', model: 'direct-model', useMainApi: false, max_tokens: 1000, temperature: 1 };
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.activePresetName).toBe('');
    expect(store.currentConfigReady).toBe(true);
    expect(store.currentConfigLabel).toBe('direct-model');
  });

  it('没有聊天绑定和全局默认时，会从当前 API 配置反推出匹配预设', async () => {
    const settings = createSettings();
    settings.defaultApiPresetName = '';
    settings.apiPresetBindingsByChat = {};
    settings.apiMode = 'custom';
    settings.apiConfig = { url: 'https://alpha.test', apiKey: 'ka', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7 };
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.activePresetName).toBe('alpha');
    expect(store.currentConfigReady).toBe(true);
  });

  it('同名异协议 / 异后处理预设不再误判为当前配置（仅差一个比较键即不匹配）', async () => {
    const base = () => {
      const settings = createSettings();
      settings.defaultApiPresetName = '';
      settings.apiPresetBindingsByChat = {};
      settings.apiMode = 'custom';
      return settings;
    };

    // 仅接口协议不同（alpha 归一后为 openai_compat）：不得匹配。
    const diffFormat = base();
    diffFormat.apiConfig = { url: 'https://alpha.test', apiKey: 'ka', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7, customApiFormat: 'claude_messages' };
    const { store: storeFormat } = await importStore(diffFormat);
    storeFormat.refreshFromSettings();
    expect(storeFormat.activePresetName).toBe('');

    // 仅提示词后处理不同（alpha 归一后为 strict，当前显式未选择）：不得匹配。
    const diffPost = base();
    diffPost.apiConfig = { url: 'https://alpha.test', apiKey: 'ka', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7, promptPostProcessing: '' };
    const { store: storePost } = await importStore(diffPost);
    storePost.refreshFromSettings();
    expect(storePost.activePresetName).toBe('');

    // 负向控制的反面：两键一致时仍能匹配（归一化后 openai_compat + strict）。
    const sameKeys = base();
    sameKeys.apiConfig = { url: 'https://alpha.test', apiKey: 'ka', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7, customApiFormat: 'openai_compat', promptPostProcessing: 'strict' };
    const { store: storeSame } = await importStore(sameKeys);
    storeSame.refreshFromSettings();
    expect(storeSame.activePresetName).toBe('alpha');
  });

  it('设置当前聊天活动 API 时同步旧当前配置', async () => {
    const settings = createSettings();
    const { store, saveSettings } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.setActivePresetForCurrentChat('beta')).toBe(true);

    expect(store.activePresetName).toBe('beta');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('beta');
    expect(settings.apiMode).toBe('custom');
    expect(settings.apiConfig.model).toBe('beta-model');
    expect(saveSettings).toHaveBeenCalled();
  });

  it('保存当前活动预设时同步当前聊天 apiConfig 细节字段', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'alpha', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.savePreset({
      name: 'alpha',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://alpha-2.test',
        apiKey: 'ka2',
        model: 'ma2',
        max_tokens: 2048,
        temperature: 0.25,
        bodyParams: '{"top_p":0.9}',
        excludeBodyParams: 'temperature',
        requestHeaders: '{"x-test":"1"}',
      },
    }, 'alpha')).toBe(true);

    expect(store.activePresetName).toBe('alpha');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('alpha');
    expect(settings.apiConfig).toEqual(expect.objectContaining({
      url: 'https://alpha-2.test',
      apiKey: 'ka2',
      model: 'ma2',
      max_tokens: 2048,
      temperature: 0.25,
      bodyParams: '{"top_p":0.9}',
      excludeBodyParams: 'temperature',
      requestHeaders: '{"x-test":"1"}',
    }));
  });

  it('删除预设时清理默认、当前聊天和功能引用', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'beta', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.deletePreset('beta')).toBe(true);

    expect(store.presets.map(p => p.name)).toEqual(['alpha']);
    expect(settings.tableApiPreset).toBe('');
    expect(settings.plotApiPreset).toBe('');
    expect(settings.contentOptimizationSettings.apiPreset).toBe('');
    expect(settings.tableApiPresetOverridesByName).toEqual({ SheetB: 'other' });
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('alpha');
  });

  it('保存重命名预设时迁移默认和聊天绑定', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'alpha', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.savePreset({
      name: 'renamed',
      apiMode: 'custom',
      apiConfig: { url: 'https://r.test', apiKey: '', model: 'mr', max_tokens: 2048, temperature: 0.8 },
    }, 'alpha')).toBe(true);

    expect(store.defaultApiPresetName).toBe('renamed');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('renamed');
    expect(store.activePresetName).toBe('renamed');
    expect(settings.apiConfig).toEqual(expect.objectContaining({
      url: 'https://r.test',
      model: 'mr',
      max_tokens: 2048,
      temperature: 0.8,
    }));
    expect(settings.apiPresets.map((p: any) => p.name)).toContain('renamed');
  });

  it('保存非活动预设时不覆盖当前聊天 apiConfig', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'alpha', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.savePreset({
      name: 'beta',
      apiMode: 'custom',
      apiConfig: { url: 'https://beta-2.test', apiKey: '', model: 'beta2', max_tokens: 777, temperature: 1.5, bodyParams: '{"a":1}', excludeBodyParams: '', requestHeaders: '' },
    }, 'beta')).toBe(true);

    expect(store.activePresetName).toBe('alpha');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('alpha');
    expect(settings.apiConfig.url).toBe('');
    expect(settings.apiConfig.max_tokens).toBe(60000);
  });

  it('模型探活透传接口协议：loadModelsForConfig 把 customApiFormat 作为第三参交给 service', async () => {
    const { store, fetchModels } = await importStore(createSettings());

    await expect(store.loadModelsForConfig({
      url: 'https://alpha.test',
      apiKey: 'ka',
      customApiFormat: 'claude_messages',
    })).resolves.toBe(true);

    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledWith('https://alpha.test', 'ka', 'claude_messages');
    expect(store.modelOptions).toEqual(['m1', 'm2']);
    expect(store.modelLoadStatus).toBe('success');
  });

  it('模型探活：草稿未配置接口协议时传空串（由 service 降级为 TT 默认协议）', async () => {
    const { store, fetchModels } = await importStore(createSettings());

    await store.loadModelsForConfig({ url: 'https://alpha.test', apiKey: 'ka' });

    expect(fetchModels).toHaveBeenCalledWith('https://alpha.test', 'ka', '');
  });

  it('模型探活：url/apiKey 缺失时仍以空串占位，不传 undefined', async () => {
    const { store, fetchModels } = await importStore(createSettings());

    await store.loadModelsForConfig({ customApiFormat: 'gemini_interactions' });

    expect(fetchModels).toHaveBeenCalledWith('', '', 'gemini_interactions');
  });
});
