<script setup lang="ts">
/**
 * Claude 风格（外观 → 界面风格 → Claude）。
 *
 * 一份全局样式，全部限定在 .ub-app[data-ub-style="claude"] 之下，不改组件行为。
 * 按公开的 Claude 界面设计规范对齐（品牌标识除外：不含品牌字体、图标、标志）：
 * - 配色：自带浅 / 深两套色板（见 theme/effective-theme.ts），四层表面阶梯，陶土强调色，低透明度墨色边线；
 * - 尺寸：控件 32 / 28px，按钮 8px、卡片 16px、子面板 10–12px、弹窗 16px、输入框 20px 圆角；
 *   侧栏 288px，45px 标题栏，正文版心 768px；
 * - 字阶：说明 11 / 12、正文 13 / 14、小标题 15、页面标题 20、问候语 38（衬线）；
 * - 边界：单闭合边框原则——卡片用 1px 外环投影代替描边，卡片内的次级按钮不再描边；
 * - 动效：60 / 120 / 200 / 300ms 时序，ease-out 与回弹曲线，聚焦用陶土三层光环；
 * - 对话：续写页按会话流排版——用户气泡、无底色回复、圆角输入框。
 */
</script>

<style>
/* ═══════════════ 色板（规范令牌） ═══════════════ */
.ub-app[data-ub-style="claude"][data-ub-color-scheme="light"] {
  --cds-surface-0: #f5f5f3;
  --cds-surface-1: #fcfcfb;
  --cds-surface-2: #ffffff;
  --cds-surface-3: #ffffff;
  --cds-surface-popover: #ffffff;
  --cds-clay: #d97757;
  --cds-clay-hover: #cc5a36;
  --cds-clay-ink: #c4532f;
  --cds-clay-light: #fbf3ef;
  --cds-alpha-1: hsla(0, 0%, 8%, 0.05);
  --cds-alpha-2: hsla(0, 0%, 8%, 0.10);
  --cds-alpha-3: hsla(0, 0%, 8%, 0.20);
  --cds-alpha-4: hsla(0, 0%, 8%, 0.35);
  --cds-fill-secondary: rgba(0, 0, 0, 0.06);
  --cds-fill-secondary-hover: rgba(0, 0, 0, 0.10);
  --cds-text-primary: #151515;
  --cds-text-secondary: #525252;
  --cds-text-muted: #767676;
  --cds-bg-tint-blue: #f0f4f8;
  --cds-segmented-track: rgba(0, 0, 0, 0.06);
  --cds-segmented-thumb: #ffffff;
  --cds-success: #2f8a57;
  --cds-warning: #b26b12;
  --cds-danger: #dc2626;
  --cds-danger-fill: #dc2626;
  --cds-danger-fill-hover: #b91c1c;
  --cds-shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05), 0 2px 8px 0 rgba(0, 0, 0, 0.06);
  --cds-shadow-md: 0 2px 4px 0 rgba(0, 0, 0, 0.05), 0 6px 16px 0 rgba(0, 0, 0, 0.08);
  --cds-shadow-lg: 0 4px 8px 0 rgba(0, 0, 0, 0.06), 0 12px 28px -2px rgba(0, 0, 0, 0.08);
  --cds-shadow-popover: 0 0 0 1px var(--cds-alpha-2), 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08);
  --cds-panel-shadow: 0 0 0 1px var(--cds-alpha-2), 0 1px 2px rgba(0, 0, 0, 0.04);
  --cds-panel-shadow-hover: 0 0 0 1px var(--cds-alpha-3), 0 4px 16px -2px rgba(0, 0, 0, 0.09);
  --cds-shadow-composer: 0 4px 20px rgba(0, 0, 0, 0.035), inset 0 0 0 1px var(--cds-alpha-2);
  --cds-shadow-composer-hover: 0 4px 24px rgba(0, 0, 0, 0.06), inset 0 0 0 1px var(--cds-alpha-3);
  --cds-shadow-composer-focus: 0 4px 24px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--cds-alpha-3), 0 0 0 1px var(--cds-alpha-3);
  --cds-focus-shadow: inset 0 0 0 1px var(--cds-surface-1), 0 0 0 1.5px var(--cds-clay), 0 0 6px 1px rgba(217, 119, 87, 0.25);
  --cds-scrim: rgba(0, 0, 0, 0.30);
}

.ub-app[data-ub-style="claude"][data-ub-color-scheme="dark"] {
  --cds-surface-0: #0b0b0a;
  --cds-surface-1: #151515;
  --cds-surface-2: #1a1a19;
  --cds-surface-3: #20201e;
  --cds-surface-popover: #222220;
  --cds-clay: #d97757;
  --cds-clay-hover: #e08264;
  --cds-clay-ink: #e08264;
  --cds-clay-light: rgba(217, 119, 87, 0.15);
  --cds-alpha-1: hsla(0, 0%, 100%, 0.05);
  --cds-alpha-2: hsla(0, 0%, 100%, 0.09);
  --cds-alpha-3: hsla(0, 0%, 100%, 0.18);
  --cds-alpha-4: hsla(0, 0%, 100%, 0.30);
  --cds-fill-secondary: rgba(255, 255, 255, 0.10);
  --cds-fill-secondary-hover: rgba(255, 255, 255, 0.15);
  --cds-text-primary: #f5f5f5;
  --cds-text-secondary: #a3a3a3;
  --cds-text-muted: #8a8a87;
  --cds-bg-tint-blue: rgba(255, 255, 255, 0.06);
  --cds-segmented-track: rgba(255, 255, 255, 0.08);
  --cds-segmented-thumb: #2c2c2a;
  --cds-success: #5fb37f;
  --cds-warning: #e0a54b;
  --cds-danger: #f87171;
  --cds-danger-fill: #dc2626;
  --cds-danger-fill-hover: #ef4444;
  --cds-shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 2px 8px 0 rgba(0, 0, 0, 0.4);
  --cds-shadow-md: 0 2px 4px 0 rgba(0, 0, 0, 0.4), 0 6px 16px 0 rgba(0, 0, 0, 0.4);
  --cds-shadow-lg: 0 4px 8px 0 rgba(0, 0, 0, 0.5), 0 16px 36px -2px rgba(0, 0, 0, 0.4);
  --cds-shadow-popover: inset 0 0 0 1px rgba(255, 255, 255, 0.10), 0 8px 28px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.45);
  --cds-panel-shadow: inset 0 0 0 1px var(--cds-alpha-2), 0 1px 2px rgba(0, 0, 0, 0.4);
  --cds-panel-shadow-hover: inset 0 0 0 1px var(--cds-alpha-3), 0 6px 20px rgba(0, 0, 0, 0.6);
  --cds-shadow-composer: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 0 0 1px var(--cds-alpha-2);
  --cds-shadow-composer-hover: 0 4px 24px rgba(0, 0, 0, 0.55), inset 0 0 0 1px var(--cds-alpha-3);
  --cds-shadow-composer-focus: 0 4px 24px rgba(0, 0, 0, 0.65), inset 0 0 0 1px rgba(255, 255, 255, 0.22), 0 0 0 1px rgba(255, 255, 255, 0.22);
  --cds-focus-shadow: inset 0 0 0 1px var(--cds-surface-1), 0 0 0 1.5px var(--cds-clay), 0 0 8px 2px rgba(217, 119, 87, 0.35);
  --cds-scrim: rgba(0, 0, 0, 0.55);
}

/* ═══════════════ 令牌映射：外壳与组件只认 --ub-* ═══════════════ */
.ub-app[data-ub-style="claude"] {
  --cds-dur-fast: 60ms;
  --cds-dur-snap: 120ms;
  --cds-dur-base: 200ms;
  --cds-dur-sheet: 300ms;
  --cds-ease-out: cubic-bezier(0.165, 0.84, 0.44, 1);
  --cds-ease-snap: cubic-bezier(0.32, 0.72, 0, 1);
  --cds-ease-overshoot: cubic-bezier(0.34, 1.3, 0.64, 1);
  --cds-ease-hover: cubic-bezier(0.16, 1, 0.3, 1);
  --cds-font-serif: ui-serif, Georgia, Cambria, "Times New Roman", "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif;

  /* 字阶：说明 11 / 12，正文 13 / 14，小标题 15，标题 20 */
  --ub-fs-2xs: calc(var(--ub-u) * 11);
  --ub-fs-xs: calc(var(--ub-u) * 12);
  --ub-fs-sm: calc(var(--ub-u) * 13);
  --ub-fs-md: calc(var(--ub-u) * 14);
  --ub-fs-lg: calc(var(--ub-u) * 15);
  --ub-fs-xl: calc(var(--ub-u) * 20);
  --ub-fs-2xl: calc(var(--ub-u) * 20);

  --ub-control-h: calc(var(--ub-u) * 32);
  --ub-control-h-sm: calc(var(--ub-u) * 28);
  --ub-rail-w: calc(var(--ub-u) * 288);
  --ub-rail-w-collapsed: calc(var(--ub-u) * 60);
  --ub-titlebar-h: calc(var(--ub-u) * 45);
  --ub-page-max: calc(var(--ub-u) * 768);
  --ub-r-card: 16px;
  --ub-r-panel: 10px;
  --ub-r-control: 8px;
  --ub-r-overlay: 16px;

  --ub-bg: var(--cds-surface-1);
  --ub-nav-bg: var(--cds-surface-0);
  --ub-panel: var(--cds-surface-2);
  --ub-input-bg: var(--cds-surface-3);
  --ub-sunken: var(--cds-alpha-1);
  --ub-hover: var(--cds-alpha-1);
  --ub-selected: var(--cds-alpha-2);
  --ub-hover-strong: var(--cds-fill-secondary-hover);
  --ub-line: var(--cds-alpha-2);
  --ub-line-soft: var(--cds-alpha-2);
  --ub-line-strong: var(--cds-alpha-3);
  --ub-text: var(--cds-text-primary);
  --ub-text-2: var(--cds-text-secondary);
  --ub-text-3: var(--cds-text-muted);
  --ub-accent: var(--cds-clay);
  --ub-accent-2: var(--cds-clay-hover);
  --ub-accent-ink: var(--cds-clay-ink);
  --ub-on-accent: #ffffff;
  --ub-accent-soft: var(--cds-clay-light);
  --ub-accent-soft-2: color-mix(in srgb, var(--cds-clay) 22%, transparent);
  --ub-ok: var(--cds-success);
  --ub-ok-soft: color-mix(in srgb, var(--cds-success) 12%, transparent);
  --ub-warn: var(--cds-warning);
  --ub-warn-soft: color-mix(in srgb, var(--cds-warning) 13%, transparent);
  --ub-danger: var(--cds-danger);
  --ub-danger-soft: color-mix(in srgb, var(--cds-danger) 11%, transparent);
  --ub-switch-off: var(--cds-alpha-3);
  --ub-scrim: var(--cds-scrim);
  --ub-toast-bg: var(--cds-surface-popover);
  --ub-card-shadow: var(--cds-panel-shadow);
  --ub-overlay-shadow: var(--cds-shadow-popover);
  --ub-focus-ring: var(--cds-focus-shadow);

  font-size: var(--ub-fs-md);
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.ub-app[data-ub-style="claude"] ::selection {
  background: color-mix(in srgb, var(--cds-clay) 26%, transparent);
}

.ub-app[data-ub-style="claude"] :is(h1, h2, h3, h4) {
  text-wrap: balance;
}

.ub-app[data-ub-style="claude"] :is(p, li, dd, blockquote) {
  text-wrap: pretty;
}

/* ═══════════════ 外壳：侧栏 ═══════════════ */
.ub-app[data-ub-style="claude"] .ub-rail {
  padding: 0 var(--ub-s2) var(--ub-s2);
  border-right: 1px solid var(--cds-alpha-2);
  background: var(--ub-nav-bg);
  transition: flex-basis var(--cds-dur-sheet) var(--cds-ease-out), width var(--cds-dur-sheet) var(--cds-ease-out);
}

.ub-app[data-ub-style="claude"] .ub-rail__head {
  flex: 0 0 auto;
  height: var(--ub-titlebar-h);
  margin: 0 calc(var(--ub-s2) * -1);
  padding: 0 var(--ub-s2) 0 var(--ub-s3);
  border-bottom: 1px solid var(--cds-alpha-2);
}

.ub-app[data-ub-style="claude"] .ub-rail__collapse {
  color: var(--ub-text-3);
}

.ub-app[data-ub-style="claude"] .ub-rail__nav {
  margin-top: var(--ub-s3);
}

.ub-app[data-ub-style="claude"] .ub-brand {
  gap: var(--ub-s2);
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-brand__mark {
  width: calc(var(--ub-u) * 22);
  height: calc(var(--ub-u) * 22);
  border-radius: 6px;
  background: var(--ub-text);
  color: var(--ub-bg);
  font-size: calc(var(--ub-u) * 9.5);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.ub-app[data-ub-style="claude"] .ub-brand__text {
  flex-direction: row;
  align-items: baseline;
  gap: var(--ub-s2);
}

.ub-app[data-ub-style="claude"] .ub-brand__name {
  font-size: var(--ub-fs-md);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.ub-app[data-ub-style="claude"] .ub-brand__tag {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-rail__foot {
  gap: 1px;
  padding-top: var(--ub-s2);
  border-top: 1px solid var(--cds-alpha-2);
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn {
  gap: var(--ub-s2);
  min-height: var(--ub-control-h);
  padding: 0 var(--ub-s2);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  font-weight: 500;
  transition: background-color 150ms var(--cds-ease-hover), color 150ms ease;
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn i {
  width: calc(var(--ub-u) * 18);
  color: var(--ub-text-3);
  font-size: calc(var(--ub-u) * 13);
  text-align: center;
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn:hover {
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn:active {
  background: var(--ub-selected);
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

/* 侧栏收起：只留图标，页名改悬停提示 */
.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-rail {
  flex-basis: var(--ub-rail-w-collapsed);
  width: var(--ub-rail-w-collapsed);
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-rail__head {
  justify-content: center;
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-brand {
  display: none;
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-rail__foot-label {
  display: none;
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-rail__foot-btn {
  justify-content: center;
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-nav--rail.ub-nav--icon-only .ub-nav__item {
  justify-content: center;
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-nav--rail.ub-nav--icon-only .ub-nav__text {
  display: none;
}

/* ═══════════════ 外壳：导航 ═══════════════ */
.ub-app[data-ub-style="claude"] .ub-nav {
  gap: var(--ub-s4);
}

.ub-app[data-ub-style="claude"] .ub-nav__group-title {
  margin: 0 var(--ub-s2) var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__items {
  gap: 1px;
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__item {
  gap: var(--ub-s2);
  min-height: var(--ub-control-h);
  padding: 0 var(--ub-s2);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  font-weight: 500;
  transition: background-color 150ms var(--cds-ease-hover), color 150ms ease, transform 100ms ease;
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__item:hover:not(.is-active) {
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__item:active {
  background: var(--ub-selected);
  transform: scale(0.98);
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__item.is-active {
  background: var(--ub-selected);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__item:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__icon {
  width: calc(var(--ub-u) * 18);
  color: var(--ub-text-3);
  font-size: calc(var(--ub-u) * 13);
  opacity: 1;
}

.ub-app[data-ub-style="claude"] .ub-nav--rail .ub-nav__item.is-active .ub-nav__icon {
  color: var(--ub-text);
}

/* 手机目录：平铺卡片 */
.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__item {
  gap: var(--ub-s2);
  padding: var(--ub-s3);
  border: 0;
  border-radius: var(--ub-r-panel);
  background: var(--ub-panel);
  box-shadow: var(--cds-panel-shadow);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__item.is-active {
  background: var(--ub-panel);
  box-shadow: inset 0 0 0 1.5px var(--cds-clay), var(--cds-shadow-sm);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__icon {
  width: calc(var(--ub-u) * 30);
  height: calc(var(--ub-u) * 30);
  border-radius: var(--ub-r-control);
  background: var(--cds-alpha-1);
  color: var(--ub-text-2);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__item.is-active .ub-nav__icon {
  background: var(--cds-clay-light);
  color: var(--cds-clay-ink);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__title {
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-transform: none;
}

/* ═══════════════ 外壳：标题栏与页首 ═══════════════ */
.ub-app[data-ub-style="claude"] .ub-top {
  min-height: var(--ub-titlebar-h);
  height: var(--ub-titlebar-h);
  padding: 0 var(--ub-s2) 0 var(--ub-s4);
  border-bottom: 1px solid var(--cds-alpha-2);
  background: var(--ub-bg);
}

.ub-app[data-ub-style="claude"] .ub-top__title {
  gap: var(--ub-s2);
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.3;
}

.ub-app[data-ub-style="claude"] .ub-top__icon {
  display: none;
}

.ub-app[data-ub-style="claude"] .ub-top__crumb {
  color: var(--ub-text-3);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-top__crumb::after {
  content: "/";
  margin-left: var(--ub-s2);
  color: var(--cds-alpha-4);
}

.ub-app[data-ub-style="claude"] .ub-top :is(.ub-icon-btn) {
  width: var(--ub-control-h-sm);
  height: var(--ub-control-h-sm);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
}

.ub-app[data-ub-style="claude"] .ub-heading {
  width: 100%;
  max-width: var(--ub-page-max);
  margin: 0 auto;
  padding: calc(var(--ub-u) * 28) var(--ub-page-pad) var(--ub-s3);
}

.ub-app[data-ub-style="claude"] .ub-heading__title {
  color: var(--ub-text);
  font-size: var(--ub-fs-xl);
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.4;
}

.ub-app[data-ub-style="claude"] .ub-heading__greeting {
  padding-top: var(--ub-s4);
  color: var(--ub-text);
  font-family: var(--cds-font-serif);
  font-size: calc(var(--ub-u) * 38);
  font-weight: 300;
  letter-spacing: -0.02em;
  line-height: 1.2;
  animation: ub-cds-fade-up 450ms var(--cds-ease-out) both;
}

.ub-app[data-ub-style="claude"] .ub-launcher {
  background: var(--ub-scrim);
}

.ub-app[data-ub-style="claude"] .ub-launcher__panel {
  background: var(--ub-bg);
}

.ub-app[data-ub-style="claude"] .ub-launcher__foot {
  border-top-color: var(--cds-alpha-2);
}

@media (max-width: 760px) {
  .ub-app[data-ub-style="claude"] .ub-top {
    height: calc(var(--ub-u) * 48);
    min-height: calc(var(--ub-u) * 48);
    padding: 0 var(--ub-s1);
  }

  .ub-app[data-ub-style="claude"] .ub-top__crumb {
    display: none;
  }

  .ub-app[data-ub-style="claude"] .ub-top__menu {
    color: var(--ub-text-2);
  }

  .ub-app[data-ub-style="claude"] .ub-heading {
    padding-top: var(--ub-s5);
  }

  .ub-app[data-ub-style="claude"] .ub-heading__greeting {
    font-size: calc(var(--ub-u) * 30);
  }
}

/* ═══════════════ 页面骨架 ═══════════════ */
.ub-app[data-ub-style="claude"] .ub-page {
  gap: var(--ub-s4);
  padding-top: 0;
}

.ub-app[data-ub-style="claude"] .ub-page__body {
  gap: calc(var(--ub-u) * 32);
}

.ub-app[data-ub-style="claude"] .ub-page__lead {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-md);
  line-height: 1.6;
}

.ub-app[data-ub-style="claude"] .ub-page__jump {
  background: linear-gradient(var(--ub-bg) 80%, transparent);
}

.ub-app[data-ub-style="claude"] .ub-page__chip {
  padding: calc(var(--ub-u) * 4) var(--ub-s3);
  border: 1px solid var(--cds-alpha-2);
  background: color-mix(in srgb, var(--ub-panel) 80%, transparent);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 500;
  transition: background-color 150ms var(--cds-ease-hover), color 150ms ease, transform 100ms ease;
}

.ub-app[data-ub-style="claude"] .ub-page__chip:hover {
  border-color: var(--cds-alpha-2);
  background: var(--cds-alpha-1);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-page__chip:active {
  transform: scale(0.95);
}

/* 分节：标题在卡片外；卡片用外环投影代替描边 */
.ub-app[data-ub-style="claude"] .ub-section__head {
  margin: 0 var(--ub-s1) var(--ub-s3);
}

.ub-app[data-ub-style="claude"] .ub-section__title {
  gap: var(--ub-s2);
  font-size: var(--ub-fs-lg);
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.33;
}

.ub-app[data-ub-style="claude"] .ub-section__icon {
  color: var(--ub-text-3);
  font-size: 0.85em;
}

.ub-app[data-ub-style="claude"] .ub-section__desc {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  line-height: 1.55;
}

.ub-app[data-ub-style="claude"] .ub-section__card {
  border: 0;
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--cds-panel-shadow);
}

.ub-app[data-ub-style="claude"] .ub-section__card.is-padded {
  gap: var(--ub-s3);
  padding: var(--ub-s4);
}

.ub-app[data-ub-style="claude"] .ub-section__card.is-bare {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.ub-app[data-ub-style="claude"] .ub-row {
  gap: var(--ub-s3) var(--ub-s4);
  padding: var(--ub-s3) var(--ub-s4);
}

.ub-app[data-ub-style="claude"] .ub-row + .ub-row {
  border-top: 1px solid var(--cds-alpha-1);
}

.ub-app[data-ub-style="claude"] .ub-row__label {
  font-size: var(--ub-fs-md);
  font-weight: 500;
  line-height: 1.43;
}

.ub-app[data-ub-style="claude"] .ub-row__hint {
  margin-top: 2px;
  font-size: var(--ub-fs-xs);
  line-height: 1.55;
}

.ub-app[data-ub-style="claude"] .ub-row--flag {
  background: var(--ub-warn-soft);
  box-shadow: inset 2px 0 0 var(--ub-warn);
}

/* ═══════════════ 按钮 ═══════════════ */
.ub-app[data-ub-style="claude"] :is(.ub-btn, .ub-icon-btn) {
  transition: background-color 150ms var(--cds-ease-hover), border-color 150ms ease, color 150ms ease, box-shadow 150ms ease, transform 100ms ease;
}

.ub-app[data-ub-style="claude"] .ub-btn {
  gap: calc(var(--ub-u) * 6);
  height: var(--ub-control-h);
  padding: 0 calc(var(--ub-u) * 14);
  border: 0;
  border-radius: var(--ub-r-control);
  background: var(--cds-fill-secondary);
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-btn--sm {
  height: var(--ub-control-h-sm);
  padding: 0 calc(var(--ub-u) * 10);
  font-size: var(--ub-fs-xs);
}

.ub-app[data-ub-style="claude"] .ub-btn:hover:not(:disabled) {
  background: var(--cds-fill-secondary-hover);
}

.ub-app[data-ub-style="claude"] :is(.ub-btn, .ub-icon-btn):active:not(:disabled) {
  transform: scale(0.98);
}

.ub-app[data-ub-style="claude"] :is(.ub-btn, .ub-icon-btn):focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

.ub-app[data-ub-style="claude"] .ub-btn:disabled {
  opacity: 0.35;
}

.ub-app[data-ub-style="claude"] .ub-btn--busy:disabled {
  opacity: 0.7;
}

.ub-app[data-ub-style="claude"] .ub-btn--primary {
  background: var(--cds-clay);
  color: #ffffff;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
}

.ub-app[data-ub-style="claude"] .ub-btn--primary:hover:not(:disabled) {
  background: var(--cds-clay-hover);
}

.ub-app[data-ub-style="claude"] .ub-btn--soft {
  background: var(--cds-clay-light);
  color: var(--cds-clay-ink);
}

.ub-app[data-ub-style="claude"] .ub-btn--soft:hover:not(:disabled) {
  background: color-mix(in srgb, var(--cds-clay) 18%, transparent);
}

.ub-app[data-ub-style="claude"] .ub-btn--ghost {
  background: transparent;
  color: var(--ub-text-2);
}

.ub-app[data-ub-style="claude"] .ub-btn--ghost:hover:not(:disabled) {
  background: var(--cds-alpha-1);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-btn--danger {
  background: var(--cds-danger-fill);
  color: #ffffff;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
}

.ub-app[data-ub-style="claude"] .ub-btn--danger:hover:not(:disabled) {
  background: var(--cds-danger-fill-hover);
  color: #ffffff;
}

.ub-app[data-ub-style="claude"] .ub-icon-btn {
  width: var(--ub-control-h);
  height: var(--ub-control-h);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-md);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn--sm {
  width: var(--ub-control-h-sm);
  height: var(--ub-control-h-sm);
  font-size: var(--ub-fs-sm);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn:hover:not(:disabled) {
  background: var(--cds-alpha-1);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn--accent {
  color: var(--cds-clay-ink);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn--danger:hover:not(:disabled) {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn--solid {
  border: 0;
  background: var(--cds-fill-secondary);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn--solid:hover:not(:disabled) {
  background: var(--cds-fill-secondary-hover);
}

/* ═══════════════ 输入类控件 ═══════════════ */
.ub-app[data-ub-style="claude"] :is(.ub-field__input, .ub-select__native, .ub-dialog__input, .ub-picker__trigger) {
  height: var(--ub-control-h);
  border: 1px solid var(--cds-alpha-2);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  transition: border-color 150ms ease, box-shadow 200ms var(--cds-ease-hover);
}

.ub-app[data-ub-style="claude"] .ub-select--sm .ub-select__native {
  height: var(--ub-control-h-sm);
  font-size: var(--ub-fs-sm);
}

.ub-app[data-ub-style="claude"] .ub-textarea__input {
  padding: calc(var(--ub-u) * 10) var(--ub-s3);
  border: 1px solid var(--cds-alpha-2);
  border-radius: 12px;
  background: var(--ub-input-bg);
  font-size: var(--ub-fs-md);
  line-height: 1.6;
  transition: border-color 150ms ease, box-shadow 200ms var(--cds-ease-hover);
}

.ub-app[data-ub-style="claude"] .ub-textarea--mono .ub-textarea__input {
  font-size: var(--ub-fs-xs);
  line-height: 1.45;
}

.ub-app[data-ub-style="claude"] .ub-textarea__label {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] :is(.ub-field__input, .ub-select__native, .ub-textarea__input, .ub-dialog__input, .ub-picker__trigger):hover:not(:disabled):not(:focus) {
  border-color: var(--cds-alpha-3);
}

.ub-app[data-ub-style="claude"] :is(.ub-field__input:focus, .ub-textarea__input:focus, .ub-dialog__input:focus, .ub-select__native:focus-visible, .ub-picker__trigger:focus-visible) {
  border-color: var(--cds-alpha-3);
  outline: none;
  box-shadow: var(--cds-focus-shadow);
}

.ub-app[data-ub-style="claude"] :is(.ub-field__input, .ub-textarea__input, .ub-dialog__input)::placeholder {
  color: color-mix(in srgb, var(--ub-text-3) 80%, transparent);
}

.ub-app[data-ub-style="claude"] .ub-picker__trigger {
  font-weight: 500;
}

/* iOS 内核：输入框字号低于 16px 时聚焦会整页放大 */
@media (max-width: 760px) {
  .ub-app[data-ub-style="claude"] :is(.ub-field__input, .ub-select__native, .ub-textarea__input, .ub-dialog__input, .ub-cchat__input) {
    font-size: max(16px, var(--ub-fs-md));
  }
}

/* 分段：全圆角轨道 + 浮起滑块（120ms 咬合） */
.ub-app[data-ub-style="claude"] .ub-seg {
  gap: 0;
  padding: 2px;
  border-radius: 999px;
  background: var(--cds-segmented-track);
}

.ub-app[data-ub-style="claude"] .ub-seg__item {
  min-height: calc(var(--ub-control-h) - 4px);
  padding: 0 calc(var(--ub-u) * 14);
  border-radius: 999px;
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  font-weight: 400;
  transition: background-color var(--cds-dur-snap) var(--cds-ease-snap), color var(--cds-dur-snap) ease, box-shadow var(--cds-dur-snap) var(--cds-ease-snap);
}

.ub-app[data-ub-style="claude"] .ub-seg--sm .ub-seg__item {
  min-height: calc(var(--ub-control-h-sm) - 4px);
  padding: 0 var(--ub-s3);
  font-size: var(--ub-fs-xs);
}

.ub-app[data-ub-style="claude"] .ub-seg__item.is-active {
  background: var(--cds-segmented-thumb);
  color: var(--ub-text);
  font-weight: 500;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06), 0 1px 2px 0 rgba(0, 0, 0, 0.08);
}

.ub-app[data-ub-style="claude"] .ub-seg__item:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

/* 开关 */
.ub-app[data-ub-style="claude"] .ub-switch {
  width: calc(var(--ub-u) * 36);
  height: calc(var(--ub-u) * 20);
  background: var(--cds-alpha-3);
}

.ub-app[data-ub-style="claude"] .ub-switch.is-on {
  background: var(--cds-clay);
}

.ub-app[data-ub-style="claude"] .ub-switch:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

.ub-app[data-ub-style="claude"] .ub-switch__thumb {
  top: 2px;
  left: 2px;
  width: calc(var(--ub-u) * 20 - 4px);
  height: calc(var(--ub-u) * 20 - 4px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform var(--cds-dur-base) var(--cds-ease-overshoot);
}

.ub-app[data-ub-style="claude"] .ub-switch.is-on .ub-switch__thumb {
  transform: translateX(calc(var(--ub-u) * 16));
}

/* 勾选框 */
.ub-app[data-ub-style="claude"] .ub-check {
  font-size: var(--ub-fs-md);
}

.ub-app[data-ub-style="claude"] .ub-check__box {
  width: calc(var(--ub-u) * 16);
  height: calc(var(--ub-u) * 16);
  margin-top: 2px;
  border: 1.5px solid var(--cds-alpha-3);
  border-radius: 4px;
  background: var(--ub-input-bg);
  font-size: calc(var(--ub-u) * 10);
}

.ub-app[data-ub-style="claude"] .ub-check.is-on .ub-check__box {
  border-color: var(--cds-clay);
  background: var(--cds-clay);
  color: #ffffff;
}

.ub-app[data-ub-style="claude"] .ub-check__native:focus-visible + .ub-check__box {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

/* ═══════════════ 提示、标签、折叠、统计 ═══════════════ */
.ub-app[data-ub-style="claude"] .ub-callout {
  gap: var(--ub-s2);
  padding: calc(var(--ub-u) * 10) var(--ub-s3);
  border-radius: var(--ub-r-panel);
  background: var(--cds-alpha-1);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-app[data-ub-style="claude"] .ub-callout--success {
  background: var(--ub-ok-soft);
}

.ub-app[data-ub-style="claude"] .ub-callout--warning {
  background: var(--ub-warn-soft);
}

.ub-app[data-ub-style="claude"] .ub-callout--error {
  background: var(--ub-danger-soft);
}

.ub-app[data-ub-style="claude"] .ub-badge {
  padding: 1px calc(var(--ub-u) * 6);
  border-radius: 5px;
  background: var(--cds-alpha-1);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-2xs);
  font-weight: 500;
  line-height: 1.55;
}

.ub-app[data-ub-style="claude"] .ub-badge--accent {
  background: var(--cds-clay-light);
  color: var(--cds-clay-ink);
}

.ub-app[data-ub-style="claude"] .ub-badge--success {
  background: var(--ub-ok-soft);
  color: var(--ub-ok);
}

.ub-app[data-ub-style="claude"] .ub-badge--warning {
  background: var(--ub-warn-soft);
  color: var(--ub-warn);
}

.ub-app[data-ub-style="claude"] .ub-badge--danger {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-app[data-ub-style="claude"] .ub-disc {
  border: 0;
  border-radius: 12px;
  background: var(--ub-panel);
  box-shadow: var(--cds-panel-shadow);
  transition: box-shadow var(--cds-dur-base) ease;
}

.ub-app[data-ub-style="claude"] .ub-disc:hover {
  box-shadow: 0 0 0 1px var(--cds-alpha-3);
}

.ub-app[data-ub-style="claude"] .ub-disc--flat,
.ub-app[data-ub-style="claude"] .ub-disc--flat:hover {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.ub-app[data-ub-style="claude"] .ub-disc__head {
  padding: var(--ub-s2) calc(var(--ub-u) * 14);
  font-size: var(--ub-fs-sm);
  font-weight: 500;
  transition: background-color 150ms var(--cds-ease-hover);
}

.ub-app[data-ub-style="claude"] .ub-disc__head:hover {
  background: var(--cds-alpha-1);
}

.ub-app[data-ub-style="claude"] .ub-disc__chevron {
  color: var(--ub-text-3);
  transition: transform var(--cds-dur-base) cubic-bezier(0.19, 1, 0.22, 1);
}

.ub-app[data-ub-style="claude"] .ub-stats__item {
  box-shadow: 1px 0 0 var(--cds-alpha-1), 0 1px 0 var(--cds-alpha-1);
}

.ub-app[data-ub-style="claude"] .ub-stats__item dt {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-stats__item dd {
  font-size: var(--ub-fs-md);
  font-variant-numeric: tabular-nums;
}

/* ═══════════════ 浮层：遮罩 / 抽屉 / 对话框 / 选择面板 / 提示条 ═══════════════ */
.ub-app[data-ub-style="claude"] :is(.ub-sheet-layer, .ub-dialog-layer, .ub-picker-layer) {
  background: var(--ub-scrim);
}

@media (min-width: 761px) {
  .ub-app[data-ub-style="claude"] :is(.ub-dialog-layer, .ub-picker-layer) {
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
  }

  .ub-app[data-ub-style="claude"] .ub-sheet-layer {
    padding: calc(var(--ub-safe-top) + 8px) calc(var(--ub-safe-right) + 8px) calc(var(--ub-safe-bottom) + 8px) var(--ub-safe-left);
  }

  .ub-app[data-ub-style="claude"] .ub-sheet {
    border-radius: 12px;
    overflow: hidden;
  }
}

@media (max-width: 760px) {
  .ub-app[data-ub-style="claude"] .ub-sheet-layer {
    padding-top: calc(var(--ub-safe-top) + 12px);
  }

  .ub-app[data-ub-style="claude"] .ub-sheet {
    border-radius: var(--ub-r-overlay) var(--ub-r-overlay) 0 0;
    overflow: hidden;
  }
}

.ub-app[data-ub-style="claude"] .ub-sheet {
  background: var(--ub-bg);
  box-shadow: var(--cds-shadow-lg), 0 0 0 1px var(--cds-alpha-2);
  animation-duration: var(--cds-dur-sheet);
  animation-timing-function: var(--cds-ease-out);
}

.ub-app[data-ub-style="claude"] .ub-sheet__head {
  min-height: var(--ub-titlebar-h);
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s4);
  border-bottom: 1px solid var(--cds-alpha-2);
}

.ub-app[data-ub-style="claude"] .ub-sheet__title {
  font-size: var(--ub-fs-lg);
  font-weight: 600;
}

.ub-app[data-ub-style="claude"] .ub-sheet__subtitle {
  font-size: var(--ub-fs-xs);
}

.ub-app[data-ub-style="claude"] .ub-sheet__body {
  gap: var(--ub-s5);
  padding: var(--ub-s4);
}

.ub-app[data-ub-style="claude"] .ub-sheet__foot {
  padding: var(--ub-s3) var(--ub-s4);
  border-top: 1px solid var(--cds-alpha-2);
  background: var(--ub-bg);
}

.ub-app[data-ub-style="claude"] .ub-dialog {
  gap: var(--ub-s4);
  width: min(448px, 100%);
  padding: var(--ub-s5);
  border: 0;
  border-radius: var(--ub-r-overlay);
  background: var(--ub-panel);
  box-shadow: var(--cds-shadow-popover);
  animation-duration: var(--cds-dur-base);
  animation-timing-function: var(--cds-ease-overshoot);
}

.ub-app[data-ub-style="claude"] .ub-dialog__head {
  align-items: flex-start;
  gap: calc(var(--ub-u) * 14);
}

.ub-app[data-ub-style="claude"] .ub-dialog__glyph {
  border-radius: 10px;
  background: var(--cds-clay-light);
  color: var(--cds-clay-ink);
}

.ub-app[data-ub-style="claude"] .ub-dialog__glyph.is-danger {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-app[data-ub-style="claude"] .ub-dialog__title {
  font-size: calc(var(--ub-u) * 16);
  font-weight: 600;
  line-height: 1.25;
}

.ub-app[data-ub-style="claude"] .ub-dialog__message {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  line-height: 1.6;
}

.ub-app[data-ub-style="claude"] .ub-dialog__danger {
  border-radius: var(--ub-r-panel);
}

.ub-app[data-ub-style="claude"] .ub-dialog__actions {
  padding-top: var(--ub-s1);
}

.ub-app[data-ub-style="claude"] .ub-picker-panel {
  border: 0;
  border-radius: 12px;
  background: var(--cds-surface-popover);
  box-shadow: var(--cds-shadow-popover);
}

.ub-app[data-ub-style="claude"] .ub-picker-panel__title {
  font-size: var(--ub-fs-lg);
  font-weight: 600;
}

.ub-app[data-ub-style="claude"] .ub-picker-panel__list {
  padding: calc(var(--ub-u) * 6);
}

.ub-app[data-ub-style="claude"] .ub-picker-panel__item {
  min-height: var(--ub-control-h);
  padding: calc(var(--ub-u) * 6) calc(var(--ub-u) * 10);
  border-radius: var(--ub-r-control);
  font-size: var(--ub-fs-sm);
}

.ub-app[data-ub-style="claude"] .ub-toast {
  border: 0;
  border-radius: 12px;
  background: var(--cds-surface-popover);
  box-shadow: var(--cds-shadow-popover);
  font-size: var(--ub-fs-sm);
}

/* ═══════════════ 仪表盘 ═══════════════ */
.ub-app[data-ub-style="claude"] .ub-health {
  gap: var(--ub-s3);
  padding: calc(var(--ub-u) * 14);
  border: 0;
  border-radius: 12px;
  background: var(--ub-panel);
  box-shadow: var(--cds-panel-shadow);
}

.ub-app[data-ub-style="claude"] .ub-health.is-error {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ub-danger) 40%, transparent), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.ub-app[data-ub-style="claude"] .ub-health__icon {
  width: calc(var(--ub-u) * 32);
  height: calc(var(--ub-u) * 32);
  border-radius: var(--ub-r-control);
  background: color-mix(in srgb, var(--ub-health-tone) 11%, transparent);
  font-size: var(--ub-fs-sm);
}

.ub-app[data-ub-style="claude"] .ub-health__title {
  font-size: var(--ub-fs-md);
  font-weight: 600;
}

.ub-app[data-ub-style="claude"] .ub-health__action {
  color: var(--cds-clay-ink);
  font-weight: 500;
}

/* ═══════════════ 续写：会话流 ═══════════════ */
.ub-app[data-ub-style="claude"] .ub-cchat__status {
  padding: calc(var(--ub-u) * 10) var(--ub-s4);
  border-bottom: 1px solid var(--cds-alpha-1);
  font-size: var(--ub-fs-xs);
}

.ub-app[data-ub-style="claude"] .ub-cchat__state {
  padding: 1px 8px 1px 6px;
  background: var(--cds-alpha-1);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-cchat__state.is-running {
  background: var(--cds-clay-light);
  color: var(--cds-clay-ink);
}

.ub-app[data-ub-style="claude"] :is(.ub-cchat__state.is-running .ub-cchat__dot, .ub-feed__pulse) {
  background: var(--cds-clay);
  animation: ub-cds-clay-breathe 2.4s ease-in-out infinite;
}

.ub-app[data-ub-style="claude"] .ub-feed {
  gap: calc(var(--ub-u) * 14);
  padding: var(--ub-s5) var(--ub-s4);
}

.ub-app[data-ub-style="claude"] .ub-feed__user {
  animation: ub-cds-bubble-in 450ms var(--cds-ease-overshoot) both;
}

.ub-app[data-ub-style="claude"] .ub-feed__bubble {
  max-width: 85%;
  padding: calc(var(--ub-u) * 10) var(--ub-s4);
  border-radius: 18px;
  background: var(--cds-bg-tint-blue);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-feed__bubble p {
  font-size: var(--ub-fs-md);
  line-height: 1.6;
}

.ub-app[data-ub-style="claude"] .ub-feed__bubble .ub-feed__time {
  color: var(--ub-text-3);
  opacity: 1;
}

.ub-app[data-ub-style="claude"] .ub-feed__time {
  font-family: var(--ub-mono);
  font-size: calc(var(--ub-u) * 10.5);
}

.ub-app[data-ub-style="claude"] .ub-feed__thought {
  margin-left: var(--ub-s1);
  padding: var(--ub-s1) 0 var(--ub-s1) calc(var(--ub-u) * 14);
  border-left: 2px solid color-mix(in srgb, var(--cds-clay) 40%, transparent);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-app[data-ub-style="claude"] .ub-feed__thought-label {
  color: var(--ub-text-2);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-feed__thought p {
  font-family: var(--ub-mono);
  font-size: calc(var(--ub-u) * 11.5);
}

.ub-app[data-ub-style="claude"] .ub-feed__card {
  border: 0;
  border-radius: 12px;
  background: var(--ub-panel);
  box-shadow: var(--cds-panel-shadow);
  transition: box-shadow var(--cds-dur-base) ease;
  animation: ub-cds-fade-up 300ms var(--cds-ease-out) both;
}

.ub-app[data-ub-style="claude"] .ub-feed__card:hover {
  box-shadow: 0 0 0 1px var(--cds-alpha-3);
}

.ub-app[data-ub-style="claude"] .ub-feed__card.is-failed {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ub-danger) 45%, transparent);
}

.ub-app[data-ub-style="claude"] .ub-feed__card-head {
  padding: calc(var(--ub-u) * 10) calc(var(--ub-u) * 14);
  font-size: var(--ub-fs-xs);
}

.ub-app[data-ub-style="claude"] .ub-feed__card-head:hover {
  background: var(--cds-alpha-1);
}

.ub-app[data-ub-style="claude"] .ub-feed__kind {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--cds-alpha-1);
  color: var(--ub-text-3);
  font-family: var(--ub-mono);
  font-size: calc(var(--ub-u) * 10.5);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-feed__title {
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-feed__status.is-running {
  background: var(--cds-clay-light);
  color: var(--cds-clay-ink);
}

.ub-app[data-ub-style="claude"] :is(.ub-feed__preview, .ub-feed__detail) {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-app[data-ub-style="claude"] .ub-feed__detail {
  border-top: 1px solid var(--cds-alpha-1);
  padding-top: var(--ub-s2);
}

.ub-app[data-ub-style="claude"] .ub-feed__divider-badge {
  background: var(--cds-alpha-1);
  color: var(--ub-text-2);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-feed__divider::before,
.ub-app[data-ub-style="claude"] .ub-feed__divider::after {
  background: var(--cds-alpha-2);
}

.ub-app[data-ub-style="claude"] .ub-feed__fold {
  border: 1px solid var(--cds-alpha-2);
  background: var(--ub-panel);
  transition: background-color 150ms var(--cds-ease-hover);
}

.ub-app[data-ub-style="claude"] .ub-feed__fold:hover {
  background: var(--cds-alpha-1);
}

.ub-app[data-ub-style="claude"] .ub-feed__running {
  color: var(--ub-text-3);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-cchat__notice {
  border-radius: var(--ub-r-panel);
}

/* 输入框：20px 圆角、无描边、三档投影 */
.ub-app[data-ub-style="claude"] .ub-cchat__composer {
  gap: var(--ub-s2);
  margin: var(--ub-s2) var(--ub-s3) var(--ub-s3);
  padding: calc(var(--ub-u) * 14);
  border: 0;
  border-radius: 20px;
  background: var(--cds-surface-3);
  box-shadow: var(--cds-shadow-composer);
  transition: box-shadow var(--cds-dur-base) var(--cds-ease-hover);
}

.ub-app[data-ub-style="claude"] .ub-cchat__composer:hover {
  box-shadow: var(--cds-shadow-composer-hover);
}

.ub-app[data-ub-style="claude"] .ub-cchat__composer:focus-within {
  border: 0;
  box-shadow: var(--cds-shadow-composer-focus);
}

.ub-app[data-ub-style="claude"] .ub-cchat__input {
  min-height: calc(2lh + 6px);
  max-height: 24rem;
  padding: 0 0 0 calc(var(--ub-u) * 6);
  font-size: calc(var(--ub-u) * 15);
  line-height: 1.55;
  resize: none;
  field-sizing: content;
}

.ub-app[data-ub-style="claude"] .ub-cchat__input::placeholder {
  color: color-mix(in srgb, var(--ub-text-3) 80%, transparent);
}

.ub-app[data-ub-style="claude"] .ub-cchat__hint {
  padding-left: calc(var(--ub-u) * 6);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

.ub-app[data-ub-style="claude"] .ub-cchat__actions .ub-btn {
  height: var(--ub-control-h);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

/* ═══════════════ 动效 ═══════════════ */
@keyframes ub-cds-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

@keyframes ub-cds-bubble-in {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

@keyframes ub-cds-clay-breathe {
  0%, 100% { opacity: 0.4; transform: scale(0.92); }
  50% { opacity: 1; transform: scale(1.08); }
}

@media (prefers-reduced-motion: reduce) {
  .ub-app[data-ub-style="claude"] *,
  .ub-app[data-ub-style="claude"] *::before,
  .ub-app[data-ub-style="claude"] *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
