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
  let currentChatIdentity = 'chat-a';
  let currentChat = [
    { message_id: 'a-0', mes: '开场' },
    { message_id: 'a-1', mes: '用户' },
    { message_id: 'a-2', mes: '旧句子' },
  ];
  const getChatArray = vi.fn(() => currentChat);
  const getOriginalContent = vi.fn(() => '旧句子');
  const getLastOptimizedMessageIndex = vi.fn(() => 2);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    get currentChatFileIdentifier_ACU() { return currentChatIdentity; },
  }));
  vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
    getChatArray_ACU: getChatArray,
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
    setChat: (identity: string, chat: any[]) => {
      currentChatIdentity = identity;
      currentChat = chat;
    },
    toast,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useContentReplaceStore', () => {

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

  it('[MVU联动] 闸门恒开启：store 不再持有开关，保存时不写顶层键', async () => {
    const { store, settings, saveSettings } = await setupStore();

    // 开关已删除：store 上无该字段，联动永远生效
    expect((store as any).mvuGateEnabled).toBeUndefined();
    expect(settings.mvuGateEnabled).toBeUndefined();
    expect(settings.contentOptimizationSettings.mvuGateEnabled).toBeUndefined();

    // 任意一次保存都不应写出该键
    store.setBoolean('showDiff', false);
    expect(saveSettings).toHaveBeenCalled();
    expect(settings.mvuGateEnabled).toBeUndefined();
  });

  it('忽略MVU更新开关默认关闭，setBoolean 写回并可回读', async () => {
    const { store, settings } = await setupStore();

    expect(store.ignoreMvuUpdate).toBe(false);

    store.setBoolean('ignoreMvuUpdate', true);
    expect(settings.contentOptimizationSettings.ignoreMvuUpdate).toBe(true);

    store.setBoolean('ignoreMvuUpdate', false);
    expect(settings.contentOptimizationSettings.ignoreMvuUpdate).toBe(false);
    expect(store.ignoreMvuUpdate).toBe(false);
  });

  it('替换前判定：开关、key、模型、门槛规整后写回 contentOptimizationSettings.decisionGate', async () => {
    const { store, settings, saveSettings } = await setupStore();

    expect(store.decisionGate).toEqual({ enabled: false, apiKey: '', model: '~typesafe/jev-latest', threshold: 50 });

    store.setDecisionGate({ enabled: true, apiKey: ' sk-or-x ', threshold: 130 });
    store.setDecisionGate({ model: 'inception/mercury-decide:free' });

    expect(settings.contentOptimizationSettings.decisionGate).toEqual({
      enabled: true, apiKey: 'sk-or-x', model: 'inception/mercury-decide:free', threshold: 100,
    });
    expect(saveSettings).toHaveBeenCalled();
    store.refreshFromSettings();
    expect(store.decisionGate.model).toBe('inception/mercury-decide:free');
  });

  it('测试判定：用测试文本直连决策接口，结果写进测试输出', async () => {
    const { store } = await setupStore();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ model: 'typesafe/jev-1.13', answers: { quality: { type: 'choice', choice: '好', probabilities: { 好: 0.83, 不好: 0.17 } } } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    store.setDecisionGate({ apiKey: 'sk-or-x' });
    store.setString('testInput', '夜色漫过屋檐，她收起最后一封信。');

    await store.runDecisionTest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.testOutput).toContain('好');
    expect(store.testOutput).toContain('83%');
    expect(store.testOutput).toContain('会替换');
  });

  it('测试判定与自动判定口径一致：先按提取/排除标签处理测试文本', async () => {
    const { store } = await setupStore();
    const fetchMock = vi.fn(async (_url: string, _init: any) => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { quality: { type: 'choice', choice: '好', probabilities: { 好: 0.9 } } } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    store.setDecisionGate({ apiKey: 'sk-or-x' });
    store.setString('extractTags', 'content');
    store.setString('testInput', '<thinking>先想一想这一段怎么写</thinking><content>夜色漫过屋檐，她收起最后一封信。</content>');

    await store.runDecisionTest();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.state).not.toContain('先想一想');
    expect(body.state).toContain('夜色漫过屋檐');
  });

  it('测试判定：没填 key 时提示，不发请求', async () => {
    const { store } = await setupStore();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    store.setString('testInput', '夜色漫过屋檐，她收起最后一封信。');

    await store.runDecisionTest();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.message?.text).toContain('Key');
  });

  it('新建、载入、删除正文替换提示词预设', async () => {
    const { store, settings } = await setupStore();

    store.createPresetFromDefault();
    expect(settings.contentOptimizationSettings.promptPresets[0].name).toBe('新正文替换预设');
    const presetContent = settings.contentOptimizationSettings.promptPresets[0].promptGroup[0].content;

    store.updatePromptSegment(0, { content: '另一套提示词' });
    store.selectPreset('新正文替换预设');
    expect(store.promptGroup[0].content).toBe(presetContent);

    store.deletePresetByName('新正文替换预设');
    expect(settings.contentOptimizationSettings.promptPresets).toEqual([]);
  });

  it('编辑目标正文替换预设时会同步更新预设库，重命名不影响提示词内容', async () => {
    const { store, settings } = await setupStore();

    store.createPresetFromDefault();
    store.renamePreset('新正文替换预设', '清爽改写');
    store.updatePromptSegment(0, { content: '重写后的模板 $CONTENT' });
    store.savePromptGroupToPreset('清爽改写');

    expect(settings.contentOptimizationSettings.promptPresets[0].promptGroup[0].content).toBe('重写后的模板 $CONTENT');

    store.renamePreset('清爽改写', '细腻改写');

    expect(settings.contentOptimizationSettings.promptPresets[0].name).toBe('细腻改写');
    expect(settings.contentOptimizationSettings.promptPresets[0].promptGroup[0].content).toBe('重写后的模板 $CONTENT');
  });

  it('默认预设使用内置提示词，且从默认新建会生成可编辑预设', async () => {
    const { store, settings } = await setupStore();

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

  it('不能把预设改名为内置默认预设名称', async () => {
    const { store, settings } = await setupStore();

    store.createPresetFromDefault();
    store.renamePreset('新正文替换预设', '默认预设');

    expect(settings.contentOptimizationSettings.promptPresets.map((p: any) => p.name)).toEqual(['新正文替换预设']);
    expect(store.message?.kind).toBe('warning');
  });

  it('重新优化等待期间切换聊天会拒绝旧 index 写回', async () => {
    const { store, performOptimization, replaceChatMessage, setChat } = await setupStore();
    store.setBoolean('enabled', true);
    let resolveOptimization: ((value: any) => void) | null = null;
    performOptimization.mockImplementation(() => new Promise(resolve => { resolveOptimization = resolve; }));

    const pending = store.reoptimizeLatest();
    await Promise.resolve();
    setChat('chat-b', [
      { message_id: 'b-0', mes: 'B 开场' },
      { message_id: 'b-1', mes: 'B 用户' },
      { message_id: 'b-2', mes: 'B 原文' },
    ]);
    resolveOptimization?.({
      success: true,
      optimizations: [{ original: '旧句子', optimized: 'A 新句子', plan: '改写' }],
      optimizedContent: 'A 新句子',
      summary: '完成',
    });
    await pending;

    expect(replaceChatMessage).not.toHaveBeenCalled();
    expect(store.message?.kind).toBe('error');
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

  it('R10B-03：未保存的提示词草稿不会被其它开关/数字/标签修改顺带写进设置', async () => {
    const { store, settings } = await setupStore();
    store.updatePromptSegment(0, { content: '半截草稿，没有占位符' });

    store.setBoolean('showDiff', false);
    store.setNumber('minLength', 200);
    store.setString('extractTags', 'content');

    const cfg = settings.contentOptimizationSettings;
    expect(cfg.promptGroup[0].content).toBe('优化 $CONTENT');
    expect(cfg.showDiff).toBe(false);
    expect(cfg.minLength).toBe(200);
    expect(cfg.extractTags).toBe('content');
    // 草稿仍在编辑器里，没有被基础字段保存冲掉
    expect(store.promptGroup[0].content).toBe('半截草稿，没有占位符');
    expect(store.promptDirty).toBe(true);
  });

  it('R10B-03：确认放弃后 discardPromptDraft 从设置重新载入提示词并清掉脏标记', async () => {
    const { store, settings } = await setupStore();
    store.updatePromptSegment(0, { content: '半截草稿' });

    store.discardPromptDraft();

    expect(store.promptGroup[0].content).toBe('优化 $CONTENT');
    expect(store.promptDirty).toBe(false);
    store.setBoolean('showDiff', false);
    expect(settings.contentOptimizationSettings.promptGroup[0].content).toBe('优化 $CONTENT');
  });

  it('R10B-12：保存提示词时设置写入失败，不报「已保存」，设置保持原样且草稿保留', async () => {
    const { store, settings, saveSettings, toast } = await setupStore();
    store.updatePromptSegment(0, { content: '新提示词 $CONTENT' });
    saveSettings.mockReturnValueOnce({ saved: false, storageType: 'memory', error: '写入失败' } as any);

    store.savePromptGroup();

    expect(settings.contentOptimizationSettings.promptGroup[0].content).toBe('优化 $CONTENT');
    expect(store.promptGroup[0].content).toBe('新提示词 $CONTENT');
    expect(store.promptDirty).toBe(true);
    expect(toast.items.map(item => item.text)).not.toContain('正文替换提示词已保存。');
    expect(toast.items.some(item => item.kind === 'error')).toBe(true);
  });

  it('R10B-12：开关保存失败时回到原值', async () => {
    const { store, settings, saveSettings } = await setupStore();
    saveSettings.mockReturnValueOnce({ saved: false, storageType: 'memory', error: '写入失败' } as any);

    store.setBoolean('showDiff', false);

    expect(store.showDiff).toBe(true);
    expect(settings.contentOptimizationSettings.showDiff).toBe(true);
  });
});

