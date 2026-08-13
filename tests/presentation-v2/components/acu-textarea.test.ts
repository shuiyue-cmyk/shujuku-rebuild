/**
 * AcuTextarea — shared textarea control
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick, ref } from 'vue';
import AcuTextarea from '../../../src/presentation-v2/components/_lib/AcuTextarea.vue';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
}

const mounted: Mounted[] = [];

function mountTextarea(opts: {
  initial?: string;
  rows?: number;
  maxRows?: number;
  autoResize?: boolean;
} = {}): Mounted {
  const wrapper = defineComponent({
    setup() {
      const value = ref(opts.initial ?? '');
      return () => h(AcuTextarea, {
        modelValue: value.value,
        rows: opts.rows,
        maxRows: opts.maxRows,
        autoResize: opts.autoResize,
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
  vi.restoreAllMocks();
});

describe('AcuTextarea', () => {
  it('autoResize 输入时按内容高度伸缩，并在超过 maxRows 后改为内部滚动', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      fontSize: '12px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
    } as CSSStyleDeclaration);

    const { el } = mountTextarea({ rows: 1, maxRows: 3, autoResize: true });
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea.acu-textarea')!;
    await nextTick();

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 80,
    });
    textarea.value = '第一行\n第二行\n第三行\n第四行';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(textarea.style.height).toBe('60px');
    expect(textarea.style.overflowY).toBe('auto');

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 20,
    });
    textarea.value = '短内容';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(textarea.style.height).toBe('20px');
    expect(textarea.style.overflowY).toBe('hidden');
    expect(textarea.value).toBe('短内容');
  });

  it('autoResize 未设置 maxRows 时不限制最大高度，并保留滚动兜底', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      fontSize: '12px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
    } as CSSStyleDeclaration);

    const longPrompt = Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 行长文本内容`).join('\n');
    const { el } = mountTextarea({ initial: longPrompt, rows: 2, autoResize: true });
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea.acu-textarea')!;
    await nextTick();

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 720,
    });
    textarea.dispatchEvent(new Event('focus', { bubbles: true }));

    expect(textarea.style.height).toBe('720px');
    expect(textarea.style.overflowY).toBe('auto');
  });

  it('autoResize 重新测量时不把外部拉伸后的高度当作内容高度', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      fontSize: '12px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
    } as CSSStyleDeclaration);

    const { el } = mountTextarea({ rows: 1, maxRows: 6, autoResize: true });
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea.acu-textarea')!;
    await nextTick();

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get() {
        return textarea.style.height === 'auto' ? 20 : 120;
      },
    });
    textarea.style.height = '120px';
    textarea.value = '短内容';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(textarea.style.height).toBe('20px');
    expect(textarea.style.overflowY).toBe('hidden');
  });

  it('autoResize 聚焦时会重新测量长文本，避免初始布局测量过早导致内容被裁掉', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      fontSize: '12px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
    } as CSSStyleDeclaration);

    const { el } = mountTextarea({ rows: 2, autoResize: true });
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea.acu-textarea')!;
    await nextTick();

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 260,
    });
    textarea.dispatchEvent(new Event('focus', { bubbles: true }));

    expect(textarea.style.height).toBe('260px');
    expect(textarea.style.overflowY).toBe('auto');
  });
});
