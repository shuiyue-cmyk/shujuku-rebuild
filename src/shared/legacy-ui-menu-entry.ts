/**
 * legacy-ui-menu-entry — 旧 UI 菜单入口的显示状态。
 *
 * 旧入口点击行为仍由 presentation/bootstrap/startup.ts 负责；这里仅提供跨层共享的
 * 持久化读取和 DOM 显隐同步，避免 v2 直接 import 旧 presentation。
 */
import { MENU_ITEM_ID_ACU } from './constants';
import { MENU_ITEM_CONTAINER_ID_ACU } from './data-constants';
import {
  ACU_V2_DEV_OPTIONS_SECTION_KEY,
  ACU_V2_STORAGE_KEY,
  LEGACY_UI_MENU_VISIBLE_KEY,
} from './v2-ui-state';

type UiState = Record<string, unknown>;

function getHostDocumentSafely(): Document | null {
  try {
    return (window.parent || window).document || document;
  } catch {
    return typeof document === 'undefined' ? null : document;
  }
}

function readAllUiState(): UiState {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(ACU_V2_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as UiState : {};
  } catch {
    return {};
  }
}

export function readLegacyUiMenuVisible(): boolean {
  const all = readAllUiState();
  const devOptions = all[ACU_V2_DEV_OPTIONS_SECTION_KEY];
  if (!devOptions || typeof devOptions !== 'object') return false;
  return (devOptions as Record<string, unknown>)[LEGACY_UI_MENU_VISIBLE_KEY] === true;
}

export function applyLegacyUiMenuVisibility(visible = readLegacyUiMenuVisible()): void {
  const doc = getHostDocumentSafely();
  const container = doc?.getElementById(MENU_ITEM_CONTAINER_ID_ACU) as HTMLElement | null;
  if (!container) return;

  if (visible) {
    container.style.removeProperty('display');
    container.removeAttribute('aria-hidden');
    container.setAttribute('tabindex', '0');
  } else {
    container.style.display = 'none';
    container.setAttribute('aria-hidden', 'true');
    container.setAttribute('tabindex', '-1');
  }

  const item = doc?.getElementById(MENU_ITEM_ID_ACU);
  if (item) {
    if (visible) item.removeAttribute('aria-hidden');
    else item.setAttribute('aria-hidden', 'true');
  }
}
