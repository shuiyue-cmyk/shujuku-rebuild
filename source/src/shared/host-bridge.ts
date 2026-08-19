/**
 * shared/host-bridge.ts — 宿主（ST / TT / Luker）适配桥（隔离层）
 *
 * 目的：数据库核心的 TT（TauriTavern）针对性适配全部集中在此，业务文件
 * 通过本桥访问宿主信息，不直接触碰 `__TAURITAVERN__` 等 TT 内部 ABI。
 * 这样业务文件保持「纯 ST 标准 API」形态，上游（AlbusKen/shujuku）发布更新时
 * 只同步业务文件、桥层不动，从而兼顾「TT 差异化适配」与「上游更新采纳」。
 *
 * TT 环境判定：TT 是 Tauri 壳 + SillyTavern 1.18 前端，注入 `__TAURITAVERN__` ABI
 * 与 `__TAURITAVERN_MAIN_READY__`。核心差异点：宿主异步引导、扩展与 host ready 存在
 * 竞态，因此核心启动、菜单注入须额外等待 TT 就绪。
 */

export type AcuHostKind = 'tauritavern' | 'luker' | 'sillytavern';

function tauriWindow(): any {
  return (typeof window !== 'undefined' ? window : globalThis) as any;
}

/** 判定宿主类型：TT / Luker 扩展 / 纯 SillyTavern，顺时针检测 */
export function getAcuHostKind(): AcuHostKind {
  const w = tauriWindow();
  if (w.__TAURITAVERN__) return 'tauritavern';
  if (w.Luker?.getContext) return 'luker';
  return 'sillytavern';
}

/** 是否跑在 TauriTavern 下 */
export function isAcuTauriRuntime(): boolean {
  return getAcuHostKind() === 'tauritavern';
}

/**
 * 取 TT 就绪 Promise/标志。TT 主线程由 init.js 异步引导，先于扩展注册完成
 * 的 APP_READY 不代表 TT 内部 ABI 就绪；`__TAURITAVERN__?.ready` 可能是个
 * Promise（可 await），也可能是布尔完成标志。
 */
export function getAcuTauriReady(): { ready: boolean; promise: Promise<void> | null } {
  const w = tauriWindow();
  const ready = w.__TAURITAVERN__?.ready || w.__TAURITAVERN_MAIN_READY__;
  if (ready && typeof ready.then === 'function') {
    return { ready: false, promise: ready as Promise<void> };
  }
  return { ready: ready === true, promise: null };
}

/**
 * 等待宿主 API 就绪（扩展可安全初始化）。
 * - ST/Luker：等 window.SillyTavern.getContext() 返回带核心字段的快照。
 * - TT：在此基础上额外等 __TAURITAVERN__?.ready（异步 promise 或布尔），
 *   避免扩展在 TT 内部 ABI（store/Agent/菜单）就绪前初始化。
 */
export async function waitForAcuHostReady(maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();
  const tauri = isAcuTauriRuntime();

  const getContextReady = (): boolean => {
    try {
      const w = tauriWindow();
      if (typeof w.SillyTavern?.getContext !== 'function') return false;
      const ctx = w.SillyTavern.getContext();
      return !!(ctx?.eventSource && ctx?.eventTypes && typeof ctx?.saveSettingsDebounced === 'function');
    } catch {
      return false;
    }
  };

  while (Date.now() - start < maxWaitMs) {
    if (getContextReady()) {
      if (!tauri) return true;
      // TT：getContext 就绪后再等 TT ABI
      const { ready, promise } = getAcuTauriReady();
      if (ready) return true;
      if (promise) {
        let promiseResolved = false;
        try {
          await Promise.race([
            promise.then(() => { promiseResolved = true; }),
            new Promise<void>((r) => setTimeout(r, Math.max(0, maxWaitMs - (Date.now() - start)))),
          ]);
        } catch { /* TT ready promise 拒绝则继续轮询 */ }
        if (promiseResolved) return true;
        if (getAcuTauriReady().ready || getContextReady()) return true;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return getContextReady();
}
