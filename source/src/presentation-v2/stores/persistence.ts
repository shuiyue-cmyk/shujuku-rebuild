/**
 * persistence — 新 UI 自己的 localStorage 持久化层（D14 / P0-4）
 *
 * - 不复用旧 settings_ACU + saveSettingsAndNotify_ACU；新 UI 状态走独立 key
 * - 单一根 key：acu_v2_ui_state，值是 JSON。各 store 通过 sectionKey 读写自己的子节
 * - localStorage 不可用（SSR / 隐私模式）时静默降级到内存
 *
 * 阶段 0 仅覆盖：theme（批次 C）+ router.activePageId（批次 D）。
 */
import { ACU_V2_STORAGE_KEY } from '../../shared/v2-ui-state';
import { logWarn_ACU } from '../../shared/utils';

type UiState = Record<string, unknown>;

let memoryFallback: UiState = {};
let warned = false;

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch (err) {
    if (!warned) {
      logWarn_ACU('[ACU-V2] localStorage unavailable; falling back to memory.', err);
      warned = true;
    }
    return null;
  }
}

function readAll(): UiState {
  const storage = getStorage();
  if (!storage) return { ...memoryFallback };
  const raw = storage.getItem(ACU_V2_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as UiState) : {};
  } catch {
    return {};
  }
}

function writeAll(next: UiState): void {
  const storage = getStorage();
  if (!storage) {
    memoryFallback = { ...next };
    return;
  }
  try {
    storage.setItem(ACU_V2_STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    if (!warned) {
      logWarn_ACU('[ACU-V2] localStorage write failed; falling back to memory.', err);
      warned = true;
    }
    memoryFallback = { ...next };
  }
}

export function readSection<T>(sectionKey: string): T | undefined {
  const all = readAll();
  return all[sectionKey] as T | undefined;
}

export function writeSection(sectionKey: string, value: unknown): void {
  const all = readAll();
  all[sectionKey] = value;
  writeAll(all);
}

export function removeSection(sectionKey: string): void {
  const all = readAll();
  delete all[sectionKey];
  writeAll(all);
}

export function __resetPersistenceForTests(): void {
  memoryFallback = {};
  warned = false;
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(ACU_V2_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
