/**
 * TableTemplatePresetPanel — 面板级 runtime 导出入口与差异提示
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

async function mountPanel(opts: {
  runtimeAvailable?: boolean;
  runtimeDiffers?: boolean;
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';

  const tplExportTemplate = vi.fn(() => {});
  const runtimeTemplateAvailable = ref(opts.runtimeAvailable ?? true);
  const runtimeDiffersFromLibrary = ref(opts.runtimeDiffers ?? false);

  vi.doMock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({
    useChatChangedTick: () => ref(0),
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTemplateRuntimeChangeListener', () => ({
    useTemplateRuntimeChangeTick: () => ref(0),
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTableTemplatePresets', () => ({
    useTableTemplatePresets: () => ({
      busy: ref(false),
      message: ref(null),
      selectedGlobalPreset: ref('global-A'),
      selectedGlobalPresetValue: ref('global:global-A'),
      selectedChatPreset: ref('global:global-A'),
      selectedChatPresetLabel: ref('global-A（全局预设）'),
      isChatOverridden: ref(false),
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
      refresh: vi.fn(),
      selectGlobalPreset: vi.fn(async () => {}),
      selectChatPreset: vi.fn(async () => {}),
      restoreArchivedChatTemplate: vi.fn(async () => {}),
      importPresetForCurrentChat: vi.fn(async () => {}),
      exportTemplate: tplExportTemplate,
    }),
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTablePresetManagement', () => ({
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

  const { default: TableTemplatePresetPanel } = await import('../../../src/presentation-v2/components/TableTemplatePresetPanel.vue');
  const app = createApp(TableTemplatePresetPanel);
  app.mount('#app');
  await nextTick();
  return { app, tplExportTemplate, runtimeDiffersFromLibrary };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TableTemplatePresetPanel · runtime 导出与差异提示', () => {
  it('渲染导出当前生效模板按钮，点击调用 exportTemplate(runtime)', async () => {
    const { app, tplExportTemplate } = await mountPanel();
    const exportBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(btn => btn.title === '导出当前生效模板');
    expect(exportBtn).toBeDefined();
    exportBtn!.click();
    await nextTick();
    expect(tplExportTemplate).toHaveBeenCalledWith('runtime');
    app.unmount();
  });

  it('运行时不可用时导出按钮 disabled', async () => {
    const { app } = await mountPanel({ runtimeAvailable: false });
    const exportBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(btn => btn.title === '导出当前生效模板');
    expect(exportBtn).toBeDefined();
    expect(exportBtn!.disabled).toBe(true);
    app.unmount();
  });

  it('runtimeDiffersFromLibrary 为真时状态行显示差异提示', async () => {
    const { app, runtimeDiffersFromLibrary } = await mountPanel({ runtimeDiffers: false });
    const statusLine = document.querySelector<HTMLElement>('.acu-table-template-panel__status-line')!;
    expect(statusLine).not.toBeNull();
    expect(statusLine.textContent).not.toContain('当前生效模板与预设库内容不同');

    runtimeDiffersFromLibrary.value = true;
    await nextTick();
    expect(statusLine.textContent).toContain('当前生效模板与预设库内容不同');
    app.unmount();
  });

  it('预设行透传 runtime 项（下拉含当前生效模板）', async () => {
    const { app } = await mountPanel();
    const dropdown = document.querySelector('.acu-preset-dd')!;
    expect(dropdown).not.toBeNull();
    (dropdown.querySelector('.acu-preset-dd__trigger') as HTMLButtonElement).click();
    await nextTick();
    const itemNames = Array.from(document.querySelectorAll('.acu-preset-dd__item-name')).map(el => el.textContent);
    expect(itemNames).toContain('当前生效模板（内存）');
    app.unmount();
  });
});
