/**
 * PlotPage 集成 — D23 剧情推进页骨架
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      { name: 'gpt-mini', apiMode: 'custom', apiConfig: { url: 'https://x', apiKey: 'k', model: 'm', useMainApi: false, max_tokens: 1000, temperature: 1 } },
    ],
    defaultApiPresetName: 'gpt-mini',
    apiPresetBindingsByChat: {},
    plotSettings: {
      enabled: true,
      promptPresets: [
        { name: '记忆召回', plotTasks: [{ id: 't1', name: 'A', stage: 1, order: 0 }] },
        { name: '低速推进', plotTasks: [{ id: 't2', name: 'B', stage: 1, order: 0 }, { id: 't3', name: 'C', stage: 2, order: 1 }] },
      ],
      lastUsedPresetName: '记忆召回',
      rateMain: 1,
      ratePersonal: 1,
      rateErotic: 0,
      rateCuckold: 1,
      recallCount: 20,
      plotWorldbookConfig: { source: 'character', manualSelection: [], enabledEntries: {} },
    },
    plotApiPreset: '',
    plotTaskApiPresetOverridesById: {},
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

async function mountPlotPage(opts: {
  devOptions?: { plotAdvanced?: boolean };
  settings?: any;
  resolveCharacterBinding?: () => Promise<any>;
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  const persisted: any = { router: { activePageId: 'plot' } };
  if (opts.devOptions) persisted.devOptions = opts.devOptions;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

  const settings = opts.settings ?? createSettings();
  const mockGetCurrentCharacterWorldbookBinding = vi.fn(
    opts.resolveCharacterBinding ?? (async () => ({
      primary: 'CharBook',
      additional: [],
      orderedNames: ['CharBook'],
      apiSource: 'getCharWorldbookNames',
    })),
  );

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-plot',
    currentJsonTableData_ACU: null,
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: vi.fn(),
    setGlobalPlotEnabled_ACU: vi.fn((val: boolean) => { settings.plotSettings.enabled = val; return val; }),
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    getWorldbookNames_ACU: vi.fn(async () => ['world-A', 'world-B']),
    getLorebookEntriesByNames_ACU: vi.fn(async () => ({
      'CharBook': [
        { uid: 1, comment: '角色设定', name: '角色设定', enabled: true },
        { uid: 2, comment: 'TavernDB-ACU-OutlineTable', name: 'TavernDB-ACU-OutlineTable', enabled: true },
        { uid: 3, comment: '世界观', name: '世界观', enabled: true },
      ],
    })),
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: vi.fn(async () => 'CharBook'),
    getCurrentCharacterWorldbookBinding_ACU: mockGetCurrentCharacterWorldbookBinding,
    getCharLorebooks_ACU: vi.fn(async () => ({ primary: 'CharBook', additional: [] })),
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-takeover', () => ({
    getPlotAgentWorldbookSnapshot_ACU: () => ({ active: false, selectionSignature: '', createdAt: 0, books: {} }),
    refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: vi.fn(async () => ({ active: false, selectionSignature: '', createdAt: 0, books: {} })),
  }));

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return { mount, settings, mockGetCurrentCharacterWorldbookBinding };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const wait = (ms = 0) => new Promise(r => setTimeout(r, ms));
const page = () => document.querySelector<HTMLElement>('[data-ub-main]')!;
const sheet = () => document.querySelector<HTMLElement>('#ub-portal .ub-sheet-layer');
const buttonByText = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => (button.textContent || '').includes(text));
const sectionByTitle = (root: ParentNode, title: string) => Array.from(root.querySelectorAll<HTMLElement>('.ub-section'))
  .find(section => (section.querySelector('.ub-section__title')?.textContent || '').includes(title));

async function openEditSheet(): Promise<HTMLElement> {
  const editButton = page().querySelector<HTMLButtonElement>('button[title="编辑当前预设"]');
  expect(editButton).not.toBeNull();
  editButton!.click();
  await wait();
  const layer = sheet();
  expect(layer).not.toBeNull();
  return layer!;
}

async function saveSheet(layer: HTMLElement): Promise<void> {
  const saveButton = buttonByText(layer, '保存预设');
  expect(saveButton).not.toBeUndefined();
  saveButton!.click();
  await wait();
}

describe('PlotPage', () => {

  it('发送体验分节暴露伪装发送楼层开关：默认关闭，点击可开启并落盘', async () => {
    // 老设置无该键：store 必须归一为 false（可选项默认关闭），不能因 undefined 而开启。
    const { mount, settings } = await mountPlotPage();
    expect(settings.plotSettings.pendingDisguiseEnabled).not.toBe(true);

    expect(page().textContent || '', '必须向用户暴露伪装发送楼层开关').toContain('伪装发送楼层');

    const toggle = page().querySelector('[role="switch"][aria-label*="伪装"]');
    expect(toggle, '伪装开关必须渲染为 role=switch 控件').toBeTruthy();
    expect(toggle?.getAttribute('aria-checked'), '默认应关闭').toBe('false');

    toggle!.dispatchEvent(new Event('click', { bubbles: true }));
    await wait();

    expect(settings.plotSettings.pendingDisguiseEnabled, '开启后必须写进 plotSettings').toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('编辑面板保存匹配替换参数到当前剧情推进预设', async () => {
    const { mount, settings } = await mountPlotPage({ devOptions: { plotAdvanced: true } });

    const layer = await openEditSheet();
    const inputs = Array.from(sectionByTitle(layer, '匹配替换（进阶）')!.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(inputs).toHaveLength(5);

    const values = ['2.25', '1.75', '0.5', '1.25', '42'];
    for (let index = 0; index < inputs.length; index += 1) {
      inputs[index].value = values[index];
      inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
      await wait();
    }

    await saveSheet(layer);

    const savedPreset = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '记忆召回');
    expect(savedPreset.rateMain).toBe(2.25);
    expect(savedPreset.ratePersonal).toBe(1.75);
    expect(savedPreset.rateErotic).toBe(0.5);
    expect(savedPreset.rateCuckold).toBe(1.25);
    expect(savedPreset.recallCount).toBe(42);
    expect(settings.plotSettings.rateMain).toBe(2.25);
    expect(settings.plotSettings.recallCount).toBe(42);

    mount.__resetAcuV2MountForTests();
  });

  it('编辑面板包含标签筛选，并将规则保存进预设', async () => {
    const { mount, settings } = await mountPlotPage();

    const layer = await openEditSheet();
    expect(layer.textContent || '').toContain('标签筛选');
    expect(layer.textContent || '').not.toContain('剧情上下文过滤');
    expect(layer.textContent || '').toContain('提取规则');
    expect(layer.textContent || '').toContain('排除规则');

    const filterSection = sectionByTitle(layer, '标签筛选');
    expect(filterSection).not.toBeUndefined();

    buttonByText(filterSection!, '添加提取规则')!.click();
    buttonByText(filterSection!, '添加排除规则')!.click();
    await wait();

    const inputs = Array.from(filterSection!.querySelectorAll<HTMLInputElement>('.ub-rules__row input'));
    expect(inputs).toHaveLength(4);
    const values = ['<recall>', '</recall>', '<thinking>', '</thinking>'];
    for (let index = 0; index < 4; index += 1) {
      inputs[index].value = values[index];
      inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
      await wait();
    }

    await saveSheet(layer);

    const savedPreset = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '记忆召回');
    expect(savedPreset.contextExtractRules).toEqual([{ start: '<recall>', end: '</recall>' }]);
    expect(savedPreset.contextExcludeRules).toEqual([{ start: '<thinking>', end: '</thinking>' }]);
    expect(savedPreset.contextExtractTags).toBeUndefined();
    expect(savedPreset.contextExcludeTags).toBeUndefined();

    mount.__resetAcuV2MountForTests();
  });

  it('剧情推进预设选择器显示任务数，支持切换与星标', async () => {
    const { mount, settings } = await mountPlotPage();

    const trigger = page().querySelector<HTMLButtonElement>('.ub-picker__trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('记忆召回');

    const items = () => Array.from(document.querySelectorAll<HTMLElement>('#ub-portal .ub-picker-panel__item'));
    trigger!.click();
    await wait();
    const defaultItem = items().find(item => item.textContent?.includes('默认预设'));
    expect(defaultItem).not.toBeUndefined();
    expect(defaultItem!.textContent).toContain('1 个任务');
    const slowItem = items().find(item => item.textContent?.includes('低速推进'));
    expect(slowItem).not.toBeUndefined();
    expect(slowItem!.textContent).toContain('2 个任务');
    slowItem!.click();
    await wait();
    expect(trigger!.textContent).toContain('低速推进');

    trigger!.click();
    await wait();
    items().find(item => item.textContent?.includes('低速推进'))!
      .querySelector<HTMLButtonElement>('.ub-picker-panel__star')!.click();
    await wait();
    expect(settings.plotSettings.lastUsedPresetName).toBe('低速推进');

    mount.__resetAcuV2MountForTests();
  });

  it('剧情推进预设选择器支持选择默认预设，并可将默认预设设为全局默认', async () => {
    const { mount, settings } = await mountPlotPage();

    const trigger = page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!;
    const items = () => Array.from(document.querySelectorAll<HTMLElement>('#ub-portal .ub-picker-panel__item'));

    trigger.click();
    await wait();
    items().find(item => item.textContent?.includes('默认预设'))!.click();
    await wait();

    expect(trigger.textContent).toContain('记忆召回');
    expect(settings.plotPresetBindings?.['chat-plot']).toBeUndefined();

    trigger.click();
    await wait();
    items().find(item => item.textContent?.includes('默认预设'))!
      .querySelector<HTMLButtonElement>('.ub-picker-panel__star')!.click();
    await wait();

    expect(settings.plotSettings.lastUsedPresetName).toBe('');
    const facts = page().querySelector<HTMLElement>('.ub-plotp__facts')!;
    const globalDefault = Array.from(facts.querySelectorAll('div')).find(row => row.querySelector('dt')?.textContent === '全局默认');
    expect(globalDefault?.querySelector('dd')?.textContent?.trim()).toBe('默认预设');

    mount.__resetAcuV2MountForTests();
  });

  it('管理面板从默认新建时使用内置默认任务初始化，并可保存为自定义预设', async () => {
    const { mount, settings } = await mountPlotPage();

    page().querySelector<HTMLButtonElement>('button[title="管理预设"]')!.click();
    await wait();

    const createButton = buttonByText(sheet()!, '从默认新建');
    expect(createButton).not.toBeUndefined();
    createButton!.click();
    await wait();

    const layer = sheet()!;
    expect(layer.textContent || '').toContain('从默认新建剧情推进预设');
    expect(layer.querySelectorAll('.ub-pps-task')).toHaveLength(1);
    expect(layer.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')?.value).toBe('新预设');

    await saveSheet(layer);

    const savedPreset = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '新预设');
    expect(savedPreset).toBeDefined();
    expect(savedPreset.plotTasks).toHaveLength(1);

    mount.__resetAcuV2MountForTests();
  });

  it('预设卡片的导入按钮会导入为预设并切换当前聊天使用', async () => {
    const { mount, settings } = await mountPlotPage();

    const input = page().querySelector<HTMLInputElement>('#plot-preset .ub-file__input');
    expect(input).not.toBeNull();
    const file = new File([
      JSON.stringify([
        {
          name: '导入推进',
          plotTasks: [{ id: 'import-task', name: '导入任务', stage: 1, order: 0 }],
        },
      ]),
    ], 'plot-import.json', { type: 'application/json' });
    Object.defineProperty(input!, 'files', { value: [file], configurable: true });
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
    await wait();

    expect(settings.plotSettings.promptPresets.map((preset: any) => preset.name)).toContain('导入推进');
    expect(settings.plotPresetBindings?.['chat-plot']?.presetName).toBe('导入推进');

    mount.__resetAcuV2MountForTests();
  });

  it('角色世界书 binding 读取失败时显示明确错误且不将失败持久化为空选择', async () => {
    const settings = createSettings();
    const bindingError = new Error('host binding read failed');
    const { mount, mockGetCurrentCharacterWorldbookBinding } = await mountPlotPage({
      settings,
      resolveCharacterBinding: async () => { throw bindingError; },
    });
    await wait(50);

    const error = document.querySelector('#plot-worldbook .ub-wbe [role="alert"]');
    expect(error?.textContent).toContain('加载角色世界书失败');
    expect(error?.textContent).not.toContain(bindingError.message);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries).toEqual({});
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);

    mount.__resetAcuV2MountForTests();
  });

  it('世界书条目列表渲染可见条目并过滤数据库生成条目', async () => {
    const { mount } = await mountPlotPage();
    await wait(50);

    const entryList = document.querySelector<HTMLElement>('#plot-worldbook .ub-wbe');
    expect(entryList).not.toBeNull();
    expect(entryList!.textContent || '').not.toContain('角色设定');

    const header = entryList!.querySelector<HTMLButtonElement>('.ub-disc__head');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('2/2 条');
    header!.click();
    await wait();

    const text = entryList!.textContent || '';
    expect(text).toContain('角色设定');
    expect(text).toContain('世界观');
    expect(text).not.toContain('TavernDB-ACU-OutlineTable');

    mount.__resetAcuV2MountForTests();
  });

  it('首次加载时 enabledEntries 持久化可见条目 uid', async () => {
    const settings = createSettings();
    settings.plotSettings.plotWorldbookConfig.enabledEntries = {};

    const { mount } = await mountPlotPage({ settings });
    await wait(50);

    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries['CharBook']).toBeDefined();
    const enabled: number[] = settings.plotSettings.plotWorldbookConfig.enabledEntries['CharBook'];
    expect(enabled).toContain(1);
    expect(enabled).toContain(3);
    expect(enabled).not.toContain(2);

    mount.__resetAcuV2MountForTests();
  });
});
