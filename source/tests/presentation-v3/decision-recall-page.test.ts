/**
 * DecisionRecallPage / PlotTaskEditor — 决策召回总开关不动剧情推进开关、侧栏显隐与剧情推进灰显、用法切换与设置保存，
 * 剧情推进任务的「改由决策召回执行」开关。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick } from 'vue';
import { byText, createV3Settings, flush, mountV3 } from './v3-harness';

function settingsWith(decisionRecall: Record<string, unknown>, plotPatch: Record<string, unknown> = {}) {
  const settings = createV3Settings();
  settings.decisionRecallSettings = { ...(settings.decisionRecallSettings || {}), ...decisionRecall };
  settings.plotSettings = { ...settings.plotSettings, ...plotPatch };
  return settings;
}

async function openPage(pageId: string, decisionRecall: Record<string, unknown> = { enabled: true }, plotPatch: Record<string, unknown> = {}) {
  const ctx = await mountV3({ settings: settingsWith(decisionRecall, plotPatch) });
  ctx.router.setActivePage(pageId);
  await flush();
  return ctx;
}

const switchByToggleKey = (key: string) => document.querySelector<HTMLButtonElement>(`button[role="switch"][data-acu-toggle-key="${key}"]`);
const navItem = (pageId: string) => document.querySelector<HTMLElement>(`.ub-nav__item[data-page-id="${pageId}"]`);
const modeRadio = (label: string) => byText<HTMLButtonElement>('[role="radiogroup"][aria-label="决策召回用法"] [role="radio"]', label);
const visibleIds = (router: { visiblePages: Array<{ id: string }> }) => router.visiblePages.map(page => page.id);

const twoTaskPlot = {
  plotTasks: [
    { id: 'recall-task', name: '召回', extractTags: 'recall', extractInjectTags: '', decisionRecall: true, stage: 1, order: 0, promptGroup: [] },
    { id: 'plan-task', name: '规划', extractTags: 'plot', extractInjectTags: '', stage: 2, order: 1, promptGroup: [] },
  ],
};

describe('决策召回总开关', () => {
  afterEach(async () => {
    const mount = await import('../../src/presentation-v2/bootstrap/mount');
    mount.__resetAcuV2MountForTests();
  });

  it('仪表盘打开决策召回：剧情推进开关不动，侧栏出现决策召回页、剧情推进入口灰显；关掉后都恢复', async () => {
    const { settings, saveSettings, errors, router } = await openPage('dashboard', { enabled: false });
    expect(visibleIds(router)).not.toContain('decision-recall');
    expect(navItem('decision-recall')).toBeNull();

    switchByToggleKey('decisionRecallEnabled')!.click();
    await flush();

    expect(settings.decisionRecallSettings.enabled).toBe(true);
    expect(settings.plotSettings.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('已关闭剧情推进');
    expect(visibleIds(router)).toEqual(expect.arrayContaining(['decision-recall', 'plot']));
    expect(navItem('plot')!.classList.contains('is-dimmed')).toBe(true);
    expect(navItem('plot')!.title).toContain('剧情推进已暂停');

    switchByToggleKey('decisionRecallEnabled')!.click();
    await flush();

    expect(settings.decisionRecallSettings.enabled).toBe(false);
    expect(settings.plotSettings.enabled).toBe(true);
    expect(visibleIds(router)).not.toContain('decision-recall');
    expect(navItem('plot')!.classList.contains('is-dimmed')).toBe(false);
    expect(errors).toEqual([]);
  });

  it('仪表盘开关剧情推进不动决策召回', async () => {
    const { settings } = await openPage('dashboard', { enabled: true });
    switchByToggleKey('plotEnabled')!.click();
    await flush();
    expect(settings.plotSettings.enabled).toBe(false);
    expect(settings.decisionRecallSettings.enabled).toBe(true);
  });
});

describe('DecisionRecallPage', () => {
  afterEach(async () => {
    const mount = await import('../../src/presentation-v2/bootstrap/mount');
    mount.__resetAcuV2MountForTests();
  });

  it('改为替换剧情推进的任务：剧情推进入口恢复、显示当前预设里由决策召回执行的任务；改回单独召回又灰显', async () => {
    const { settings, saveSettings, errors } = await openPage('decision-recall', { enabled: true }, twoTaskPlot);
    expect(modeRadio('单独召回')!.getAttribute('aria-checked')).toBe('true');
    expect(navItem('plot')!.classList.contains('is-dimmed')).toBe(true);

    modeRadio('替换剧情推进的任务')!.click();
    await flush();

    expect(settings.decisionRecallSettings.mode).toBe('plot_task');
    expect(settings.decisionRecallSettings.enabled).toBe(true);
    expect(settings.plotSettings.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalled();
    expect(navItem('plot')!.classList.contains('is-dimmed')).toBe(false);
    expect(document.body.textContent).toContain('当前预设里由决策召回执行的任务：召回');

    modeRadio('单独召回')!.click();
    await flush();

    expect(settings.decisionRecallSettings.mode).toBe('standalone');
    expect(navItem('plot')!.classList.contains('is-dimmed')).toBe(true);
    expect(errors).toEqual([]);
  });

  it('替换剧情推进的任务但预设只有一个任务时提示替换不了', async () => {
    await openPage('decision-recall', { enabled: true, mode: 'plot_task' });
    expect(document.body.textContent).toContain('只有一个任务，替换不了');
  });

  it('没填 Key 时提示只会带上最新 5 条；换服务商后显示对应的 Key 与模型', async () => {
    const { settings } = await openPage('decision-recall');
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
    const { settings } = await openPage('decision-recall');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="召回条数"]')!;
    input.value = '99';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(settings.decisionRecallSettings.recallCount).toBe(45);
  });
});

describe('剧情推进页随决策召回用法', () => {
  afterEach(async () => {
    const mount = await import('../../src/presentation-v2/bootstrap/mount');
    mount.__resetAcuV2MountForTests();
  });

  it('单独召回时剧情推进页灰掉、不可编辑，并提示去决策召回页；发送体验照样可改', async () => {
    const { errors } = await openPage('plot', { enabled: true, mode: 'standalone' });
    expect(document.body.textContent).toContain('剧情推进已暂停');
    const bodies = Array.from(document.querySelectorAll<HTMLElement>('.ub-plot__body'));
    expect(bodies).toHaveLength(2);
    bodies.forEach(body => {
      expect(body.classList.contains('is-paused')).toBe(true);
      expect(body.hasAttribute('inert')).toBe(true);
    });
    expect(document.querySelector('#plot-experience')!.closest('.ub-plot__body')).toBeNull();
    expect(document.body.textContent).not.toContain('不读这里选的世界书');
    expect(errors).toEqual([]);
  });

  it('替换剧情推进的任务时剧情推进页恢复，世界书处提示由决策召回执行的任务不读这里选的世界书', async () => {
    const { errors } = await openPage('plot', { enabled: true, mode: 'plot_task' });
    expect(document.body.textContent).not.toContain('剧情推进已暂停');
    document.querySelectorAll<HTMLElement>('.ub-plot__body').forEach(body => {
      expect(body.classList.contains('is-paused')).toBe(false);
      expect(body.hasAttribute('inert')).toBe(false);
    });
    expect(document.body.textContent).toContain('由决策召回执行的任务不读这里选的世界书');
    expect(errors).toEqual([]);
  });

  it('决策召回关着时剧情推进页照常，也不提示世界书', async () => {
    await openPage('plot', { enabled: false, mode: 'plot_task' });
    expect(document.body.textContent).not.toContain('剧情推进已暂停');
    expect(document.body.textContent).not.toContain('不读这里选的世界书');
  });
});

describe('PlotTaskEditor 改由决策召回执行', () => {
  const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];
  afterEach(() => {
    mounted.splice(0).forEach(({ app, el }) => { app.unmount(); el.remove(); });
  });

  async function mountEditor(taskPatch: Record<string, unknown>, taskCount: number, decisionRecallTaskMode = true, onPatch = vi.fn()) {
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
    const app = createApp({ render: () => h(PlotTaskEditor, { task, apiPresetOptions: [], taskApiOverride: '', taskCount, decisionRecallTaskMode, onPatch }) });
    app.mount(el);
    mounted.push({ app, el });
    await nextTick();
    return { el, onPatch };
  }

  const toggleOf = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[aria-label="改由决策召回执行"]')!;

  it('用法是替换剧情推进的任务时，多任务预设里标签是 recall 的任务可以打开开关', async () => {
    const { el, onPatch } = await mountEditor({}, 2);
    expect(toggleOf(el).disabled).toBe(false);
    toggleOf(el).click();
    expect(onPatch).toHaveBeenCalledWith({ decisionRecall: true });
  });

  it('决策召回没开或用法不是替换剧情推进的任务时开关不可用、显示为关，并提示去哪里改', async () => {
    const { el } = await mountEditor({ decisionRecall: true }, 2, false);
    expect(toggleOf(el).disabled).toBe(true);
    expect(toggleOf(el).getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('把用法选为「替换剧情推进的任务」');
  });

  it('单任务预设里开关不可用，并提示改用单独召回', async () => {
    const { el } = await mountEditor({ decisionRecall: true }, 1);
    expect(toggleOf(el).disabled).toBe(true);
    expect(toggleOf(el).getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('改用「单独召回」');
  });

  it('标签不是恰好 recall 时开关不可用', async () => {
    const { el } = await mountEditor({ extractTags: 'recall,plot' }, 3);
    expect(toggleOf(el).disabled).toBe(true);
    expect(el.textContent).toContain('恰好是 recall');
  });
});
