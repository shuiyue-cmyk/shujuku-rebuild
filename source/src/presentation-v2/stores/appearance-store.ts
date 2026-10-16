/**
 * appearance-store — 新 UI 外观偏好。
 *
 * 界面缩放、界面风格（默认 / Claude）与侧栏收起都是本机显示偏好，独立持久化到 acu_v2_ui_state.appearance；
 * 不进入主题导入/导出，也不触碰业务配置。
 */
import { defineStore } from 'pinia';
import { readSection, writeSection } from './persistence';

export type AcuUiScale = '100' | '110' | '125';

export interface AcuUiScaleOption {
  value: AcuUiScale;
  label: string;
  cssScale: '1' | '1.1' | '1.25';
}

export const ACU_UI_SCALE_OPTIONS: readonly AcuUiScaleOption[] = [
  { value: '100', label: '100%', cssScale: '1' },
  { value: '110', label: '110%', cssScale: '1.1' },
  { value: '125', label: '125%', cssScale: '1.25' },
] as const;

export const ACU_DEFAULT_UI_SCALE: AcuUiScale = '100';

/** 界面风格：只换外壳与控件的形状、排版和层次，颜色仍取当前主题。 */
export type AcuUiStyle = 'default' | 'claude';

export const ACU_UI_STYLE_OPTIONS: readonly { value: AcuUiStyle; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'claude', label: 'Claude' },
] as const;

export const ACU_DEFAULT_UI_STYLE: AcuUiStyle = 'default';

const SECTION_KEY = 'appearance';

interface PersistedAppearance {
  uiScale?: unknown;
  uiStyle?: unknown;
  railCollapsed?: unknown;
}

interface AppearanceState {
  uiScale: AcuUiScale;
  uiStyle: AcuUiStyle;
  railCollapsed: boolean;
}

export function isUiScale(value: unknown): value is AcuUiScale {
  return typeof value === 'string' && ACU_UI_SCALE_OPTIONS.some(option => option.value === value);
}

export function normalizeUiScale(value: unknown): AcuUiScale {
  return isUiScale(value) ? value : ACU_DEFAULT_UI_SCALE;
}

export function isUiStyle(value: unknown): value is AcuUiStyle {
  return typeof value === 'string' && ACU_UI_STYLE_OPTIONS.some(option => option.value === value);
}

export function normalizeUiStyle(value: unknown): AcuUiStyle {
  return isUiStyle(value) ? value : ACU_DEFAULT_UI_STYLE;
}

function getScaleOption(value: AcuUiScale): AcuUiScaleOption {
  return ACU_UI_SCALE_OPTIONS.find(option => option.value === value) ?? ACU_UI_SCALE_OPTIONS[0];
}

function readInitialAppearanceState(): AppearanceState {
  const persisted = readSection<PersistedAppearance>(SECTION_KEY);
  return {
    uiScale: normalizeUiScale(persisted?.uiScale),
    uiStyle: normalizeUiStyle(persisted?.uiStyle),
    railCollapsed: persisted?.railCollapsed === true,
  };
}

function buildPersistedAppearance(state: AppearanceState): PersistedAppearance {
  return { uiScale: state.uiScale, uiStyle: state.uiStyle, railCollapsed: state.railCollapsed };
}

export const useAppearanceStore = defineStore('acu-v2-appearance', {
  state: (): AppearanceState => readInitialAppearanceState(),
  getters: {
    uiScaleOption(state): AcuUiScaleOption {
      return getScaleOption(state.uiScale);
    },
    uiScaleLabel(state): string {
      return getScaleOption(state.uiScale).label;
    },
    uiScaleCssValue(state): string {
      return getScaleOption(state.uiScale).cssScale;
    },
    isClaudeStyle(state): boolean {
      return state.uiStyle === 'claude';
    },
  },
  actions: {
    setUiScale(value: AcuUiScale): void {
      if (!isUiScale(value)) return;
      if (this.uiScale === value) return;
      this.uiScale = value;
      this.persist();
    },
    setUiStyle(value: AcuUiStyle): void {
      if (!isUiStyle(value)) return;
      if (this.uiStyle === value) return;
      this.uiStyle = value;
      this.persist();
    },
    toggleRailCollapsed(): void {
      this.railCollapsed = !this.railCollapsed;
      this.persist();
    },
    persist(): void {
      writeSection(SECTION_KEY, buildPersistedAppearance(this.$state));
    },
  },
});
