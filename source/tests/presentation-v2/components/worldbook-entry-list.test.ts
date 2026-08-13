/**
 * WorldbookEntryList — 世界书条目列表空状态
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import WorldbookEntryList from '../../../src/presentation-v2/components/WorldbookEntryList.vue';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
}

const mounted: Mounted[] = [];

function mountList(emptyText: string) {
  const wrapper = defineComponent({
    setup() {
      return () => h(WorldbookEntryList, {
        groups: [],
        filter: '',
        loading: false,
        emptyText,
      });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  mounted.push({ app, el });
  return el;
}

function mountGroups(showAgentTakeoverState = true) {
  const groups = [
    {
      bookName: 'CharBook',
      expanded: true,
      entries: [
        { uid: 1, bookName: 'CharBook', label: '人物', checked: true, skillifySelected: false, skillifySelectable: true, disabled: false, hasSkill: true, agentTakeoverState: 'skill_ready' },
        { uid: 2, bookName: 'CharBook', label: '地点', checked: false, skillifySelected: true, skillifySelectable: true, disabled: false, hasSkill: true, agentTakeoverState: 'taken_over' },
        { uid: 3, bookName: 'CharBook', label: '背景', checked: true, skillifySelected: false, skillifySelectable: true, disabled: false, hasSkill: false, agentTakeoverState: 'native' },
        { uid: 4, bookName: 'CharBook', label: '常驻设定', checked: true, skillifySelected: false, skillifySelectable: false, disabled: false, hasSkill: false, isConstant: true, agentTakeoverState: 'native' },
      ],
    },
  ];
  const toggleSkillify = vi.fn();
  const wrapper = defineComponent({
    setup() {
      return () => h(WorldbookEntryList, {
        groups,
        filter: '',
        loading: false,
        onToggleSkillify: toggleSkillify,
        showAgentTakeoverState,
      });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  mounted.push({ app, el });
  return { el, toggleSkillify };
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('WorldbookEntryList', () => {
  it('空列表提示使用调用方传入的文案', () => {
    const el = mountList('未解析到角色卡世界书。打开聊天后会显示条目；也可手动选择一本。');

    expect(el.textContent).toContain('未解析到角色卡世界书');
    expect(el.textContent).not.toContain('所选世界书中无可显示的条目');
  });

  it('分组头部展示已勾选数量和总条目数量', () => {
    const { el } = mountGroups();
    const meta = el.querySelector('.acu-disclosure-group__meta');

    expect(el.textContent).toContain('CharBook');
    expect(meta?.textContent).toBe('3/4 条 · Skill 2 · 接管 1');
    expect(el.textContent).toContain('Agent 接管');
    expect(el.textContent).toContain('常量');
    expect(el.textContent).not.toContain('常量原生逻辑');
  });

  it('普通世界书选择页隐藏 Agent 控制态徽标和接管计数', () => {
    const { el } = mountGroups(false);
    const meta = el.querySelector('.acu-disclosure-group__meta');

    expect(meta?.textContent).toBe('3/4 条 · Skill 2');
    expect(el.textContent).not.toContain('Agent 接管');
    expect(el.textContent).toContain('常量');
  });

  it('Skill 化复选框使用独立状态并透传 toggle-skillify 事件', async () => {
    const { el, toggleSkillify } = mountGroups();
    const checkboxes = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-checkbox'));

    expect(checkboxes.map(button => button.textContent?.trim())).toEqual([
      '人物', 'Skill 化',
      '地点', 'Skill 化',
      '背景', 'Skill 化',
      '常驻设定', 'Skill 化',
    ]);
    expect(checkboxes[1].getAttribute('aria-checked')).toBe('false');
    expect(checkboxes[3].getAttribute('aria-checked')).toBe('true');

    checkboxes[1].click();
    await Promise.resolve();

    expect(toggleSkillify).toHaveBeenCalledWith('CharBook', 1, true);
  });

  it('label 元素带完整文本的 title 悬浮属性（长文本兜底）', async () => {
    const longLabel = '这是一段非常长的条目标题'.repeat(10);
    const groups = [
      {
        bookName: 'CharBook',
        expanded: true,
        entries: [
          { uid: 1, bookName: 'CharBook', label: longLabel, checked: true, skillifySelected: false, skillifySelectable: true, disabled: false, hasSkill: false, agentTakeoverState: 'native' },
        ],
      },
    ];
    const wrapper = defineComponent({
      setup() {
        return () => h(WorldbookEntryList, { groups, filter: '', loading: false, showEntryToggle: false });
      },
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(wrapper);
    app.mount(el);
    mounted.push({ app, el });

    const label = el.querySelector('.acu-v2-wb-entry-item__label');
    expect(label?.getAttribute('title')).toBe(longLabel);
    expect(label?.textContent).toBe(longLabel);
  });
});
