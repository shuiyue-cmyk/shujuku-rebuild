/**
 * tests/shared/host-panel-runtime-snapshot.test.ts
 * T2 Panel Runtime 感知日志：启动时只读快照宿主面板运行时状态（profile + manager），
 * 解释“抽屉关闭时面板 DOM 被 park 导致菜单/面板找不到”的报障。不做任何行为分支。
 *
 * 宿主链路（TauriTavern v2.3.0 源码实证）：
 * 面板运行时把关闭抽屉的面板 DOM park 到 DocumentFragment（bootstrap.js preinstallPanelRuntime、
 * services/panel-runtime/install.js 读 panel_runtime_profile，off 则直接返回 null）。
 * 可观察状态：localStorage `tt:panelRuntimeProfile`（preinstall.js 同步 honor off）、
 * `globalThis.__TAURITAVERN_PANEL_RUNTIME__` manager（panel-runtime-service.js）。
 *
 * 快照函数是纯读取：任何缺失/异常都收敛为字符串，绝不抛错（启动链路不容 fail-closed）。
 */
import { describe, expect, it } from 'vitest';

describe('readPanelRuntimeSnapshot_ACU', () => {
  it('宿主键全缺失时收敛为 unavailable，不抛错', async () => {
    delete (globalThis as any).__TAURITAVERN_PANEL_RUNTIME__;
    const mod = await import('../../src/shared/host-bridge') as any;
    expect(typeof mod.readPanelRuntimeSnapshot_ACU).toBe('function');
    expect(mod.readPanelRuntimeSnapshot_ACU()).toEqual({ profile: 'unavailable', manager: 'absent' });
  });

  it('读到 profile 与 manager 时如实返回', async () => {
    const g = globalThis as any;
    const prevStorage = g.localStorage;
    const prevRuntime = g.__TAURITAVERN_PANEL_RUNTIME__;
    g.localStorage = { getItem: (key: string) => (key === 'tt:panelRuntimeProfile' ? 'compact' : null) };
    g.__TAURITAVERN_PANEL_RUNTIME__ = { parkedCount: 2 };
    try {
      const mod = await import('../../src/shared/host-bridge') as any;
      expect(mod.readPanelRuntimeSnapshot_ACU()).toEqual({ profile: 'compact', manager: expect.stringContaining('2') });
    } finally {
      if (prevStorage === undefined) delete g.localStorage; else g.localStorage = prevStorage;
      if (prevRuntime === undefined) delete g.__TAURITAVERN_PANEL_RUNTIME__; else g.__TAURITAVERN_PANEL_RUNTIME__ = prevRuntime;
    }
  });

  it('localStorage 抛错（如隐私模式）时不抛错，profile 记 unreadable', async () => {
    const g = globalThis as any;
    const prevStorage = g.localStorage;
    g.localStorage = { getItem: () => { throw new Error('denied'); } };
    try {
      const mod = await import('../../src/shared/host-bridge') as any;
      expect(mod.readPanelRuntimeSnapshot_ACU().profile).toBe('unreadable');
    } finally {
      if (prevStorage === undefined) delete g.localStorage; else g.localStorage = prevStorage;
    }
  });
});
