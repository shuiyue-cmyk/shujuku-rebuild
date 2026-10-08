/**
 * WorldbookEntries — 世界书条目列表：空状态文案、分组统计、Skill 化勾选、大分组分页、长标题悬浮。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick } from 'vue';
import WorldbookEntries from '../../src/presentation-v3/parts/WorldbookEntries.vue';

const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountEntries(props: Record<string, unknown>): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp({ render: () => h(WorldbookEntries, { filter: '', loading: false, ...props }) });
  app.mount(el);
  mounted.push({ app, el });
  return el;
}

const entry = (uid: number, label: string, extra: Record<string, unknown> = {}) => ({
  uid, bookName: 'CharBook', label, checked: false, skillifySelected: false, skillifySelectable: true,
  disabled: false, hasSkill: false, agentTakeoverState: 'native', ...extra,
});

function sampleGroups() {
  return [{
    bookName: 'CharBook',
    expanded: true,
    entries: [
      entry(1, '人物', { checked: true, hasSkill: true, agentTakeoverState: 'skill_ready' }),
      entry(2, '地点', { skillifySelected: true, hasSkill: true, agentTakeoverState: 'taken_over' }),
      entry(3, '背景', { checked: true }),
      entry(4, '常驻设定', { checked: true, skillifySelectable: false, isConstant: true }),
    ],
  }];
}

afterEach(() => {
  mounted.splice(0).forEach(({ app, el }) => { app.unmount(); el.remove(); });
  document.body.innerHTML = '';
});

describe('WorldbookEntries', () => {
  it('空列表提示使用调用方传入的文案', () => {
    const el = mountEntries({ groups: [], emptyText: '未解析到角色卡世界书。打开聊天后会显示条目；也可手动选择一本。' });
    expect(el.textContent).toContain('未解析到角色卡世界书');
    expect(el.textContent).not.toContain('所选世界书中无可显示的条目');
  });

  it('Agent 页的分组头展示已勾选/总数、Skill 数与接管数，并显示接管与常量徽标', () => {
    const el = mountEntries({ groups: sampleGroups(), showSkillifyControls: true, showAgentTakeoverState: true });
    expect(el.querySelector('.ub-disc__meta')?.textContent).toBe('3/4 条 · Skill 2 · 接管 1');
    expect(el.textContent).toContain('常量');
  });

  it('普通世界书选择不显示 Skill 与接管计数', () => {
    const el = mountEntries({ groups: sampleGroups() });
    expect(el.querySelector('.ub-disc__meta')?.textContent).toBe('3/4 条');
    expect(el.textContent).toContain('常量');
  });

  it('Skill 化勾选框与条目勾选各自独立，并透传 toggle-skillify', async () => {
    const onToggleSkillify = vi.fn();
    const el = mountEntries({ groups: sampleGroups(), showSkillifyControls: true, onToggleSkillify });
    const skillChecks = Array.from(el.querySelectorAll<HTMLInputElement>('.ub-wbe__skill-row input[type="checkbox"]'));
    expect(skillChecks.map(input => input.checked)).toEqual([false, true, false, false]);
    expect(skillChecks[3].disabled).toBe(true);
    skillChecks[0].checked = true;
    skillChecks[0].dispatchEvent(new Event('change'));
    await nextTick();
    expect(onToggleSkillify).toHaveBeenCalledWith('CharBook', 1, true);
  });

  it('大分组分页：默认只渲染前 200 条，加载更多每次再放 200，分组统计仍是全量', async () => {
    const entries = Array.from({ length: 450 }, (_, i) => entry(i + 1, `条目${i + 1}`, { bookName: 'BigBook' }));
    const el = mountEntries({ groups: [{ bookName: 'BigBook', expanded: true, entries }] });
    expect(el.querySelectorAll('.ub-wbe__entry')).toHaveLength(200);
    const more = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('加载更多'))!;
    expect(more.textContent).toContain('剩余 250 条');
    expect(el.querySelector('.ub-disc__meta')?.textContent).toContain('450 条');
    more.click();
    await nextTick();
    expect(el.querySelectorAll('.ub-wbe__entry')).toHaveLength(400);
  });

  it('长标题带完整文本的 title 悬浮', () => {
    const longLabel = '这是一段非常长的条目标题'.repeat(10);
    const el = mountEntries({ groups: [{ bookName: 'CharBook', expanded: true, entries: [entry(1, longLabel)] }], showEntryToggle: false });
    const label = el.querySelector('.ub-wbe__label');
    expect(label?.getAttribute('title')).toBe(longLabel);
    expect(label?.textContent).toBe(longLabel);
  });

  it('R10B-05：有搜索词时批量按钮随事件带出筛选结果范围，无搜索词时范围为空（全部）', async () => {
    const onSelectAll = vi.fn();
    const onDeselectAll = vi.fn();
    const onSkillifySelectAll = vi.fn();
    const onSkillifyDeselectAll = vi.fn();
    const handlers = { onSelectAll, onDeselectAll, onSkillifySelectAll, onSkillifyDeselectAll };
    const button = (el: HTMLElement, text: string) => Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;

    const filtered = mountEntries({ groups: sampleGroups(), filter: '地点', showSkillifyControls: true, ...handlers });
    button(filtered, '全不选').click();
    button(filtered, '全选').click();
    button(filtered, 'Skill 全选').click();
    button(filtered, 'Skill 全不选').click();
    await nextTick();
    const scope = [{ bookName: 'CharBook', uid: 2 }];
    expect(onDeselectAll).toHaveBeenLastCalledWith(scope);
    expect(onSelectAll).toHaveBeenLastCalledWith(scope);
    expect(onSkillifySelectAll).toHaveBeenLastCalledWith(scope);
    expect(onSkillifyDeselectAll).toHaveBeenLastCalledWith(scope);

    const unfiltered = mountEntries({ groups: sampleGroups(), filter: '', ...handlers });
    button(unfiltered, '全不选').click();
    expect(onDeselectAll).toHaveBeenLastCalledWith(null);
  });
});

