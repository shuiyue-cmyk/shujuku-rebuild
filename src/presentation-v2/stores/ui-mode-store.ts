/**
 * ui-mode-store — 基础模式 / 高手模式切换。
 *
 * 这是新 UI 自己的展示模式，不写入旧 settings_ACU。基础模式只保留一个
 * “基础配置”入口；高手模式恢复完整工作台。
 */
import { defineStore } from 'pinia';
import { readSection, writeSection } from './persistence';

const SECTION_KEY = 'uiMode';
const ROUTER_SECTION_KEY = 'router';

export type AcuV2UiMode = 'basic' | 'advanced';

interface PersistedUiMode {
  mode?: unknown;
}

function normalizeMode(value: unknown): AcuV2UiMode {
  return value === 'advanced' ? 'advanced' : 'basic';
}

function loadFromStorage(): AcuV2UiMode {
  const raw = readSection<PersistedUiMode>(SECTION_KEY) ?? {};
  if (raw.mode !== undefined) return normalizeMode(raw.mode);
  const router = readSection<{ activePageId?: unknown }>(ROUTER_SECTION_KEY);
  if (typeof router?.activePageId === 'string' && router.activePageId && router.activePageId !== 'basic-config') {
    return 'advanced';
  }
  return normalizeMode(raw.mode);
}

function persist(mode: AcuV2UiMode): void {
  writeSection(SECTION_KEY, { mode });
}

export const useUiModeStore = defineStore('acu-v2-ui-mode', {
  state: () => ({
    mode: loadFromStorage() as AcuV2UiMode,
  }),
  getters: {
    isBasicMode: state => state.mode === 'basic',
    isAdvancedMode: state => state.mode === 'advanced',
    modeLabel: state => (state.mode === 'basic' ? '基础模式' : '高手模式'),
  },
  actions: {
    setMode(mode: AcuV2UiMode): void {
      this.mode = normalizeMode(mode);
      persist(this.mode);
    },
    toggleMode(): void {
      this.setMode(this.mode === 'basic' ? 'advanced' : 'basic');
    },
    refresh(): void {
      this.mode = loadFromStorage();
    },
  },
});
