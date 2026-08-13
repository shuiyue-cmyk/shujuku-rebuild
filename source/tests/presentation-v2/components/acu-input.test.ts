/**
 * AcuInput — shared input control
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import AcuInput from '../../../src/presentation-v2/components/_lib/AcuInput.vue';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
}

const mounted: Mounted[] = [];

function mountInput(opts: {
  initial?: string | number;
  type?: 'text' | 'number' | 'password';
} = {}): Mounted {
  const wrapper = defineComponent({
    setup() {
      const value = ref<string | number>(opts.initial ?? '');
      return () => h(AcuInput, {
        modelValue: value.value,
        type: opts.type ?? 'text',
        'onUpdate:modelValue': (next: string | number) => {
          value.value = next;
        },
      });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  const entry = { app, el };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('AcuInput', () => {
  it('number 类型保留原生 number 输入框，并渲染右侧数字提示图形', () => {
    const { el } = mountInput({ type: 'number', initial: 12 });

    const input = el.querySelector<HTMLInputElement>('input.acu-input');
    expect(input).not.toBeNull();
    expect(input!.type).toBe('number');
    expect(input!.value).toBe('12');
    expect(el.querySelector('.acu-input__number-indicator')).not.toBeNull();
    expect(el.querySelectorAll('.acu-input__number-caret')).toHaveLength(2);
  });

  it('text 类型不渲染数字提示图形', () => {
    const { el } = mountInput({ type: 'text', initial: 'abc' });

    expect(el.querySelector<HTMLInputElement>('input.acu-input')!.type).toBe('text');
    expect(el.querySelector('.acu-input__number-indicator')).toBeNull();
  });

  it('number 类型聚焦后拦截滚轮，避免滚轮悄悄修改数值', () => {
    const { el } = mountInput({ type: 'number', initial: 12 });
    const input = el.querySelector<HTMLInputElement>('input.acu-input')!;

    input.focus();
    expect(document.activeElement).toBe(input);

    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 100 });
    input.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe('12');
  });

  it('text 类型不拦截滚轮', () => {
    const { el } = mountInput({ type: 'text', initial: 'abc' });
    const input = el.querySelector<HTMLInputElement>('input.acu-input')!;

    input.focus();
    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 100 });
    input.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});
