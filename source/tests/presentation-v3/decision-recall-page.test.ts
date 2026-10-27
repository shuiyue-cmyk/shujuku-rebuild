/**
 * DecisionRecallPage / PlotTaskEditor — 决策召回页的开关互斥与设置保存，剧情推进任务的「改由决策召回执行」开关。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick } from 'vue';
import { byText, createV3Settings, flush, mountV3 } from './v3-harness';

async function openDecisionRecallPage(settingsPatch: Record<string, unknown> = {}) {
  const settings = { ...createV3Settings(), ...settingsPatch };
  const ctx = await mountV3({ settings });
  ctx.router.setActivePage('decision-recall');
  await flush();
  return ctx;
}

const switchByLabel = (label: string) => document.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`);

describe('DecisionRecallPage', () => {
  afterEach(async () => {
    const mount = await import('../../src/presentation-v2/bootstrap/mount');
    mount.__resetAcuV2MountForTests();
  });

  it('剧情推进开着时单独开启决策召回：剧情推进被关掉、侧栏入口收起、设置已保存、并提示', async () => {
    const { settings, saveSettings, errors, router } = await openDecisionRecallPage();
    expect(settings.plotSettings.enabled).toBe(true);
    expect(router.visiblePages.map(page => page.id)).toContain('plot');

    switchByLabel('单独开启决策召回')!.click();
    await flush();

    expect(settings.decisionRecallSettings.enabled).toBe(true);
    expect(settings.plotSettings.enabled).toBe(false);
    expect(saveSettings).toHaveBeenCalled();
    expect(document.body.textContent).toContain('已关闭剧情推进');
    expect(switchByLabel('单独开启决策召回')!.getAttribute('aria-checked')).toBe('true');
    expect(router.visiblePages.map(page => page.id)).not.toContain('plot');
    expect(router.visiblePages.map(page => page.id)).toContain('decision-recall');
    expect(errors).toEqual([]);
  });

  it('没填 Key 时提示只会带上最新 5 条；换服务商后显示对应的 Key 与模型', async () => {
    const { settings } = await openDecisionRecallPage();
    expect(document.body.textContent).toContain('还没填 硅基流动（中国） Key');

    const select = document.querySelector<HTMLSelectElement>('select[aria-label="决策召回服务商"]');
    if (select) {
      select.value = 'aihubmix';
      select.dispatchEvent(new Event('change'));
    } else {
      const trigger = document.querySelector<HTMLElement>('[aria-label="决策召回服务商"]')!;
      trigger.click();
      await flush();
      byText<HTMLElement>('[role="option"]', 'AIHubMix')!.click();
    }
    await flush();

    expect(settings.decisionRecallSettings.provider).toBe('aihubmix');
    expect(document.body.textContent).toContain('AIHubMix Key');
  });

  it('召回条数填超范围时规整到 45 再保存', async () => {
    const { settings } = await openDecisionRecallPage();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="召回条数"]')!;
    input.value = '99';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(settings.decisionRecallSettings.recallCount).toBe(45);
  });
});

describe('PlotTaskEditor 改由决策召回执行', () => {
  const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];
  afterEach(() => {
    mounted.splice(0).forEach(({ app, el }) => { app.unmount(); el.remove(); });
  });

  async function mountEditor(taskPatch: Record<string, unknown>, taskCount: number, onPatch = vi.fn()) {
    vi.resetModules();
    const { default: PlotTaskEditor } = await import('../../src/presentation-v3/parts/PlotTaskEditor.vue');
    const task = {
      id: 't1', name: '召回', enabled: true, promptGroup: [], extractTags: 'recall', extractInjectTags: '',
      finalDirectiveTemplate: '', minLength: 0, maxRetries: 3, mergeStrategy: 'append', stage: 1, order: 0,
      description: '', triggerWhen: '', decisionRecall: false,
      agentControl: { enabled: false, selectable: true, defaultSelected: false, allowSequential: true, allowParallel: true, dependsOnTaskIds: [], blocksTaskIds: [] },
      ...taskPatch,
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp({ render: () => h(PlotTaskEditor, { task, apiPresetOptions: [], taskApiOverride: '', taskCount, onPatch }) });
    app.mount(el);
    mounted.push({ app, el });
    await nextTick();
    return { el, onPatch };
  }

  it('多任务预设里标签是 recall 的任务可以打开开关', async () => {
    const { el, onPatch } = await mountEditor({}, 2);
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-label="改由决策召回执行"]')!;
    expect(toggle.disabled).toBe(false);
    toggle.click();
    expect(onPatch).toHaveBeenCalledWith({ decisionRecall: true });
  });

  it('单任务预设里开关不可用，并提示去决策召回页单独开启', async () => {
    const { el } = await mountEditor({ decisionRecall: true }, 1);
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-label="改由决策召回执行"]')!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('单独开启');
  });

  it('标签不是恰好 recall 时开关不可用', async () => {
    const { el } = await mountEditor({ extractTags: 'recall,plot' }, 3);
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="改由决策召回执行"]')!.disabled).toBe(true);
    expect(el.textContent).toContain('恰好是 recall');
  });
});
