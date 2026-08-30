/**
 * service/runtime/version-update-check.ts — 启动版本校验（静默失败，仅新版才提示）
 *
 * 本库经 ST 扩展面板按仓库地址分发（根级 manifest.json + index.js，auto_update）。
 * 启动加载成功后对照仓库 HEAD 的 manifest.json 版本：
 * - 网络失败/超时/解析失败/版本不可比 → 完全静默（不打扰用户，用户只要"已加载"）；
 * - 远端更新 → 提示一条"发现新版本"toast；同一新版本只提示一次（localStorage 记忆），
 *   避免用户未更新时每轮重启都被弹。
 * 检查节流每小时一次，结果缓存于 localStorage。
 */
import { logDebug_ACU } from '../../shared/utils';

const VERSION_CHECK_STORAGE_KEY_ACU = 'acu-version-check-v1';
const VERSION_CHECK_INTERVAL_MS_ACU = 60 * 60 * 1000;
const VERSION_FETCH_TIMEOUT_MS_ACU = 8000;
const LATEST_MANIFEST_URL_ACU = 'https://raw.githubusercontent.com/shuiyue-cmyk/shujuku-rebuild/master/manifest.json';

export interface VersionCheckDeps_ACU {
  fetchLatest: () => Promise<string | null>;
  notify: (latestVersion: string, localVersion: string) => void;
  now: () => number;
  readState: () => VersionCheckState_ACU | null;
  writeState: (state: VersionCheckState_ACU) => void;
  localVersion: () => string;
}

/** 解析 "v9.0.1" / "9.0" / "9.0.0-beta"（取前导数字段）为数值数组；不可解析返回 null。 */
export function parseVersionSegments_ACU(version: string): number[] | null {
  const match = String(version ?? '').trim().replace(/^v/i, '').match(/^\d+(?:\.\d+)*/);
  if (!match) return null;
  return match[0].split('.').map((part) => Number(part));
}

/** a > b 返回 1，相等返回 0，a < b 返回 -1；任一不可解析返回 null（=无法比较）。 */
export function compareVersions_ACU(a: string, b: string): 1 | 0 | -1 | null {
  const sa = parseVersionSegments_ACU(a);
  const sb = parseVersionSegments_ACU(b);
  if (!sa || !sb) return null;
  const length = Math.max(sa.length, sb.length);
  for (let i = 0; i < length; i += 1) {
    const va = sa[i] ?? 0;
    const vb = sb[i] ?? 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

interface VersionCheckState_ACU {
  lastCheckAt?: number;
  latestVersion?: string;
  lastNotifiedVersion?: string;
}

function defaultReadState_ACU(): VersionCheckState_ACU | null {
  try {
    const raw = localStorage.getItem(VERSION_CHECK_STORAGE_KEY_ACU);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function defaultWriteState_ACU(state: unknown): void {
  try {
    localStorage.setItem(VERSION_CHECK_STORAGE_KEY_ACU, JSON.stringify(state));
  } catch { /* 存储不可用只影响节流，不影响本次判定。 */ }
}

async function defaultFetchLatest_ACU(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS_ACU);
  try {
    // cache-buster：raw.githubusercontent 有 CDN 缓存，?t= 强制回源拿 HEAD 最新。
    const response = await fetch(`${LATEST_MANIFEST_URL_ACU}?t=${Date.now()}`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    const manifest = JSON.parse(text);
    return typeof manifest?.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const defaultDeps_ACU: VersionCheckDeps_ACU = {
  fetchLatest: defaultFetchLatest_ACU,
  // 服务层不反向依赖 presentation：提示由调用方注入（init.ts 接线处传 toast 实现）。
  notify: () => {},
  now: () => Date.now(),
  readState: defaultReadState_ACU,
  writeState: defaultWriteState_ACU,
  localVersion: () => String((globalThis as any).__ACU_BUILD_VERSION__ || ''),
};

/**
 * 启动版本校验入口：fire-and-forget，任何异常都不外溢（调用方 void 即可）。
 * 只有「远端版本 > 本地版本 且 该版本未提示过」才会 notify；notify 由调用方注入。
 */
export async function checkDatabaseUpdateOnStartup_ACU(overrides: Partial<VersionCheckDeps_ACU> = {}): Promise<void> {
  const deps: VersionCheckDeps_ACU = { ...defaultDeps_ACU, ...overrides };
  try {
    const local = deps.localVersion();
    if (!local || local === 'unknown') return;
    const state = deps.readState() ?? {};
    if (state.lastCheckAt && deps.now() - state.lastCheckAt < VERSION_CHECK_INTERVAL_MS_ACU) {
      // 节流窗口内：复用缓存的远端版本，仍可提示未通知过的新版。
      if (state.latestVersion) {
        const cached = compareVersions_ACU(state.latestVersion, local);
        if (cached === 1 && state.lastNotifiedVersion !== state.latestVersion) {
          // 先记账再提示：notify 抛错也不会导致下次重启重复弹窗。
          deps.writeState({ ...state, lastNotifiedVersion: state.latestVersion });
          deps.notify(state.latestVersion, local);
        }
      }
      return;
    }
    const latest = await deps.fetchLatest();
    if (!latest) {
      // 网络/解析失败：只推进节流时间戳，不留任何用户可见痕迹。
      deps.writeState({ ...state, lastCheckAt: deps.now() });
      return;
    }
    const order = compareVersions_ACU(latest, local);
    deps.writeState({ ...state, lastCheckAt: deps.now(), latestVersion: latest });
    if (order === 1 && state.lastNotifiedVersion !== latest) {
      deps.writeState({ ...state, lastCheckAt: deps.now(), latestVersion: latest, lastNotifiedVersion: latest });
      deps.notify(latest, local);
    }
  } catch (error) {
    // 校验链的任何异常都静默：启动体验优先，用户只应看到"已加载"。
    logDebug_ACU('[版本校验] 启动版本校验异常（已静默）。', error);
  }
}
