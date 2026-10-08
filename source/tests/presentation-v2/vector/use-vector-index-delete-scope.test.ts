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
