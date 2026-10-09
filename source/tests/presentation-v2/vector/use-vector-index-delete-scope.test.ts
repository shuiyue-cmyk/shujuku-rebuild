/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// R10A-04：删除交火索引的确认针对弹窗时的聊天；确认期间切了聊天就不删。
const chatState = vi.hoisted(() => ({ id: 'chat-a' }));
const deleteIndex = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../../src/service/runtime/state-manager', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  get currentChatFileIdentifier_ACU() { return chatState.id; },
  getCurrentIsolationKey_ACU: () => '',
}));
vi.mock('../../../src/service/vector/summary-vector-index-chat-service', () => ({
  deleteCurrentSummaryVectorIndexFromChat_ACU: deleteIndex,
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: vi.fn(() => null),
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  getSummaryVectorIndexStats_ACU: vi.fn(async () => null),
  inspectSummaryVectorIndexHealth_ACU: vi.fn(async () => null),
}));

beforeEach(async () => {
  chatState.id = 'chat-a';
  deleteIndex.mockClear();
  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
});

describe('useVectorIndexConfig.deleteCurrentIndex（R10A-04）', () => {
  it('确认期间切换聊天时不删除交火索引并提示', async () => {
    const { useVectorIndexConfig } = await import('../../../src/presentation-v2/composables/useVectorIndexConfig');
    const { captureChatActionScope_ACU } = await import('../../../src/presentation-v2/composables/chat-action-scope');
    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    const warning = vi.spyOn(useToastStore(), 'warning').mockImplementation(() => '' as any);
    const vector = useVectorIndexConfig();
    const scope = captureChatActionScope_ACU();
    chatState.id = 'chat-b';

    await vector.deleteCurrentIndex(scope);

    expect(deleteIndex).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('切换'), expect.anything());
  });

  it('聊天未切换时照常删除', async () => {
    const { useVectorIndexConfig } = await import('../../../src/presentation-v2/composables/useVectorIndexConfig');
    const { captureChatActionScope_ACU } = await import('../../../src/presentation-v2/composables/chat-action-scope');
    const vector = useVectorIndexConfig();

    await vector.deleteCurrentIndex(captureChatActionScope_ACU());

    expect(deleteIndex).toHaveBeenCalledOnce();
  });
});

// 索引状态卡片：「身份健康」排在最后并占两格。11 项 = 10 + 1 宽 = 12 格，2/3/4 列下都整行排满，
// 而且放在末尾时任何列数都无需打乱前面各项的顺序。
describe('useVectorIndexConfig.statusStatsItems 排列', () => {
  it('身份健康是最后一项且为宽项，其余项都不加宽', async () => {
    const { useVectorIndexConfig } = await import('../../../src/presentation-v2/composables/useVectorIndexConfig');
    const items = useVectorIndexConfig().statusStatsItems.value;

    expect(items).toHaveLength(11);
    expect(items[items.length - 1]).toMatchObject({ label: '身份健康', wide: true });
    expect(items.filter(item => item.wide)).toHaveLength(1);
  });
});

// R10A-12：关键词提示词是全局设置；保存向量 API 或切聊天触发的 refresh 不得重置未保存的编辑。
describe('useVectorIndexConfig.refresh（R10A-12）', () => {
  it('提示词有未保存修改时 refresh 不重置编辑缓冲与 dirty', async () => {
    const { useVectorIndexConfig } = await import('../../../src/presentation-v2/composables/useVectorIndexConfig');
    const vector = useVectorIndexConfig();
    vector.refresh();
    vector.addPromptSegment('bottom');
    const edited = vector.promptSegments.value.length;
    expect(vector.promptDirty.value).toBe(true);

    vector.refresh();

    expect(vector.promptDirty.value).toBe(true);
    expect(vector.promptSegments.value.length).toBe(edited);
  });
});
