/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function snapshot(id: string) {
  return {
    schemaVersion: 1,
    settledThroughIndex: 1,
    hooks: [{ id: `${id}-hook`, summary: id }],
    infoGap: [],
    constraints: [],
    storyArc: [],
    chronology: [],
    webRefs: [],
    revisions: { hooks: 1, infoGap: 1, constraints: 1, storyArc: 1, chronology: 1, webRefs: 1 },
  } as any;
}

async function setup() {
  vi.resetModules();
  let identity = 'chat-a';
  let chat: any[] = [{ kind: 'a' }];
  const replace = vi.fn(async (raw: any, explicitChat?: any[]) => {
    const target = explicitChat || chat;
    target[0] = { ...target[0], saved: raw };
    return snapshot('saved');
  });
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    get currentChatFileIdentifier_ACU() { return identity; },
  }));
  vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
    getChatArray_ACU: () => chat,
  }));
  vi.doMock('../../../src/service/continuation/agent/agent-module-store', () => ({
    readAgentModuleSnapshot_ACU: vi.fn(() => snapshot('a')),
    readAgentModuleSnapshotDiagnostics_ACU: vi.fn(() => ({ candidates: [], adoptedIndex: 0, salvaged: false })),
    replaceAgentModuleSnapshotByUser_ACU: replace,
  }));
  const pinia = await import('pinia');
  pinia.setActivePinia(pinia.createPinia());
  const { useContinuationMaterials } = await import('../../../src/presentation-v2/composables/useContinuationMaterials');
  const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
  return {
    useContinuationMaterials,
    toast: useToastStore(),
    replace,
    setChat(nextIdentity: string, nextChat: any[]) {
      identity = nextIdentity;
      chat = nextChat;
    },
    getChat: () => chat,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useContinuationMaterials chat binding', () => {
  it('资料保存期间切换聊天时，迟到的 A 结果不回写 B 页面', async () => {
    const d = await setup();
    const materials = d.useContinuationMaterials();
    materials.reload();
    materials.updateDraft('hooks', JSON.stringify([{ id: 'a-hook', summary: 'A 草稿' }]));
    let release!: () => void;
    d.replace.mockImplementationOnce(async (raw: any, explicitChat?: any[]) => {
      await new Promise<void>(resolve => { release = resolve; });
      const target = explicitChat || d.getChat();
      target[0] = { ...target[0], saved: raw };
      return snapshot('late');
    });

    const saving = materials.save('hooks');
    await vi.waitFor(() => { expect(d.replace).toHaveBeenCalledOnce(); });
    d.setChat('chat-b', [{ kind: 'b' }]);
    release();

    await expect(saving).resolves.toBe(false);
    expect(d.getChat()[0]).toEqual({ kind: 'b' });
    expect(materials.snapshot.value).toEqual(snapshot('a'));
  });

  it('资料草稿保存时绑定草稿所属聊天，不把 A 草稿写入 B', async () => {
    const d = await setup();
    const materials = d.useContinuationMaterials();
    materials.reload();
    materials.updateDraft('hooks', JSON.stringify([{ id: 'a-hook', summary: 'A 草稿' }]));

    d.setChat('chat-b', [{ kind: 'b' }]);
    const saved = await materials.save('hooks');

    expect(saved).toBe(false);
    expect(d.replace).not.toHaveBeenCalled();
    expect(d.getChat()[0]).toEqual({ kind: 'b' });
  });
});
