/**
 * useEffectiveTheme — 实际生效的配色（默认风格 = 所选主题；Claude 风格 = Claude 自带配色）。
 * 外壳的明暗标记与主题注入都读这一份，见 theme/effective-theme.ts。
 */
import { computed, type ComputedRef } from 'vue';
import type { Pinia } from 'pinia';
import { useAppearanceStore } from '../stores/appearance-store';
import { useThemeStore } from '../stores/theme-store';
import { resolveEffectiveTheme_ACU } from '../theme/effective-theme';
import type { AcuV2Theme } from '../theme/theme-types';

export function useEffectiveTheme(pinia?: Pinia): ComputedRef<AcuV2Theme> {
  const themeStore = useThemeStore(pinia);
  const appearanceStore = useAppearanceStore(pinia);
  return computed(() => resolveEffectiveTheme_ACU(themeStore.activeTheme, {
    uiStyle: appearanceStore.uiStyle,
    claudeColorMode: appearanceStore.claudeColorMode,
    systemPrefersDark: appearanceStore.systemPrefersDark,
  }));
}
