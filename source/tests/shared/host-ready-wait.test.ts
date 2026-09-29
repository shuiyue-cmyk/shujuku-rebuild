/**
 * tests/shared/host-ready-wait.test.ts
 * T3 就绪等待：waitForAcuHostReady 的语义锁 + 新抽出的唯一 TT 等待器。
 *
 * 锁住的语义（重构前后必须一致，任一条变红即行为回退）：
 * - H1：宿主类型每轮重估（__TAURITAVERN__ 可能晚于扩展注入才出现，不许循环外固化）；
 * - 拒绝恢复：TT ready 被拒绝不直接成功也不 abort，继续轮询等恢复或超时；
 * - 尾判：超时后按当时状态终判（就绪了即真），不挂起；
 * - 非 TT：上下文就绪即真，不碰 TT 等待。
 * 新等待器 awaitAcuTauriReady_ACU：布尔/真值对象立即判、promise 限时等
 * （解决→真；拒绝→假；超时→重读一次再判），缺席为假，绝不抛错。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForAcuHostReady } from '../../src/shared/host-bridge';

const g = globalThis as any;

function installFakeWindow(value: any): void {
  g.window = value;
}

function readyContext(): any {
  return { eventSource: {}, eventTypes: {}, saveSettingsDebounced: () => {} };
}

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
});

describe('awaitAcuTauriReady_ACU（T3 抽出的唯一等待器）', () => {
  it('布尔就绪即真、无 ready 即假', async () => {
    const mod = await import('../../src/shared/host-bridge') as any;
    expect(typeof mod.awaitAcuTauriReady_ACU).toBe('function');
    installFakeWindow({ __TAURITAVERN__: { ready: true } });
    await expect(mod.awaitAcuTauriReady_ACU(200)).resolves.toBe(true);
    installFakeWindow({});
    await expect(mod.awaitAcuTauriReady_ACU(50)).resolves.toBe(false);
  });

  it('promise 解决为真、拒绝为假（不抛）', async () => {
    const mod = await import('../../src/shared/host-bridge') as any;
    installFakeWindow({ __TAURITAVERN__: { ready: Promise.resolve() } });
    await expect(mod.awaitAcuTauriReady_ACU(500)).resolves.toBe(true);
    const rejected = Promise.reject(new Error('tt down'));
    rejected.catch(() => {});
    installFakeWindow({ __TAURITAVERN__: { ready: rejected } });
    await expect(mod.awaitAcuTauriReady_ACU(500)).resolves.toBe(false);
  });

  it('永不解决的 promise 超时为假（不挂起）', async () => {
    const mod = await import('../../src/shared/host-bridge') as any;
    installFakeWindow({ __TAURITAVERN__: { ready: new Promise<void>(() => {}) } });
    await expect(mod.awaitAcuTauriReady_ACU(60)).resolves.toBe(false);
  });
});

describe('waitForAcuHostReady（语义锁）', () => {
  it('ST 上下文就绪即真（非 TT 不碰 TT 等待）', async () => {
    installFakeWindow({ SillyTavern: { getContext: () => readyContext() } });
    await expect(waitForAcuHostReady(500)).resolves.toBe(true);
  });

  it('迟到的 TT 其 ready promise 会被等待（而非按固化非 TT 直接放行）', async () => {
    let resolveReady!: () => void;
    // 上下文与 TT 都迟到：t=0 时首轮必须空转。解决延迟放到一轮（100ms）之外——
    // 若实现把宿主类型固化为非 TT，会在约 100ms 后按非 TT 放行返回 true（<250ms 即红）；
    // 正确实现等 promise 到 t≈320ms 才真。只设下界（抖动只会让耗时更长）。
    installFakeWindow({});
    setTimeout(() => {
      g.window = {
        SillyTavern: { getContext: () => readyContext() },
        __TAURITAVERN__: { ready: new Promise<void>((r) => { resolveReady = r; }) },
      };
      setTimeout(resolveReady, 300);
    }, 20);
    const start = Date.now();
    await expect(waitForAcuHostReady(2000)).resolves.toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(250);
  });

  it('拒绝恢复：ready 拒绝后出现就绪仍为真（不许拒绝即 abort）', async () => {
    const rejected = Promise.reject(new Error('tt down'));
    rejected.catch(() => {});
    installFakeWindow({
      SillyTavern: { getContext: () => readyContext() },
      __TAURITAVERN__: { ready: rejected },
    });
    // 恢复通道是宿主替换 __TAURITAVERN__.ready 本体（被拒绝的 promise 对象恒真值，
    // 会一直遮蔽 MAIN_READY 旗标——这是保守的 fail-closed，尾判 + 版本闸门 fail-open 兜底，不碰）。
    setTimeout(() => { g.window.__TAURITAVERN__ = { ready: true }; }, 30);
    await expect(waitForAcuHostReady(1000)).resolves.toBe(true);
  });

  it('超时返回尾判（全未就绪为假，且不挂起）', async () => {
    installFakeWindow({});
    await expect(waitForAcuHostReady(80)).resolves.toBe(false);
  });
});
