// service/settings/api-preset-staleness.ts — API 预设变更防呆（核心，无 Vue 依赖）
// 机制：全局修订号（localStorage，任何预设写入/绑定变化时 +1）；每个预设选择器
// 记录「最后一次手动确认时的修订号」。两者不一致 → 该选择器标淡黄底，提示用户
// 当前预设已在别处变化；用户在该处手动重选一次即确认，黄底消除。
// 纯设备本地 UX 提示，不进 settings 持久化。Vue 响应式封装见
// presentation-v2/composables/useApiPresetStaleness.ts。

const REVISION_KEY = 'acu-preset-revision-global';
const CONFIRMED_PREFIX = 'acu-preset-stale-confirmed:';
const REVISION_EVENT = 'acu-preset-revision-changed';

function readRevision(): number {
  try {
    const raw = Number(localStorage.getItem(REVISION_KEY));
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

function writeRevision(value: number): void {
  try { localStorage.setItem(REVISION_KEY, String(value)); } catch {}
}

/** 预设发生写入/绑定变化时调用（finalizeSave 成功后）：全局修订号 +1 并广播 */
export function bumpApiPresetRevision_ACU(reason?: string): void {
  const next = readRevision() + 1;
  writeRevision(next);
  try {
    void reason;
    window.dispatchEvent(new CustomEvent(REVISION_EVENT, { detail: next }));
  } catch {}
}

function confirmedStorageKey(key: string): string {
  return `${CONFIRMED_PREFIX}${key}`;
}

/** 读取某选择器最后手动确认的修订号；从未确认过返回 null */
export function getConfirmedApiPresetRevision_ACU(key: string): number | null {
  try {
    const raw = localStorage.getItem(confirmedStorageKey(key));
    if (raw === null) return null;
    const num = Number(raw);
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : null;
  } catch {
    return null;
  }
}

/** 手动确认：把当前全局修订号记为该选择器的已确认值，黄底随之消除 */
export function confirmApiPresetStaleness_ACU(key: string): void {
  try { localStorage.setItem(confirmedStorageKey(key), String(readRevision())); } catch {}
}

/**
 * 计算某选择器当前是否处于「预设已变化未确认」状态：
 * - 从未确认过：全局修订号 > 0（发生过任何预设变更）即 stale——否则防呆对
 *   「从未手动选过的选择器」永远沉默，恰好吞掉最需要提醒的场景（用户实测反馈）。
 *   全新安装修订号 = 0，不误报。
 * - 已确认且 ≠ 当前修订号：stale（确认后又有变化）
 */
export function isApiPresetStale_ACU(key: string): boolean {
  const confirmed = getConfirmedApiPresetRevision_ACU(key);
  const current = readRevision();
  if (confirmed === null) return current > 0;
  return confirmed !== current;
}

/** 订阅修订号变化（返回取消订阅函数）；回调里重算 isStale 即可保持响应式 */
export function onApiPresetRevisionChanged_ACU(listener: () => void): () => void {
  try {
    window.addEventListener(REVISION_EVENT, listener);
    return () => window.removeEventListener(REVISION_EVENT, listener);
  } catch {
    return () => {};
  }
}
