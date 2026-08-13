/**
 * AcuCheckbox — 自绘选择控件
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick, type App, createApp, defineComponent, h, ref } from 'vue';
import AcuCheckbox from '../../../src/presentation-v2/components/_lib/AcuCheckbox.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountCheckbox(initial = false): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      const checked = ref(initial);
      return () => h(AcuCheckbox, {
        modelValue: checked.value,
        label: '选择条目',
        'onUpdate:modelValue': (next: boolean) => {
          checked.value = next;
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

describe('AcuCheckbox', () => {
  it('使用 button checkbox 语义，不渲染隐藏原生 checkbox', () => {
    const el = mountCheckbox(false);
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    const button = el.querySelector<HTMLButtonElement>('button[role="checkbox"]');
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-checked')).toBe('false');
  });

  it('点击后切换 aria-checked', async () => {
    const el = mountCheckbox(false);
    const button = el.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;

    button.click();
    await nextTick();
    expect(button.getAttribute('aria-checked')).toBe('true');

    button.click();
    await nextTick();
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('勾选图标节点常驻，避免切换状态时改变控件高度', async () => {
    const el = mountCheckbox(false);
    const button = el.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
    const icon = el.querySelector('.acu-checkbox__icon');

    expect(icon).not.toBeNull();

    button.click();
    await nextTick();
    expect(el.querySelector('.acu-checkbox__icon')).toBe(icon);
  });
});
