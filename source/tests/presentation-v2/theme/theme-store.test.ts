/**
 * theme-store.test — 验证主题切换、持久化、注入
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STYLE_NODE_ID = 'acu-v2-theme';
const APP_ROOT_ID = 'acu-app-v2';
const STORAGE_KEY = 'acu_v2_ui_state';

type ThemeStoreModule = typeof import('../../../src/presentation-v2/stores/theme-store');
type InjectorModule = typeof import('../../../src/presentation-v2/theme/theme-injector');
type PersistenceModule = typeof import('../../../src/presentation-v2/stores/persistence');
type HostDocModule = typeof import('../../../src/presentation-v2/bootstrap/host-document');
type PiniaModule = typeof import('pinia');

type Rgba = [number, number, number, number];

function parseColor(color: string): Rgba {
  const value = color.trim();
  if (value === 'transparent') return [0, 0, 0, 0];
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgba = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgba) throw new Error(`无法解析颜色：${color}`);
  const parts = rgba[1].split(',').map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1) as Rgba;
}

function luminance(c: Rgba): number {
  const [r, g, b] = c.slice(0, 3).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const JIRAI_TOKENS = {
  bg0: '#2B2B2B',
  bg1: '#1F1F1F',
  bg2: 'rgba(255, 196, 212, 0.08)',
  sidebarBg: '#1F1F1F',
  hoverOverlay: 'rgba(255, 196, 212, 0.12)',
  border: 'transparent',
  border2: 'transparent',
  text1: '#FFFFFF',
  text2: 'rgba(255, 255, 255, 0.70)',
  text3: 'rgba(255, 255, 255, 0.50)',
  accent: '#FFC4D4',
  accent2: '#FFD9E4',
  onAccent: '#2B2B2B',
  accentGlow: 'rgba(255, 196, 212, 0.25)',
  success: '#E5A0B5',
  warning: '#FFB38B',
  danger: '#D96C6C',
  fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
  radiusLg: '18px',
  radiusMd: '16px',
  radiusSm: '12px',
  shadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
};

async function freshImport(): Promise<{
  themeStore: ThemeStoreModule;
  injector: InjectorModule;
  persistence: PersistenceModule;
  host: HostDocModule;
  pinia: PiniaModule;
}> {
  vi.resetModules();
  const [themeStore, injector, persistence, host, pinia] = await Promise.all([
    import('../../../src/presentation-v2/stores/theme-store'),
    import('../../../src/presentation-v2/theme/theme-injector'),
    import('../../../src/presentation-v2/stores/persistence'),
    import('../../../src/presentation-v2/bootstrap/host-document'),
    import('pinia'),
  ]);
  return { themeStore, injector, persistence, host, pinia };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('theme-store', () => {
  it('未持久化时使用默认主题（default-dark）', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('default-dark');
  });

  it('localStorage 中已有合法 id 时按持久化值初始化', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { activeId: 'creamy-minimal' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('creamy-minimal');
  });

  it('旧草莓奶龙 id 会迁移到奶油主题', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { activeId: 'strawberry-dragon' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('creamy-minimal');
    expect(store.activeTheme.name).toBe('奶油风');
  });

  it('非法 id 落回默认主题', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { activeId: 'not-a-theme' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('default-dark');
  });

  it('setTheme 切换后 localStorage 被写入新 id', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    store.setTheme('default-light');
    expect(store.activeId).toBe('default-light');
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ theme: { activeId: 'default-light' } });
  });

  it('setTheme 拒绝非法 id（不变更 state）', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const before = store.activeId;
    (store.setTheme as any)('definitely-not-a-theme');
    expect(store.activeId).toBe(before);
  });

  it('只暴露当前维护的八个内置主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.themes.map(t => t.id)).toEqual([
      'default-light',
      'default-dark',
      'creamy-minimal',
      'jirai-kei',
      'claude',
      'claude-night',
      'mist-blue',
      'midnight',
    ]);
  });

  it('导入 v2 自定义主题后加入列表、切为活动主题并持久化', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const base = store.themes.find(t => t.id === 'default-dark')!;

    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '夜航主题',
        colorScheme: 'dark',
        tokens: {
          ...base.tokens,
          bg0: '#101820',
          accent: '#91D9F7',
        },
      },
    }));

    expect(imported.id).toBe('custom:theme');
    expect(imported.name).toBe('夜航主题');
    expect(store.activeId).toBe(imported.id);
    expect(store.activeTheme.tokens.bg0).toBe('#101820');
    expect(store.themes.map(t => t.id)).toEqual([
      'default-light',
      'default-dark',
      'creamy-minimal',
      'jirai-kei',
      'claude',
      'claude-night',
      'mist-blue',
      'midnight',
      'custom:theme',
    ]);

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.theme.activeId).toBe('custom:theme');
    expect(raw.theme.customThemes).toHaveLength(1);
    expect(raw.theme.customThemes[0]).toMatchObject({
      id: 'custom:theme',
      name: '夜航主题',
      colorScheme: 'dark',
    });
  });

  it('导入同名地雷色主题时使用内置主题并移除自定义主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();

    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:jirai-kei',
        name: '地雷色',
        colorScheme: 'dark',
        tokens: {
          ...JIRAI_TOKENS,
          bg0: '#000000',
        },
      },
    }));

    expect(imported.id).toBe('jirai-kei');
    expect(store.activeId).toBe('jirai-kei');
    expect(store.customThemes).toEqual([]);
    expect(store.themes.map(t => t.id)).toEqual([
      'default-light',
      'default-dark',
      'creamy-minimal',
      'jirai-kei',
      'claude',
      'claude-night',
      'mist-blue',
      'midnight',
    ]);
    expect(store.activeTheme.tokens.bg0).toBe('#2B2B2B');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { activeId: 'jirai-kei' },
    });
  });

  it('localStorage 中已有同名自定义地雷色时恢复为内置主题', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: {
        activeId: 'custom:jirai-kei',
        customThemes: [{
          id: 'custom:jirai-kei',
          name: '地雷色',
          colorScheme: 'dark',
          tokens: {
            ...JIRAI_TOKENS,
            bg0: '#000000',
          },
        }],
      },
    }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();

    expect(store.activeId).toBe('jirai-kei');
    expect(store.activeTheme.name).toBe('地雷色');
    expect(store.activeTheme.tokens.bg0).toBe('#2B2B2B');
    expect(store.customThemes).toEqual([]);
    expect(store.themes.filter(t => t.name === '地雷色')).toHaveLength(1);
  });

  it('localStorage 中已有自定义主题时可以恢复活动主题', async () => {
    const m1 = await freshImport();
    m1.pinia.setActivePinia(m1.pinia.createPinia());
    const store1 = m1.themeStore.useThemeStore();
    const base = store1.themes.find(t => t.id === 'default-light')!;
    store1.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:saved-theme',
        name: '保存主题',
        colorScheme: 'light',
        tokens: base.tokens,
      },
    }));

    const m2 = await freshImport();
    m2.pinia.setActivePinia(m2.pinia.createPinia());
    const store2 = m2.themeStore.useThemeStore();
    expect(store2.activeId).toBe('custom:saved-theme');
    expect(store2.activeTheme.name).toBe('保存主题');
  });

  it('删除当前自定义主题时回退默认主题，并拒绝删除内置主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const base = store.themes.find(t => t.id === 'default-dark')!;
    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:delete-me',
        name: '删除测试',
        colorScheme: 'dark',
        tokens: base.tokens,
      },
    }));

    expect(store.deleteCustomTheme('default-dark')).toBe(false);
    expect(store.deleteCustomTheme(imported.id)).toBe(true);
    expect(store.activeId).toBe('default-dark');
    expect(store.themes.some(t => t.id === imported.id)).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { activeId: 'default-dark' },
    });
  });

  it('导出主题使用 v2 自定义主题文件格式，内置主题不携带 custom id', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const baseFile = store.buildThemeFile('default-light');
    expect(baseFile).toMatchObject({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '浅色',
        colorScheme: 'light',
      },
    });
    expect(baseFile.theme.id).toBeUndefined();

    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:export-me',
        name: '导出测试',
        colorScheme: 'light',
        tokens: baseFile.theme.tokens,
      },
    }));
    expect(store.buildThemeFile(imported.id).theme.id).toBe('custom:export-me');
  });

  it('拒绝旧主题格式、缺失 token 与危险 CSS token', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const base = store.themes.find(t => t.id === 'default-dark')!;

    expect(() => store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-theme',
      version: 1,
      theme: { name: '旧主题' },
    }))).toThrow('主题文件缺少 v2 主题所需的颜色模式或 token。');

    expect(() => store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '缺字段',
        colorScheme: 'dark',
        tokens: { bg0: '#000' },
      },
    }))).toThrow('主题文件缺少 v2 主题所需的颜色模式或 token。');

    expect(() => store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '危险主题',
        colorScheme: 'dark',
        tokens: {
          ...base.tokens,
          bg0: '#000; } body { color: red',
        },
      },
    }))).toThrow('主题文件缺少 v2 主题所需的颜色模式或 token。');
  });

  it('R10B-16：拒绝能让界面请求外部资源的 token（CSS 转义的 url、image-set、协议地址）', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const base = store.themes.find(t => t.id === 'default-dark')!;
    const attempt = (bg0: string) => () => store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: { name: '外链主题', colorScheme: 'dark', tokens: { ...base.tokens, bg0 } },
    }));

    for (const bad of [
      String.raw`\75 rl(https://evil.example/x.png)`,
      'image-set("https://evil.example/x.png" 1x)',
      '-webkit-image-set("https://evil.example/x.png" 1x)',
      'linear-gradient(red, blue), src("//evil.example/a")',
      '"https://evil.example/a"',
    ]) {
      expect(attempt(bad), bad).toThrow('主题文件缺少 v2 主题所需的颜色模式或 token。');
    }
    // 正常的渐变与带引号的字体名仍可导入
    expect(attempt('linear-gradient(180deg, #111 0%, rgba(0, 0, 0, 0.8) 100%)')).not.toThrow();
  });

  it('深色使用灰蓝底色与冷薄荷 accent', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const defaultDark = store.themes.find(t => t.id === 'default-dark');
    expect(defaultDark).toMatchObject({
      name: '深色',
      colorScheme: 'dark',
      tokens: {
        bg0: '#15181C',
        bg1: '#1E2227',
        sidebarBg: '#121519',
        text1: '#EEF1F4',
        accent: '#7FD6CA',
        onAccent: '#15181C',
      },
    });
  });

  it('包含奶油风主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const creamyMinimal = store.themes.find(t => t.id === 'creamy-minimal');
    expect(creamyMinimal).toMatchObject({
      name: '奶油风',
      colorScheme: 'light',
      tokens: {
        bg0: '#F2E8DA',
        bg1: '#FFFBF5',
        text1: '#463B2F',
        accent: '#5A7A44',
        onAccent: '#FFFBF5',
        hoverOverlay: 'rgba(116, 91, 62, 0.08)',
        radiusLg: '18px',
      },
    });

    store.setTheme('creamy-minimal');
    expect(store.activeId).toBe('creamy-minimal');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { activeId: 'creamy-minimal' },
    });
  });

  it('包含地雷色主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const jiraiKei = store.themes.find(t => t.id === 'jirai-kei');
    expect(jiraiKei).toMatchObject({
      name: '地雷色',
      colorScheme: 'dark',
      tokens: {
        bg0: '#2B2B2B',
        bg1: '#1F1F1F',
        bg2: 'rgba(255, 196, 212, 0.08)',
        sidebarBg: '#1F1F1F',
        border: 'transparent',
        text1: '#FFFFFF',
        accent: '#FFC4D4',
        accent2: '#FFD9E4',
        onAccent: '#2B2B2B',
        hoverOverlay: 'rgba(255, 196, 212, 0.12)',
        success: '#E5A0B5',
        warning: '#FFB38B',
        danger: '#D96C6C',
        radiusLg: '18px',
      },
    });

    store.setTheme('jirai-kei');
    expect(store.activeId).toBe('jirai-kei');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { activeId: 'jirai-kei' },
    });
  });
  it('包含 Claude 浅色与 Claude 夜主题：暖象牙底 + 赤陶 accent', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.themes.find(t => t.id === 'claude')).toMatchObject({
      name: 'Claude',
      colorScheme: 'light',
      tokens: { bg0: '#F0EEE6', bg1: '#FAF9F5', text1: '#1F1E1D', accent: '#BA5A36', onAccent: '#FFFFFF' },
    });
    expect(store.themes.find(t => t.id === 'claude-night')).toMatchObject({
      name: 'Claude 夜',
      colorScheme: 'dark',
      tokens: { bg0: '#1F1E1D', bg1: '#2A2927', text1: '#FAF9F5', accent: '#D97757', onAccent: '#1F1E1D' },
    });

    store.setTheme('claude');
    expect(store.activeId).toBe('claude');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ theme: { activeId: 'claude' } });
  });

  /**
   * 新版界面靠「页面底色 bg0 / 卡片 bg1」分层、靠 accent 做选中与主按钮。
   * 旧浅色 / 深色 / 奶油风两层几乎同色（对比 1.04~1.07）、奶油风主按钮字看不清，
   * 这正是它们放到新界面上显得发灰发糊的原因。这里给所有内置主题立同一道可读性下限。
   */
  it('所有内置主题满足新版界面的可读性下限：文字对比、主按钮文字、卡片与底色分层', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const builtins = store.themes.filter(t => !t.id.startsWith('custom:'));
    expect(builtins.length).toBeGreaterThanOrEqual(8);

    for (const theme of builtins) {
      const t = theme.tokens;
      const bg1 = parseColor(t.bg1);
      const on = (color: string, base = bg1) => composite(parseColor(color), base);
      const accent = on(t.accent);
      const checks = {
        正文: [contrast(on(t.text1), bg1), 7],
        次要文字: [contrast(on(t.text2), bg1), 4.5],
        辅助文字: [contrast(on(t.text3), bg1), 3.5],
        主按钮文字: [contrast(on(t.onAccent, accent), accent), 4.5],
        卡片与底色分层: [contrast(parseColor(t.bg0), bg1), 1.08],
      } as const;
      for (const [label, [value, min]] of Object.entries(checks)) {
        expect(value, `${theme.name}：${label}对比 ${value.toFixed(2)} 低于 ${min}`).toBeGreaterThanOrEqual(min);
      }
    }
  });
});

describe('theme-injector', () => {
  it('applyTheme 把内置主题分别写入同一个 <style id="acu-v2-theme">', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();

    m.injector.applyTheme(store.activeTheme);
    const style1 = document.getElementById(STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(style1).not.toBeNull();
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} {`);
    expect(style1!.textContent).not.toContain(`#${APP_ROOT_ID} *`);
    expect(style1!.textContent).toContain('--acu-bg-0:');
    expect(style1!.textContent).toContain('--acu-sidebar-bg:');
    expect(style1!.textContent).not.toContain('--acu-bg-3:');
    expect(style1!.textContent).toContain('--acu-hover-overlay:');
    expect(style1!.textContent).toContain('--acu-accent:');
    expect(style1!.textContent).not.toContain('--acu-accent-glow-2:');
    expect(style1!.textContent).toContain('--acu-font-ui:');
    expect(style1!.textContent).toContain('--acu-font-mono:');
    expect(style1!.textContent).toContain('scrollbar-color: color-mix(in srgb, var(--acu-text-3) 55%, transparent) transparent;');
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} ::-webkit-scrollbar-thumb`);
    expect(style1!.textContent).toContain('background: color-mix(in srgb, var(--acu-accent) 62%, var(--acu-text-3));');
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} :is(.acu-input, .acu-textarea)::placeholder`);
    expect(style1!.textContent).toContain('-webkit-text-fill-color: var(--acu-text-3) !important;');
    expect(style1!.textContent).toContain('opacity: 1 !important;');
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} :is(.fa, .fas, .far, .fab, .fa-solid, .fa-regular, .fa-brands, [class^="fa-"], [class*=" fa-"])`);
    expect(style1!.textContent).toContain('color: var(--acu-icon-color, currentColor) !important;');

    store.setTheme('default-light');
    m.injector.applyTheme(store.activeTheme);
    const style2 = document.getElementById(STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(style2).toBe(style1); // 同一个节点，textContent 被替换
    expect(style2!.textContent).toContain('#F2F1ED'); // light 的 bg-0

    store.setTheme('creamy-minimal');
    m.injector.applyTheme(store.activeTheme);
    const style3 = document.getElementById(STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(style3).toBe(style1);
    expect(style3!.textContent).toContain('#F2E8DA'); // 奶油风的 bg-0
    expect(style3!.textContent).toContain('#5A7A44'); // 奶油风的 accent
    expect(style3!.textContent).toContain('rgba(116, 91, 62, 0.08)'); // 奶油风的 hover overlay
  });

  it('applyTheme 设置根容器 colorScheme', async () => {
    const root = document.createElement('div');
    root.id = APP_ROOT_ID;
    document.body.appendChild(root);

    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    store.setTheme('default-light');
    m.injector.applyTheme(store.activeTheme);
    expect(root.style.colorScheme).toBe('light');

    store.setTheme('default-dark');
    m.injector.applyTheme(store.activeTheme);
    expect(root.style.colorScheme).toBe('dark');
  });
});
