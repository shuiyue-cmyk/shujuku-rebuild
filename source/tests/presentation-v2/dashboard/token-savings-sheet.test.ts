// @vitest-environment jsdom
import { createPinia } from 'pinia';
import { createApp, h, ref, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogStore } from '../../../src/presentation-v2/stores/dialog-store';
import TokenSavingsSheet from '../../../src/presentation-v3/parts/TokenSavingsSheet.vue';
import UbDialogHost from '../../../src/presentation-v3/ui/UbDialogHost.vue';

const { preview, saveBook, saveChronicle, chronicle, loadBook } = vi.hoisted(() => ({
  preview: vi.fn(),
  saveBook: vi.fn(),
  saveChronicle: vi.fn(),
  loadBook: vi.fn(),
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
vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'test-chat',
  getCurrentIsolationKey_ACU: () => '',
}));
vi.mock('../../../src/service/optimization/token-savings', () => ({
  previewTokenSavingsItem_ACU: preview,
  getWorldbookCompressionBlock_ACU: (label: string) => label === '[InitVar]' ? '含变量，已保护' : undefined,
  resolveTokenSavingsPreset_ACU: () => ({ presetName: '示例模型', apiConfig: { model: 'model' } }),
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
  preview.mockImplementation(async item => ({
    item, candidate: { text: '星汐令夜莺门外等。', before: 24, after: 10, estimated: false },
  }));
  loadBook.mockResolvedValue({
    entries: {
      4: { uid: 4, comment: '背景故事', content: '星汐通知夜莺先在门外等待。' },
      5: { uid: 5, comment: '[InitVar]', content: '数值: 0' },
      6: { uid: 6, comment: 'TavernDB-ACU-测试', content: '内部条目' },
    },
  });
  const open = ref(true);
  app = createApp({ setup: () => () => [
    h(TokenSavingsSheet, { isOpen: open.value, onClose: () => { open.value = false; } }),
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
    await click('勾选筛选结果');
    await click('压缩并预览');
    await vi.waitFor(() => expect(useDialogStore().active?.title).toBe('生成压缩预览'));
    expect(preview).not.toHaveBeenCalled();
    await click('开始压缩');
    await vi.waitFor(() => expect(document.body.textContent).toContain('星汐令夜莺门外等。'));
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
});
