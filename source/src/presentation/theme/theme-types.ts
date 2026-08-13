// theme/theme-types.ts
// 主题系统类型定义
// 每个主题由 CSS 变量覆盖 + 可选自定义 CSS + 元信息组成

/**
 * 主题元信息 + 样式定义
 *
 * 第三方作者只需实现此接口即可创建自定义主题。
 * 参见 THEME_TEMPLATE.md 获取完整范例。
 */
export interface ACUTheme {
    /** 唯一标识符，格式建议: "@author/theme-name" 或简单字符串 */
    id: string;
    /** 显示名称 */
    name: string;
    /** 简短描述 */
    description: string;
    /** 作者 */
    author: string;
    /** 版本号（语义化） */
    version: string;
    /** 明暗模式，影响浏览器原生表单控件渲染 */
    colorScheme: 'light' | 'dark';

    /**
     * CSS 变量覆盖表。
     * key 是 CSS 变量名（含 -- 前缀），value 是 CSS 值。
     * 这些变量会注入到 #popup 根元素上，覆盖默认值。
     *
     * 必要变量（不提供则使用默认值）：
     *   --acu-bg-0, --acu-bg-1, --acu-bg-2, --acu-bg-3
     *   --acu-border, --acu-border-2
     *   --acu-text-1, --acu-text-2, --acu-text-3
     *   --acu-accent, --acu-accent-2, --acu-accent-glow, --acu-accent-glow-2
     *   --acu-success, --acu-warning, --acu-danger
     *   --acu-radius-lg, --acu-radius-md, --acu-radius-sm
     *   --acu-shadow
     *
     * 兼容变量（用于旧 inline style）：
     *   --background_light, --background_default, --background-color-light
     *   --input-background, --input-text-color
     *   --button-background, --button-secondary-background
     *   --bg-primary, --bg-secondary
     *   --text-main, --text_primary, --text_secondary, --text_tertiary
     *   --text-color, --text-color-dimmed
     *   --border_color, --border_color_light, --border-normal
     *   --warning-color, --error-color
     *   --green, --orange, --red
     *   --accent-primary
     *
     * 扩展模块变量（强烈建议主题作者显式提供）：
     *   --acu-control-bg, --acu-control-text, --acu-select-arrow
     *   --acu-radio-accent, --acu-radio-bg
     *   --acu-checkbox-bg, --acu-checkbox-checked-bg, --acu-checkbox-checked-border, --acu-checkbox-checked-icon
     *   --acu-danger-soft-bg, --acu-danger-soft-border
     *   --acu-overlay-bg, --acu-overlay-backdrop-blur
     *   --acu-confirm-bg, --acu-confirm-border, --acu-confirm-title, --acu-confirm-text
     *   --acu-confirm-cancel-bg, --acu-confirm-cancel-border, --acu-confirm-cancel-text
     *   --acu-confirm-cancel-hover-bg, --acu-confirm-cancel-hover-border, --acu-confirm-cancel-hover-text
     *   --acu-confirm-ok-bg, --acu-confirm-ok-border, --acu-confirm-ok-text
     *   --acu-confirm-ok-hover-bg, --acu-confirm-ok-hover-border
     */
    variables: Record<string, string>;

    /**
     * 可选：自定义 CSS 字符串。
     * 用于覆盖组件级样式（圆角、字体、特效等）。
     * 当前主题导出与模板导出都会显式包含该字段，主题作者可以直接在导出文件中编辑。
     * 
     * 作用域说明：
     * - 写 `#popup` 会被自动替换为弹窗根选择器
     * - 写 `.acu-window` 可覆盖窗口chrome样式
     * - 写 `.acu-toast` 可覆盖提示框样式
     * - 写自定义确认框容器选择器（如 `#xxx-custom-confirm` / `#xxx-custom-confirm-overlay`）可覆盖确认框
     * - 写 `#acu-visualizer-content` 可覆盖可视化编辑器样式
     */
    customCSS?: string;

    /** 可选：字体覆盖 */
    fontFamily?: string;

    /**
     * 可选：覆盖窗口chrome的CSS变量。
     * 窗口chrome使用 --acu-panel-* 变量，默认引用主题变量。
     * 如果需要窗口chrome与弹窗内容使用不同色调，在此覆盖。
     * 
     * 可用变量：
     *   --acu-panel-bg, --acu-panel-border
     *   --acu-panel-text, --acu-panel-text-dim, --acu-panel-text-mute
     *   --acu-panel-accent, --acu-panel-hover, --acu-panel-shadow
     *   --acu-panel-close-hover-bg, --acu-panel-close-hover-border, --acu-panel-close-hover-text
     * 当前主题导出会显式补齐该字段（即使原主题未手写定义），便于二次创作。
     */
    windowChromeVariables?: Record<string, string>;

    /**
     * 可选：覆盖toast提示框样式变量。
     * 
     * 可用变量：
     *   --toast-accent, --toast-bg, --toast-text, --toast-border, --toast-font
     * 当前主题导出会显式补齐该字段（默认空对象），便于主题作者扩展。
     */
    toastVariables?: Record<string, string>;

    /**
     * 可选：覆盖可视化表格编辑器样式变量。
     * 编辑器使用 --acu-viz-* 变量。
     * 
     * 可用变量（举例）：
     *   --acu-viz-bg, --acu-viz-sidebar-bg
     *   --acu-viz-card-bg, --acu-viz-border
     *   --acu-viz-text, --acu-viz-text-dim
     *   --acu-viz-accent
     * 当前主题导出会显式补齐该字段（默认空对象），便于主题作者扩展。
     */
    visualizerVariables?: Record<string, string>;

    /** 可选：主题预览色块（用于UI选择器） */
    previewColors?: {
        bg: string;
        card: string;
        accent: string;
        text: string;
    };
}

/**
 * 可序列化的主题格式（用于导入导出）
 */
export interface ACUThemeFile {
    /** 文件格式版本 */
    formatVersion: 1;
    /** 导出时间 ISO 字符串 */
    exportedAt: string;
    /** 可选：模板元信息，不参与运行时主题应用，仅用于说明这份文件是可编辑模板 */
    templateMeta?: {
        kind: 'editable-theme-template',
        sourceThemeId: string,
        sourceThemeName: string,
        description: string,
    };
    /** 可选：按模块列出的可编辑入口导航 */
    editableModules?: Array<{
        id: string,
        label: string,
        description: string,
        paths: string[],
        status: 'configured' | 'empty' | 'fallback',
    }>;
    /** 可选：简明编辑指南，不参与运行时主题应用 */
    guide?: {
        summary: string,
        recommendedOrder: string[],
        tips: string[],
    };
    /** 主题数据 */
    theme: ACUTheme;
}
