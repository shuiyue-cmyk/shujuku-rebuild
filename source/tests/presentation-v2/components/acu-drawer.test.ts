/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { createApp, ref } from 'vue';

async function mountDrawer() {
  document.body.innerHTML = '<div id="app"></div>';
  const { default: AcuDrawer } = await import('../../../src/presentation-v2/components/_lib/AcuDrawer.vue');
  const closed = vi.fn();
  const app = createApp({
    components: { AcuDrawer },
    setup() {
      const open = ref(false);
      function close() {
        open.value = false;
        closed();
      }
      return { open, close };
    },
    template: `
      <button type="button" class="open-drawer" @click="open = true">open</button>
      <AcuDrawer :is-open="open" title="测试抽屉" @close="close">
        <button type="button" class="inside-drawer">inside</button>
      </AcuDrawer>
    `,
  });
  app.mount('#app');
  await Promise.resolve();
  return { app, closed };
}

async function mountGuardedDrawer() {
  document.body.innerHTML = '<div id="app"></div>';
  const { default: AcuDrawer } = await import('../../../src/presentation-v2/components/_lib/AcuDrawer.vue');
  const closed = vi.fn();
  const guard = {
    resolve: undefined as undefined | ((value: boolean) => void),
  };
  const beforeClose = vi.fn(() => new Promise<boolean>(resolve => {
    guard.resolve = resolve;
  }));
  const app = createApp({
    components: { AcuDrawer },
    setup() {
      const open = ref(true);
      function close() {
        open.value = false;
        closed();
      }
      return { open, close, beforeClose };
    },
    template: `
      <AcuDrawer :is-open="open" title="测试抽屉" :before-close="beforeClose" @close="close">
        <button type="button" class="inside-drawer">inside</button>
      </AcuDrawer>
    `,
  });
  app.mount('#app');
  await Promise.resolve();
  return { app, closed, beforeClose, guard };
}

describe('AcuDrawer', () => {
  it('打开后内部点击不关闭，遮罩 pointerdown 可以关闭', async () => {
    const { app, closed } = await mountDrawer();

    (document.querySelector('.open-drawer') as HTMLButtonElement).click();
    await Promise.resolve();

    const layer = document.querySelector('.acu-v2-drawer-layer') as HTMLElement | null;
    expect(layer).not.toBeNull();
    expect(document.querySelector('.acu-v2-drawer')!.textContent).toContain('测试抽屉');

    (document.querySelector('.inside-drawer') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();

    layer!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(layer!.classList.contains('is-closing')).toBe(true);

    app.unmount();
  });

  it('异步关闭确认未完成时不会重复触发 beforeClose', async () => {
    const { app, closed, beforeClose, guard } = await mountGuardedDrawer();
    const layer = document.querySelector('.acu-v2-drawer-layer') as HTMLElement | null;
    expect(layer).not.toBeNull();

    layer!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    layer!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(beforeClose).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();

    expect(guard.resolve).toBeTypeOf('function');
    guard.resolve!(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(closed).toHaveBeenCalledTimes(1);

    app.unmount();
  });
});
