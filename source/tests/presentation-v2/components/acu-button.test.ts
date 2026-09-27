/**
 * AcuButton — href 模式（渲染成 <a>）
 *
 * 为什么需要 href 模式而不是在页面里裸写 `<a class="acu-btn">`：`.acu-btn` 那套样式是 AcuButton 的
 * scoped style，换个组件就拿不到（编译后带 data-v 属性选择器），裸锚点会变成无样式链接。
 * 外链在 TauriTavern 里由宿主处理：桌面端 on_new_window 把 http(s) 外链交给系统浏览器并 Deny 新窗
 * （window.rs:110-113），移动端另有 window.open 兼容层转 plugin:opener|open_url
 * （mobile-window-open-compat.js:40-47），所以这里只需要一个规范的 target=_blank 真链接。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

async function mountButton(props: Record<string, any> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const { default: AcuButton } = await import('../../../src/presentation-v2/components/_lib/AcuButton.vue');
  const onClick = vi.fn();
  const app = createApp({
    components: { AcuButton },
    setup() {
      return { props, onClick };
    },
    template: `<AcuButton v-bind="props" @click="onClick"><i class="fa-brands fa-github"></i>前往 GitHub 提交 issue</AcuButton>`,
  });
  app.mount('#app');
  await Promise.resolve();
  return { app, onClick };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('AcuButton', () => {
  it('不给 href 时仍渲染 <button type="button">（回归护栏）', async () => {
    await mountButton({});

    const button = document.querySelector('button');
    expect(button).not.toBeNull();
    expect(button!.getAttribute('type')).toBe('button');
    expect(button!.classList.contains('acu-btn')).toBe(true);
    expect(document.querySelector('a')).toBeNull();
  });

  it('给了 href 就渲染 <a>，默认 target=_blank + rel=noopener noreferrer，且不带 button 专有属性', async () => {
    await mountButton({ href: 'https://github.com/shuiyue-cmyk/shujuku-rebuild/issues/new' });

    const anchor = document.querySelector('a');
    expect(anchor, 'href 模式必须渲染成真链接（宿主才会把它交给系统浏览器）').not.toBeNull();
    expect(document.querySelector('button')).toBeNull();
    expect(anchor!.getAttribute('href')).toBe('https://github.com/shuiyue-cmyk/shujuku-rebuild/issues/new');
    expect(anchor!.getAttribute('target')).toBe('_blank');
    expect(anchor!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor!.hasAttribute('type')).toBe(false);
    expect(anchor!.hasAttribute('disabled')).toBe(false);
    // 样式类必须原样带上，否则链接在面板里不成按钮形
    expect(anchor!.classList.contains('acu-btn')).toBe(true);
    expect(anchor!.classList.contains('acu-btn--md')).toBe(true);
  });

  it('target / rel 可显式覆盖', async () => {
    await mountButton({ href: 'https://example.test', target: '_self', rel: 'noreferrer' });

    const anchor = document.querySelector('a')!;
    expect(anchor.getAttribute('target')).toBe('_self');
    expect(anchor.getAttribute('rel')).toBe('noreferrer');
  });

  it('href 模式下 disabled 用 aria-disabled 表达（锚点没有 disabled 属性），且不渲染 href', async () => {
    await mountButton({ href: 'https://example.test', disabled: true });

    const anchor = document.querySelector('a')!;
    expect(anchor.getAttribute('aria-disabled')).toBe('true');
    expect(anchor.hasAttribute('disabled')).toBe(false);
    // 禁用态不该给出可点的去向：留着 href 会让「看起来禁用」的链接照样能中键打开
    expect(anchor.hasAttribute('href')).toBe(false);
  });

  it('href 模式点击仍发出 click 事件（调用方可埋点）', async () => {
    const { onClick } = await mountButton({ href: 'https://example.test' });

    document.querySelector('a')!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
