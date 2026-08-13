/**
 * appearance-store — 新 UI 外观偏好。
 *
 * 界面缩放是本机显示偏好，独立持久化到 acu_v2_ui_state.appearance；
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

const SECTION_KEY = 'appearance';

interface PersistedAppearance {
  uiScale?: unknown;
}

interface AppearanceState {
  uiScale: AcuUiScale;
}

export function isUiScale(value: unknown): value is AcuUiScale {
  return typeof value === 'string' && ACU_UI_SCALE_OPTIONS.some(option => option.value === value);
}

export function normalizeUiScale(value: unknown): AcuUiScale {
  return isUiScale(value) ? value : ACU_DEFAULT_UI_SCALE;
}

function getScaleOption(value: AcuUiScale): AcuUiScaleOption {
  return ACU_UI_SCALE_OPTIONS.find(option => option.value === value) ?? ACU_UI_SCALE_OPTIONS[0];
}

function readInitialAppearanceState(): AppearanceState {
  const persisted = readSection<PersistedAppearance>(SECTION_KEY);
  return { uiScale: normalizeUiScale(persisted?.uiScale) };
}

function buildPersistedAppearance(state: AppearanceState): PersistedAppearance {
  return { uiScale: state.uiScale };
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
  },
  actions: {
    setUiScale(value: AcuUiScale): void {
      if (!isUiScale(value)) return;
      if (this.uiScale === value) return;
      this.uiScale = value;
      this.persist();
    },
    persist(): void {
      writeSection(SECTION_KEY, buildPersistedAppearance(this.$state));
    },
  },
});
