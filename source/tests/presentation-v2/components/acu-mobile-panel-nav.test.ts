/**
 * AcuMobilePanelNav — 移动端页面板块导航。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import AcuMobilePanelNav from '../../../src/presentation-v2/components/_lib/AcuMobilePanelNav.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountNav(): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      return () =>
        h('main', { 'data-acu-main': '', class: 'test-main' }, [
          h(AcuMobilePanelNav, {
            items: [
              { id: 'panel-a', label: '面板 A' },
              { id: 'panel-b', label: '面板 B' },
            ],
          }),
          h('section', { id: 'panel-a' }, 'A'),
          h('section', { id: 'panel-b' }, 'B'),
        ]);
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
  vi.restoreAllMocks();
});

describe('AcuMobilePanelNav', () => {
  it('渲染面板导航按钮并默认标记第一个面板', () => {
    const el = mountNav();

    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-mobile-panel-nav__item'));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['面板 A', '面板 B']);
    expect(buttons[0].classList.contains('is-active')).toBe(true);
    expect(buttons[0].getAttribute('aria-current')).toBe('location');
  });

  it('点击导航按钮后滚动到对应面板并更新 active 状态', async () => {
    const el = mountNav();
    const main = el.querySelector<HTMLElement>('[data-acu-main]')!;
    const target = el.querySelector<HTMLElement>('#panel-b')!;
    const scrollTo = vi.fn();
    main.scrollTo = scrollTo;
    main.getBoundingClientRect = () => ({
      top: 20,
      bottom: 520,
      left: 0,
      right: 320,
      width: 320,
      height: 500,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    });
    target.getBoundingClientRect = () => ({
      top: 220,
      bottom: 320,
      left: 0,
      right: 320,
      width: 320,
      height: 100,
      x: 0,
      y: 220,
      toJSON: () => ({}),
    });

    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-mobile-panel-nav__item'));
    buttons[1].click();
    await Promise.resolve();

    expect(scrollTo).toHaveBeenCalledWith({ top: 190, behavior: 'smooth' });
    expect(buttons[1].classList.contains('is-active')).toBe(true);
    expect(buttons[1].getAttribute('aria-current')).toBe('location');
  });

  it('点击跳转的平滑滚动过程中保持目标项 active', async () => {
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        setTimeout(() => callback(0), 0);
        return 1;
      });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const el = mountNav();
    const main = el.querySelector<HTMLElement>('[data-acu-main]')!;
    const panelA = el.querySelector<HTMLElement>('#panel-a')!;
    const panelB = el.querySelector<HTMLElement>('#panel-b')!;
    main.scrollTo = vi.fn();
    main.getBoundingClientRect = () => ({
      top: 20,
      bottom: 520,
      left: 0,
      right: 320,
      width: 320,
      height: 500,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    });
    panelA.getBoundingClientRect = () => ({
      top: -20,
      bottom: 80,
      left: 0,
      right: 320,
      width: 320,
      height: 100,
      x: 0,
      y: -20,
      toJSON: () => ({}),
    });
    panelB.getBoundingClientRect = () => ({
      top: 220,
      bottom: 320,
      left: 0,
      right: 320,
      width: 320,
      height: 100,
      x: 0,
      y: 220,
      toJSON: () => ({}),
    });

    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-mobile-panel-nav__item'));
    buttons[1].click();
    main.dispatchEvent(new Event('scroll'));
    await Promise.resolve();

    expect(buttons[1].classList.contains('is-active')).toBe(true);
    expect(buttons[0].classList.contains('is-active')).toBe(false);
    raf.mockRestore();
  });
});
