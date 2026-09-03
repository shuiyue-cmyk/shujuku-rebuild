/**
 * menu-button.test — 事件驱动注入验证（TT dev 实态对照）
 *
 * TT dev（src/scripts/extensions.js）：
 * - addExtensionsButtonAndMenu 经 renderTemplateAsync('wandMenu'/'wandButton') 运行时注入，
 *   menu 挂 document.body 下、button 挂 #leftSendForm 下；
 * - 门控 ensureExtensionsUiReady 由 eventSource once APP_READY 触发。
 *
 * 本文件断言三条行为：
 * 1) APP_READY 后注入；
 * 2) MutationObserver 触发注入；
 * 3) 双缺失走备用入口（挂 #leftSendForm 旁）/ 双锚点缺失放弃 + log。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockLogError, mockLogDebug } = vi.hoisted(() => ({
  mockLogError: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logError_ACU: mockLogError, logDebug_ACU: mockLogDebug };
});

type MenuButtonModule = typeof import('../../../src/presentation-v2/bootstrap/menu-button');
type HostApiModule = typeof import('../../../src/shared/host-api');

async function freshImport(): Promise<{ menuButton: MenuButtonModule; hostApi: HostApiModule }> {
  vi.resetModules();
  const [menuButton, hostApi] = await Promise.all([
    import('../../../src/presentation-v2/bootstrap/menu-button'),
    import('../../../src/shared/host-api'),
  ]);
  return { menuButton, hostApi };
}

function makeEventSource() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const push = (ev: string, fn: (...args: any[]) => void): void => {
    listeners.set(ev, [...(listeners.get(ev) ?? []), fn]);
  };
  return {
    listeners,
    once: vi.fn(push),
    on: vi.fn(push),
    emit(ev: string, ...args: any[]): void {
      for (const fn of listeners.get(ev) ?? []) fn(...args);
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('menu-button 事件驱动注入', () => {
  it('APP_READY 后注入（TT dev once APP_READY 门控；同步断言隔离 observer 路径）', async () => {
    const { menuButton, hostApi } = await freshImport();
    document.body.innerHTML = '';
    const eventSource = makeEventSource();
    hostApi._set_SillyTavern_API_ACU({ eventSource, eventTypes: { APP_READY: 'app_ready' } } as any);

    menuButton.registerAcuV2MenuButton();
    expect(document.getElementById('acu-v2-menu-container')).toBeNull();
    expect(eventSource.once).toHaveBeenCalledWith('app_ready', expect.any(Function));

    // 注册时菜单尚未注入：APP_READY 先到也不注入
    eventSource.emit('app_ready');
    expect(document.getElementById('acu-v2-menu-container')).toBeNull();

    // TT 运行时注入菜单容器，随后 APP_READY 到达 → 同步注入。
    // 同步断言是关键：MutationObserver 回调是微任务，此时还没跑，
    // 容器已存在即证明是 APP_READY 路径注入的。
    const menu = document.createElement('div');
    menu.id = 'extensionsMenu';
    document.body.appendChild(menu);
    eventSource.emit('app_ready');
    const container = document.getElementById('acu-v2-menu-container');
    expect(container).not.toBeNull();
    expect(menu.contains(container)).toBe(true);
    expect(document.getElementById('acu-v2-menu-item')).not.toBeNull();

    // 幂等：重复注册 + 重复事件 + observer 后触发都不产生第二个按钮
    menuButton.registerAcuV2MenuButton();
    eventSource.emit('app_ready');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.querySelectorAll('#acu-v2-menu-container')).toHaveLength(1);
  });

  it('MutationObserver 触发注入（TT 运行时后注入 #extensionsMenu）', async () => {
    const { menuButton, hostApi } = await freshImport();
    document.body.innerHTML = '';
    hostApi._set_SillyTavern_API_ACU(undefined);

    menuButton.registerAcuV2MenuButton();
    expect(document.getElementById('acu-v2-menu-container')).toBeNull();

    const menu = document.createElement('div');
    menu.id = 'extensionsMenu';
    document.body.appendChild(menu);
    await new Promise(resolve => setTimeout(resolve, 0));

    const container = document.getElementById('acu-v2-menu-container');
    expect(container).not.toBeNull();
    expect(menu.contains(container)).toBe(true);
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('menu button registered'));
  });

  it('主容器长期缺失时走备用入口（挂 #leftSendForm 旁，wandButton 同宿主）', async () => {
    vi.useFakeTimers();
    try {
      const { menuButton, hostApi } = await freshImport();
      document.body.innerHTML = '<form id="leftSendForm"></form>';
      hostApi._set_SillyTavern_API_ACU(undefined);

      menuButton.registerAcuV2MenuButton();
      expect(document.getElementById('acu-v2-menu-container')).toBeNull();

      await vi.advanceTimersByTimeAsync(6 * 2000 + 500);

      const container = document.getElementById('acu-v2-menu-container');
      expect(container).not.toBeNull();
      expect(container?.previousElementSibling?.id).toBe('leftSendForm');
      expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('fallback'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('双锚点缺失则放弃并记错（#extensionsMenu 与 #leftSendForm 都没有）', async () => {
    vi.useFakeTimers();
    try {
      const { menuButton, hostApi } = await freshImport();
      document.body.innerHTML = '';
      hostApi._set_SillyTavern_API_ACU(undefined);

      menuButton.registerAcuV2MenuButton();
      await vi.advanceTimersByTimeAsync(6 * 2000 + 500);

      expect(document.getElementById('acu-v2-menu-container')).toBeNull();
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('both missing'));
    } finally {
      vi.useRealTimers();
    }
  });
});
