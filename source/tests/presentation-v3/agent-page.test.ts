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
  refreshApiPresets: vi.fn(),
  favorites: null as any,
}));

vi.mock('../../src/presentation-v2/stores/api-preset-store', async () => {
  const { reactive } = await import('vue');
  const store = reactive({
    activePresetName: 'Fast',
    presets: [{ name: 'Fast' }],
    refreshFromSettings: harness.refreshApiPresets,
  });
  return { useApiPresetStore: () => store };
});

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
    apiPresetOptions: ref([{ value: '', label: '当前 API' }, { value: 'Fast', label: 'Fast' }]),
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
vi.mock('../../src/presentation-v2/composables/useFavoriteWorldbooks', async () => {
  const { computed, ref } = await import('vue');
  const selected = ref<string[]>([]);
  const characterName = ref('艾琳');
  harness.favorites = {
    favorites: ref(['战斗技能', '地理百科', '旧书']),
    statuses: ref({
      战斗技能: { bookName: '战斗技能', exists: true, candidateCount: 3, skilledCount: 3 },
      地理百科: { bookName: '地理百科', exists: true, candidateCount: 4, skilledCount: 1 },
      旧书: { bookName: '旧书', exists: false, candidateCount: 0, skilledCount: 0 },
    }),
    addableNames: ref(['AgentBook']),
    characterName,
    selected,
    mounting: ref(false),
    canMount: computed(() => !!characterName.value),
    refresh: vi.fn(async () => undefined),
    add: vi.fn(async () => undefined),
    remove: vi.fn(),
    toggleSelected: vi.fn((name: string, checked: boolean) => {
      selected.value = checked ? [...selected.value, name] : selected.value.filter(item => item !== name);
    }),
    mountSelected: vi.fn(async () => true),
    skillify: vi.fn(async () => undefined),
  };
  return { useFavoriteWorldbooks: () => harness.favorites };
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

  it('两个 API 下拉的「跟随当前」项显示当前预设名，而不是「使用当前 API 配置」', async () => {
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

    expect(harness.refreshApiPresets).toHaveBeenCalled();
    const selects = Array.from(el.querySelectorAll<HTMLSelectElement>('#agent-control select'));
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      const options = Array.from(select.options).map(option => option.textContent?.trim());
      expect(options).toEqual(['Fast（当前）', 'Fast']);
      expect(select.options[select.selectedIndex].textContent?.trim()).toBe('Fast（当前）');
    }
    expect(el.textContent).not.toContain('使用当前 API 配置');

    app.unmount();
  });

  it('常用世界书：显示 Skill 进度，未完成的给 Skill 化按钮，找不到的不能勾选；勾选后挂载到当前角色卡', async () => {
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

    const section = el.querySelector('#agent-favorites')!;
    expect(harness.favorites.refresh).toHaveBeenCalled();
    const items = Array.from(section.querySelectorAll('.ub-agent-fav__item'));
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('已 Skill 化 3/3'),
      expect.stringContaining('Skill 1/4'),
      expect.stringContaining('找不到这本书'),
    ]);
    const skillifyButtons = (item: Element) => Array.from(item.querySelectorAll('button')).filter(button => button.textContent?.includes('Skill 化') && !button.classList.contains('ub-agent-fav__check'));
    expect(skillifyButtons(items[0])).toHaveLength(0);
    expect(skillifyButtons(items[1])).toHaveLength(1);
    expect(items[2].querySelector<HTMLButtonElement>('.ub-agent-fav__check')!.disabled).toBe(true);

    skillifyButtons(items[1])[0].click();
    await Promise.resolve();
    expect(harness.favorites.skillify).toHaveBeenCalledWith('地理百科');

    const mountButton = Array.from(section.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('挂载所选'))!;
    expect(mountButton.disabled).toBe(true);
    items[0].querySelector<HTMLButtonElement>('.ub-agent-fav__check')!.click();
    await Promise.resolve();
    expect(mountButton.disabled).toBe(false);
    expect(section.textContent).toContain('艾琳');
    mountButton.click();
    await Promise.resolve();
    expect(harness.favorites.mountSelected).toHaveBeenCalledTimes(1);

    app.unmount();
  });
});
