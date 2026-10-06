/**
 * TablePage 集成 — 标签筛选 + 填表提示词 + 注入目标 + 附加世界书条目
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 2,
    updateBatchSize: 2,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoUpdateTokenThreshold: 500,
    tableMaxRetries: 3,
    tableEditLastPairOnly: true,
    discardUnauthorizedTableEditsEnabled: true,
    tableContextExtractTags: '',
    tableContextExtractRules: [{ start: '<正文>', end: '</正文>' }],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [{ start: '<think>', end: '</think>' }],
    storageMode: 'native',
    charCardPrompt: [
      { role: 'SYSTEM', content: '系统段', deletable: true },
      { role: 'USER', content: '主任务', mainSlot: 'A', isMain: true, deletable: false },
      { role: 'USER', content: '数据段', mainSlot: 'B', isMain2: true, deletable: false },
    ],
  } as any;
}

async function mountTablePage(opts: {
  selectedChatPreset?: string;
  selectedGlobalPreset?: string;
  injectionCharPrimary?: string | null;
  /** 覆盖设置（用于构造「自定义提示词 + 工具仍开着」这类组合）。 */
  overrideSettings?: (settings: any) => void;
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ router: { activePageId: 'table' } }));

  const { ref, shallowRef, computed } = await import('vue');
  const settings = createSettings();
  opts.overrideSettings?.(settings);
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));

  // —— useTableTemplatePresets（页面顶部下拉） ——
  const selectGlobalPreset = vi.fn(async () => {});
  const selectChatPreset = vi.fn(async () => {});
  const refresh = vi.fn();
  const tplExportTemplate = vi.fn(() => {});
  const importPresetForCurrentChat = vi.fn(async () => {});

  vi.doMock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({
    useChatChangedListener: () => {},
    useChatChangedTick: () => ref(0),
    watchChatChanged_ACU: () => {},
  }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => settings.storageMode,
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTableTemplatePresets', () => ({
    useTableTemplatePresets: () => {
      const selectedGlobalPreset = ref(opts.selectedGlobalPreset ?? 'global-A');
      const selectedGlobalPresetValue = ref(`global:${selectedGlobalPreset.value}`);
      const selectedChatPreset = ref(`global:${opts.selectedChatPreset ?? 'global-A'}`);
      return {
      busy: ref(false),
      message: ref(null),
      selectedGlobalPreset,
      selectedGlobalPresetValue,
      selectedChatPreset,
      selectedChatPresetLabel: ref(`${opts.selectedChatPreset ?? 'global-A'}（全局预设）`),
      isChatOverridden: computed(() => selectedChatPreset.value !== selectedGlobalPresetValue.value),
      chatPresetItems: ref([
        { value: 'global:', label: '默认预设（全局）', meta: '2 张表' },
        { value: 'global:global-A', label: 'global-A（全局预设）', meta: '2 张表' },
        { value: 'snapshot:chat-A', label: 'chat-A（当前聊天快照）', meta: '3 张表' },
      ]),
      refresh,
      selectGlobalPreset,
      selectChatPreset,
      importPresetForCurrentChat,
      exportTemplate: tplExportTemplate,
    };
    },
  }));

  // —— useTablePresetManagement（抽屉） ——
  const drawerView = ref<'closed' | 'manage'>('closed');
  const isDrawerOpen = computed(() => drawerView.value !== 'closed');
  const title = computed(() => (drawerView.value === 'manage' ? '管理表格模板预设' : ''));
  const presetMeta = ref<Array<{ name: string }>>([{ name: 'global-A' }, { name: 'global-B' }]);
  const defaultPresetName = ref('global-A');
  const message = ref<{ kind: 'success' | 'error' | 'info' | 'warning'; text: string } | null>(null);

  const openVisualizer = vi.fn(async () => {});
  const editPreset = vi.fn(async () => {});
  const setAsDefault = vi.fn(async () => {});
  const deletePreset = vi.fn(async () => {});
  const exportPresetMgmt = vi.fn(() => {});
  const renamePreset = vi.fn(async () => {});
  const createBlankPreset = vi.fn(async () => {});

  vi.doMock('../../../src/presentation-v2/composables/useTablePresetManagement', () => ({
    useTablePresetManagement: () => ({
      drawerView,
      isDrawerOpen,
      title,
      busy: ref(false),
      message,
      presetMeta,
      defaultPresetName,
      refresh: vi.fn(),
      openManage: () => { drawerView.value = 'manage'; },
      closeDrawer: () => { drawerView.value = 'closed'; },
      openVisualizer,
      editPreset,
      setAsDefault,
      deletePreset,
      exportPreset: exportPresetMgmt,
      renamePreset,
      createBlankPreset,
    }),
  }));

  // —— 注入目标 / 附加条目 / 选择器 ——
  const injectionTargetRef = ref('character');
  const injectionTargetChange = vi.fn((value: string) => {
    injectionTargetRef.value = value;
  });
  const describeInjectionTarget = vi.fn(async () =>
    injectionTargetRef.value === 'character'
      ? '角色卡绑定世界书 · CharBookT'
      : injectionTargetRef.value,
  );
  vi.doMock('../../../src/presentation-v2/composables/useFormFillInjectionTarget', () => ({
    useFormFillInjectionTarget: () => ({
      target: injectionTargetRef,
      selectorValue: computed(() => injectionTargetRef.value || 'character'),
      refreshFromSettings: vi.fn(),
      onSelectorChange: injectionTargetChange,
      describeTarget: describeInjectionTarget,
    }),
  }));

  const entriesSourceRef = ref<'character' | 'manual'>('character');
  const entriesManualSelectionRef = ref<string[]>([]);
  const setEntriesSource = vi.fn((value: 'character' | 'manual') => {
    entriesSourceRef.value = value;
  });
  const toggleEntriesManualBook = vi.fn((name: string, checked: boolean) => {
    entriesSourceRef.value = 'manual';
    entriesManualSelectionRef.value = checked
      ? [...new Set([...entriesManualSelectionRef.value, name])]
      : entriesManualSelectionRef.value.filter(item => item !== name);
  });
  vi.doMock('../../../src/presentation-v2/composables/useFormFillWorldbookConfig', () => ({
    useFormFillWorldbookConfig: () => ({
      source: entriesSourceRef,
      manualSelection: entriesManualSelectionRef,
      manualBook: computed(() => entriesManualSelectionRef.value[0] || ''),
      refreshFromSettings: vi.fn(),
      setSource: setEntriesSource,
      setManualSelection: vi.fn((names: string[]) => {
        entriesSourceRef.value = 'manual';
        entriesManualSelectionRef.value = names;
      }),
      toggleManualBook: toggleEntriesManualBook,
      resolveBookNames: vi.fn(async () =>
        entriesSourceRef.value === 'manual' ? entriesManualSelectionRef.value : ['CharBookT'],
      ),
    }),
  }));

  const groupsRef = shallowRef<any[]>([
    { bookName: 'CharBookT', expanded: true, entries: [{ uid: 1, bookName: 'CharBookT', label: '人物', checked: true, disabled: false }] },
  ]);
  vi.doMock('../../../src/presentation-v2/composables/useFormFillWorldbookEntries', () => ({
    useFormFillWorldbookEntries: () => ({
      groups: groupsRef,
      status: ref('success'),
      error: ref(''),
      loadEntries: vi.fn(async () => {}),
      toggleEntry: vi.fn(),
      selectAll: vi.fn(),
      deselectAll: vi.fn(),
      toggleGroupExpanded: vi.fn(),
    }),
  }));

  vi.doMock('../../../src/presentation-v2/composables/useWorldbookSelector', () => ({
    useWorldbookSelector: () => ({
      names: shallowRef(['CharBookT', 'Other']),
      charPrimary: ref(opts.injectionCharPrimary === undefined ? 'CharBookT' : opts.injectionCharPrimary),
      status: ref('success'),
      error: ref(''),
      refresh: vi.fn(async () => {}),
    }),
  }));

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return {
    mount,
    selectGlobalPreset,
    selectChatPreset,
    refresh,
    openVisualizer,
    editPreset,
    setAsDefault,
    deletePreset,
    exportPresetMgmt,
    renamePreset,
    createBlankPreset,
    importPresetForCurrentChat,
    settings,
    saveSettings,
    injectionTargetChange,
    describeInjectionTarget,
    drawerView,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TablePage', () => {
  it('四个分节：附加世界书条目、写入目标、提示词、标签筛选，不混入模板与工具', async () => {
    const { mount } = await mountTablePage();

    const page = document.querySelector('[data-ub-main]');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(document.querySelector('.ub-top__title')?.textContent || '').toContain('填表规则');
    expect(text).toContain('标签筛选');
    expect(text).toContain('填表提示词');
    expect(text).toContain('写入目标世界书');
    expect(text).toContain('附加世界书条目');
    expect(text).not.toContain('表格模板预设');
    expect(text).not.toContain('打开可视化表格编辑器');
    expect(text).not.toContain('表格工具');
    expect(text).not.toContain('立即构建交火纪要索引');
    expect(text).not.toContain('Embedding / Rerank');
    expect(Array.from(page!.querySelectorAll('button')).some(b => b.textContent?.trim() === '刷新')).toBe(false);

    const sectionTitles = Array.from(page!.querySelectorAll('.ub-section__title'))
      .map(title => (title.textContent || '').trim());
    expect(sectionTitles).toEqual(['附加世界书条目', '写入目标世界书', '填表提示词', '标签筛选']);
    const jumpItems = Array.from(page!.querySelectorAll('.ub-page__chip'))
      .map(item => (item.textContent || '').trim());
    expect(jumpItems).toEqual(['附加条目', '写入目标', '提示词', '标签筛选']);
    // 每个分节都带常驻说明
    page!.querySelectorAll('.ub-section').forEach(section => {
      expect(section.querySelector('.ub-section__desc')?.textContent?.trim()).toBeTruthy();
    });

    mount.__resetAcuV2MountForTests();
  });

  it('提示词已自定义且工具仍开着时，badge 提示工具未关（提示词与开关分处两页）', async () => {
    // 提示词编辑器在本页、工具开关在填表页：自定义后必须在本页就能看出工具还开着。
    const { mount } = await mountTablePage({
      overrideSettings: (settings) => {
        settings.tableFillNativeToolsEnabled = true;
      },
    });

    const text = document.body.textContent || '';
    expect(text).toContain('工具调用仍开着');

    mount.__resetAcuV2MountForTests();
  });

  it('越权 SQL 降级开关默认开启，切换后立即保存设置', async () => {
    const { mount, settings, saveSettings } = await mountTablePage();
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-acu-setting-key="discardUnauthorizedTableEditsEnabled"]',
    );

    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('role')).toBe('switch');
    expect(toggle!.getAttribute('aria-checked')).toBe('true');

    toggle!.click();
    await nextTick();

    expect(settings.discardUnauthorizedTableEditsEnabled).toBe(false);
    expect(toggle!.getAttribute('aria-checked')).toBe('false');
    expect(saveSettings).toHaveBeenCalledTimes(1);

    mount.__resetAcuV2MountForTests();
  });

  it('关闭后重新打开 UI 会刷新当前表格页', async () => {
    const { mount, describeInjectionTarget } = await mountTablePage();

    expect(describeInjectionTarget).toHaveBeenCalledTimes(1);
    mount.closeAcuV2App();
    await mount.openAcuV2App();
    await new Promise(r => setTimeout(r, 0));

    expect(describeInjectionTarget).toHaveBeenCalledTimes(2);

    mount.__resetAcuV2MountForTests();
  });

  it('注入目标在未解析角色卡世界书时仍显示角色卡绑定世界书默认选项', async () => {
    const { mount } = await mountTablePage({ injectionCharPrimary: null });

    const target = document.getElementById('tbl-target')!;
    const select = target.querySelector<HTMLSelectElement>('select[aria-label="目标世界书"]');
    expect(select).not.toBeNull();
    expect(select!.selectedOptions[0]?.textContent?.trim()).toBe('角色卡绑定世界书');

    const labels = Array.from(select!.options).map(option => option.textContent?.trim());
    expect(labels).toContain('角色卡绑定世界书');
    expect(labels).toContain('CharBookT');

    mount.__resetAcuV2MountForTests();
  });

  it('附加世界书条目手动模式可以多选世界书', async () => {
    const { mount } = await mountTablePage();

    const entriesSection = document.getElementById('tbl-entries')!;
    const manualButton = Array.from(entriesSection.querySelectorAll<HTMLButtonElement>('.ub-seg__item'))
      .find(button => button.textContent?.trim() === '手动选择')!;
    manualButton.click();
    await nextTick();

    const books = () => Array.from(entriesSection.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'));
    books().find(button => button.textContent?.trim() === 'CharBookT')!.click();
    books().find(button => button.textContent?.trim() === 'Other')!.click();
    // 两次 toggle 各触发一次 refreshEntriesGroups（带 seq guard，旧调用中止），
    // 需要多次微任务刷新让最后一次调用的 resolveBookNames + loadEntries + label 写入全部完成
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await nextTick();

    expect(entriesSection.querySelector('.ub-tbl__current')?.textContent).toContain('CharBookT、Other');
    expect(books().find(button => button.textContent?.trim() === 'CharBookT')!.getAttribute('aria-checked')).toBe('true');
    expect(books().find(button => button.textContent?.trim() === 'Other')!.getAttribute('aria-checked')).toBe('true');

    mount.__resetAcuV2MountForTests();
  });

  it('切换注入目标世界书后立即刷新目前已选提示', async () => {
    const { mount, injectionTargetChange, describeInjectionTarget } = await mountTablePage();

    const target = document.getElementById('tbl-target')!;
    expect(target.querySelector('.ub-tbl__current')?.textContent).toContain('角色卡绑定世界书 · CharBookT');

    const select = target.querySelector<HTMLSelectElement>('select[aria-label="目标世界书"]')!;
    select.value = 'Other';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(injectionTargetChange).toHaveBeenCalledWith('Other');
    expect(describeInjectionTarget).toHaveBeenCalledTimes(2);
    expect(target.querySelector('.ub-tbl__current')?.textContent).toContain('Other');

    mount.__resetAcuV2MountForTests();
  });

});
