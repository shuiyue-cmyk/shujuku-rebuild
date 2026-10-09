/**
 * FormFillPage 集成 — 更新参数、规则列表、提示词段、手动填表
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 2,
    updateBatchSize: 2,
    manualUpdateContextDepth: null,
    manualUpdateBatchSize: null,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoUpdateTokenThreshold: 500,
    tableMaxRetries: 3,
    tableEditLastPairOnly: true,
    tableContextExtractTags: '',
    tableContextExtractRules: [{ start: '<正文>', end: '</正文>' }],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [{ start: '<think>', end: '</think>' }],
    storageMode: 'native',
    apiPresets: [{ name: 'fast', apiMode: 'custom', apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 1000, temperature: 1 }, tavernProfile: '' }],
    defaultApiPresetName: 'fast',
    apiPresetBindingsByChat: {},
    tableApiPreset: '',
    manualSelectedTables: [],
    hasManualSelection: false,
    charCardPrompt: [
      { role: 'SYSTEM', content: '系统段', deletable: true },
      { role: 'USER', content: '主任务', mainSlot: 'A', isMain: true, deletable: false },
      { role: 'USER', content: '数据段', mainSlot: 'B', isMain2: true, deletable: false },
    ],
  } as any;
}

function createTableData() {
  return {
    sheet_a: { name: '角色状态', content: [['id'], ['1']], updateConfig: { updateFrequency: -1, skipFloors: -1 } },
    sheet_b: { name: '事件记录', content: [['id'], ['1'], ['2']], updateConfig: { updateFrequency: -1, skipFloors: -1 } },
  };
}

async function mountFormFillPage(
  settings = createSettings(),
  activePageId = 'form-fill',
  checkpointFloors = [
    { messageIndex: 1, aiFloor: 1, reason: 'init', createdAt: 1 },
    // 历史 fixture：reason:'periodic' 仅表示旧数据兼容，新策略不再生成 periodic full checkpoint。
    { messageIndex: 4, aiFloor: 3, reason: 'periodic', createdAt: 2 },
  ],
) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ router: { activePageId } }));
  const { ref, computed } = await import('vue');
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  const orchestrate = vi.fn(async (..._args: any[]) => ({ success: true }));
  const catchUpPlan = {
    targetAiFloor: 3,
    targetMessageIndex: 4,
    planSignature: 'catch-up-plan',
    waves: [
      {
        startAiFloor: 2,
        endAiFloor: 2,
        messageIndices: [3],
        sheetKeys: ['sheet_a'],
        groups: [{ key: 'a', groupId: 0, batchSize: 1, sheetKeys: ['sheet_a'], requestOptions: null, updateMode: 'manual_independent', executionKind: 'standard' }],
      },
      {
        startAiFloor: 3,
        endAiFloor: 3,
        messageIndices: [4],
        sheetKeys: ['sheet_a', 'sheet_b'],
        groups: [{ key: 'ab', groupId: 0, batchSize: 1, sheetKeys: ['sheet_a', 'sheet_b'], requestOptions: null, updateMode: 'manual_independent', executionKind: 'standard' }],
      },
    ],
  };
  const prepareCatchUp = vi.fn(async (..._args: any[]) => ({ success: true, plan: catchUpPlan }));
  const orchestrateCatchUp = vi.fn(async (..._args: any[]) => ({ success: true, outcome: 'complete', committedBucketCount: 2, catchUpPlan }));
  const refreshMergedData = vi.fn(async () => ({ degraded: false }));
  const executeCore = vi.fn(async (..._args: any[]) => ({ success: true, modifiedKeys: [] }));
  const processUpdatesBatch = vi.fn(async (indices: number[], mode: string, options: any, executeUpdate: any) => {
    if (options?.__skipExecuteForTest) return { success: true };
    return executeUpdate(
      [{ mes: 'AI回复' }],
      indices[indices.length - 1] ?? -1,
      mode,
      false,
      options?.targetSheetKeys ?? null,
      options?.requestOptions ?? null,
      { currentBatch: 1, totalBatches: 1 },
    );
  });
  const manualExtraHintSetter = vi.fn();
  const abortAllActiveRequests = vi.fn();
  const setWasStoppedByUser = vi.fn();
  const setIsAutoUpdatingCard = vi.fn();
  const requestTableFillStop = vi.fn();
  const openVisualizer = vi.fn(async () => {});

  const worldbookConfig: any = {
    source: 'character',
    manualSelection: [],
    enabledEntries: {},
    injectionTarget: 'character',
  };

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-form-fill',
    currentJsonTableData_ACU: createTableData(),
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
    _set_manualExtraHint_ACU: manualExtraHintSetter,
    abortAllActiveRequests_ACU: abortAllActiveRequests,
    _set_wasStoppedByUser_ACU: setWasStoppedByUser,
    _set_isAutoUpdatingCard_ACU: setIsAutoUpdatingCard,
    requestTableFillStop_ACU: requestTableFillStop,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
    setGlobalPlotEnabled_ACU: vi.fn((enabled: boolean) => { settings.plotSettings = { ...(settings.plotSettings || {}), enabled }; }),
    setSummaryVectorIndexMode_ACU: vi.fn((enabled: boolean) => { settings.summaryVectorIndexModeDefault = enabled; }),
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: () => [
      { is_user: true, mes: 'u1' },
      { is_user: false, mes: 'a1' },
      { is_user: true, mes: 'u2' },
      { is_user: false, mes: 'a2' },
      { is_user: false, mes: 'a3' },
    ],
  }));
  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentWorldbookConfig_ACU: () => worldbookConfig,
    getCurrentCharSettings_ACU: () => ({ worldbookConfig }),
    getCurrentTableDisplayData_ACU: () => createTableData(),
    hasRuntimeTableData_ACU: () => true,
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTableTemplatePresets', () => ({
    useTableTemplatePresets: () => ({
      busy: ref(false),
      message: ref(null),
      selectedGlobalPreset: ref('global-A'),
      selectedGlobalPresetValue: ref('global:global-A'),
      selectedChatPreset: ref('global:global-A'),
      selectedChatPresetLabel: ref('global-A（全局预设）'),
      isChatOverridden: computed(() => false),
      chatPresetItems: ref([
        { value: 'global:', label: '默认预设（全局）', meta: '2 张表' },
        { value: 'global:global-A', label: 'global-A（全局预设）', meta: '2 张表' },
      ]),
      chatArchiveItems: ref([]),
      runtimeTemplateItem: ref(null),
      runtimeDiffersFromLibrary: ref(false),
      runtimeTemplateAvailable: ref(false),
      chatSnapshotDiffersFromLibrary: ref(false),
      refresh: vi.fn(),
      selectGlobalPreset: vi.fn(async () => {}),
      selectChatPreset: vi.fn(async () => {}),
      importPresetForCurrentChat: vi.fn(async () => {}),
      restoreArchivedChatTemplate: vi.fn(async () => {}),
      exportTemplate: vi.fn(),
    }),
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTablePresetManagement', () => ({
    useTablePresetManagement: () => ({
      drawerView: ref('closed'),
      isDrawerOpen: computed(() => false),
      title: computed(() => ''),
      busy: ref(false),
      message: ref(null),
      presetMeta: ref([]),
      defaultPresetName: ref('global-A'),
      refresh: vi.fn(),
      openManage: vi.fn(),
      closeDrawer: vi.fn(),
      openVisualizer,
      editPreset: vi.fn(async () => {}),
      setAsDefault: vi.fn(async () => {}),
      deletePreset: vi.fn(async () => {}),
      exportPreset: vi.fn(),
      renamePreset: vi.fn(async () => {}),
      createBlankPreset: vi.fn(async () => {}),
    }),
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => settings.storageMode,
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (data: any) => Object.keys(data).filter(k => k.startsWith('sheet_')),
  }));
  vi.doMock('../../../src/service/template/template-preset-service', () => ({
    getActiveTemplatePresetMeta_ACU: () => ({ displayName: '默认预设', scopeLabel: '全局' }),
  }));
  vi.doMock('../../../src/service/table/table-history', () => ({
    collectV2CheckpointFloorsFromChat_ACU: () => checkpointFloors,
    resolveTableHistoryStatesFromChat_ACU: (_chat: any[], optsList: any[]) => {
      const map = new Map<string, any>();
      for (const opts of optsList || []) {
        map.set(opts.sheetKey, {
          latestAiMessageIndex: 4,
          latestDataMessageIndex: 3,
          lastTrackedUpdateMessageIndex: opts.sheetKey === 'sheet_a' ? 1 : -1,
          latestDataAiFloor: 2,
          lastTrackedUpdateAiFloor: opts.sheetKey === 'sheet_a' ? 1 : 0,
          hasAnyData: true,
          hasTrackedUpdate: opts.sheetKey === 'sheet_a',
        });
      }
      return map;
    },
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    reloadStorageProvider: vi.fn(async () => {}),
  }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    orchestrateManualUpdate_ACU: orchestrate,
    orchestrateManualCatchUp_ACU: orchestrateCatchUp,
    prepareManualCatchUpPlan_ACU: prepareCatchUp,
    processUpdatesBatch_ACU: processUpdatesBatch,
    executeCardUpdateCore_ACU: executeCore,
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: (): any[] => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    refreshMergedDataAndNotify_ACU: refreshMergedData,
    getWorldbookNames_ACU: vi.fn(async () => ['world-X', 'world-Y']),
    getLorebookEntriesByNames_ACU: vi.fn(async () => ({
      'CharBookFF': [
        { uid: 11, comment: '角色概念', name: '角色概念', enabled: true },
        { uid: 12, comment: '人物关系', name: '人物关系', enabled: true },
      ],
    })),
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: vi.fn(async () => 'CharBookFF'),
    getCharLorebooks_ACU: vi.fn(async () => ({ primary: 'CharBookFF', additional: [] })),
  }));

  vi.spyOn(window, 'confirm').mockReturnValue(false);

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return {
    mount,
    settings,
    saveSettings,
    orchestrate,
    prepareCatchUp,
    orchestrateCatchUp,
    refreshMergedData,
    processUpdatesBatch,
    executeCore,
    worldbookConfig,
    manualExtraHintSetter,
    abortAllActiveRequests,
    setWasStoppedByUser,
    setIsAutoUpdatingCard,
    requestTableFillStop,
    openVisualizer,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * 确认弹窗在异步准备（解析世界书注入目标等）之后才出现，不能假设固定的微任务数。
 * 轮询直到弹窗层出现；超过上限则抛错，避免用例在弹窗缺失时静默通过或死循环。
 */
async function waitForDialogLayer(maxTicks = 50): Promise<HTMLElement> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const layer = document.querySelector<HTMLElement>('.ub-dialog-layer');
    if (layer) return layer;
    await Promise.resolve();
    if (tick % 5 === 4) await new Promise(r => setTimeout(r, 0));
  }
  throw new Error('等待确认弹窗出现超时');
}

async function clickDialogButton(label: string): Promise<void> {
  const layer = await waitForDialogLayer();
  expect(layer).not.toBeNull();
  const button = Array.from(layer!.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.includes(label));
  expect(button).not.toBeUndefined();
  button!.click();
  await new Promise(r => setTimeout(r, 0));
}

describe('FormFillPage', () => {

  it('标签筛选里的 tableEdit 解析开关会保存设置', async () => {
    const { mount, settings, saveSettings } = await mountFormFillPage(createSettings(), 'table');

    const toggle = document.querySelector(
      'button[data-acu-setting-key="tableEditLastPairOnly"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    toggle.click();
    await Promise.resolve();

    expect(settings.tableEditLastPairOnly).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('自动更新设置选项会写入更新间隔与保留最新层字段', async () => {
    const optionSettings = {
      ...createSettings(),
      autoUpdateThreshold: 3,
      autoUpdateFrequency: 1,
      updateBatchSize: 3,
      maxConcurrentGroups: 1,
      skipUpdateFloors: 0,
      retainRecentLayers: 100,
    };
    const { mount, settings, saveSettings } = await mountFormFillPage(optionSettings);

    const updatePanel = document.getElementById('ff-update')!;
    expect(updatePanel.querySelectorAll<HTMLInputElement>('input[type="number"]')).toHaveLength(0);
    expect(updatePanel.textContent || '').toContain('高级参数');

    const intervalRow = Array.from(updatePanel.querySelectorAll<HTMLElement>('.ub-row'))
      .find(row => (row.textContent || '').includes('自动填表间隔'))!;
    const intervalSelect = intervalRow.querySelector<HTMLSelectElement>('select[aria-label="自动填表间隔"]')!;
    const optionLabels = () => Array.from(intervalSelect.options).filter(option => !option.disabled).map(option => (option.textContent || '').trim());
    expect(optionLabels()).toContain('每 1 层：最及时');
    expect(optionLabels()).not.toContain('每 2 层：常用节奏');
    expect(optionLabels()).toContain('每 3 层：均衡');
    expect(optionLabels()).toContain('每 5 层：低频省 API');
    expect(optionLabels()).not.toContain('自定义');
    const pick = async (label: string) => {
      const option = Array.from(intervalSelect.options).find(item => (item.textContent || '').trim() === label)!;
      intervalSelect.value = option.value;
      intervalSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    };
    await pick('每 1 层：最及时');
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.autoUpdateFrequency).toBe(1);
    expect(settings.updateBatchSize).toBe(3);

    await pick('每 3 层：均衡');
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.autoUpdateFrequency).toBe(3);
    expect(settings.updateBatchSize).toBe(3);

    await pick('每 5 层：低频省 API');
    expect(settings.autoUpdateThreshold).toBe(5);
    expect(settings.autoUpdateFrequency).toBe(5);
    expect(settings.updateBatchSize).toBe(5);

    const skipRow = Array.from(updatePanel.querySelectorAll<HTMLElement>('.ub-row'))
      .find(row => (row.textContent || '').includes('最新层不填表'))!;
    skipRow.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await Promise.resolve();
    expect(settings.skipUpdateFloors).toBe(1);
    expect(updatePanel.textContent || '').not.toContain('并发策略');
    expect(updatePanel.textContent || '').not.toContain('历史数据保留');

    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('添加排除规则会写入结构化规则', async () => {
    const { mount, settings, saveSettings } = await mountFormFillPage(createSettings(), 'table');

    const excludeList = Array.from(document.querySelectorAll<HTMLElement>('#tbl-filter .ub-rules'))
      .find(list => (list.querySelector('.ub-rules__label')?.textContent || '').includes('排除规则'))!;
    expect(excludeList).toBeDefined();
    const addButton = Array.from(excludeList.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('添加排除规则')) as HTMLButtonElement;
    addButton.click();
    await Promise.resolve();

    let rows = Array.from(excludeList.querySelectorAll<HTMLElement>('.ub-rules__row'));
    expect(rows.length).toBe(2);
    expect(settings.tableContextExcludeRules.length).toBe(1);
    expect(settings.tableContextExcludeRules[0]).toEqual({ start: '<think>', end: '</think>' });

    const inputs = rows[1].querySelectorAll<HTMLInputElement>('input');
    inputs[0].value = '<note>';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(settings.tableContextExcludeRules.length).toBe(1);

    rows = Array.from(excludeList.querySelectorAll<HTMLElement>('.ub-rules__row'));
    const nextInputs = rows[1].querySelectorAll<HTMLInputElement>('input');
    nextInputs[1].value = '</note>';
    nextInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(settings.tableContextExcludeRules).toContainEqual({ start: '<note>', end: '</note>' });
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('提示词编辑器只在侧抽屉中出现，保存后写回 charCardPrompt', async () => {
    const { mount, settings, saveSettings } = await mountFormFillPage(createSettings(), 'table');

    expect(document.querySelector('[data-ub-main] .ub-segs')).toBeNull();
    const openButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('编辑提示词')) as HTMLButtonElement;
    openButton.click();
    await Promise.resolve();

    const drawer = document.querySelector('#ub-portal .ub-sheet-layer') as HTMLElement;
    expect(drawer).not.toBeNull();
    const textareas = Array.from(drawer.querySelectorAll<HTMLTextAreaElement>('.ub-segs textarea'));
    expect(textareas.length).toBeGreaterThan(0);
    textareas[0].value = '新的系统段';
    textareas[0].dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const saveButton = Array.from(drawer.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('保存提示词')) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    saveButton.click();
    await Promise.resolve();

    expect(settings.charCardPrompt[0].content).toBe('新的系统段');
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('提示词抽屉有未保存修改时关闭整个 UI 会确认', async () => {
    const { mount } = await mountFormFillPage(createSettings(), 'table');

    const openButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('编辑提示词')) as HTMLButtonElement;
    openButton.click();
    await Promise.resolve();

    const drawer = document.querySelector('#ub-portal .ub-sheet-layer') as HTMLElement;
    const textarea = drawer.querySelector<HTMLTextAreaElement>('.ub-segs textarea')!;
    textarea.value = '未保存修改';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const appClose = document.querySelector<HTMLButtonElement>('button[title="关闭 UnbirthDB"]')!;
    appClose.click();
    await Promise.resolve();

    expect(document.querySelector('.ub-dialog-layer')?.textContent || '')
      .toContain('你有未保存的填表提示词修改');
    expect(document.getElementById('acu-app-v2')!.style.display).not.toBe('none');
    expect(document.querySelector('#ub-portal .ub-sheet-layer')).not.toBeNull();

    mount.__resetAcuV2MountForTests();
  });

});

describe('FormFillPage · 手动填表面板', () => {

  it('checkpoint reason 文案兼容历史手动、保留边界、未知和缺失 reason', async () => {
    const { mount } = await mountFormFillPage(createSettings(), 'form-fill', [
      { messageIndex: 1, aiFloor: 1, reason: 'manual', createdAt: 1 },
      { messageIndex: 2, aiFloor: 2, reason: 'compaction', createdAt: 2 },
      { messageIndex: 3, aiFloor: 3, reason: 'weird', createdAt: 3 },
      { messageIndex: 4, aiFloor: 4, createdAt: 4 },
    ]);

    const panel = document.getElementById('ff-manual')!;
    const text = panel.textContent || '';
    expect(text).toContain('AI 第 1 层（历史手动基线）');
    expect(text).toContain('AI 第 2 层（保留边界基线）');
    expect(text).toContain('AI 第 3 层（旧基线:weird）');
    expect(text).toContain('AI 第 4 层（旧基线）');

    mount.__resetAcuV2MountForTests();
  });

  it('手动参数保存到独立字段，不改自动更新设置', async () => {
    const { mount, settings, saveSettings } = await mountFormFillPage();

    const panel = document.getElementById('ff-manual')!;
    const depthRow = Array.from(panel.querySelectorAll<HTMLElement>('.ub-row'))
      .find(row => (row.textContent || '').includes('手动处理最近 N 层'))!;
    const batchRow = Array.from(panel.querySelectorAll<HTMLElement>('.ub-row'))
      .find(row => (row.textContent || '').includes('每 N 层合并为一次填表'))!;
    const depthInput = depthRow.querySelector<HTMLInputElement>('input[type="number"]')!;
    const batchInput = batchRow.querySelector<HTMLInputElement>('input[type="number"]')!;

    expect(depthInput.value).toBe('3');
    expect(batchInput.value).toBe('3');

    depthInput.value = '100';
    depthInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    batchInput.value = '2';
    batchInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.manualUpdateContextDepth).toBe(100);
    expect(settings.manualUpdateBatchSize).toBe(2);
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('执行手动填表不再改写自动更新设置：手动参数由 service 层独立解析', async () => {
    const settings = createSettings();
    settings.autoUpdateThreshold = 3;
    settings.updateBatchSize = 2;
    settings.manualUpdateContextDepth = 100;
    settings.manualUpdateBatchSize = 4;
    const { mount, orchestrate } = await mountFormFillPage(settings);
    const observedSettings: Array<{ threshold: number; batchSize: number; manualDepth: number; manualBatch: number }> = [];
    orchestrate.mockImplementation(async () => {
      observedSettings.push({
        threshold: settings.autoUpdateThreshold,
        batchSize: settings.updateBatchSize,
        manualDepth: settings.manualUpdateContextDepth,
        manualBatch: settings.manualUpdateBatchSize,
      });
      return { success: true };
    });

    const button = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await clickDialogButton('确认并继续');
    await new Promise(r => setTimeout(r, 0));

    // 自动填表设置在整个执行期间保持原值；service 层通过 manual-update-settings 读取手动参数。
    expect(observedSettings).toEqual([{ threshold: 3, batchSize: 2, manualDepth: 100, manualBatch: 4 }]);
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);

    mount.__resetAcuV2MountForTests();
  });

  // 上游 issue #18 第四条：零提交失败时 service 已回滚清理并落盘，toast 必须如实告知。
  it('手动填表零提交失败时提示已回滚清理', async () => {
    const { mount, orchestrate } = await mountFormFillPage();
    orchestrate.mockResolvedValueOnce({ success: false, error: '模型 404：API 不可用。', rolledBackCleanup: true });

    const button = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await waitForDialogLayer();
    await clickDialogButton('确认并继续');
    await new Promise(r => setTimeout(r, 0));

    const rolledBackToast = document.querySelector('.ub-toasts')?.textContent || '';
    expect(rolledBackToast).toContain('模型 404：API 不可用。');
    expect(rolledBackToast).toContain('已回滚清理');

    mount.__resetAcuV2MountForTests();
  });

  // 已提交过批次时 service 不回滚（成果必须保留），UI 不得再声称回滚过。
  it('手动填表已提交后失败时不提示回滚', async () => {
    const { mount, orchestrate } = await mountFormFillPage();
    orchestrate.mockResolvedValueOnce({ success: false, error: '模型 404：API 不可用。' });

    const button = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await waitForDialogLayer();
    await clickDialogButton('确认并继续');
    await new Promise(r => setTimeout(r, 0));

    const keptToast = document.querySelector('.ub-toasts')?.textContent || '';
    expect(keptToast).toContain('模型 404：API 不可用。');
    expect(keptToast).not.toContain('已回滚清理');

    mount.__resetAcuV2MountForTests();
  });

  it('所有 checkpoint 都落入重填范围时仅在确认弹窗中显示红色风险提示', async () => {
    const settings = createSettings();
    settings.manualUpdateContextDepth = 3;
    const { mount } = await mountFormFillPage(settings, 'form-fill', [
      { messageIndex: 1, aiFloor: 1, reason: 'init', createdAt: 1 },
      // 历史 fixture：reason:'periodic' 仅表示旧数据兼容，新策略不再生成 periodic full checkpoint。
      { messageIndex: 4, aiFloor: 3, reason: 'periodic', createdAt: 2 },
    ]);

    const panel = document.getElementById('ff-manual')!;
    expect(panel.textContent || '').toContain('AI 第 1 层（初始基线）');
    expect(panel.textContent || '').toContain('AI 第 3 层（历史周期基线）');
    expect(panel.textContent || '').toContain('预计处理范围：AI 第 1~3 层');
    expect(panel.textContent || '').not.toContain('危险：当前聊天的所有 full checkpoint');

    const button = Array.from(panel.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await waitForDialogLayer();

    const danger = document.querySelector<HTMLElement>('.ub-dialog__danger');
    expect(danger).not.toBeNull();
    const dangerText = danger!.textContent || '';
    expect(dangerText).toContain('所有 full checkpoint 都在本次重填范围内');
    expect(dangerText).toContain('系统首次执行时只会做边界检查');
    expect(dangerText).toContain('在下一步要求你单独确认是否替换本次范围内选中表的基底');
    expect(dangerText).not.toContain('首次确认后会立即替换 checkpoint 基底');
    expect(dangerText).not.toContain('空白结构');
    const confirmButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-dialog-layer button'))
      .find(btn => btn.textContent?.includes('确认并继续'))!;
    expect(confirmButton.className).toContain('danger');

    mount.__resetAcuV2MountForTests();
  });

  it('手动填表展示 orchestrator 的具体进度文案，不把分组数显示成重试次数', async () => {
    const { mount, orchestrate } = await mountFormFillPage();
    let releaseCore = () => {};
    orchestrate.mockImplementation(async (_targetKeys: string[], _refreshData: any, options: any) => {
      const onProgress = options?.onProgress as ((event: any) => void) | undefined;
      expect(onProgress).toEqual(expect.any(Function));
      onProgress?.({
        phase: 'calling_ai',
        currentBatch: 1,
        totalBatches: 1,
        attempt: 1,
        maxRetries: 20,
        message: '正在生成第 1/20 组 AI 响应...',
      });
      await new Promise<void>(resolve => {
        releaseCore = resolve;
      });
      return { success: true };
    });

    const panel = document.getElementById('ff-manual')!;
    const button = Array.from(panel.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await clickDialogButton('确认并继续');
    await new Promise(r => setTimeout(r, 0));

    const toastText = document.querySelector('.ub-toasts')?.textContent || '';
    expect(toastText).toContain('批次 1/1 · 正在生成第 1/20 组手动填表结果...');
    expect(toastText).not.toContain('调用 AI (1/20)');
    expect(button.textContent || '').toContain('填表中...');

    expect(orchestrate).toHaveBeenCalled();
    releaseCore();
    await new Promise(r => setTimeout(r, 0));

    mount.__resetAcuV2MountForTests();
  });

  it('手动填表展示 service grouped 路径转发的重试进度', async () => {
    const { mount, orchestrate } = await mountFormFillPage();
    let releaseOrchestrate = () => {};
    orchestrate.mockImplementation(async (_targetKeys: string[], _refreshData: any, options: any) => {
      options.onProgress?.({
        phase: 'calling_ai',
        currentBatch: 2,
        totalBatches: 4,
        attempt: 2,
        maxRetries: 3,
      });
      await new Promise<void>(resolve => {
        releaseOrchestrate = resolve;
      });
      return { success: true };
    });

    const panel = document.getElementById('ff-manual')!;
    const button = Array.from(panel.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await clickDialogButton('确认并继续');
    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('.ub-toasts')?.textContent || '')
      .toContain('批次 2/4 · 调用 AI（第 2/3 次尝试）');

    releaseOrchestrate();
    await new Promise(r => setTimeout(r, 0));

    mount.__resetAcuV2MountForTests();
  });

  it('手动填表进度 toast 提供终止按钮并触发中止链路', async () => {
    const { mount, orchestrate, requestTableFillStop, setIsAutoUpdatingCard } = await mountFormFillPage();
    let releaseOrchestrate = () => {};
    orchestrate.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        releaseOrchestrate = resolve;
      });
      return { success: false, error: '手动更新已终止。' };
    });

    const panel = document.getElementById('ff-manual')!;
    const button = Array.from(panel.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await clickDialogButton('确认并继续');
    await new Promise(r => setTimeout(r, 0));

    const stopButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-toast button'))
      .find(btn => btn.textContent?.includes('终止'));
    expect(stopButton).toBeDefined();
    stopButton!.click();
    await Promise.resolve();

    // 终止走统一的停止入口（锁存终止 + 中止请求），不再当场释放「正在填表」标记
    expect(requestTableFillStop).toHaveBeenCalledTimes(1);
    expect(setIsAutoUpdatingCard).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('.ub-toasts')?.textContent || '').toContain('手动填表已终止');

    releaseOrchestrate();
    await new Promise(r => setTimeout(r, 0));

    mount.__resetAcuV2MountForTests();
  });

  it('手动填表附加要求常驻显示，填写后传给本次执行', async () => {
    const { mount, manualExtraHintSetter } = await mountFormFillPage();

    const panel = document.getElementById('ff-manual')!;
    const textarea = panel.querySelector<HTMLTextAreaElement>('textarea[aria-label="本次填表附加要求"]')!;
    expect(textarea).not.toBeNull();

    textarea.value = '只更新角色状态。';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const button = Array.from(panel.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('执行手动填表')) as HTMLButtonElement;
    button.click();
    await clickDialogButton('确认并继续');
    await new Promise(r => setTimeout(r, 0));

    expect(manualExtraHintSetter).toHaveBeenCalledWith(
      '以下为用户的额外填表要求,请严格遵守:\n只更新角色状态。',
    );

    mount.__resetAcuV2MountForTests();
  });

  it('追平入口使用真实计划展示 wave、bucket、skip 与内部空洞边界，确认后才执行', async () => {
    const { mount, prepareCatchUp, orchestrateCatchUp, orchestrate } = await mountFormFillPage();
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;

    button.click();
    await new Promise(r => setTimeout(r, 0));

    const dialogText = document.querySelector('.ub-dialog-layer')?.textContent || '';
    expect(prepareCatchUp).toHaveBeenCalledWith(['sheet_a', 'sheet_b']);
    expect(dialogText).toContain('锁定目标：AI 第 3 层');
    expect(dialogText).toContain('预计 2 个 wave、2 个 bucket');
    expect(dialogText).toContain('跳过最新楼层：0 层');
    expect(dialogText).toContain('Wave 1：AI 第 2 层；角色状态');
    expect(dialogText).toContain('Wave 2：AI 第 3 层；角色状态、事件记录');
    expect(dialogText).toContain('不扫描或修复历史前沿之前的内部空洞');
    expect(orchestrateCatchUp).not.toHaveBeenCalled();
    expect(orchestrate).not.toHaveBeenCalled();

    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));

    expect(orchestrateCatchUp).toHaveBeenCalledTimes(1);
    expect(orchestrateCatchUp.mock.calls[0][0]).toEqual(['sheet_a', 'sheet_b']);
    expect(orchestrateCatchUp.mock.calls[0][1]).toEqual(expect.any(Function));
    expect(orchestrateCatchUp.mock.calls[0][2]).toEqual(expect.objectContaining({
      abortController: expect.any(AbortController),
      onProgress: expect.any(Function),
    }));
    expect(orchestrate).not.toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('追平规划无缺口时提示已追平且不执行编排或刷新', async () => {
    const { mount, prepareCatchUp, orchestrateCatchUp, refreshMergedData } = await mountFormFillPage();
    prepareCatchUp.mockResolvedValueOnce({
      success: true,
      plan: { targetAiFloor: 3, targetMessageIndex: 4, planSignature: 'none', waves: [] },
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;

    button.click();
    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('.ub-dialog-layer')).toBeNull();
    expect(document.querySelector('.ub-toasts')?.textContent || '').toContain('所选表已追平');
    expect(orchestrateCatchUp).not.toHaveBeenCalled();
    expect(refreshMergedData).not.toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('追平运行与普通手填互斥，终止仅中止当前 controller', async () => {
    const { mount, orchestrateCatchUp, orchestrate, abortAllActiveRequests, setWasStoppedByUser, setIsAutoUpdatingCard, requestTableFillStop } = await mountFormFillPage();
    let releaseCatchUp = () => {};
    let capturedController: AbortController | undefined;
    orchestrateCatchUp.mockImplementation(async (_keys: string[], _refresh: any, options: any) => {
      capturedController = options.abortController;
      await new Promise<void>(resolve => { releaseCatchUp = resolve; });
      return { success: false, outcome: 'stopped', committedBucketCount: 1 };
    });
    const catchUpButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;
    const manualButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('执行手动填表'))!;

    catchUpButton.click();
    await new Promise(r => setTimeout(r, 0));
    expect(manualButton.disabled).toBe(true);
    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));
    expect(capturedController?.signal.aborted).toBe(false);
    expect(manualButton.disabled).toBe(true);

    const stopButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-toast button'))
      .find(btn => btn.textContent?.includes('终止'))!;
    stopButton.click();
    await Promise.resolve();

    expect(capturedController?.signal.aborted).toBe(true);
    expect(abortAllActiveRequests).not.toHaveBeenCalled();
    expect(setWasStoppedByUser).not.toHaveBeenCalled();
    expect(setIsAutoUpdatingCard).not.toHaveBeenCalled();
    expect(requestTableFillStop).not.toHaveBeenCalled();
    expect(orchestrate).not.toHaveBeenCalled();

    releaseCatchUp();
    await new Promise(r => setTimeout(r, 0));
    // 契约变更（issue #18 第三条）：committedBucketCount=1 但没有 committedDataBucketCount
    // 证据时只是「零 operation 伪提交」，文案不得再说「已保留数据」。
    const stoppedToastText = document.querySelector('.ub-toasts')?.textContent || '';
    expect(stoppedToastText).toContain('手动追平已终止');
    expect(stoppedToastText).toContain('未写入数据（只落了进度）');
    expect(stoppedToastText).not.toContain('已保留 1 个已提交 bucket');

    mount.__resetAcuV2MountForTests();
  });

  // 上游 issue #18 第三条：计数文案必须区分「真的写了数据」与「零 operation 伪提交（只落进度）」。
  it('追平完成文案按数据批次计数', async () => {
    const { mount, orchestrateCatchUp } = await mountFormFillPage();
    orchestrateCatchUp.mockResolvedValueOnce({
      success: true,
      outcome: 'complete',
      committedBucketCount: 2,
      committedDataBucketCount: 2,
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;

    button.click();
    await new Promise(r => setTimeout(r, 0));
    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));

    const dataToastText = document.querySelector('.ub-toasts')?.textContent || '';
    expect(dataToastText).toContain('手动追平完成，共写入 2 个数据 bucket');

    mount.__resetAcuV2MountForTests();
  });

  it('追平两个 bucket 都是零 operation 伪提交时如实说未写入数据', async () => {
    const { mount, orchestrateCatchUp } = await mountFormFillPage();
    orchestrateCatchUp.mockResolvedValueOnce({
      success: true,
      outcome: 'complete',
      committedBucketCount: 2,
      committedDataBucketCount: 0,
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;

    button.click();
    await new Promise(r => setTimeout(r, 0));
    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));

    const pseudoToastText = document.querySelector('.ub-toasts')?.textContent || '';
    expect(pseudoToastText).toContain('未写入数据（只落了进度，2 个已提交 bucket）');
    expect(pseudoToastText).not.toContain('共写入 2 个数据 bucket');

    mount.__resetAcuV2MountForTests();
  });

  it('terminal progress 保存失败时提示数据已提交，不误报为整次追平失败', async () => {
    const { mount, orchestrateCatchUp } = await mountFormFillPage();
    orchestrateCatchUp.mockResolvedValueOnce({
      success: true,
      outcome: 'progress_metadata_failed',
      committedBucketCount: 2,
      error: '终态进度保存失败：strict save failed',
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;

    button.click();
    await new Promise(r => setTimeout(r, 0));
    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));

    const toastText = document.querySelector('.ub-toasts')?.textContent || '';
    expect(toastText).toContain('手动追平数据已提交，但完成状态记录失败');
    expect(toastText).toContain('strict save failed');

    mount.__resetAcuV2MountForTests();
  });

  it('追平回放完整性失败时明确提示已回载持久化数据，不伪装成普通 AI 失败', async () => {
    const { mount, orchestrateCatchUp } = await mountFormFillPage();
    orchestrateCatchUp.mockResolvedValueOnce({
      success: false,
      outcome: 'integrity_failed',
      committedBucketCount: 1,
      error: 'V2 replay 未恢复所选表：sheet_a；已从聊天持久化状态回载运行时。',
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;

    button.click();
    await new Promise(r => setTimeout(r, 0));
    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));

    const toastText = document.querySelector('.ub-toasts')?.textContent || '';
    expect(toastText).toContain('持久化完整性校验失败');
    expect(toastText).toContain('已回载聊天中的已保存数据');
    expect(toastText).toContain('V2 replay 未恢复所选表');

    mount.__resetAcuV2MountForTests();
  });

  it('追平锚点预检阻断时展示恢复指引而不伪装成 AI 执行失败', async () => {
    const { mount, orchestrateCatchUp } = await mountFormFillPage();
    orchestrateCatchUp.mockResolvedValueOnce({
      success: false,
      outcome: 'blocked',
      committedBucketCount: 0,
      error: '手动追平目标早于未知 V2 checkpoint；请先执行 V2 恢复诊断。',
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;

    button.click();
    await new Promise(r => setTimeout(r, 0));
    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('.ub-toasts')?.textContent || '').toContain('请先执行 V2 恢复诊断');

    mount.__resetAcuV2MountForTests();
  });

  it('sync_pending 提供仅同步重试，重试不再次调用追平编排', async () => {
    const { mount, orchestrateCatchUp, refreshMergedData } = await mountFormFillPage();
    orchestrateCatchUp.mockResolvedValueOnce({ success: true, outcome: 'sync_pending', committedBucketCount: 2 });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('一键追平所选表未填楼层'))!;
    button.click();
    await new Promise(r => setTimeout(r, 0));
    await clickDialogButton('确认追平');
    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('.ub-toasts')?.textContent || '').toContain('世界书同步待重试');
    const retryButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-toast button'))
      .find(btn => btn.textContent?.includes('仅同步重试'))!;
    retryButton.click();
    await new Promise(r => setTimeout(r, 0));

    expect(refreshMergedData).toHaveBeenCalledTimes(1);
    expect(orchestrateCatchUp).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ub-toasts')?.textContent || '').toContain('没有再次调用 AI');

    mount.__resetAcuV2MountForTests();
  });
});
