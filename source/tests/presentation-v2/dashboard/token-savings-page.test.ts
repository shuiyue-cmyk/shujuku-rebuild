// @vitest-environment jsdom
import { createPinia } from 'pinia';
import { createApp, h, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogStore } from '../../../src/presentation-v2/stores/dialog-store';
import TokenSavingsPage from '../../../src/presentation-v3/pages/TokenSavingsPage.vue';
import UbDialogHost from '../../../src/presentation-v3/ui/UbDialogHost.vue';

const { preview, saveBook, saveChronicle, chronicle, loadBook, settings } = vi.hoisted(() => ({
  preview: vi.fn(),
  saveBook: vi.fn(),
  saveChronicle: vi.fn(),
  loadBook: vi.fn(),
  settings: { tokenSavings: { enabled: true, autoChronicle: false, concurrency: 2, compressionPreset: '', auditPreset: '' } },
  chronicle: {
    scope: { chatKey: 'test-chat', isolationKey: '', sheetKey: 'sheet_1', column: '纪要' },
    items: [{ id: '42', label: 'AM0042', original: '星汐通知夜莺先在门外等待。' }],
  },
}));

vi.mock('../../../src/data/gateways/worldbook-file-gateway', () => ({
  listWorldbookNamesLive_ACU: vi.fn(async () => ['世界书A', '世界书B']),
  loadWorldbookFile_ACU: loadBook,
  replaceWorldbookContentsIfUnchanged_ACU: saveBook,
}));
vi.mock('../../../src/presentation/bootstrap/api-groups/table-crud-api', () => ({
  listChronicleCompressionItems_ACU: () => chronicle,
  replaceChronicleContentsIfUnchanged_ACU: saveChronicle,
}));
vi.mock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({
  watchChatChanged_ACU: vi.fn(),
}));
vi.mock('../../../src/presentation-v2/composables/useApiPresetSelectOptions', () => ({
  useApiPresetSelectOptions: () => ({
    apiStore: { refreshFromSettings: vi.fn() },
    followActiveApiLabel: { value: '当前模型' },
    apiPresetSelectOptions: { value: ['', '压缩模型', '核验模型'].map(value => ({ value, label: value || '当前模型' })) },
  }),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'test-chat',
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: settings,
}));
vi.mock('../../../src/presentation/bootstrap/chronicle-auto-compression', () => ({
  stopChronicleAutoCompression_ACU: vi.fn(),
}));
vi.mock('../../../src/service/settings/settings-write-service', () => ({
  withSettingsWrite_ACU: vi.fn((_fields, mutate) => { mutate(); return { ok: true }; }),
}));
vi.mock('../../../src/service/optimization/token-savings', () => ({
  previewTokenSavingsBatch_ACU: preview,
  getWorldbookCompressionBlock_ACU: (label: string) => label === '[InitVar]' ? '含变量，已保护' : undefined,
  resolveTokenSavingsPresets_ACU: () => ({
    compression: { presetName: settings.tokenSavings.compressionPreset || '当前模型' },
    audit: { presetName: settings.tokenSavings.auditPreset || '当前模型' },
  }),
}));

let app: App;

function button(text: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === text);
  if (!match) throw new Error('无法找到按钮 ' + text);
  return match;
}

async function click(text: string): Promise<void> {
  await vi.waitFor(() => expect(button(text).disabled).toBe(false));
  button(text).click();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="mount"></div><div id="ub-portal"></div>';
  vi.clearAllMocks();
  settings.tokenSavings = { enabled: true, autoChronicle: false, concurrency: 2, compressionPreset: '', auditPreset: '' };
  preview.mockImplementation(async items => items.map(item => ({
    item, candidate: { text: '星汐令夜莺门外等。', before: 24, after: 10, estimated: false },
  })));
  loadBook.mockResolvedValue({
    entries: {
      4: { uid: 4, comment: '背景故事', content: '星汐通知夜莺先在门外等待。' },
      5: { uid: 5, comment: '[InitVar]', content: '数值: 0' },
      6: { uid: 6, comment: 'TavernDB-ACU-测试', content: '内部条目' },
    },
  });
  app = createApp({ setup: () => () => [
    h(TokenSavingsPage),
    h(UbDialogHost),
  ] });
  app.use(createPinia()).mount('#mount');
});

afterEach(() => {
  app.unmount();
  document.body.replaceChildren();
});

describe('Token 节省双确认流程', () => {
  it('当前纪要先请求确认再生成预览，取消第二次确认后仍可再次核对', async () => {
    for (const [label, name] of [['压缩 API 预设', '压缩模型'], ['核验 API 预设', '核验模型']]) {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="' + label + '"]')!;
      select.value = name;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const concurrency = document.querySelector<HTMLInputElement>('input[aria-label="压缩并发数"]')!;
    concurrency.value = '4';
    concurrency.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.tokenSavings.concurrency).toBe(4);
    await click('勾选筛选结果');
    await click('压缩并预览');
    await vi.waitFor(() => expect(useDialogStore().active?.title).toBe('生成压缩预览'));
    expect(useDialogStore().active?.message).toMatch(/压缩模型.*核验模型/);
    expect(preview).not.toHaveBeenCalled();
    await click('开始压缩');
    await vi.waitFor(() => expect(document.body.textContent).toContain('星汐令夜莺门外等。'));
    expect(preview.mock.calls[0][4]).toBe(4);
    expect(preview.mock.calls[0][2]).toEqual({ compression: { presetName: '压缩模型' }, audit: { presetName: '核验模型' } });
    expect(saveChronicle).not.toHaveBeenCalled();
    await click('确认替换压缩');
    await vi.waitFor(() => expect(useDialogStore().active?.dangerMessage).toContain('无法撤销'));
    await click('取消');
    expect(saveChronicle).not.toHaveBeenCalled();
    await click('确认替换压缩');
    await click('永久替换');
    await vi.waitFor(() => expect(saveChronicle).toHaveBeenCalledExactlyOnceWith(chronicle.scope, [{
      id: '42', original: chronicle.items[0].original, replacement: '星汐令夜莺门外等。',
    }]));
    expect(saveBook).not.toHaveBeenCalled();
  });

  it('从酒馆全局选定世界书，只替换通过预览且勾选的条目', async () => {
    await click('世界书');
    const select = await vi.waitFor(() => {
      const field = document.querySelector<HTMLSelectElement>('select[aria-label="酒馆世界书"]');
      expect(field?.options.length).toBe(3);
      return field!;
    });
    select.value = '世界书B';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain('含变量，已保护'));
    expect(document.body.textContent).toContain('数据库自动维护，已保护');
    await click('勾选筛选结果');
    await click('压缩并预览');
    await click('开始压缩');
    await click('确认替换压缩');
    expect(saveBook).not.toHaveBeenCalled();
    await click('永久替换');
    await vi.waitFor(() => expect(saveBook).toHaveBeenCalledExactlyOnceWith('世界书B', [{
      uid: '4', original: '星汐通知夜莺先在门外等待。', replacement: '星汐令夜莺门外等。',
    }]));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(saveChronicle).not.toHaveBeenCalled();
  });

  it('自动压缩默认关闭，提示直接替换原文并在确认后保存开关', async () => {
    const auto = document.querySelector<HTMLButtonElement>('[aria-label="自动压缩纪要表"]')!;
    expect(auto.getAttribute('aria-checked')).toBe('false');
    auto.click();
    await vi.waitFor(() => expect(useDialogStore().active?.dangerMessage).toContain('无法撤销'));
    expect(settings.tokenSavings.autoChronicle).toBe(false);
    await click('启用自动压缩');
    await vi.waitFor(() => expect(settings.tokenSavings.autoChronicle).toBe(true));
    expect(preview).not.toHaveBeenCalled();
    expect(saveChronicle).not.toHaveBeenCalled();
  });
});
