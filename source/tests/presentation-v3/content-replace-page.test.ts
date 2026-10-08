/**
 * ContentReplacePage 集成 — 正文替换页分节与关键交互
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    apiPresets: [{ name: 'fast', apiMode: 'custom', apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 1000, temperature: 1 }, tavernProfile: '' }],
    defaultApiPresetName: 'fast',
    apiPresetBindingsByChat: {},
    contentOptimizationSettings: {
      enabled: false,
      apiPreset: '',
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
      promptPresets: [
        {
          name: '默认优化',
          promptGroup: [{ role: 'USER', content: '预设 $CONTENT', deletable: true }],
        },
      ],
    },
  } as any;
}

async function mountContentReplacePage() {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';

  const settings = createSettings();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  const performOptimization = vi.fn(async () => ({
    success: true,
    optimizations: [{ original: '旧句子', optimized: '新句子', plan: '更顺' }],
    optimizedContent: '新句子',
    summary: '完成',
  }));

  vi.doMock('../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-content-replace',
  }));
  vi.doMock('../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../src/service/optimization/content-optimization', () => ({
    performContentOptimization_ACU: performOptimization,
  }));
  vi.doMock('../../src/service/chat/chat-service', () => ({
    getOriginalContent_ACU: vi.fn(() => '旧句子'),
    replaceChatMessage_ACU: vi.fn(async () => true),
  }));
  vi.doMock('../../src/service/plot/plot-logic', () => ({
    getLastOptimizedMessageIndex_ACU: vi.fn(() => 3),
  }));
  vi.doMock('../../src/presentation-v2/composables/useChatChangedListener', async () => {
    const vue = await vi.importActual<typeof import('vue')>('vue');
    return {
      useChatChangedTick: () => vue.ref(0),
      watchChatChanged_ACU: () => {},
    };
  });

  const vue = await import('vue');
  const pinia = await import('pinia');
  const Page = (await import('../../src/presentation-v3/pages/ContentReplacePage.vue')).default;
  const app = vue.createApp(Page);
  app.use(pinia.createPinia());
  const portal = document.createElement('div');
  portal.id = 'ub-portal';
  document.body.appendChild(portal);
  const root = document.createElement('div');
  document.body.appendChild(root);
  app.mount(root);
  await new Promise(r => setTimeout(r, 0));

  return { app, settings, saveSettings, performOptimization };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tick = () => new Promise(r => setTimeout(r, 0));
const page = () => document.body;
const btn = (text: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes(text));

describe('ContentReplacePage', () => {
  it('五个分节齐全，页面里不再有启用开关', async () => {
    const { app } = await mountContentReplacePage();
    for (const id of ['cr-basic', 'cr-mode', 'cr-preset', 'cr-filter', 'cr-test']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    expect(page().textContent).not.toContain('启用开关在仪表盘');
    expect(document.querySelector('[data-ub-row="启用正文替换"]')).toBeNull();
    app.unmount();
  });

  it('API 预设下拉的跟随项显示当前活动 API 预设名', async () => {
    const { app } = await mountContentReplacePage();
    const select = document.querySelector<HTMLSelectElement>('[data-ub-row="API 预设"] select')!;
    const labels = Array.from(select.options).map(option => option.textContent!.trim());
    expect(labels[0]).toBe('跟随当前活动 API（fast）');
    expect(labels).toContain('fast');
    app.unmount();
  });

  it('提示词只在侧边面板里编辑，保存后写回当前配置和目标预设', async () => {
    const { app, settings, saveSettings } = await mountContentReplacePage();
    expect(document.querySelector('#cr-preset textarea')).toBeNull();
    expect(document.querySelector('[title="导入预设 JSON"] i')?.className || '').toContain('fa-download');

    document.querySelector<HTMLButtonElement>('#cr-preset .ub-picker__trigger')!.click();
    await tick();
    expect(document.querySelector('.ub-picker-panel__star')).toBeNull();
    Array.from(document.querySelectorAll<HTMLElement>('.ub-picker-panel__item')).find(item => item.textContent?.includes('默认优化'))!.click();
    await tick();
    // 当前是自定义提示词：确认切换（R10B-13）
    const { useDialogStore } = await import('../../src/presentation-v2/stores/dialog-store');
    useDialogStore().submitActive();
    await tick();

    const edit = document.querySelector<HTMLButtonElement>('button[title="编辑当前提示词"]')!;
    expect(edit.disabled).toBe(false);
    edit.click();
    await tick();
    const sheet = document.querySelector<HTMLElement>('.ub-sheet')!;
    expect(sheet).not.toBeNull();
    const textarea = sheet.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = '新的优化提示词 $CONTENT';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(settings.contentOptimizationSettings.promptGroup[0].content).toBe('预设 $CONTENT');

    btn('保存提示词', sheet)!.click();
    await tick();
    expect(settings.contentOptimizationSettings.promptGroup[0].content).toBe('新的优化提示词 $CONTENT');
    expect(settings.contentOptimizationSettings.promptPresets[0].promptGroup[0].content).toBe('新的优化提示词 $CONTENT');
    expect(saveSettings).toHaveBeenCalled();
    app.unmount();
  });

  it('选择默认预设会载入内置提示词并写回设置', async () => {
    const { app, settings } = await mountContentReplacePage();
    document.querySelector<HTMLButtonElement>('#cr-preset .ub-picker__trigger')!.click();
    await tick();
    Array.from(document.querySelectorAll<HTMLElement>('.ub-picker-panel__item')).find(item => item.textContent?.includes('默认预设'))!.click();
    await tick();
    // 当前是未存为预设的自定义提示词：切走前确认（R10B-13）
    const { useDialogStore } = await import('../../src/presentation-v2/stores/dialog-store');
    useDialogStore().submitActive();
    await tick();
    expect(document.querySelector('#cr-preset')!.textContent).toContain('当前提示词：默认预设');
    expect(settings.contentOptimizationSettings.promptGroup[0].content).not.toBe('预设 $CONTENT');
    expect(settings.contentOptimizationSettings.promptGroup.some((seg: any) => String(seg.content || '').includes('$CONTENT'))).toBe(true);
    app.unmount();
  });

  it('R10B-13：从未存为预设的自定义提示词切到预设前先确认，取消则保留自定义提示词', async () => {
    const { app, settings } = await mountContentReplacePage();
    const { useDialogStore } = await import('../../src/presentation-v2/stores/dialog-store');
    const pickPreset = async (label: string) => {
      document.querySelector<HTMLButtonElement>('#cr-preset .ub-picker__trigger')!.click();
      await tick();
      Array.from(document.querySelectorAll<HTMLElement>('.ub-picker-panel__item')).find(item => item.textContent?.includes(label))!.click();
      await tick();
    };

    await pickPreset('默认优化');
    const dialog = useDialogStore();
    expect(dialog.active?.kind).toBe('confirm');
    expect(dialog.active?.message).toContain('另存为预设');
    dialog.cancelActive();
    await tick();
    expect(settings.contentOptimizationSettings.promptGroup[0].content).toBe('优化 $CONTENT');

    await pickPreset('默认优化');
    dialog.submitActive();
    await tick();
    expect(settings.contentOptimizationSettings.promptGroup[0].content).toBe('预设 $CONTENT');
    app.unmount();
  });

  it('R10B-13：正文替换测试在途时，重新优化与导入不会并发启动', async () => {
    const { app, performOptimization } = await mountContentReplacePage();
    const { useContentReplaceStore } = await import('../../src/presentation-v2/stores/content-replace-store');
    const store = useContentReplaceStore();
    let release!: () => void;
    performOptimization.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ success: true, optimizations: [], optimizedContent: '', summary: '' } as any); }));
    store.enabled = true;
    store.setString('testInput', '这是一段足够长的测试正文内容。');

    const testing = store.runTest();
    await tick();
    await store.reoptimizeLatest();
    expect(performOptimization).toHaveBeenCalledTimes(1);
    expect(store.busyAction).toBe('test');

    release();
    await testing;
    expect(store.busyAction).toBe('');
    app.unmount();
  });

  it('提取规则新增空行先保留可编辑草稿，填完整后再写入设置', async () => {
    const { app, settings, saveSettings } = await mountContentReplacePage();
    const rules = () => Array.from(document.querySelectorAll<HTMLElement>('#cr-filter .ub-rules'))
      .find(el => el.textContent?.includes('正文标签提取规则'))!;
    btn('添加提取规则', rules())!.click();
    await tick();
    let rows = rules().querySelectorAll<HTMLElement>('.ub-rules__row');
    expect(rows).toHaveLength(1);
    expect(settings.contentOptimizationSettings.extractRules).toEqual([]);

    const start = rows[0].querySelectorAll<HTMLInputElement>('input')[0];
    start.value = '<content>';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(settings.contentOptimizationSettings.extractRules).toEqual([]);

    rows = rules().querySelectorAll<HTMLElement>('.ub-rules__row');
    expect(rows).toHaveLength(1);
    const end = rows[0].querySelectorAll<HTMLInputElement>('input')[1];
    end.value = '</content>';
    end.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(settings.contentOptimizationSettings.extractRules).toEqual([{ start: '<content>', end: '</content>' }]);
    expect(saveSettings).toHaveBeenCalled();
    app.unmount();
  });

  it('管理面板只列预设与导出/重命名/编辑/删除，没有"设为全局默认"', async () => {
    const { app } = await mountContentReplacePage();
    document.querySelector<HTMLButtonElement>('button[title="管理预设"]')!.click();
    await tick();
    const sheet = document.querySelector<HTMLElement>('.ub-sheet')!;
    expect(sheet.textContent).toContain('管理正文替换预设');
    expect(sheet.textContent).not.toContain('保存当前提示词');
    const titles = Array.from(sheet.querySelectorAll<HTMLButtonElement>('.ub-cr__list-item button')).map(b => b.getAttribute('title'));
    expect(titles).toEqual(expect.arrayContaining(['导出 JSON', '重命名', '编辑提示词', '删除']));
    expect(titles).not.toContain('设为全局默认');
    app.unmount();
  });

  it('手动测试使用当前正文替换配置并展示结果', async () => {
    const { app, performOptimization } = await mountContentReplacePage();
    const textarea = document.querySelector<HTMLTextAreaElement>('#cr-test textarea')!;
    textarea.value = '这是一段足够长的测试正文。';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    btn('执行优化测试')!.click();
    await tick();
    expect(performOptimization).toHaveBeenCalledWith('这是一段足够长的测试正文。', { currentLoop: 1, userMessage: '' });
    expect(document.querySelector('.ub-cr__output')?.textContent || '').toContain('优化完成：1 处建议');
    app.unmount();
  });
});
