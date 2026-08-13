/**
 * AcuPanelGrid — 功能页面板等宽分栏组件。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import AcuPanelGrid from '../../../src/presentation-v2/components/_lib/AcuPanelGrid.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountGrid(props: Record<string, unknown> = {}): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      return () => h(
        AcuPanelGrid,
        props,
        {
          default: () => [
            h('section', { class: 'left-panel' }, 'left'),
            h('section', { class: 'right-panel' }, 'right'),
          ],
        },
      );
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  apps.push({ app, el });
  return el;
}

afterEach(() => {
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('AcuPanelGrid', () => {
  it('默认渲染两列等宽面板网格', () => {
    const el = mountGrid();
    const grid = el.querySelector<HTMLElement>('.acu-panel-grid');
    expect(grid).not.toBeNull();
    expect(grid!.style.getPropertyValue('--acu-panel-grid-columns')).toBe('2');
    expect(grid!.classList.contains('acu-panel-grid--collapse-md')).toBe(true);
  });

  it('支持选择更晚的单列断点', () => {
    const el = mountGrid({ collapseAt: 'lg' });
    const grid = el.querySelector<HTMLElement>('.acu-panel-grid');
    expect(grid!.classList.contains('acu-panel-grid--collapse-lg')).toBe(true);
  });
});
