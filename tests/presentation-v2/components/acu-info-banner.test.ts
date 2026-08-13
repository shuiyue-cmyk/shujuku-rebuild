/**
 * AcuInfoBanner / AcuPanel description — 阶段 2 后续的「常驻说明信息条」组件
 *
 * 设计目标见 plans/ui_v2/02-principles.md §17 D22：
 *  - 用户必须能看到说明（不依赖 hover）
 *  - 描述长度无字数上限
 *  - 多列网格内同一行的面板高度一致
 *
 * 不引入 @vue/test-utils；改用 createApp + 真实 DOM 断言。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import AcuInfoBanner from '../../../src/presentation-v2/components/_lib/AcuInfoBanner.vue';
import AcuPanel from '../../../src/presentation-v2/components/_lib/AcuPanel.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountComponent<T>(component: T, props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      return () => h(component as any, props, slots);
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

describe('AcuInfoBanner', () => {
  it('从 text prop 渲染文本', () => {
    const el = mountComponent(AcuInfoBanner, { text: '这是一段说明文字。' });
    expect(el.querySelector('.acu-info-banner')).not.toBeNull();
    expect(el.textContent).toContain('这是一段说明文字。');
  });

  it('默认 slot 优先于 text prop', () => {
    const el = mountComponent(
      AcuInfoBanner,
      { text: 'fallback' },
      { default: () => h('span', 'slot 内容') },
    );
    expect(el.textContent).toContain('slot 内容');
    expect(el.textContent).not.toContain('fallback');
  });

  it('tone=info 默认不渲染图标', () => {
    const el = mountComponent(AcuInfoBanner, { text: 'x' });
    expect(el.querySelector('.acu-info-banner--info')).not.toBeNull();
    expect(el.querySelector('.acu-info-banner__icon')).toBeNull();
  });

  it('tone=tip 默认不渲染图标', () => {
    const el = mountComponent(AcuInfoBanner, { text: 'x', tone: 'tip' });
    expect(el.querySelector('.acu-info-banner--tip')).not.toBeNull();
    expect(el.querySelector('.acu-info-banner__icon')).toBeNull();
  });

  it('tone=warning 默认不渲染图标', () => {
    const el = mountComponent(AcuInfoBanner, { text: 'x', tone: 'warning' });
    expect(el.querySelector('.acu-info-banner--warning')).not.toBeNull();
    expect(el.querySelector('.acu-info-banner__icon')).toBeNull();
  });

  it('支持自定义 icon 覆盖默认图标', () => {
    const el = mountComponent(AcuInfoBanner, { text: 'x', icon: 'fa-solid fa-rocket' });
    expect(el.querySelector('.acu-info-banner__icon')?.classList.contains('fa-rocket')).toBe(true);
  });

  it('role="note" 暴露给辅助技术', () => {
    const el = mountComponent(AcuInfoBanner, { text: 'x' });
    expect(el.querySelector('[role="note"]')).not.toBeNull();
  });
});

describe('AcuPanel description', () => {
  it('给定 description prop 时在标题栏渲染说明按钮，并在点击后展开标题附属说明', async () => {
    const el = mountComponent(
      AcuPanel,
      { title: '面板标题', description: '面板说明文字。' },
      { default: () => h('div', { class: 'body-marker' }, 'body') },
    );
    const button = el.querySelector<HTMLButtonElement>('.acu-panel__description-button');
    expect(button).not.toBeNull();
    expect(button!.tagName).toBe('BUTTON');
    expect(button!.type).toBe('button');
    expect(button!.classList.contains('acu-icon-btn')).toBe(true);
    expect(button!.getAttribute('aria-expanded')).toBe('false');

    const region = el.querySelector<HTMLElement>('.acu-panel__description-region');
    expect(region).not.toBeNull();
    expect(region!.getAttribute('aria-hidden')).toBe('true');
    expect(region!.style.display).toBe('none');

    const banner = el.querySelector('.acu-info-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('面板说明文字。');
    expect(banner!.classList.contains('acu-panel__description-banner')).toBe(true);
    expect(region!.querySelector('.acu-panel__description-connector')).toBeNull();

    const header = el.querySelector('.acu-panel__header');
    expect(header).not.toBeNull();
    expect(header!.querySelector('.acu-info-banner')).toBeNull();
    expect(header!.nextElementSibling).toBe(region);

    const body = el.querySelector('.acu-panel__body');
    expect(region!.nextElementSibling).toBe(body);
    expect(body!.querySelector('.acu-info-banner')).toBeNull();
    expect(body!.querySelector('.body-marker')).not.toBeNull();

    button!.click();
    await nextTick();
    expect(button!.getAttribute('aria-expanded')).toBe('true');
    expect(region!.getAttribute('aria-hidden')).toBe('false');
    expect(region!.style.display).not.toBe('none');
  });

  it('未提供 description 时不渲染信息条', () => {
    const el = mountComponent(
      AcuPanel,
      { title: '只有标题' },
      { default: () => h('div', 'body') },
    );
    expect(el.querySelector('.acu-info-banner')).toBeNull();
  });

  it('不再支持 subtitle prop（旧 API 已移除）', () => {
    const el = mountComponent(
      AcuPanel,
      { title: '标题', subtitle: '废弃 subtitle' },
      { default: () => h('div', 'body') },
    );
    expect(el.textContent).not.toContain('废弃 subtitle');
    expect(el.querySelector('.acu-panel__subtitle')).toBeNull();
  });

  it('description slot 优先于 description prop', () => {
    const el = mountComponent(
      AcuPanel,
      { title: '标题', description: 'fallback' },
      { description: () => h('strong', 'slot 描述') },
    );
    expect(el.textContent).toContain('slot 描述');
    expect(el.textContent).not.toContain('fallback');
  });

  it('descriptionTone 透传给 AcuInfoBanner', () => {
    const el = mountComponent(AcuPanel, { title: '标题', description: '提示', descriptionTone: 'tip' });
    expect(el.querySelector('.acu-info-banner--tip')).not.toBeNull();
  });
});
