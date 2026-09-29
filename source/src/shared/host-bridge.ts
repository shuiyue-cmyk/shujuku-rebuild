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
 * T3 抽出的唯一 TT 就绪等待器（waitForAcuHostReady 与 menu-button 共用）。
 * 语义 = getAcuTauriReady 的判定 + promise 限时等待：
 * - 布尔/真值对象：立即返回真值（[L1] 宽容保留——对象旗标仍按就绪处理，不等满超时）；
 * - promise：限时等解决（解决→true；拒绝→false；超时→重读一次 ready 再判）；
 * - 全缺席：false。绝不抛错。
 * 轮询 / H1 重估 / 拒绝恢复 / 尾判仍由调用方（waitForAcuHostReady 的循环）负责，
 * 本函数只做单次判定。
 */
export async function awaitAcuTauriReady_ACU(timeoutMs: number): Promise<boolean> {
  const { ready, promise } = getAcuTauriReady();
  if (ready) return true;
  if (!promise) return false;
  const outcome: 'resolved' | 'rejected' | 'timeout' = await Promise.race([
    promise.then(() => 'resolved' as const, () => 'rejected' as const),
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), Math.max(0, timeoutMs))),
  ]);
  if (outcome === 'resolved') return true;
  if (outcome === 'rejected') return false;
  return getAcuTauriReady().ready;
}

/**
 * 等待宿主 API 就绪（扩展可安全初始化）。
 * - ST/Luker：等 window.SillyTavern.getContext() 返回带核心字段的快照。
 * - TT：在此基础上额外等 __TAURITAVERN__?.ready（异步 promise 或布尔），
 *   避免扩展在 TT 内部 ABI（store/Agent/菜单）就绪前初始化。
 * TT 内的单次判定走 awaitAcuTauriReady_ACU（与 menu-button 共用同一等待器）；
 * 拒绝恢复（拒绝后继续轮询等恢复或超时）与尾判语义不变。
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
      // TT：getContext 就绪后再等 TT ABI（helper 内已含超时/拒绝/重读口径）。
      // helper 假 → 本轮不直接判死，照旧 sleep 后下一轮重估（拒绝恢复）。
      if (await awaitAcuTauriReady_ACU(Math.max(0, maxWaitMs - (Date.now() - start)))) return true;
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
function stashAcuTauriVersion_ACU(version: string): void {
  // 运行时缓存：Debug 导出 meta 与版本弹窗的扩展/宿主对照需要同步读取，
  // 但版本读取本身是异步（fetch / invoke）。启动时闸门读过一次后，这里总是有值。
  try { (globalThis as any).__ACU_TAURI_VERSION__ = version; } catch { /* 缓存失败不影响主链路 */ }
}

export async function readAcuTauriVersion(): Promise<string | null> {
  if (!isAcuTauriRuntime()) return null;
  // T3 首选同源 GET /version（宿主 Public 路由，无条件注册；既当版本源又证明宿主 HTTP 内核已就绪）。
  // 判据只取 tauriVersion：pkgVersion 是 ST 兼容版本号（恒为 1.18.0），误用会导致闸门恒闭/恒开。
  try {
    const fetchFn = (globalThis as any).fetch;
    if (typeof fetchFn === 'function') {
      const response = await fetchFn('/version');
      const info = await (response as any)?.json?.();
      const version = typeof info?.tauriVersion === 'string' ? info.tauriVersion.trim() : '';
      if (version) {
        stashAcuTauriVersion_ACU(version);
        return version;
      }
    }
  } catch { /* 落到 invoke 回退 */ }
  // 回退旧链路（fetch 不可用 / 老宿主无该路由时不断链；已有测试按 safeInvoke 语义锁定）。
  const w = tauriWindow();
  const safeInvoke = w.__TAURITAVERN__?.invoke?.safeInvoke;
  if (typeof safeInvoke !== 'function') return null;
  try {
    const info = await safeInvoke('get_client_version');
    const version = typeof info?.tauriVersion === 'string' ? info.tauriVersion.trim() : '';
    if (!version) return null;
    stashAcuTauriVersion_ACU(version);
    return version;
  } catch {
    return null;
  }
}

/**
 * 同步读取已缓存的宿主版本（readAcuTauriVersion 成功时写入）。
 * 读不到（非 TT / 启动时读取失败 / 尚未读取）返回 'unavailable'，不猜、不抛。
 */
export function readCachedAcuTauriVersion_ACU(): string {
  try {
    const version = (globalThis as any).__ACU_TAURI_VERSION__;
    return typeof version === 'string' && version ? version : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Panel Runtime 只读快照（T2 感知日志的数据源）。
 *
 * 宿主把关闭抽屉的面板 DOM park 到 DocumentFragment 以降 DOM 压力
 * （bootstrap.js preinstallPanelRuntime / panel-runtime/install.js 读
 * `panel_runtime_profile`，off 则直接返回 null）。用户报“菜单/面板找不到”时，
 * 这条快照能区分“没注入”与“被 park 了”。
 *
 * 纯读取：任何缺失/异常都收敛为字符串，绝不抛错——启动链路不容 fail-closed。
 * 行为调用方自行决定记不记日志，本函数不写日志（host-bridge 是无日志副作用的隔离层）。
 */
export function readPanelRuntimeSnapshot_ACU(): { profile: string; manager: string } {
  let profile = 'unavailable';
  try {
    const stored = (globalThis as any).localStorage?.getItem?.('tt:panelRuntimeProfile');
    if (typeof stored === 'string' && stored) profile = stored;
  } catch {
    profile = 'unreadable';
  }
  let manager = 'absent';
  try {
    const runtime = (globalThis as any).__TAURITAVERN_PANEL_RUNTIME__;
    if (runtime) {
      const count = (runtime as any).parkedCount ?? (runtime as any).activeCount ?? null;
      manager = count === null ? 'present' : `present (count=${String(count)})`;
    }
  } catch {
    manager = 'unreadable';
  }
  return { profile, manager };
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
