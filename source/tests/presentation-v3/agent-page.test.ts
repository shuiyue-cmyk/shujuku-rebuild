/**
 * @vitest-environment jsdom
 */
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

const harness = vi.hoisted(() => ({
  setScope: vi.fn(async () => true),
  toggleScopeBook: vi.fn(async () => true),
  refreshControl: vi.fn(async () => undefined),
  loadEntries: vi.fn(async () => ['AgentBook']),
  refreshWorldbooks: vi.fn(async () => undefined),
}));

vi.mock('../../src/presentation-v2/composables/usePlotWorldbookAgentControl', async () => {
  const { ref } = await import('vue');
  const explicit: Record<string, unknown> = {
    worldbookScope: ref({ source: 'character', manualSelection: [] }),
    isAgentMode: ref(false),
    isReady: ref(true),
    initializationFailed: ref(false),
    busy: ref(null),
    mode: ref('off'),
    agentApiPreset: ref(''),
    agentSkillApiPreset: ref(''),
    apiPresetOptions: ref([]),
    configStatusText: ref(''),
    contextSettings: ref({}),
    contextSettingsLimits: {},
    agentDecisionPromptSegments: ref([]),
    agentSkillifyPromptSegments: ref([]),
    refresh: harness.refreshControl,
    setWorldbookScope: harness.setScope,
    toggleWorldbookScopeBook: harness.toggleScopeBook,
  };
  // 页面与高级面板还会读其它字段：动作类给空实现，状态类给空 ref。
  const control = new Proxy(explicit, {
    get(target, key: string) {
      if (!(key in target)) {
        target[key] = /^(set|save|reset|retry|get|skillify|restore|clear|sync|toggle)/.test(key) ? vi.fn(async () => true) : ref(null);
      }
      return target[key];
    },
  });
  return { usePlotWorldbookAgentControl: () => control };
});
vi.mock('../../src/presentation-v2/composables/useAgentWorldbookEntries', async () => {
  const { ref } = await import('vue');
  return {
    useAgentWorldbookEntries: () => ({
      groups: ref([]), status: ref('success'), error: ref(''), batchBusy: ref(false),
      loadEntries: harness.loadEntries, toggleSkillifyEntry: vi.fn(), toggleGroupExpanded: vi.fn(),
      selectAllForSkillify: vi.fn(), deselectAllForSkillify: vi.fn(), getSelectedSkillifyEntries: () => [],
      saveEntrySkillMeta: vi.fn(), deleteEntrySkillMeta: vi.fn(),
      batchEnableDisabledSkillEntries: vi.fn(async () => 0),
      batchConvertBlueToGreenEntries: vi.fn(async () => 0),
      batchCombinedBlueToGreenAndEnable: vi.fn(async () => ({ converted: 0, enabled: 0 })),
      lastBatchFailedBooks: { value: [] as string[] },
    }),
  };
});
vi.mock('../../src/presentation-v2/composables/useWorldbookSelector', async () => {
  const { ref } = await import('vue');
  return { useWorldbookSelector: () => ({
    names: ref(['AgentBook']), charPrimary: ref('CharBook'), status: ref('success'), error: ref(''), refresh: harness.refreshWorldbooks,
  }) };
});
vi.mock('../../src/presentation-v2/composables/useChatChangedListener', async () => {
  const { ref } = await import('vue');
  return { useChatChangedTick: () => ref(0), watchChatChanged_ACU: () => {} };
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('AgentPage', () => {
  it('条目区只有 Skill 全选/全不选（没有普通全选），范围切到手动选择写入 Agent control', async () => {
    const Page = (await import('../../src/presentation-v3/pages/AgentPage.vue')).default;
    const portal = document.createElement('div');
    portal.id = 'ub-portal';
    document.body.appendChild(portal);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(Page);
    app.use(createPinia());
    app.mount(el);
    await Promise.resolve();

    const entries = el.querySelector('#agent-entries')!;
    expect(entries.textContent).toContain('条目与 Skill');
    const labels = Array.from(entries.querySelectorAll<HTMLButtonElement>('button')).map(button => button.textContent?.trim());
    expect(labels).toContain('Skill 全选');
    expect(labels).toContain('Skill 全不选');
    expect(labels).not.toContain('全选');
    expect(labels).not.toContain('全不选');

    const manual = Array.from(el.querySelectorAll<HTMLButtonElement>('#agent-scope .ub-seg__item'))
      .find(button => button.textContent?.trim() === '手动选择');
    manual!.click();
    await Promise.resolve();
    expect(harness.setScope).toHaveBeenCalledWith('manual');

    app.unmount();
  });
});
