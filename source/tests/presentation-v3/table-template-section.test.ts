/**
 * TableTemplateSection — runtime 导出入口、跟随全局与差异提示
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

async function mountPanel(opts: {
  runtimeAvailable?: boolean;
  runtimeDiffers?: boolean;
  chatOverridden?: boolean;
  snapshotDiffers?: boolean;
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '<div id="ub-portal"></div><div id="app"></div>';

  const tplExportTemplate = vi.fn(() => {});
  const tplFollowGlobalTemplate = vi.fn(async () => {});
  const runtimeTemplateAvailable = ref(opts.runtimeAvailable ?? true);
  const runtimeDiffersFromLibrary = ref(opts.runtimeDiffers ?? false);
  const isChatOverridden = ref(opts.chatOverridden ?? false);
  const chatSnapshotDiffersFromLibrary = ref(opts.snapshotDiffers ?? false);

  vi.doMock('../../src/presentation-v2/composables/useChatChangedListener', () => ({
    useChatChangedTick: () => ref(0),
    watchChatChanged_ACU: () => {},
  }));
  vi.doMock('../../src/presentation-v2/composables/useTemplateRuntimeChangeListener', () => ({
    useTemplateRuntimeChangeTick: () => ref(0),
  }));
  vi.doMock('../../src/presentation-v2/composables/useTableTemplatePresets', () => ({
    useTableTemplatePresets: () => ({
      busy: ref(false),
      message: ref(null),
      selectedGlobalPreset: ref('global-A'),
      selectedGlobalPresetValue: ref('global:global-A'),
      selectedChatPreset: ref('global:global-A'),
      selectedChatPresetLabel: ref('global-A（全局预设）'),
      isChatOverridden,
      chatPresetItems: ref([
        { value: 'global:', label: '默认预设（全局）', meta: '2 张表' },
        { value: 'runtime:current', label: '当前生效模板（内存）', meta: '2 张表' },
        { value: 'global:global-A', label: 'global-A（全局预设）', meta: '2 张表' },
      ]),
      chatArchiveItems: ref([]),
      runtimeTemplateItem: ref(
        opts.runtimeAvailable === false
          ? null
          : { value: 'runtime:current', label: '当前生效模板（内存）', meta: '2 张表' },
      ),
      runtimeDiffersFromLibrary,
      runtimeTemplateAvailable,
      chatSnapshotDiffersFromLibrary,
      refresh: vi.fn(),
      selectGlobalPreset: vi.fn(async () => {}),
      selectChatPreset: vi.fn(async () => {}),
      restoreArchivedChatTemplate: vi.fn(async () => {}),
      importPresetForCurrentChat: vi.fn(async () => {}),
      exportTemplate: tplExportTemplate,
      followGlobalTemplate: tplFollowGlobalTemplate,
    }),
  }));
  vi.doMock('../../src/presentation-v2/composables/useTablePresetManagement', () => ({
    useTablePresetManagement: () => ({
      busy: ref(false),
      message: ref(null),
      isDrawerOpen: ref(false),
      title: ref(''),
      presetMeta: ref([
        { name: '__runtime__', kind: 'runtime', label: '当前生效模板（内存）', readOnly: true },
        { name: 'global-A' },
      ]),
      defaultPresetName: ref('global-A'),
      refresh: vi.fn(),
      closeDrawer: vi.fn(),
      openManage: vi.fn(),
      openVisualizer: vi.fn(async () => {}),
      editPreset: vi.fn(async () => {}),
      setAsDefault: vi.fn(async () => {}),
      deletePreset: vi.fn(async () => {}),
      exportPreset: vi.fn(() => {}),
      renamePreset: vi.fn(async () => {}),
      createBlankPreset: vi.fn(async () => {}),
    }),
  }));

  const { default: TableTemplateSection } = await import('../../src/presentation-v3/parts/TableTemplateSection.vue');
  const app = createApp(TableTemplateSection);
  app.mount('#app');
  await nextTick();
  return { app, tplExportTemplate, tplFollowGlobalTemplate, runtimeDiffersFromLibrary, isChatOverridden, chatSnapshotDiffersFromLibrary };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TableTemplateSection · runtime 导出与状态展示', () => {
  it('渲染导出当前生效模板按钮，点击调用 exportTemplate(runtime)', async () => {
    const { app, tplExportTemplate } = await mountPanel();
    const exportBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(btn => btn.title === '导出当前生效模板');
    expect(exportBtn).toBeDefined();
    exportBtn!.click();
    await nextTick();
    expect(tplExportTemplate).toHaveBeenCalledWith('runtime');
    app.unmount();
  });
});
