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
  // [L1] 宽容处理：TT ABI 的 ready 除布尔/Promise 外还可能是真值对象（如完成标记对象），
  // 一律按真值视为就绪；仅 promise-like 走上面的等待分支。
  return { ready: Boolean(ready), promise: null };
}

/**
 * 等待宿主 API 就绪（扩展可安全初始化）。
 * - ST/Luker：等 window.SillyTavern.getContext() 返回带核心字段的快照。
 * - TT：在此基础上额外等 __TAURITAVERN__?.ready（异步 promise 或布尔），
 *   避免扩展在 TT 内部 ABI（store/Agent/菜单）就绪前初始化。
 */
export async function waitForAcuHostReady(maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();

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
    // [H1] 每轮重估宿主类型：TT 的 __TAURITAVERN__ ABI 可能晚于扩展注入，
    // 循环外只读一次会把 tauri 固化为 false，导致 TT 下跳过 __TAURITAVERN__.ready 等待。
    const isTauri = isAcuTauriRuntime();
    if (getContextReady()) {
      if (!isTauri) return true;
      // TT：getContext 就绪后再等 TT ABI
      const { ready, promise } = getAcuTauriReady();
      if (ready) return true;
      if (promise) {
        let promiseResolved = false;
        let promiseRejected = false;
        try {
          await Promise.race([
            promise.then(() => { promiseResolved = true; }).catch(() => { promiseRejected = true; }),
            new Promise<void>((r) => setTimeout(r, Math.max(0, maxWaitMs - (Date.now() - start)))),
          ]);
        } catch { promiseRejected = true; }
        if (promiseResolved) return true;
        if (promiseRejected) {
          // TT ready 被拒绝：不直接回退为成功，继续轮询等待 TT 恢复或超时
        } else if (getAcuTauriReady().ready) {
          return true;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  // [H1] 终判同样用当轮重估值，不用循环外的固化快照
  const finalIsTauri = isAcuTauriRuntime();
  return finalIsTauri ? (getAcuTauriReady().ready && getContextReady()) : getContextReady();
}

/**
 * 本插件适配与验证所依据的 TauriTavern 最低版本。
 * 2.3.0 起宿主把工具调用结果升为一等楼层（`{role:'tool', is_system:true}`）、新增 TOOL_CALLS_* 事件、
 * 引入 Agent 断点续连的 `{agentResume:true}` 生成事件，并变更了结构写入与保存管线契约。
 */
export const ACU_REQUIRED_TAURITAVERN_VERSION = '2.3.0';

/** 解析 `major.minor.patch` 形式的版本串；不可解析返回 null（不猜）。 */
export function parseAcuVersionParts(value: unknown): [number, number, number] | null {
  const text = String(value ?? '').trim().replace(/^v/i, '');
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 比较两个版本串：a<b 返回 -1、a===b 返回 0、a>b 返回 1；任一不可解析返回 null。 */
export function compareAcuVersions(a: unknown, b: unknown): number | null {
  const left = parseAcuVersionParts(a);
  const right = parseAcuVersionParts(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 读 TauriTavern 自身版本号（`tauriVersion`，取自宿主 crates/tauritavern 的 Cargo 版本）。
 * 走宿主文档化的第三方 ABI `__TAURITAVERN__.invoke.safeInvoke('get_client_version')`。
 * 非 TT 宿主、ABI 不可用或调用失败一律返回 null（**不做猜测**）。
 */
export async function readAcuTauriVersion(): Promise<string | null> {
  if (!isAcuTauriRuntime()) return null;
  const w = tauriWindow();
  const safeInvoke = w.__TAURITAVERN__?.invoke?.safeInvoke;
  if (typeof safeInvoke !== 'function') return null;
  try {
    const info = await safeInvoke('get_client_version');
    const version = typeof info?.tauriVersion === 'string' ? info.tauriVersion.trim() : '';
    return version || null;
  } catch {
    return null;
  }
}

/**
 * TT 版本是否低于要求。**读不到版本时返回 false（fail-open，不打扰用户）**：
 * `get_client_version` 与 `safeInvoke` 自 TT v1.6.5 起就存在，读失败属异常而非「版本过旧」，
 * 若把失败当成过旧就会对纯 ST / 读取偶发失败的用户误报。
 */
export function isAcuTauriVersionOutdated(
  version: unknown,
  required: string = ACU_REQUIRED_TAURITAVERN_VERSION,
): boolean {
  const compared = compareAcuVersions(version, required);
  return compared === null ? false : compared < 0;
}
