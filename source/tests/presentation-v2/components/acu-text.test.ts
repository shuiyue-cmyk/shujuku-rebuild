/**
 * AcuText — shared typography semantic wrapper.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import AcuText from '../../../src/presentation-v2/components/_lib/AcuText.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountText(props: Record<string, unknown> = {}, text = '辅助文字'): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      return () => h(AcuText, props, { default: () => text });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  apps.push({ app, el });
  return el.firstElementChild as HTMLElement;
}

afterEach(() => {
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('AcuText', () => {
  it('默认渲染 meta 段落语义', () => {
    const el = mountText();
    expect(el.tagName).toBe('P');
    expect(el.classList.contains('acu-text')).toBe(true);
    expect(el.classList.contains('acu-text--meta')).toBe(true);
  });

  it('支持自定义标签和 variant class', () => {
    const el = mountText({ as: 'span', variant: 'caption' });
    expect(el.tagName).toBe('SPAN');
    expect(el.classList.contains('acu-text--caption')).toBe(true);
  });
});
