/**
 * effective-theme — 界面风格决定实际生效的配色：默认风格用所选主题，Claude 风格用自带的 Claude 配色。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_DEFAULT_DARK, THEME_JIRAI_KEI } from '../../../src/presentation-v2/theme/builtin-themes';
import {
  CLAUDE_STYLE_THEME_DARK,
  CLAUDE_STYLE_THEME_LIGHT,
  readPersistedEffectiveTheme_ACU,
  resolveEffectiveTheme_ACU,
  systemPrefersDark_ACU,
} from '../../../src/presentation-v2/theme/effective-theme';

const STORAGE_KEY = 'acu_v2_ui_state';

function stubSystemDark(dark: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('dark') ? dark : !dark,
    addEventListener() {},
    removeEventListener() {},
  })));
  (window as any).matchMedia = (globalThis as any).matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('resolveEffectiveTheme_ACU', () => {
  it('默认风格：原样使用所选主题', () => {
    expect(resolveEffectiveTheme_ACU(THEME_JIRAI_KEI, { uiStyle: 'default', claudeColorMode: 'dark', systemPrefersDark: true }))
      .toBe(THEME_JIRAI_KEI);
  });

  it('Claude 风格：不看所选主题，按颜色模式取 Claude 浅色 / 深色配色', () => {
    expect(resolveEffectiveTheme_ACU(THEME_DEFAULT_DARK, { uiStyle: 'claude', claudeColorMode: 'light', systemPrefersDark: true }))
      .toBe(CLAUDE_STYLE_THEME_LIGHT);
    expect(resolveEffectiveTheme_ACU(THEME_JIRAI_KEI, { uiStyle: 'claude', claudeColorMode: 'dark', systemPrefersDark: false }))
      .toBe(CLAUDE_STYLE_THEME_DARK);
  });

  it('Claude 风格跟随系统：系统深色取深色，否则取浅色', () => {
    expect(resolveEffectiveTheme_ACU(THEME_JIRAI_KEI, { uiStyle: 'claude', claudeColorMode: 'system', systemPrefersDark: true }))
      .toBe(CLAUDE_STYLE_THEME_DARK);
    expect(resolveEffectiveTheme_ACU(THEME_JIRAI_KEI, { uiStyle: 'claude', claudeColorMode: 'system', systemPrefersDark: false }))
      .toBe(CLAUDE_STYLE_THEME_LIGHT);
  });

  it('Claude 配色的明暗声明与色板一致（原生表单控件跟随）', () => {
    expect(CLAUDE_STYLE_THEME_LIGHT.colorScheme).toBe('light');
    expect(CLAUDE_STYLE_THEME_DARK.colorScheme).toBe('dark');
    expect(CLAUDE_STYLE_THEME_LIGHT.tokens.accent.toLowerCase()).toBe('#d97757');
  });
});

describe('readPersistedEffectiveTheme_ACU（启动时给面板外的宿主浮层上色）', () => {
  it('没存过外观偏好：用已保存的主题', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { activeId: 'jirai-kei' } }));
    expect(readPersistedEffectiveTheme_ACU().id).toBe('jirai-kei');
  });

  it('存的是 Claude 风格：按保存的颜色模式与系统明暗取 Claude 配色', () => {
    stubSystemDark(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { activeId: 'jirai-kei' }, appearance: { uiStyle: 'claude', claudeColorMode: 'system' } }));
    expect(readPersistedEffectiveTheme_ACU()).toBe(CLAUDE_STYLE_THEME_DARK);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance: { uiStyle: 'claude', claudeColorMode: 'light' } }));
    expect(readPersistedEffectiveTheme_ACU()).toBe(CLAUDE_STYLE_THEME_LIGHT);
  });
});

describe('systemPrefersDark_ACU', () => {
  it('读宿主窗口的系统明暗；不支持 matchMedia 时当作浅色', () => {
    stubSystemDark(true);
    expect(systemPrefersDark_ACU(window)).toBe(true);
    expect(systemPrefersDark_ACU({} as Window)).toBe(false);
  });
});
