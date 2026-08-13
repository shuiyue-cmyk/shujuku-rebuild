/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

const harness = vi.hoisted(() => ({ confirm: vi.fn(async () => false), info: vi.fn(), success: vi.fn() }));
vi.mock('../../../src/presentation-v2/stores/dialog-store', () => ({ useDialogStore: () => ({ confirm: harness.confirm }) }));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({ useToastStore: () => ({ info: harness.info, success: harness.success }) }));
vi.mock('../../../src/presentation-v2/components/_lib/AcuDrawer.vue', () => ({ default: defineComponent({
  props: { beforeClose: Function }, emits: ['close'],
  setup(props, { emit, slots }) { return () => h('div', [slots.default?.(), h('button', { class: 'close', onClick: async () => { if (!props.beforeClose || await props.beforeClose()) emit('close'); } }, 'close')]); },
}) }));

const mounted: Array<{ app: ReturnType<typeof createApp>; el: HTMLElement }> = [];
const segment = (content: string) => ({ role: 'user', content, deletable: true });
function control() {
  return {
    isReady: ref(true), initializationFailed: ref(false),
    agentDecisionPromptSegments: ref([segment('current decision')]), agentSkillifyPromptSegments: ref([segment('current skillify')]),
    getBuiltInPromptSegments: vi.fn((kind: string) => [segment(`built-in ${kind}`)]),
    savePromptSegmentsToCurrentWorldbook: vi.fn(async () => true), savePromptSegmentsAsGlobalTemplate: vi.fn(async () => true),
    agentPlotExecutionMode: ref('sequential'), contextSettings: ref({ decisionRecentContextCharLimit: 2, decisionWorldbookCandidateLimit: 10, skillifyMaxEntries: 10, plotWorldbookScanMessageLimit: 2, agentAiMaxRetries: 2, greenlightMinTkBudget: 0, greenlightMaxTkBudget: 1000 }),
    contextSettingsLimits: { decisionRecentContextCharLimit: { min: 1 }, decisionWorldbookCandidateLimit: { min: 1 }, skillifyMaxEntries: { min: 1 }, plotWorldbookScanMessageLimit: { min: 1 }, agentAiMaxRetries: { min: 1 }, greenlightMinTkBudget: { min: 0 }, greenlightMaxTkBudget: { min: 1 } },
    agentDecisionConcurrency: ref(1), maxSkillifyConcurrency: ref(3),
    setAgentPlotExecutionMode: vi.fn(), setContextSetting: vi.fn(), resetContextSettings: vi.fn(), setAgentDecisionConcurrency: vi.fn(async () => true), setMaxSkillifyConcurrency: vi.fn(), retryInitialization: vi.fn(),
  };
}
async function mount() {
  const agentControl = control(); const current = vi.fn(); const global = vi.fn(); const closed = vi.fn();
  const Panel = (await import('../../../src/presentation-v2/components/WorldbookAgentAdvancedPanel.vue')).default;
  const app = createApp(defineComponent({ setup: () => () => h(Panel, { open: true, agentControl, onCurrentWorldbookChanged: current, onGlobalTemplateSaved: global, onClose: closed }) }));
  const el = document.createElement('div'); document.body.appendChild(el); app.mount(el); mounted.push({ app, el }); await nextTick();
  return { agentControl, current, global, closed, el };
}
function click(el: HTMLElement, text: string) { const button = [...el.querySelectorAll('button')].find(item => item.textContent?.trim() === text) as HTMLButtonElement; expect(button).toBeTruthy(); button.click(); }
afterEach(() => { mounted.splice(0).forEach(({ app, el }) => { app.unmount(); el.remove(); }); vi.clearAllMocks(); harness.confirm.mockResolvedValue(false); });

describe('WorldbookAgentAdvancedPanel', () => {
  it('内置默认只进入草稿，全局保存不写当前世界书', async () => {
    const x = await mount(); click(x.el, '载入内置默认决策提示词'); await nextTick(); click(x.el, '保存为全局模板'); await nextTick();
    expect(x.agentControl.savePromptSegmentsAsGlobalTemplate).toHaveBeenCalledWith([segment('built-in decision')], [segment('current skillify')]);
    expect(x.agentControl.savePromptSegmentsToCurrentWorldbook).not.toHaveBeenCalled(); expect(x.global).toHaveBeenCalledOnce(); expect(x.current).not.toHaveBeenCalled();
  });
  it('保存当前才发当前变更，dirty 关闭需要确认', async () => {
    const x = await mount(); click(x.el, '载入内置默认决策提示词'); await nextTick(); click(x.el, '保存到当前世界书'); await nextTick();
    expect(x.current).toHaveBeenCalledOnce(); expect(x.global).not.toHaveBeenCalled(); click(x.el, '载入内置默认决策提示词'); await nextTick(); (x.el.querySelector('.close') as HTMLButtonElement).click(); await nextTick(); expect(harness.confirm).toHaveBeenCalled(); expect(x.closed).not.toHaveBeenCalled();
  });
  it('底层配置在 dirty 期间变化时锁定保存，确认关闭后真正丢弃草稿', async () => {
    const x = await mount();
    click(x.el, '载入内置默认决策提示词');
    await nextTick();
    x.agentControl.agentDecisionPromptSegments.value = [segment('new scope decision')];
    await nextTick();
    expect(x.el.textContent).toContain('当前草稿可能属于旧角色或旧世界书');
    const saveButtons = [...x.el.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => ['保存到当前世界书', '保存为全局模板'].includes(button.textContent?.trim() || ''));
    expect(saveButtons.every(button => button.disabled)).toBe(true);
    harness.confirm.mockResolvedValueOnce(true);
    (x.el.querySelector('.close') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(x.closed).toHaveBeenCalledOnce());
    await nextTick();
    expect(saveButtons.every(button => button.disabled)).toBe(true);
  });

  it('所有 Agent 数字输入保留最小值但不渲染 max 属性', async () => {
    const x = await mount();
    const inputs = [...x.el.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(inputs).toHaveLength(9);
    expect(inputs.every(input => !input.hasAttribute('max'))).toBe(true);
    expect(inputs.map(input => input.min)).toEqual(['1', '1', '1', '1', '1', '0', '1', '1', '1']);
    expect(inputs.map(input => input.step)).toEqual(['1', '1', '1', '1', '1', '100', '100', '1', '1']);
  });

  it('Agent 决策并发输入调用独立 setter 并通知当前世界书变更', async () => {
    const x = await mount();
    const input = [...x.el.querySelectorAll('input')].find(item => item.value === '1') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = '4';
    input.dispatchEvent(new Event('change'));
    await nextTick();
    expect(x.agentControl.setAgentDecisionConcurrency).toHaveBeenCalledWith(4);
    expect(x.current).toHaveBeenCalledOnce();
  });
});
