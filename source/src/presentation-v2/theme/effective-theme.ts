/**
 * effective-theme — 实际生效的配色。
 *
 * 默认风格：用外观里所选的主题。
 * Claude 风格：自带 Claude 配色（参考公开的 Claude 界面设计规范：四层表面阶梯、陶土强调色、
 * 低透明度墨色边线），明暗由「颜色模式」决定（浅色 / 跟随系统 / 深色），不看所选主题。
 *
 * 生效配色统一经 theme-injector 写进 --acu-* 令牌：面板、宿主浮层、原生表单控件的明暗都跟着走。
 */
import {
  normalizeClaudeColorMode,
  normalizeUiStyle,
  type AcuClaudeColorMode,
  type AcuUiStyle,
} from '../stores/appearance-store';
import { readSection } from '../stores/persistence';
import { readPersistedActiveTheme_ACU } from '../stores/theme-store';
import type { AcuV2Theme } from './theme-types';

const CLAUDE_FONT_UI = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const CLAUDE_FONT_MONO = '"SF Mono", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * 弱化文字（text3）比规范值略深：本插件说明文字多，规范的 #8a8a8a / #666666 在长段中文上对比度不足。
 */
export const CLAUDE_STYLE_THEME_LIGHT: AcuV2Theme = Object.freeze({
  id: 'claude',
  name: 'Claude 风格（浅色）',
  colorScheme: 'light',
  tokens: Object.freeze({
    bg0: '#fcfcfb',
    bg1: '#ffffff',
    bg2: '#f5f5f3',
    sidebarBg: '#f5f5f3',
    hoverOverlay: 'rgba(20, 20, 20, 0.05)',
    border: 'rgba(20, 20, 20, 0.10)',
    border2: 'rgba(20, 20, 20, 0.20)',
    text1: '#151515',
    text2: '#525252',
    text3: '#767676',
    accent: '#d97757',
    accent2: '#cc5a36',
    onAccent: '#ffffff',
    accentGlow: 'rgba(217, 119, 87, 0.25)',
    success: '#2f8a57',
    warning: '#b26b12',
    danger: '#dc2626',
    fontUi: CLAUDE_FONT_UI,
    fontMono: CLAUDE_FONT_MONO,
    radiusLg: '16px',
    radiusMd: '10px',
    radiusSm: '8px',
    shadow: '0 0 0 1px rgba(20, 20, 20, 0.10), 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08)',
  }),
}) as AcuV2Theme;

export const CLAUDE_STYLE_THEME_DARK: AcuV2Theme = Object.freeze({
  id: 'claude-night',
  name: 'Claude 风格（深色）',
  colorScheme: 'dark',
  tokens: Object.freeze({
    bg0: '#151515',
    bg1: '#1a1a19',
    bg2: '#20201e',
    sidebarBg: '#0b0b0a',
    hoverOverlay: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.09)',
    border2: 'rgba(255, 255, 255, 0.18)',
    text1: '#f5f5f5',
    text2: '#a3a3a3',
    text3: '#8a8a87',
    accent: '#d97757',
    accent2: '#e08264',
    onAccent: '#ffffff',
    accentGlow: 'rgba(217, 119, 87, 0.35)',
    success: '#5fb37f',
    warning: '#e0a54b',
    danger: '#f87171',
    fontUi: CLAUDE_FONT_UI,
    fontMono: CLAUDE_FONT_MONO,
    radiusLg: '16px',
    radiusMd: '10px',
    radiusSm: '8px',
    shadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.10), 0 8px 28px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.45)',
  }),
}) as AcuV2Theme;

export interface EffectiveThemeInput_ACU {
  uiStyle: AcuUiStyle;
  claudeColorMode: AcuClaudeColorMode;
  systemPrefersDark: boolean;
}

export function resolveEffectiveTheme_ACU(activeTheme: AcuV2Theme, input: EffectiveThemeInput_ACU): AcuV2Theme {
  if (input.uiStyle !== 'claude') return activeTheme;
  const dark = input.claudeColorMode === 'dark'
    || (input.claudeColorMode === 'system' && input.systemPrefersDark);
  return dark ? CLAUDE_STYLE_THEME_DARK : CLAUDE_STYLE_THEME_LIGHT;
}

/** 生效的是 Claude 风格自带配色（面板外弹窗据此套用 Claude 外观）。 */
export function isClaudeStyleTheme_ACU(theme: AcuV2Theme): boolean {
  return theme === CLAUDE_STYLE_THEME_LIGHT || theme === CLAUDE_STYLE_THEME_DARK;
}

/** 按生效配色同步面板外弹窗的 Claude 外观：Claude 配色写入，其余清空。 */
export function hostSkinSchemeFor_ACU(theme: AcuV2Theme): AcuV2Theme['colorScheme'] | null {
  return isClaudeStyleTheme_ACU(theme) ? theme.colorScheme : null;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 读宿主窗口的系统明暗；不支持 matchMedia 的环境当作浅色。 */
export function systemPrefersDark_ACU(win: Window): boolean {
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia(DARK_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** 监听系统明暗变化；返回取消监听。 */
export function watchSystemColorScheme_ACU(win: Window, onChange: (dark: boolean) => void): () => void {
  let query: MediaQueryList | null = null;
  try {
    query = typeof win.matchMedia === 'function' ? win.matchMedia(DARK_QUERY) : null;
  } catch {
    query = null;
  }
  if (!query || typeof query.addEventListener !== 'function') return () => {};
  const listener = (event: MediaQueryListEvent) => onChange(event.matches === true);
  query.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}

interface PersistedAppearanceStyle {
  uiStyle?: unknown;
  claudeColorMode?: unknown;
}

/** 不建 store 直接读出已保存的生效配色：启动时给面板外的宿主浮层上色用。 */
export function readPersistedEffectiveTheme_ACU(win: Window = globalThis as unknown as Window): AcuV2Theme {
  const appearance = readSection<PersistedAppearanceStyle>('appearance');
  return resolveEffectiveTheme_ACU(readPersistedActiveTheme_ACU(), {
    uiStyle: normalizeUiStyle(appearance?.uiStyle),
    claudeColorMode: normalizeClaudeColorMode(appearance?.claudeColorMode),
    systemPrefersDark: systemPrefersDark_ACU(win),
  });
}
