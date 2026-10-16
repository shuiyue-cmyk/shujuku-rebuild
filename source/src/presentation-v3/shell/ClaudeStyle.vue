<script setup lang="ts">
/**
 * Claude 风格（外观 → 界面风格 → Claude）。
 *
 * 只是一份全局样式，全部限定在 .ub-app[data-ub-style="claude"] 之下，不改任何组件结构与行为。
 * 颜色仍取当前主题（--acu-*），这里只换表面层次、形状、排版与动效：
 * - 表面：画布 / 侧栏 / 卡片三层微对比，边线用低透明度墨色，深色下改内侧高光；
 * - 形状：控件 8px、卡片 12px、弹窗 16px，页内跳转胶囊全圆角；
 * - 排版：页面标题与弹窗标题用衬线，正文 500 字重为主，导航选中用中性底色而非强调色；
 * - 主按钮用墨色实底，次级按钮去强调色，聚焦用强调色三层光环。
 * 参考的是公开的界面设计规范，不含任何品牌字体、图标或标识。
 */
</script>
<style>
/* ═══ 令牌 ═══ */
.ub-app[data-ub-style="claude"] {
  --ub-r-card: 12px;
  --ub-r-control: 8px;
  --ub-r-overlay: 16px;
  --ub-control-h: calc(var(--ub-u) * 34);
  --ub-control-h-sm: calc(var(--ub-u) * 28);
  --ub-rail-w: calc(var(--ub-u) * 256);
  --ub-rail-w-collapsed: calc(var(--ub-u) * 60);
  --ub-page-max: calc(var(--ub-u) * 768);

  --ub-serif: ui-serif, Georgia, Cambria, "Times New Roman", "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  --ub-ease: cubic-bezier(0.16, 1, 0.3, 1);

  --ub-ink: var(--acu-text-1);
  --ub-hover: color-mix(in srgb, var(--acu-text-1) 5%, transparent);
  --ub-selected: color-mix(in srgb, var(--acu-text-1) 8%, transparent);
  --ub-sunken: color-mix(in srgb, var(--acu-text-1) 5%, transparent);
  --ub-line: color-mix(in srgb, var(--acu-text-1) 14%, transparent);
  --ub-line-soft: color-mix(in srgb, var(--acu-text-1) 9%, transparent);
  --ub-line-strong: color-mix(in srgb, var(--acu-text-1) 24%, transparent);
  --ub-accent-soft: color-mix(in srgb, var(--acu-accent) 12%, transparent);
  --ub-accent-soft-2: color-mix(in srgb, var(--acu-accent) 20%, transparent);
  --ub-focus-ring: 0 0 0 1px var(--ub-bg), 0 0 0 2.5px var(--ub-accent), 0 0 6px 2px color-mix(in srgb, var(--acu-accent) 25%, transparent);

  letter-spacing: -0.003em;
}

.ub-app[data-ub-style="claude"][data-ub-color-scheme="light"] {
  --ub-bg: var(--acu-bg-1);
  --ub-nav-bg: color-mix(in srgb, var(--acu-sidebar-bg) 45%, var(--acu-bg-1));
  --ub-panel: color-mix(in srgb, var(--acu-bg-1) 30%, #fff);
  --ub-input-bg: color-mix(in srgb, var(--acu-bg-1) 30%, #fff);
  --ub-hover-strong: color-mix(in srgb, var(--acu-text-1) 6%, var(--ub-panel));
  --ub-seg-thumb: color-mix(in srgb, var(--acu-bg-1) 20%, #fff);
  --ub-on-ink: var(--acu-bg-1);
  --ub-scrim: rgba(20, 20, 19, 0.3);
  --ub-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 2px 8px rgba(0, 0, 0, 0.025);
  --ub-overlay-shadow: 0 0 0 1px var(--ub-line-soft), 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08);
  --ub-toast-bg: color-mix(in srgb, var(--ub-panel) 96%, transparent);
}

.ub-app[data-ub-style="claude"][data-ub-color-scheme="dark"] {
  --ub-bg: color-mix(in srgb, var(--acu-bg-0) 55%, var(--acu-bg-1));
  --ub-nav-bg: color-mix(in srgb, var(--acu-sidebar-bg) 70%, var(--acu-bg-0));
  --ub-panel: color-mix(in srgb, var(--acu-bg-1) 70%, var(--acu-bg-2));
  --ub-input-bg: color-mix(in srgb, var(--acu-bg-0) 35%, var(--acu-bg-1));
  --ub-hover-strong: color-mix(in srgb, var(--acu-text-1) 8%, var(--ub-panel));
  --ub-seg-thumb: color-mix(in srgb, var(--acu-text-1) 10%, var(--ub-panel));
  --ub-on-ink: var(--acu-bg-0);
  --ub-scrim: rgba(0, 0, 0, 0.55);
  --ub-card-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3);
  --ub-overlay-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 28px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
  --ub-toast-bg: color-mix(in srgb, var(--ub-panel) 96%, transparent);
}

.ub-app[data-ub-style="claude"] ::selection {
  background: color-mix(in srgb, var(--acu-accent) 28%, transparent);
}

/* ═══ 外壳 ═══ */
.ub-app[data-ub-style="claude"] .ub-rail {
  padding: var(--ub-s3) var(--ub-s2) var(--ub-s2);
  border-right-color: var(--ub-line-soft);
  transition: flex-basis 0.22s var(--ub-ease), width 0.22s var(--ub-ease);
}

.ub-app[data-ub-style="claude"] .ub-rail__head {
  min-height: calc(var(--ub-u) * 40);
  padding: 0 var(--ub-s1) 0 0;
}

.ub-app[data-ub-style="claude"] .ub-rail__collapse {
  color: var(--ub-text-3);
}

.ub-app[data-ub-style="claude"] .ub-rail__nav {
  margin-top: var(--ub-s4);
}

.ub-app[data-ub-style="claude"] .ub-brand {
  gap: var(--ub-s2);
  padding: 0 var(--ub-s2);
}

.ub-app[data-ub-style="claude"] .ub-brand__mark {
  width: calc(var(--ub-u) * 28);
  height: calc(var(--ub-u) * 28);
  border-radius: 8px;
  background: var(--ub-accent);
  font-size: var(--ub-fs-2xs);
  letter-spacing: 0.02em;
}

.ub-app[data-ub-style="claude"] .ub-brand__name {
  font-family: var(--ub-serif);
  font-size: calc(var(--ub-u) * 17);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.15;
}

.ub-app[data-ub-style="claude"] .ub-brand__tag {
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-rail__foot {
  border-top: 0;
  padding-top: var(--ub-s2);
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn {
  min-height: calc(var(--ub-u) * 32);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-2);
  font-weight: 500;
  transition: background 0.15s var(--ub-ease), color 0.15s ease;
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn:hover {
  background: var(--ub-hover);
}

.ub-app[data-ub-style="claude"] .ub-rail__foot-btn:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

/* 侧栏收起：只留图标，文字改悬停提示 */
.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-rail {
  flex-basis: var(--ub-rail-w-collapsed);
  width: var(--ub-rail-w-collapsed);
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-rail__head {
  flex-direction: column;
  gap: var(--ub-s2);
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-brand {
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed :is(.ub-brand__text, .ub-rail__foot-label) {
  display: none;
}

.ub-app[data-ub-style="claude"] .ub-shell.is-rail-collapsed .ub-rail__foot-btn {
  justify-content: center;
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-nav--icon-only .ub-nav__item {
  justify-content: center;
  padding: 0;
}

.ub-app[data-ub-style="claude"] .ub-nav--icon-only .ub-nav__text {
  display: none;
}

.ub-app[data-ub-style="claude"] .ub-top {
  min-height: calc(var(--ub-u) * 60);
}

.ub-app[data-ub-style="claude"] .ub-top__title {
  font-family: var(--ub-serif);
  font-size: calc(var(--ub-u) * 24);
  font-weight: 500;
  letter-spacing: -0.012em;
}

.ub-app[data-ub-style="claude"] .ub-top__icon {
  display: none;
}

.ub-app[data-ub-style="claude"] .ub-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--ub-line) transparent;
}

.ub-app[data-ub-style="claude"] .ub-launcher__panel {
  background: var(--ub-bg);
}

@media (max-width: 760px) {
  .ub-app[data-ub-style="claude"] .ub-top {
    min-height: calc(var(--ub-u) * 52);
  }

  .ub-app[data-ub-style="claude"] .ub-top__title {
    font-size: calc(var(--ub-u) * 20);
  }
}

/* ═══ 导航 ═══ */
.ub-app[data-ub-style="claude"] .ub-nav {
  gap: var(--ub-s4);
}

.ub-app[data-ub-style="claude"] .ub-nav__group-title {
  margin: 0 var(--ub-s3) var(--ub-s1);
  font-size: var(--ub-fs-xs);
  font-weight: 500;
  letter-spacing: 0;
}

.ub-app[data-ub-style="claude"] .ub-nav__item {
  min-height: calc(var(--ub-u) * 34);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-2);
  font-weight: 500;
  transition: background 0.15s var(--ub-ease), color 0.15s ease;
}

.ub-app[data-ub-style="claude"] .ub-nav__item:hover:not(.is-active) {
  background: var(--ub-hover);
}

.ub-app[data-ub-style="claude"] .ub-nav__item:active {
  transform: scale(0.99);
}

.ub-app[data-ub-style="claude"] .ub-nav__item.is-active {
  background: var(--ub-selected);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-nav__item:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

.ub-app[data-ub-style="claude"] .ub-nav__icon {
  color: var(--ub-text-3);
  opacity: 1;
}

.ub-app[data-ub-style="claude"] .ub-nav__item.is-active .ub-nav__icon {
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__item {
  border-color: var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--ub-card-shadow);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__item.is-active {
  border-color: var(--ub-line-strong);
  background: var(--ub-panel);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__icon {
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
  color: var(--ub-text-2);
}

.ub-app[data-ub-style="claude"] .ub-nav--tiles .ub-nav__item.is-active .ub-nav__icon {
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

/* ═══ 页面骨架 ═══ */
.ub-app[data-ub-style="claude"] .ub-page__body {
  gap: calc(var(--ub-u) * 32);
}

.ub-app[data-ub-style="claude"] .ub-page__lead {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-md);
  line-height: 1.7;
}

.ub-app[data-ub-style="claude"] .ub-page__chip {
  border-color: var(--ub-line-soft);
  background: transparent;
  color: var(--ub-text-2);
  font-weight: 500;
  transition: background 0.15s var(--ub-ease), color 0.15s ease, border-color 0.15s ease;
}

.ub-app[data-ub-style="claude"] .ub-page__chip:hover {
  border-color: var(--ub-line);
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-section__head {
  margin-bottom: var(--ub-s3);
}

.ub-app[data-ub-style="claude"] .ub-section__title {
  font-size: calc(var(--ub-u) * 15);
  font-weight: 600;
  letter-spacing: -0.008em;
}

.ub-app[data-ub-style="claude"] .ub-section__icon {
  color: var(--ub-text-3);
}

.ub-app[data-ub-style="claude"] .ub-section__card {
  border-color: var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--ub-card-shadow);
}

.ub-app[data-ub-style="claude"] .ub-section__card.is-padded {
  padding: calc(var(--ub-u) * 18);
}

.ub-app[data-ub-style="claude"] .ub-section__card.is-bare {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.ub-app[data-ub-style="claude"] .ub-row {
  padding: calc(var(--ub-u) * 14) calc(var(--ub-u) * 18);
}

.ub-app[data-ub-style="claude"] .ub-row + .ub-row {
  border-top-color: var(--ub-line-soft);
}

.ub-app[data-ub-style="claude"] .ub-row__label {
  font-size: var(--ub-fs-sm);
  font-weight: 500;
}

/* ═══ 按钮 ═══ */
.ub-app[data-ub-style="claude"] :is(.ub-btn, .ub-icon-btn) {
  transition: background 0.15s var(--ub-ease), border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
}

.ub-app[data-ub-style="claude"] .ub-btn {
  border-color: var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-panel);
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-btn:hover:not(:disabled) {
  border-color: var(--ub-line-strong);
  background: var(--ub-hover-strong);
}

.ub-app[data-ub-style="claude"] :is(.ub-btn, .ub-icon-btn):focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

.ub-app[data-ub-style="claude"] .ub-btn--primary {
  border-color: transparent;
  background: var(--ub-ink);
  color: var(--ub-on-ink);
}

.ub-app[data-ub-style="claude"] .ub-btn--primary:hover:not(:disabled) {
  border-color: transparent;
  background: color-mix(in srgb, var(--ub-ink) 84%, var(--ub-bg));
}

.ub-app[data-ub-style="claude"] .ub-btn--soft {
  border-color: transparent;
  background: var(--ub-sunken);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-btn--soft:hover:not(:disabled) {
  border-color: transparent;
  background: color-mix(in srgb, var(--acu-text-1) 10%, transparent);
}

.ub-app[data-ub-style="claude"] .ub-btn--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--ub-text-2);
}

.ub-app[data-ub-style="claude"] .ub-btn--ghost:hover:not(:disabled) {
  border-color: transparent;
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-app[data-ub-style="claude"] .ub-btn--danger {
  border-color: transparent;
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-app[data-ub-style="claude"] .ub-btn--danger:hover:not(:disabled) {
  border-color: transparent;
  background: var(--ub-danger);
  color: #fff;
}

.ub-app[data-ub-style="claude"] .ub-icon-btn {
  border-radius: var(--ub-r-control);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn:hover:not(:disabled) {
  background: var(--ub-hover);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn--danger:hover:not(:disabled) {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-app[data-ub-style="claude"] .ub-icon-btn--solid {
  border-color: var(--ub-line);
  background: var(--ub-panel);
}

/* ═══ 输入类控件 ═══ */
.ub-app[data-ub-style="claude"] :is(.ub-field__input, .ub-select__native, .ub-textarea__input, .ub-dialog__input, .ub-picker__trigger) {
  border-color: var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  transition: border-color 0.15s ease, box-shadow 0.2s var(--ub-ease);
}

.ub-app[data-ub-style="claude"] .ub-textarea__input {
  border-radius: 10px;
  line-height: 1.65;
}

.ub-app[data-ub-style="claude"] :is(.ub-field__input, .ub-select__native, .ub-textarea__input, .ub-dialog__input, .ub-picker__trigger):hover:not(:disabled):not(:focus) {
  border-color: var(--ub-line-strong);
}

.ub-app[data-ub-style="claude"] :is(.ub-field__input:focus, .ub-textarea__input:focus, .ub-dialog__input:focus, .ub-select__native:focus-visible) {
  border-color: color-mix(in srgb, var(--acu-text-1) 32%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--acu-text-1) 6%, transparent);
}

.ub-app[data-ub-style="claude"] .ub-picker__trigger {
  font-weight: 500;
}

.ub-app[data-ub-style="claude"] .ub-picker__trigger:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

/* 分段：中性轨道＋浮起滑块 */
.ub-app[data-ub-style="claude"] .ub-seg {
  border-radius: calc(var(--ub-r-control) + 3px);
  background: var(--ub-sunken);
}

.ub-app[data-ub-style="claude"] .ub-seg__item {
  border-radius: var(--ub-r-control);
  font-weight: 500;
  transition: background 0.18s var(--ub-ease), color 0.15s ease, box-shadow 0.18s var(--ub-ease);
}

.ub-app[data-ub-style="claude"] .ub-seg__item.is-active {
  background: var(--ub-seg-thumb);
  color: var(--ub-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 0.5px var(--ub-line);
}

.ub-app[data-ub-style="claude"] .ub-seg__item:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

/* 开关：更小巧，滑块阻尼回弹 */
.ub-app[data-ub-style="claude"] .ub-switch {
  width: calc(var(--ub-u) * 38);
  height: calc(var(--ub-u) * 22);
  background: var(--ub-line-strong);
}

.ub-app[data-ub-style="claude"] .ub-switch.is-on {
  background: var(--ub-accent);
}

.ub-app[data-ub-style="claude"] .ub-switch:focus-visible {
  outline: none;
  box-shadow: var(--ub-focus-ring);
}

.ub-app[data-ub-style="claude"] .ub-switch__thumb {
  top: calc(var(--ub-u) * 2);
  left: calc(var(--ub-u) * 2);
  width: calc(var(--ub-u) * 18);
  height: calc(var(--ub-u) * 18);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
  transition: transform 0.24s cubic-bezier(0.34, 1.36, 0.64, 1);
}

.ub-app[data-ub-style="claude"] .ub-switch.is-on .ub-switch__thumb {
  transform: translateX(calc(var(--ub-u) * 16));
}

.ub-app[data-ub-style="claude"] .ub-check__box {
  border-width: 1.5px;
  border-color: var(--ub-line-strong);
  border-radius: calc(var(--ub-u) * 4);
  background: var(--ub-input-bg);
}

.ub-app[data-ub-style="claude"] .ub-check.is-on .ub-check__box {
  border-color: var(--ub-accent);
  background: var(--ub-accent);
}

/* ═══ 提示与标签 ═══ */
.ub-app[data-ub-style="claude"] .ub-callout {
  border-radius: 10px;
  line-height: 1.6;
}

.ub-app[data-ub-style="claude"] .ub-badge {
  border-radius: 6px;
  font-weight: 600;
}

.ub-app[data-ub-style="claude"] .ub-disc {
  border-color: var(--ub-line-soft);
  border-radius: 10px;
  background: var(--ub-panel);
}

.ub-app[data-ub-style="claude"] .ub-disc--flat {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.ub-app[data-ub-style="claude"] .ub-disc__head {
  font-weight: 500;
}

/* ═══ 浮层：抽屉 / 对话框 / 选择面板 / 提示条 ═══ */
.ub-app[data-ub-style="claude"] .ub-sheet {
  background: var(--ub-bg);
}

@media (min-width: 761px) {
  .ub-app[data-ub-style="claude"] .ub-sheet-layer {
    padding: calc(var(--ub-safe-top) + 8px) calc(var(--ub-safe-right) + 8px) calc(var(--ub-safe-bottom) + 8px) var(--ub-safe-left);
  }

  .ub-app[data-ub-style="claude"] .ub-sheet {
    border-radius: var(--ub-r-overlay);
    overflow: hidden;
  }
}

@media (max-width: 760px) {
  .ub-app[data-ub-style="claude"] .ub-sheet {
    border-radius: var(--ub-r-overlay) var(--ub-r-overlay) 0 0;
    overflow: hidden;
  }

  .ub-app[data-ub-style="claude"] .ub-sheet-layer {
    padding-top: calc(var(--ub-safe-top) + 12px);
  }
}

.ub-app[data-ub-style="claude"] .ub-sheet__head {
  border-bottom-color: var(--ub-line-soft);
}

.ub-app[data-ub-style="claude"] :is(.ub-sheet__title, .ub-dialog__title, .ub-picker-panel__title) {
  font-family: var(--ub-serif);
  font-weight: 500;
  letter-spacing: -0.01em;
}

.ub-app[data-ub-style="claude"] .ub-sheet__title {
  font-size: calc(var(--ub-u) * 19);
}

.ub-app[data-ub-style="claude"] .ub-sheet__foot {
  border-top-color: var(--ub-line-soft);
  background: var(--ub-bg);
}

.ub-app[data-ub-style="claude"] .ub-dialog {
  padding: calc(var(--ub-u) * 22);
  border: 0;
  border-radius: var(--ub-r-overlay);
  background: var(--ub-panel);
}

.ub-app[data-ub-style="claude"] .ub-dialog__title {
  font-size: calc(var(--ub-u) * 19);
}

.ub-app[data-ub-style="claude"] .ub-dialog__glyph {
  background: var(--ub-sunken);
  color: var(--ub-text-2);
}

.ub-app[data-ub-style="claude"] .ub-dialog__glyph.is-danger {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-app[data-ub-style="claude"] .ub-dialog__danger {
  border-radius: 10px;
}

.ub-app[data-ub-style="claude"] .ub-picker-panel {
  border: 0;
  border-radius: var(--ub-r-overlay);
}

.ub-app[data-ub-style="claude"] .ub-picker-panel__item {
  border-radius: var(--ub-r-control);
}

.ub-app[data-ub-style="claude"] .ub-toast {
  border: 0;
  border-radius: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .ub-app[data-ub-style="claude"] *,
  .ub-app[data-ub-style="claude"] *::before,
  .ub-app[data-ub-style="claude"] *::after {
    transition-duration: 0.01ms !important;
  }
}
</style>
