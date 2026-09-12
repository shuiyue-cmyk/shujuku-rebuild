/**
 * MainArea — 切页滚动复位（滚动页切走后新页错位回归）
 *
 * 复现：移动端在 API 等可滚动页滚动（手指 momentum / 面板导航 smooth 动画在飞），
 * 切到 Agent 等页 → 共享滚动容器被在飞滚动拖回旧位置，新页内容错位。
 * 旧实现只同步 scrollTop=0 一次，杀不掉在飞动画，也不覆盖异步挂载后的高度变化。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import MainArea from '../../../src/presentation-v2/components/MainArea.vue';
import { useRouterStore } from '../../../src/presentation-v2/stores/router-store';
import { useRootShellStore } from '../../../src/presentation-v2/stores/root-shell-store';

function mountMain() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(defineComponent({ setup: () => () => h(MainArea) }));
  app.mount(host);
  return { app, host, main: host.querySelector('[data-acu-main]') as HTMLElement };
}

const rafFlush = () => new Promise(resolve => setTimeout(resolve, 30));

beforeEach(() => {
  document.body.innerHTML = '';
  setActivePinia(createPinia());
});

describe('MainArea 切页滚动复位', () => {
  it('切页时用 instant 断掉在飞滚动并复位到顶部', async () => {
    const { main } = mountMain();
    const router = useRouterStore();
    router.activePageId = 'api';
    await nextTick();
    const scrollToSpy = vi.fn();
    (main as any).scrollTo = scrollToSpy;
    (main as any).scrollTop = 240;

    router.activePageId = 'agent';
    await nextTick();
    await rafFlush();

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, behavior: 'instant' }),
    );
    expect(main.scrollTop).toBe(0);
  });

  it('重开 remount 后下一帧再断言一次顶部（覆盖异步挂载）', async () => {
    const { main } = mountMain();
    const shell = useRootShellStore();
    (main as any).scrollTop = 120;
    shell.requestOpenRefresh();
    await nextTick();
    await rafFlush();
    expect(main.scrollTop).toBe(0);
  });
});
