/**
 * DecisionRecallPage / PlotPage — 决策召回总开关不动剧情推进开关、侧栏显隐与剧情推进灰显、用法切换与设置保存，
 * 剧情推进页的「由决策召回执行 recall 任务」开关与自动匹配。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
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
const replaceSwitch = () => document.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="由决策召回执行 recall 任务"]');
/** 召回规则里的「高级设置」默认收起。 */
async function openAdvancedRules() {
  byText<HTMLButtonElement>('#dr-rule button[aria-expanded]', '高级设置')!.click();
  await flush();
}
const visibleIds = (router: { visiblePages: Array<{ id: string }> }) => router.visiblePages.map(page => page.id);

const twoTaskPlot = {
  plotTasks: [
    { id: 'recall-task', name: '召回', extractTags: 'recall', extractInjectTags: '', stage: 1, order: 0, promptGroup: [] },
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
    const { settings, saveSettings, errors } = await openPage('decision-recall', { enabled: true, replacePlotRecallTasks: true }, twoTaskPlot);
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

  it('替换剧情推进的任务但剧情推进页的开关没开时，提示照常由剧情推进召回并可去剧情推进页', async () => {
    const { router } = await openPage('decision-recall', { enabled: true, mode: 'plot_task' }, twoTaskPlot);
    expect(document.body.textContent).toContain('「由决策召回执行 recall 任务」没开');
    byText<HTMLButtonElement>('button', '去剧情推进页')!.click();
    await flush();
    expect(router.activePageId).toBe('plot');
  });

  it('替换剧情推进的任务但预设只有一个任务时提示不替换', async () => {
    await openPage('decision-recall', { enabled: true, mode: 'plot_task', replacePlotRecallTasks: true });
    expect(document.body.textContent).toContain('只启用了一个任务，不替换');
  });

  it('默认是自定义接口：自己填接口地址、Key 与模型，没有常用模型下拉；填好后提示消失', async () => {
    const { settings, saveSettings } = await openPage('decision-recall');
    expect(settings.decisionRecallSettings?.provider ?? 'custom').toBe('custom');
    expect(document.body.textContent).toContain('还没填 自定义 接口地址');
    expect(document.querySelector('select[aria-label="常用决策模型"]')).toBeNull();
    const fill = (label: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
    };

    fill('决策接口地址', 'https://relay.example.com/v1/systemone');
    await flush();
    expect(document.body.textContent).toContain('还没填 自定义 模型名');
    fill('自定义 Key', 'sk-relay');
    fill('决策模型名', 'jev-latest');
    await flush();

    expect(settings.decisionRecallSettings).toMatchObject({
      provider: 'custom', customUrl: 'https://relay.example.com/v1/systemone', customApiKey: 'sk-relay', customModel: 'jev-latest',
    });
    expect(saveSettings).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('还没填');
  });

  it('没填 Key 时提示只会带上最新 5 条；换服务商后显示对应的 Key 与模型', async () => {
    const { settings } = await openPage('decision-recall', { enabled: true, provider: 'siliconflow' });
    expect(document.body.textContent).toContain('还没填 硅基流动（中国） Key');
    expect(document.querySelector('input[aria-label="决策接口地址"]')).toBeNull();

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
    const options = Array.from(document.querySelectorAll<HTMLOptionElement>('select[aria-label="常用决策模型"] option')).map(option => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['Mammoth 1（27B）（免费）', 'Elephant 1（9B）（免费）', 'Decision Model Preview（Qwen）（免费）']));
  });

  it('预设服务商的决策模型可直接填模型名，也可以从常用模型里选；清空回到默认', async () => {
    const { settings } = await openPage('decision-recall', { enabled: true, provider: 'siliconflow' });
    const modelInput = () => document.querySelector<HTMLInputElement>('input[aria-label="决策模型名"]')!;
    expect(modelInput().value).toBe('SemIf');

    modelInput().value = 'my-custom-model';
    modelInput().dispatchEvent(new Event('input'));
    modelInput().dispatchEvent(new Event('change'));
    await flush();
    expect(settings.decisionRecallSettings.siliconflowModel).toBe('my-custom-model');
    // 不在常用列表里：下拉显示占位
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="常用决策模型"]')!.value).toBe('__ub_placeholder__');

    const preset = document.querySelector<HTMLSelectElement>('select[aria-label="常用决策模型"]')!;
    preset.value = 'SemIf';
    preset.dispatchEvent(new Event('change'));
    await flush();
    expect(settings.decisionRecallSettings.siliconflowModel).toBe('SemIf');
    expect(modelInput().value).toBe('SemIf');

    modelInput().value = '';
    modelInput().dispatchEvent(new Event('input'));
    modelInput().dispatchEvent(new Event('change'));
    await flush();
    expect(settings.decisionRecallSettings.siliconflowModel).toBe('SemIf');
    expect(modelInput().value).toBe('SemIf');
  });

  it('召回规则只露出打分时看什么与失败重试次数，其余收在高级设置里（同填表工作台），改过就标为自定义', async () => {
    await openPage('decision-recall');
    const rule = document.getElementById('dr-rule')!;
    expect(rule.querySelector('[aria-label="打分时看什么"]')).not.toBeNull();
    expect(rule.querySelector('input[aria-label="失败重试次数"]')).not.toBeNull();
    for (const label of ['召回条数', '参考最近 AI 回复', '每组条数', '判定次数', '并发数']) {
      expect(rule.querySelector(`input[aria-label="${label}"]`)).toBeNull();
    }
    const toggle = () => byText<HTMLButtonElement>('#dr-rule button[aria-expanded]', '高级设置')!;
    expect(toggle().textContent).toContain('默认');

    await openAdvancedRules();
    for (const label of ['召回条数', '参考最近 AI 回复', '每组条数', '判定次数', '并发数']) {
      expect(rule.querySelector(`input[aria-label="${label}"]`)).not.toBeNull();
    }
    // 不再套带边框的折叠框，各项直接铺在这一节里
    expect(rule.querySelector('.ub-disc')).toBeNull();

    const input = rule.querySelector<HTMLInputElement>('input[aria-label="判定次数"]')!;
    input.value = '3';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(toggle().textContent).toContain('自定义');
  });

  it('参考最近 AI 回复可填 0–10，说明文字随之变化', async () => {
    const { settings } = await openPage('decision-recall');
    await openAdvancedRules();
    const input = () => document.querySelector<HTMLInputElement>('input[aria-label="参考最近 AI 回复"]')!;
    input().value = '0';
    input().dispatchEvent(new Event('input'));
    input().dispatchEvent(new Event('change'));
    await flush();
    expect(settings.decisionRecallSettings.contextAiFloors).toBe(0);
    expect(document.getElementById('dr-rule')!.textContent).toContain('参考用户最新输入（不带 AI 回复）');

    input().value = '99';
    input().dispatchEvent(new Event('input'));
    input().dispatchEvent(new Event('change'));
    await flush();
    expect(settings.decisionRecallSettings.contextAiFloors).toBe(10);
    expect(input().value).toBe('10');
    expect(document.getElementById('dr-test')!.textContent).toContain('最近 10 楼 AI 回复');
  });

  it('每组条数、判定次数、并发数可填，超范围时规整后保存', async () => {
    const { settings } = await openPage('decision-recall');
    await openAdvancedRules();
    const fill = (label: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
    };
    fill('每组条数', '10');
    fill('判定次数', '99');
    fill('并发数', '64');
    await flush();
    expect(settings.decisionRecallSettings).toMatchObject({ batchSize: 10, judgeRuns: 10, concurrency: 64 });
    expect(document.querySelector<HTMLInputElement>('input[aria-label="判定次数"]')!.value).toBe('10');
    // 总时限按判定次数放宽
    expect(document.body.textContent).toContain('整次召回最多 900 秒');
  });

  it('召回条数填超范围时规整到 45 再保存', async () => {
    const { settings } = await openPage('decision-recall');
    await openAdvancedRules();
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

  it('替换剧情推进的任务时剧情推进页恢复；打开页内开关后自动匹配 recall 任务，并提示这些任务不读这里选的世界书', async () => {
    const { settings, saveSettings, errors } = await openPage('plot', { enabled: true, mode: 'plot_task' }, twoTaskPlot);
    expect(document.body.textContent).not.toContain('剧情推进已暂停');
    document.querySelectorAll<HTMLElement>('.ub-plot__body').forEach(body => {
      expect(body.classList.contains('is-paused')).toBe(false);
      expect(body.hasAttribute('inert')).toBe(false);
    });
    const toggle = replaceSwitch()!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.body.textContent).not.toContain('不读这里选的世界书');

    toggle.click();
    await flush();

    expect(settings.decisionRecallSettings.replacePlotRecallTasks).toBe(true);
    expect(saveSettings).toHaveBeenCalled();
    expect(document.body.textContent).toContain('当前预设里由决策召回执行的任务：召回。');
    expect(document.body.textContent).toContain('由决策召回执行的任务不读这里选的世界书');

    replaceSwitch()!.click();
    await flush();
    expect(settings.decisionRecallSettings.replacePlotRecallTasks).toBe(false);
    expect(document.body.textContent).not.toContain('不读这里选的世界书');
    expect(errors).toEqual([]);
  });

  it('页内开关开着但预设只有一个任务时提示不替换，也不提示世界书', async () => {
    await openPage('plot', { enabled: true, mode: 'plot_task', replacePlotRecallTasks: true });
    expect(document.body.textContent).toContain('只启用了一个任务，不替换');
    expect(document.body.textContent).not.toContain('不读这里选的世界书');
  });

  it('预设里另一个任务停用了也算只启用一个任务，不替换', async () => {
    await openPage('plot', { enabled: true, mode: 'plot_task', replacePlotRecallTasks: true }, {
      plotTasks: [twoTaskPlot.plotTasks[0], { ...twoTaskPlot.plotTasks[1], enabled: false }],
    });
    expect(document.body.textContent).toContain('只启用了一个任务，不替换');
    expect(document.body.textContent).not.toContain('不读这里选的世界书');
  });

  it('停用的 recall 任务不算替换对象', async () => {
    const third = { id: 'extra-task', name: '补充', extractTags: 'extra', extractInjectTags: '', stage: 2, order: 2, promptGroup: [] };
    await openPage('plot', { enabled: true, mode: 'plot_task', replacePlotRecallTasks: true }, {
      plotTasks: [{ ...twoTaskPlot.plotTasks[0], enabled: false }, twoTaskPlot.plotTasks[1], third],
    });
    expect(document.body.textContent).toContain('没有「标签摘取」只有 recall 的任务');
    expect(document.body.textContent).not.toContain('由决策召回执行的任务：召回');
  });

  it('决策召回关着或用法是单独召回时不显示页内开关', async () => {
    await openPage('plot', { enabled: false, mode: 'plot_task', replacePlotRecallTasks: true }, twoTaskPlot);
    expect(document.body.textContent).not.toContain('剧情推进已暂停');
    expect(document.body.textContent).not.toContain('不读这里选的世界书');
    expect(replaceSwitch()).toBeNull();
    const mount = await import('../../src/presentation-v2/bootstrap/mount');
    mount.__resetAcuV2MountForTests();

    await openPage('plot', { enabled: true, mode: 'standalone', replacePlotRecallTasks: true }, twoTaskPlot);
    expect(replaceSwitch()).toBeNull();
  });
});
