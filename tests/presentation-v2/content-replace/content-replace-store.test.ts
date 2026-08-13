/**
 * content-replace-store — 正文替换设置边界与快捷操作
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSettings() {
  return {
    apiPresets: [
      { name: 'fast', apiConfig: {} },
      { name: 'quality', apiConfig: {} },
    ],
    contentOptimizationSettings: {
      enabled: false,
      apiPreset: 'fast',
      seamlessMode: true,
      autoApply: true,
      showDiff: true,
      parallelMode: false,
      minLength: 100,
      maxOptimizations: 10,
      loopCount: 1,
      retryCount: 3,
      extractTags: '',
      extractRules: [],
      excludeTags: '',
      excludeRules: [],
      promptGroup: [
        { role: 'USER', content: '优化 $CONTENT', deletable: true, mainSlot: 'A' },
      ],
      promptPresets: [],
    },
  } as any;
}

async function setupStore() {
  vi.resetModules();
  const settings = createSettings();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  const performOptimization = vi.fn(async () => ({
    success: true,
    optimizations: [{ original: '旧句子', optimized: '新句子', plan: '更顺' }],
    optimizedContent: '新句子',
    summary: '完成',
  }));
  const replaceChatMessage = vi.fn(async () => true);
  const getOriginalContent = vi.fn(() => '旧句子');
  const getLastOptimizedMessageIndex = vi.fn(() => 2);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../../src/service/optimization/content-optimization', () => ({
    performContentOptimization_ACU: performOptimization,
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getOriginalContent_ACU: getOriginalContent,
    replaceChatMessage_ACU: replaceChatMessage,
  }));
  vi.doMock('../../../src/service/plot/plot-logic', () => ({
    getLastOptimizedMessageIndex_ACU: getLastOptimizedMessageIndex,
  }));

  const pinia = await import('pinia');
  pinia.setActivePinia(pinia.createPinia());
  const mod = await import('../../../src/presentation-v2/stores/content-replace-store');
  const toastMod = await import('../../../src/presentation-v2/stores/toast-store');
  const store = mod.useContentReplaceStore();
  const toast = toastMod.useToastStore();
  store.refreshFromSettings();

  return {
    store,
    settings,
    saveSettings,
    performOptimization,
    replaceChatMessage,
    getOriginalContent,
    getLastOptimizedMessageIndex,
    toast,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useContentReplaceStore', () => {
  it('从 settings 读取正文替换配置和 API 预设', async () => {
    const { store } = await setupStore();

    expect(store.apiPresetNames).toEqual(['fast', 'quality']);
    expect(store.apiPreset).toBe('fast');
    expect(store.promptGroup[0].content).toBe('优化 $CONTENT');
    expect(store.lastOptimizedMessageIndex).toBe(2);
  });

  it('保存基础字段时写回 contentOptimizationSettings', async () => {
    const { store, settings, saveSettings } = await setupStore();

    store.setBoolean('enabled', true);
    store.setNumber('loopCount', 99);
    store.setString('apiPreset', 'quality');

    expect(settings.contentOptimizationSettings.enabled).toBe(true);
    expect(settings.contentOptimizationSettings.loopCount).toBe(10);
    expect(settings.contentOptimizationSettings.apiPreset).toBe('quality');
    expect(saveSettings).toHaveBeenCalled();
  });

  it('保存、载入、删除正文替换提示词预设', async () => {
    const { store, settings } = await setupStore();

    store.setString('presetNameDraft', '清爽改写');
    store.savePreset();
    expect(settings.contentOptimizationSettings.promptPresets[0].name).toBe('清爽改写');

    store.updatePromptSegment(0, { content: '另一套提示词' });
    store.selectPreset('清爽改写');
    expect(store.promptGroup[0].content).toBe('优化 $CONTENT');

    store.deletePreset();
    expect(settings.contentOptimizationSettings.promptPresets).toEqual([]);
  });

  it('编辑目标正文替换预设时会同步更新预设库，重命名不影响提示词内容', async () => {
    const { store, settings } = await setupStore();

    store.setString('presetNameDraft', '清爽改写');
    store.savePreset();
    store.updatePromptSegment(0, { content: '重写后的模板 $CONTENT' });
    store.savePromptGroupToPreset('清爽改写');

    expect(settings.contentOptimizationSettings.promptPresets[0].promptGroup[0].content).toBe('重写后的模板 $CONTENT');

    store.renamePreset('清爽改写', '细腻改写');

    expect(settings.contentOptimizationSettings.promptPresets[0].name).toBe('细腻改写');
    expect(settings.contentOptimizationSettings.promptPresets[0].promptGroup[0].content).toBe('重写后的模板 $CONTENT');
  });

  it('默认预设使用内置提示词，且从默认新建会生成可编辑预设', async () => {
    const { store, settings } = await setupStore();

    store.setString('presetNameDraft', '清爽改写');
    store.savePreset();
    store.updatePromptSegment(0, { content: '另一套提示词 $CONTENT' });
    store.selectPreset('');

    expect(store.activePresetLabel).toBe('默认预设');
    expect(store.selectedPresetName).toBe('');
    expect(settings.contentOptimizationSettings.promptGroup[0].content).not.toBe('另一套提示词 $CONTENT');
    expect(settings.contentOptimizationSettings.promptGroup.some((seg: any) => String(seg.content || '').includes('$CONTENT'))).toBe(true);

    store.createPresetFromDefault();

    expect(store.selectedPresetName).toBe('新正文替换预设');
    expect(settings.contentOptimizationSettings.promptPresets.map((p: any) => p.name)).toContain('新正文替换预设');
    expect(settings.contentOptimizationSettings.promptGroup.some((seg: any) => String(seg.content || '').includes('$CONTENT'))).toBe(true);
  });

  it('不能覆盖内置默认预设名称', async () => {
    const { store, settings } = await setupStore();

    store.setString('presetNameDraft', '默认预设');
    store.savePreset();

    expect(settings.contentOptimizationSettings.promptPresets).toEqual([]);
    expect(store.message?.kind).toBe('warning');
  });

  it('手动测试调用正文优化 service 并展示结果', async () => {
    const { store, performOptimization, toast } = await setupStore();

    store.setString('testInput', '这是一段足够长的测试正文。');
    await store.runTest();

    expect(performOptimization).toHaveBeenCalledWith('这是一段足够长的测试正文。', { currentLoop: 1, userMessage: '' });
    expect(store.testOutput).toContain('优化完成：1 处建议');
    expect(store.message).toBeNull();
    expect(toast.items.map(item => item.text)).toContain('正文替换测试完成。');
  });

  it('重新优化最近一次会读取原文、优化并写回聊天消息', async () => {
    const { store, performOptimization, replaceChatMessage, getOriginalContent, toast } = await setupStore();

    store.setBoolean('enabled', true);
    await store.reoptimizeLatest();

    expect(getOriginalContent).toHaveBeenCalledWith(2);
    expect(performOptimization).toHaveBeenCalledWith('旧句子', { currentLoop: 1, userMessage: '' });
    expect(replaceChatMessage).toHaveBeenCalledWith(2, '新句子', { originalContent: '旧句子' });
    expect(store.message).toBeNull();
    expect(toast.items.map(item => item.text)).toContain('已重新优化并替换 1 处内容。');
  });
});
