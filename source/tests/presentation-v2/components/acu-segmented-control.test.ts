/**
 * AcuSegmentedControl — 分段选择控件
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import AcuSegmentedControl from '../../../src/presentation-v2/components/_lib/AcuSegmentedControl.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountSegmented(initial = 'main'): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      const value = ref(initial);
      return () => h(AcuSegmentedControl, {
        options: [
          { value: 'main', label: '酒馆主 API' },
          { value: 'custom', label: '自定义' },
          { value: 'tavern', label: '酒馆预设' },
        ],
        modelValue: value.value,
        ariaLabel: '连接方式',
        'onUpdate:modelValue': (next: string) => {
          value.value = next;
        },
      });
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

describe('AcuSegmentedControl', () => {
  it('用 radiogroup / radio 语义渲染三段选项', () => {
    const el = mountSegmented();
    expect(el.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('连接方式');
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-segmented__item'));
    expect(buttons).toHaveLength(3);
    expect(buttons.map(btn => btn.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
    expect(buttons.map(btn => btn.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('切到第二和第三项时 active 类跟随当前值', async () => {
    const el = mountSegmented();
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-segmented__item'));

    buttons[1].click();
    await Promise.resolve();
    expect(buttons.map(btn => btn.classList.contains('acu-segmented__item--active'))).toEqual([false, true, false]);
    expect(buttons.map(btn => btn.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);

    buttons[2].click();
    await Promise.resolve();
    expect(buttons.map(btn => btn.classList.contains('acu-segmented__item--active'))).toEqual([false, false, true]);
    expect(buttons.map(btn => btn.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
  });

});
