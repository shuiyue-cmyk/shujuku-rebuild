/**
 * WorldbookAgentControlBar — Agent 世界书控制条
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';

const mockSetMode = vi.fn(async () => undefined);
const mockRestore = vi.fn(async () => false);
const mockSkillifyAll = vi.fn(async () => false);
const mockClearSkillMeta = vi.fn(async () => false);

const agentControl = {
  mode: { value: 'passive' },
  busy: { value: null },
  configStatusText: { value: '配置正常' },
  apiPresetOptions: { value: [] },
  agentApiPreset: { value: '' },
  agentSkillApiPreset: { value: '' },
  isAgentMode: { value: false },
  setMode: mockSetMode,
  setAgentApiPreset: vi.fn(),
  setAgentSkillApiPreset: vi.fn(),
  restore: mockRestore,
  skillifyAll: mockSkillifyAll,
  clearSkillMeta: mockClearSkillMeta,
};

vi.mock('../../../src/presentation-v2/components/WorldbookAgentAdvancedPanel.vue', () => ({
  default: defineComponent({
    props: { agentControl: { type: Object, required: true } },
    emits: ['close', 'current-worldbook-changed', 'global-template-saved'],
    setup() { return () => null; },
  }),
}));

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
  currentWorldbookChanged: ReturnType<typeof vi.fn>;
}

const mounted: Mounted[] = [];

async function mountControlBar(): Promise<Mounted> {
  vi.resetModules();
  const currentWorldbookChanged = vi.fn();
  const mod = await import('../../../src/presentation-v2/components/WorldbookAgentControlBar.vue');
  const wrapper = defineComponent({
    setup() {
      return () => h(mod.default, { agentControl, onCurrentWorldbookChanged: currentWorldbookChanged });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  const result = { app, el, currentWorldbookChanged };
  mounted.push(result);
  return result;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('WorldbookAgentControlBar', () => {
  it('切换 Agent 世界书模式后等待 setMode 并通知父级刷新条目列表', async () => {
    const { el, currentWorldbookChanged } = await mountControlBar();
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-segmented__item'));

    buttons[2].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSetMode).toHaveBeenCalledWith('agent');
    expect(currentWorldbookChanged).toHaveBeenCalledTimes(1);
  });
});
