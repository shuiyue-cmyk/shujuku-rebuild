// theme/theme-registry.ts
// 主题注册表：管理内置主题、自定义主题、主题切换、导入导出

import type { ACUTheme, ACUThemeFile } from './theme-types';
import { POPUP_ID_ACU, SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { showToastr_ACU } from './toast';
import { topLevelWindow_ACU } from '../../shared/env';

// 内置主题
import { THEME_DEFAULT_LIGHT } from './builtins/default-light';
import { THEME_DEFAULT_DARK } from './builtins/default-dark';
import { THEME_CLASSICAL_INK } from './builtins/classical-ink';
import { THEME_CLASSICAL_SILK } from './builtins/classical-silk';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

const THEME_STYLE_ID = 'acu-theme-override';
const SETTINGS_KEY = 'uiTheme';
const CUSTOM_THEMES_KEY = 'customThemes';

const EXPORT_TEMPLATE_FILENAME = 'acu-theme-editable-template.json';
const EXPORT_TEMPLATE_SEED: Pick<ACUTheme, 'customCSS' | 'windowChromeVariables' | 'toastVariables' | 'visualizerVariables' | 'previewColors'> = {
    customCSS: [
        '/* 在这里编写组件级覆盖。#popup 会被自动替换为弹窗根选择器。 */',
        '/* .acu-window-header { backdrop-filter: blur(10px); } */',
    ].join('\n'),
    windowChromeVariables: {},
    toastVariables: {},
    visualizerVariables: {},
    previewColors: {
        bg: '#f5f7fa',
        card: '#ffffff',
        accent: '#2563eb',
        text: '#1a2332',
    },
};

// ═══════════════════════════════════════════════════════════════
// 注册表
// ═══════════════════════════════════════════════════════════════

/** 内置主题列表 */
const BUILTIN_THEMES: ACUTheme[] = [
    THEME_DEFAULT_LIGHT,
    THEME_DEFAULT_DARK,
    THEME_CLASSICAL_INK,
    THEME_CLASSICAL_SILK,
];

/** 内置主题 ID 集合（用于区分内置/自定义） */
export const BUILTIN_THEME_IDS: Set<string> = new Set(BUILTIN_THEMES.map(t => t.id));

/** 自定义主题（从设置加载） */
let _customThemes: ACUTheme[] = [];

/**
 * 获取所有可用主题（内置 + 自定义）
 */
export function getAllThemes(): ACUTheme[] {
    return [...BUILTIN_THEMES, ..._customThemes];
}

/**
 * 按 ID 查找主题
 */
export function getThemeById(id: string): ACUTheme | undefined {
    return getAllThemes().find(t => t.id === id);
}

/**
 * 获取当前激活的主题 ID
 */
export function getActiveThemeId(): string {
    return (settings_ACU?.[SETTINGS_KEY] as string) || THEME_DEFAULT_LIGHT.id;
}

/**
 * 设置当前激活的主题 ID 并持久化
 */
export function setActiveThemeId(id: string): void {
    if (!settings_ACU) return;
    (settings_ACU as any)[SETTINGS_KEY] = id;
    saveSettingsAndNotify_ACU();
}

// ═══════════════════════════════════════════════════════════════
// 主题应用
// ═══════════════════════════════════════════════════════════════

/**
 * 将主题应用到 DOM。
 * 通过注入/更新 <style> 块覆盖 CSS 变量。
 */
export function applyTheme(themeId?: string): void {
    const id = themeId || getActiveThemeId();
    const theme = getThemeById(id);

    if (!theme) {
        logWarn_ACU(`[ThemeRegistry] Theme "${id}" not found, falling back to default`);
        applyThemeToDOM(THEME_DEFAULT_LIGHT);
        return;
    }

    applyThemeToDOM(theme);
    logDebug_ACU(`[ThemeRegistry] Applied theme: ${theme.name} (${theme.id})`);
}

/**
 * 根据主题对象生成完整的 CSS 字符串。
 * 包含 popup 变量、window chrome 变量、toast、confirm、visualizer、customCSS。
 * 此函数不操作 DOM，仅返回 CSS 文本。
 * 用于：① 预注入到 popupHtml 消除 FOUC  ② applyThemeToDOM 中复用
 */
export function buildThemeCSS_ACU(theme: ACUTheme): string {
    const varDeclarations = Object.entries(theme.variables)
        .map(([key, value]) => `    ${key}: ${value};`)
        .join('\n');

    let css = `#${POPUP_ID_ACU} {\n${varDeclarations}\n}`;

    // 窗口 chrome 核心主题变量
    css += `\n.acu-window {\n${varDeclarations}\n}`;

    // color-scheme 和 font-family
    css += `\n#${POPUP_ID_ACU} { color-scheme: ${theme.colorScheme};`;
    if (theme.fontFamily) {
        css += ` font-family: ${theme.fontFamily};`;
    }
    css += ` }`;

    css += `\n.acu-window { color-scheme: ${theme.colorScheme};`;
    if (theme.fontFamily) {
        css += ` font-family: ${theme.fontFamily};`;
    }
    css += ` }`;

    // 追加自定义 CSS
    if (theme.customCSS) {
        const customCSS = theme.customCSS.replace(/#popup\b/g, `#${POPUP_ID_ACU}`);
        css += '\n' + customCSS;
    }

    // 窗口chrome变量覆盖
    if (theme.windowChromeVariables) {
        const chromeVars = Object.entries(theme.windowChromeVariables)
            .map(([key, value]) => `    ${key}: ${value};`)
            .join('\n');
        css += `\n.acu-window {\n${chromeVars}\n}`;
    }

    // Toast 变量覆盖
    {
        const toastVarNames = [
            '--acu-accent', '--acu-bg-1', '--acu-text-1', '--acu-border',
            '--acu-accent-2', '--acu-bg-0', '--acu-text-2', '--acu-text-3',
            '--acu-border-2',
        ];
        const toastBaseVars = toastVarNames
            .filter(key => theme.variables[key])
            .map(key => `    ${key}: ${theme.variables[key]};`)
            .join('\n');
        const customToastVars = theme.toastVariables
            ? Object.entries(theme.toastVariables)
                .map(([key, value]) => `    ${key}: ${value};`)
                .join('\n')
            : '';
        if (toastBaseVars || customToastVars) {
            css += `\n#toast-container .acu-toast.toast {\n${toastBaseVars}${customToastVars ? '\n' + customToastVars : ''}\n}`;
        }
    }

    // 确认弹窗变量注入
    {
        const confirmVarNames = [
            '--acu-accent', '--acu-bg-1', '--acu-bg-0', '--acu-text-1',
            '--acu-text-2', '--acu-text-3', '--acu-border', '--acu-border-2',
            '--acu-radius-lg', '--acu-radius-md', '--acu-shadow',
            '--acu-confirm-bg', '--acu-confirm-border', '--acu-confirm-title', '--acu-confirm-text',
            '--acu-confirm-cancel-bg', '--acu-confirm-cancel-border', '--acu-confirm-cancel-text',
            '--acu-confirm-cancel-hover-bg', '--acu-confirm-cancel-hover-border', '--acu-confirm-cancel-hover-text',
            '--acu-confirm-ok-bg', '--acu-confirm-ok-border', '--acu-confirm-ok-text',
            '--acu-confirm-ok-hover-bg', '--acu-confirm-ok-hover-border',
            '--acu-overlay-bg', '--acu-overlay-backdrop-blur',
        ];
        const confirmVars = confirmVarNames
            .filter(key => theme.variables[key])
            .map(key => `    ${key}: ${theme.variables[key]};`)
            .join('\n');
        if (confirmVars) {
            css += `\n#${SCRIPT_ID_PREFIX_ACU}-custom-confirm-overlay,\n#${SCRIPT_ID_PREFIX_ACU}-custom-confirm {\n${confirmVars}\n}`;
        }
    }

    // Visualizer 变量覆盖
    {
        const visualizerBaseVarNames = [
            '--acu-bg-0', '--acu-bg-1', '--acu-bg-2', '--acu-bg-3',
            '--acu-border', '--acu-border-2',
            '--acu-text-1', '--acu-text-2', '--acu-text-3',
            '--acu-accent', '--acu-accent-2', '--acu-accent-glow', '--acu-accent-glow-2',
            '--acu-success', '--acu-warning', '--acu-danger',
            '--acu-radius-lg', '--acu-radius-md', '--acu-radius-sm', '--acu-shadow',
        ];
        const visualizerBaseVars = visualizerBaseVarNames
            .filter(key => theme.variables[key])
            .map(key => `    ${key}: ${theme.variables[key]};`)
            .join('\n');
        const vizVars = theme.visualizerVariables
            ? Object.entries(theme.visualizerVariables)
                .map(([key, value]) => `    ${key}: ${value};`)
                .join('\n')
            : '';
        if (visualizerBaseVars || vizVars) {
            css += `\n#acu-visualizer-content {\n${visualizerBaseVars}${vizVars ? '\n' + vizVars : ''}\n}`;
        }
    }

    return css;
}

/**
 * 获取当前主题的完整 CSS 字符串（用于预注入消除 FOUC）。
 * 在 popup 创建之前调用，确保首帧即包含正确的主题样式。
 */
export function getThemeCSS_ACU(themeId?: string): string {
    const id = themeId || getActiveThemeId();
    const theme = getThemeById(id);
    if (!theme) {
        return buildThemeCSS_ACU(THEME_DEFAULT_LIGHT);
    }
    return buildThemeCSS_ACU(theme);
}

/**
 * 实际将主题变量写入 DOM
 * 复用 buildThemeCSS_ACU 生成 CSS，注入到正确位置
 */
function applyThemeToDOM(theme: ACUTheme): void {
    const targetDoc = (topLevelWindow_ACU || window).document;
    let existingStyle = targetDoc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;

    if (!existingStyle) {
        existingStyle = targetDoc.createElement('style');
        existingStyle.id = THEME_STYLE_ID;
    }

    // 主题覆盖样式必须常驻主文档，而不是挂在 [`#popup`](src/presentation/pages/main-popup.ts:75)
    // 内部。否则主界面一关闭，整个 style 节点会跟着被移除，随后出现的 toast / confirm /
    // visualizer 首帧就会退回基础 UI。这个问题不是视觉细节，而是主题注入作用域设计错了。
    if (existingStyle.parentNode !== targetDoc.head) {
        targetDoc.head.appendChild(existingStyle);
    }

    existingStyle.textContent = buildThemeCSS_ACU(theme);
}

// ═══════════════════════════════════════════════════════════════
// 自定义主题管理
// ═══════════════════════════════════════════════════════════════

/**
 * 加载自定义主题（从设置中恢复）
 */
export function loadCustomThemes(): void {
    if (!settings_ACU) return;
    const stored = settings_ACU[CUSTOM_THEMES_KEY];
    if (Array.isArray(stored)) {
        _customThemes = stored as ACUTheme[];
        logDebug_ACU(`[ThemeRegistry] Loaded ${_customThemes.length} custom themes`);
    }
}

/**
 * 添加自定义主题并持久化
 */
export function addCustomTheme(theme: ACUTheme): boolean {
    // 校验
    if (!theme.id || !theme.name || !theme.variables) {
        showToastr_ACU('error', '主题格式不合法：缺少 id、name 或 variables');
        return false;
    }

    // 检查 ID 冲突
    if (getThemeById(theme.id)) {
        showToastr_ACU('error', `主题 ID "${theme.id}" 已存在，请使用不同的 ID`);
        return false;
    }

    _customThemes.push(theme);
    persistCustomThemes();
    showToastr_ACU('success', `主题 "${theme.name}" 已导入`);
    return true;
}

/**
 * 删除自定义主题
 */
export function removeCustomTheme(id: string): boolean {
    const idx = _customThemes.findIndex(t => t.id === id);
    if (idx === -1) {
        showToastr_ACU('error', `未找到主题 "${id}"`);
        return false;
    }

    // 如果正在使用该主题，切回默认
    if (getActiveThemeId() === id) {
        setActiveThemeId(THEME_DEFAULT_LIGHT.id);
        applyTheme(THEME_DEFAULT_LIGHT.id);
    }

    const name = _customThemes[idx].name;
    _customThemes.splice(idx, 1);
    persistCustomThemes();
    showToastr_ACU('success', `主题 "${name}" 已删除`);
    return true;
}

/**
 * 持久化自定义主题到设置
 */
function persistCustomThemes(): void {
    if (!settings_ACU) return;
    (settings_ACU as any)[CUSTOM_THEMES_KEY] = _customThemes;
    saveSettingsAndNotify_ACU();
}

// ═══════════════════════════════════════════════════════════════
// 导入导出
// ═══════════════════════════════════════════════════════════════

/**
 * 从 JSON 文件导入主题
 */
export function importThemeFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const raw = JSON.parse(e.target?.result as string) as ACUThemeFile;

                if (raw.formatVersion !== 1) {
                    showToastr_ACU('error', '不支持的主题文件格式版本');
                    return;
                }

                if (!raw.theme?.id || !raw.theme?.name || !raw.theme?.variables) {
                    showToastr_ACU('error', '主题文件缺少必要字段');
                    return;
                }

                // 如果 ID 冲突，自动重命名
                const existing = getThemeById(raw.theme.id);
                if (existing) {
                    raw.theme.id = `${raw.theme.id}-imported-${Date.now()}`;
                    raw.theme.name = `${raw.theme.name} (导入)`;
                }

                if (addCustomTheme(raw.theme)) {
                    // 导入后自动切换到新主题
                    setActiveThemeId(raw.theme.id);
                    applyTheme(raw.theme.id);
                    // 刷新选择器（通过事件通知）
                    document.dispatchEvent(new CustomEvent('acu-theme-changed'));
                }
            } catch (err) {
                logError_ACU('[ThemeRegistry] Failed to parse theme file:', err);
                showToastr_ACU('error', '主题文件解析失败');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function createThemeTemplateBase(): ACUTheme {
    return createExportableTheme({
            // ═══ 元信息（必填）═══
            id: 'my-custom-theme',          // 唯一ID，建议格式: "@author/theme-name"
            name: '我的自定义主题',           // 显示名称
            description: '在此描述你的主题风格', // 简短描述
            author: '你的名字',
            version: '1.0.0',
            colorScheme: 'light',            // 'light' 或 'dark'，影响浏览器原生控件渲染

            // ═══ 核心颜色变量（必填）═══
            // 这些变量控制弹窗内所有组件的颜色
            variables: {
                // --- 背景色 ---
                '--acu-bg-0': '#f5f7fa',                  // 页面底色（最深层背景）
                '--acu-bg-1': '#ffffff',                  // 卡片/面板背景
                '--acu-bg-2': 'rgba(0, 0, 0, 0.03)',     // 次级背景（hover、分组底色）
                '--acu-bg-3': 'rgba(0, 0, 0, 0.05)',     // 三级背景（强调区块）

                // --- 边框 ---
                '--acu-border': '#e0e4ea',                // 主边框色
                '--acu-border-2': '#c8cdd5',              // 强边框色（输入框聚焦、按钮边框）

                // --- 文字 ---
                '--acu-text-1': '#1a2332',                // 主文字（标题、重要信息）
                '--acu-text-2': '#4a5568',                // 次级文字（描述、标签）
                '--acu-text-3': '#8896a8',                // 辅助文字（备注、placeholder）

                // --- 强调色 ---
                '--acu-accent': '#2563eb',                 // 主强调色（按钮、选中态、链接）
                '--acu-accent-2': '#3b82f6',              // 次强调色（渐变、hover态）
                '--acu-accent-glow': 'rgba(37, 99, 235, 0.12)',  // 强调色光晕（按钮背景、标记）
                '--acu-accent-glow-2': 'rgba(59, 130, 246, 0.10)', // 次光晕

                // --- 语义色 ---
                '--acu-success': '#10b981',               // 成功/确认
                '--acu-warning': '#f59e0b',               // 警告/注意
                '--acu-danger': '#ef4444',                // 危险/删除/错误

                // --- 圆角 ---
                '--acu-radius-lg': '10px',                // 大圆角（卡片、弹窗header）
                '--acu-radius-md': '8px',                 // 中圆角（输入框、select）
                '--acu-radius-sm': '6px',                 // 小圆角（按钮、tag）

                // --- 阴影 ---
                '--acu-shadow': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',

                // ═══ 兼容变量（强烈建议完整提供）═══
                // 部分旧组件的 inline style 仍使用这些变量名
                '--bg-primary': 'var(--acu-bg-0)',
                '--bg-secondary': 'var(--acu-bg-1)',
                '--background_light': 'rgba(0,0,0,0.02)',
                '--background_default': '#ffffff',
                '--background-color-light': 'rgba(0,0,0,0.02)',
                '--input-background': '#ffffff',
                '--input-text-color': 'var(--acu-text-1)',
                '--button-background': '#ffffff',
                '--button-secondary-background': '#f8f9fb',
                '--text-main': 'var(--acu-text-1)',
                '--text_primary': 'var(--acu-text-1)',
                '--text_secondary': 'var(--acu-text-2)',
                '--text_tertiary': 'var(--acu-text-3)',
                '--text-color': 'var(--acu-text-1)',
                '--text-color-dimmed': 'var(--acu-text-3)',
                '--border_color': 'var(--acu-border)',
                '--border_color_light': 'var(--acu-border)',
                '--border-normal': 'var(--acu-border-2)',
                '--warning-color': 'var(--acu-warning)',
                '--error-color': 'var(--acu-danger)',
                '--green': 'var(--acu-success)',
                '--orange': 'var(--acu-warning)',
                '--red': 'var(--acu-danger)',
                '--accent-primary': 'var(--acu-accent)',

                // ═══ 控件与交互扩展变量（建议完整提供）═══
                '--acu-control-bg': '#ffffff',
                '--acu-control-text': 'var(--acu-text-1)',
                '--acu-select-arrow': 'var(--acu-text-2)',
                '--acu-radio-accent': 'var(--acu-accent)',
                '--acu-radio-bg': 'var(--acu-control-bg)',
                '--acu-checkbox-bg': 'var(--acu-control-bg)',
                '--acu-checkbox-checked-bg': 'var(--acu-accent)',
                '--acu-checkbox-checked-border': 'var(--acu-accent)',
                '--acu-checkbox-checked-icon': '#ffffff',
                '--acu-danger-soft-bg': 'rgba(239, 68, 68, 0.08)',
                '--acu-danger-soft-border': 'rgba(239, 68, 68, 0.25)',
                '--acu-overlay-bg': 'rgba(0, 0, 0, 0.16)',
                '--acu-overlay-backdrop-blur': '3px',
                '--acu-confirm-bg': 'var(--acu-bg-1)',
                '--acu-confirm-border': 'var(--acu-border)',
                '--acu-confirm-title': 'var(--acu-text-1)',
                '--acu-confirm-text': 'var(--acu-text-2)',
                '--acu-confirm-cancel-bg': 'transparent',
                '--acu-confirm-cancel-border': 'var(--acu-border-2)',
                '--acu-confirm-cancel-text': 'var(--acu-text-2)',
                '--acu-confirm-cancel-hover-bg': 'var(--acu-bg-2)',
                '--acu-confirm-cancel-hover-border': 'var(--acu-border)',
                '--acu-confirm-cancel-hover-text': 'var(--acu-text-1)',
                '--acu-confirm-ok-bg': 'rgba(37, 99, 235, 0.08)',
                '--acu-confirm-ok-border': 'rgba(37, 99, 235, 0.30)',
                '--acu-confirm-ok-text': 'var(--acu-accent)',
                '--acu-confirm-ok-hover-bg': 'rgba(37, 99, 235, 0.14)',
                '--acu-confirm-ok-hover-border': 'rgba(37, 99, 235, 0.45)',
            },

            // ═══ 字体（可选）═══
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',

            // ═══ 自定义CSS（可选，高级）═══
            // 可以覆盖任何组件级样式。#popup 会被自动替换为弹窗根选择器。
            customCSS: [
                '/* ═══ 组件级样式覆盖示例 ═══ */',
                '',
                '/* 自定义窗口顶部 chrome */',
                '/* .acu-window-header { backdrop-filter: blur(10px); } */',
                '/* .acu-window-title { letter-spacing: 0.08em; } */',
                '',
                '/* 调整导航栏宽度 */',
                '/* #popup .acu-tabs-nav { min-width: 160px; } */',
                '',
                '/* 修改卡片内边距 */',
                '/* #popup .acu-card { padding: 16px; } */',
                '',
                '/* 自定义按钮悬停效果 */',
                '/* #popup button.primary:hover { filter: brightness(1.1); } */',
                '',
                '/* 修改表格样式 */',
                '/* #popup table th { background: var(--acu-bg-2); } */',
                '',
                '/* 修改输入框聚焦效果 */',
                '/* #popup input:focus, #popup textarea:focus, #popup select:focus {',
                '  outline: 2px solid var(--acu-accent);',
                '  outline-offset: -1px;',
                '} */',
                '',
                '/* 自定义确认框 */',
                '/* #your-prefix-custom-confirm { border-radius: 18px; } */',
                '/* #your-prefix-custom-confirm-overlay { backdrop-filter: blur(8px); } */',
                '',
                '/* 自定义 checkbox / radio / select */',
                '/* #popup input[type="checkbox"] { border-radius: 5px !important; } */',
                '/* #popup .qrf_radio_group input[type="radio"] { transform: scale(1.05); } */',
                '/* #popup select { background-size: 7px 7px, 7px 7px; } */',
            ].join('\n'),

            // ═══ 窗口标题栏样式（可选）═══
            // 窗口标题栏使用 --acu-panel-* 变量，默认从主题变量引用。
            // 如果需要标题栏与内容区使用不同色调，在此覆盖。
            windowChromeVariables: {
                // '--acu-panel-bg': 'var(--acu-bg-0)',
                // '--acu-panel-border': 'var(--acu-border)',
                // '--acu-panel-text': 'var(--acu-text-1)',
                // '--acu-panel-text-dim': 'var(--acu-text-2)',
                // '--acu-panel-text-mute': 'var(--acu-text-3)',
                // '--acu-panel-accent': 'var(--acu-accent)',
                // '--acu-panel-hover': 'var(--acu-bg-2)',
                // '--acu-panel-shadow': 'var(--acu-shadow)',
                // '--acu-panel-close-hover-bg': 'var(--acu-danger-soft-bg)',
                // '--acu-panel-close-hover-border': 'var(--acu-danger-soft-border)',
                // '--acu-panel-close-hover-text': 'var(--acu-danger)',
            },

            // ═══ Toast 提示框样式（可选）═══
            // 提示框默认使用主题核心色。如果需要独立定制，在此覆盖。
            toastVariables: {
                // '--toast-accent': 'var(--acu-accent)',
                // '--toast-bg': 'var(--acu-bg-1)',
                // '--toast-text': 'var(--acu-text-1)',
                // '--toast-border': 'var(--acu-border)',
            },

            // ═══ 可视化编辑器样式（可选）═══
            // 表格可视化编辑器的独立样式变量
            visualizerVariables: {
                // '--acu-viz-bg': 'var(--acu-bg-0)',
                // '--acu-viz-sidebar-bg': 'var(--acu-bg-1)',
                // '--acu-viz-card-bg': 'var(--acu-bg-1)',
                // '--acu-viz-border': 'var(--acu-border)',
                // '--acu-viz-text': 'var(--acu-text-1)',
                // '--acu-viz-text-dim': 'var(--acu-text-3)',
                // '--acu-viz-accent': 'var(--acu-accent)',
            },

            // ═══ 预览色块（可选）═══
            // 在主题选择下拉框中显示的颜色预览
            previewColors: {
                bg: '#f5f7fa',
                card: '#ffffff',
                accent: '#2563eb',
                text: '#1a2332',
            },
        });
}

function createEditableThemeTemplate(theme: ACUTheme): ACUTheme {
    const templateBase = createThemeTemplateBase();

    return createExportableTheme({
        ...templateBase,
        ...theme,
        variables: {
            ...templateBase.variables,
            ...theme.variables,
        },
        windowChromeVariables: {
            ...(templateBase.windowChromeVariables ?? {}),
            ...(theme.windowChromeVariables ?? {}),
        },
        toastVariables: {
            ...(templateBase.toastVariables ?? {}),
            ...(theme.toastVariables ?? {}),
        },
        visualizerVariables: {
            ...(templateBase.visualizerVariables ?? {}),
            ...(theme.visualizerVariables ?? {}),
        },
        customCSS: theme.customCSS ?? templateBase.customCSS,
        previewColors: theme.previewColors ?? templateBase.previewColors,
    });
}

function buildEditableModules(theme: ACUTheme): NonNullable<ACUThemeFile['editableModules']> {
    return [
        {
            id: 'core-variables',
            label: '核心颜色变量',
            description: '页面背景、文字、边框、强调色、语义色与圆角阴影。主题的主体风格由这里决定。',
            paths: ['theme.variables'],
            status: Object.keys(theme.variables || {}).length > 0 ? 'configured' : 'fallback',
        },
        {
            id: 'window-chrome',
            label: '窗口顶部 chrome',
            description: '独立窗口标题栏、按钮 hover、阴影与边框的专用覆盖。',
            paths: ['theme.windowChromeVariables'],
            status: Object.keys(theme.windowChromeVariables || {}).length > 0 ? 'configured' : 'empty',
        },
        {
            id: 'toast',
            label: 'Toast 提示框',
            description: '提示框的独立颜色入口；为空时回退到核心主题变量。',
            paths: ['theme.toastVariables'],
            status: Object.keys(theme.toastVariables || {}).length > 0 ? 'configured' : 'empty',
        },
        {
            id: 'visualizer',
            label: '可视化编辑器',
            description: '表格可视化编辑器的独立颜色入口；为空时回退到核心主题变量。',
            paths: ['theme.visualizerVariables'],
            status: Object.keys(theme.visualizerVariables || {}).length > 0 ? 'configured' : 'empty',
        },
        {
            id: 'controls-confirm-overlay',
            label: '控件 / 确认框 / 遮罩层',
            description: 'select、checkbox、radio、confirm、overlay 目前通过 theme.variables 中的 --acu-control-* / --acu-confirm-* / --acu-overlay-* 变量控制。',
            paths: [
                'theme.variables.--acu-control-*',
                'theme.variables.--acu-confirm-*',
                'theme.variables.--acu-overlay-*',
            ],
            status: 'configured',
        },
        {
            id: 'custom-css',
            label: '组件级细节覆盖',
            description: '当变量不够时，在 customCSS 中覆盖具体组件样式。',
            paths: ['theme.customCSS'],
            status: theme.customCSS && theme.customCSS.trim() ? 'configured' : 'empty',
        },
        {
            id: 'preview',
            label: '主题预览色块',
            description: '主题选择器中显示的预览色，不影响实际运行样式。',
            paths: ['theme.previewColors'],
            status: theme.previewColors ? 'configured' : 'empty',
        },
    ];
}

function buildEditableGuide(theme: ACUTheme): NonNullable<ACUThemeFile['guide']> {
    return {
        summary: `这是一份基于当前主题「${theme.name}」生成的完整可编辑模板。你可以直接修改 theme 下的字段，然后重新导入。`,
        recommendedOrder: [
            '先修改 theme.variables 中的核心颜色变量，建立整体色板',
            '再按需修改 theme.windowChromeVariables / theme.toastVariables / theme.visualizerVariables',
            '最后在 theme.customCSS 中处理局部特效、版式和组件级细节',
        ],
        tips: [
            'theme.variables 是运行时主题的主入口；里面的 --acu-control-* / --acu-confirm-* / --acu-overlay-* 控制表单控件、确认框和遮罩层。',
            'windowChromeVariables / toastVariables / visualizerVariables 即使当前为空，也可以直接补充自定义值。',
            '导入时系统只读取根级 theme 对象；templateMeta / editableModules / guide 只是给你看的编辑导航，不会影响运行。',
        ],
    };
}

/**
 * 导出当前主题为完整可编辑主题模板
 * 结果 = 空白模板骨架 + 当前主题内容覆盖
 */
export function exportThemeToFile(themeId: string): void {
    const theme = getThemeById(themeId);
    if (!theme) {
        showToastr_ACU('error', `未找到主题 "${themeId}"`);
        return;
    }

    const file: ACUThemeFile = {
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        templateMeta: {
            kind: 'editable-theme-template',
            sourceThemeId: theme.id,
            sourceThemeName: theme.name,
            description: '基于当前主题生成的完整可编辑模板，适合二次修改后重新导入。',
        },
        editableModules: buildEditableModules(theme),
        guide: buildEditableGuide(theme),
        theme: createEditableThemeTemplate(theme),
    };

    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `acu-theme-template-${theme.id}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToastr_ACU('success', `主题「${theme.name}」的完整可编辑模板已导出`);
}

function createExportableTheme(theme: ACUTheme): ACUTheme {
    return {
        ...theme,
        customCSS: theme.customCSS ?? EXPORT_TEMPLATE_SEED.customCSS,
        windowChromeVariables: theme.windowChromeVariables ?? {},
        toastVariables: theme.toastVariables ?? {},
        visualizerVariables: theme.visualizerVariables ?? {},
        previewColors: theme.previewColors ?? EXPORT_TEMPLATE_SEED.previewColors,
    };
}
