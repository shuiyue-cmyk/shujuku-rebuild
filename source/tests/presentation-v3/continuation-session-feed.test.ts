/**
 * ContinuationSessionFeed — 会话流折叠与交接条目渲染
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import ContinuationSessionFeed from '../../src/presentation-v3/parts/ContinuationSessionFeed.vue';
import type { AgentSessionEntry_ACU } from '../../src/service/continuation/agent/agent-session-log';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
  entries: Ref<AgentSessionEntry_ACU[]>;
}

const mounted: Mounted[] = [];

function entry_ACU(id: number, overrides: Partial<AgentSessionEntry_ACU> = {}): AgentSessionEntry_ACU {
  return { id, at: id, kind: 'main_action', title: `条目 ${id}`, detail: '', agentName: '', ok: true, status: 'done', ...overrides };
}

function entriesOf_ACU(count: number): AgentSessionEntry_ACU[] {
  return Array.from({ length: count }, (_item, index) => entry_ACU(index + 1));
}

function mountFeed(initial: AgentSessionEntry_ACU[]): Mounted {
  const entries = ref<AgentSessionEntry_ACU[]>(initial);
  const wrapper = defineComponent({
    setup() {
      return () => h(ContinuationSessionFeed, { entries: entries.value, running: false });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  const item: Mounted = { app, el, entries };
  mounted.push(item);
  return item;
}

function foldButton(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector('.ub-feed__fold');
}

function renderedTitles(el: HTMLElement): string[] {
  return [...el.querySelectorAll('.ub-feed__title')].map(node => node.textContent ?? '');
}

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    item.app.unmount();
    item.el.remove();
  }
  document.body.innerHTML = '';
});

describe('ContinuationSessionFeed', () => {

  it('新条目追加时窗口保持锚定末尾；长度骤减（切聊天重灌）时折叠窗口复位', async () => {
    const { el, entries } = mountFeed(entriesOf_ACU(100));
    foldButton(el)!.click();
    await nextTick();
    expect(renderedTitles(el)).toHaveLength(80);

    // 追加一条：展开上限不变，仍显示最近 80 条。
    entries.value = [...entries.value, entry_ACU(101)];
    await nextTick();
    const titles = renderedTitles(el);
    expect(titles).toHaveLength(80);
    expect(titles[titles.length - 1]).toBe('条目 101');

    // 切换聊天重灌成 50 条：折叠窗口复位为 40。
    entries.value = entriesOf_ACU(50);
    await nextTick();
    expect(renderedTitles(el)).toHaveLength(40);
    expect(foldButton(el)!.textContent).toContain('已折叠 10 条更早消息');
  });
});
