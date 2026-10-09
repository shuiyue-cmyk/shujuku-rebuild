/**
 * presentation/theme/host-dialog.ts
 *
 * 面板外插件弹窗（手动填表确认框、正文替换遮罩、正文替换对比/结果对话框）的统一样式与模板。
 * 与新界面的对话框（UbDialogHost / UbButton）同一套设计；颜色取当前主题 token：
 * 主题注入器给 .acu-host-surface 写 --acu-* 变量，未注入时回退默认浅色。
 *
 * 这些弹窗挂在酒馆主窗口的 body 上，样式表也注入主窗口，只注入一次。
 */
import { ACU_HOST_SURFACE_CLASS_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { escapeHtml_ACU } from '../../shared/html-helpers';

export const HOST_DIALOG_STYLE_ID_ACU = 'acu-host-dialog-styles';

const HOST_DIALOG_CSS_ACU = `
  .acu-hd-layer,
  .acu-hd-scrim,
  .acu-hd-dialog {
    --acu-hd-font: var(--acu-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
    --acu-hd-scrim: rgba(6, 8, 12, 0.52);
    --acu-hd-safe-top: max(env(safe-area-inset-top, 0px), var(--tt-inset-top, 0px));
    --acu-hd-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px));
    --acu-hd-r-card: max(var(--acu-radius-lg, 12px), 14px);
    --acu-hd-r-control: max(var(--acu-radius-sm, 8px), 9px);
    --acu-hd-accent-soft: color-mix(in srgb, var(--acu-accent, #2F5FD0) 14%, transparent);
    --acu-hd-accent-ink: color-mix(in srgb, var(--acu-accent, #2F5FD0) 82%, var(--acu-text-1, #1C1B18));
    --acu-hd-danger-soft: color-mix(in srgb, var(--acu-danger, #B4483F) 14%, transparent);
    box-sizing: border-box;
    font-family: var(--acu-hd-font);
    -webkit-font-smoothing: antialiased;
  }
  .acu-hd-layer *,
  .acu-hd-dialog * {
    box-sizing: border-box;
  }

  /* 铺满的遮罩层：确认框与优化遮罩把内容放在层内居中 */
  .acu-hd-layer {
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(var(--acu-hd-safe-top), 16px) 16px max(var(--acu-hd-safe-bottom), 16px);
    background: var(--acu-hd-scrim);
    animation: acu-hd-fade-in 0.15s ease-out both;
  }
  /* 与对话框同级的遮罩（正文替换对比/结果对话框沿用此结构） */
  .acu-hd-scrim {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: var(--acu-hd-scrim);
    animation: acu-hd-fade-in 0.15s ease-out both;
  }

  .acu-hd-dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(440px, 100%);
    max-height: 100%;
    margin: 0;
    padding: 20px;
    border: 1px solid var(--acu-border, rgba(28, 27, 24, 0.08));
    border-radius: var(--acu-hd-r-card);
    background: var(--acu-bg-1, #FFFFFF);
    color: var(--acu-text-1, #1C1B18);
    box-shadow: var(--acu-shadow, 0 12px 32px rgba(28, 27, 24, 0.12));
    font-size: 14px;
    line-height: 1.5;
    text-align: left;
    overflow: hidden;
    animation: acu-hd-pop-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  /* 浮在页面顶部的大对话框：free-window 不受宿主几何钳制，安全区自己吃 */
  .acu-hd-dialog--floating {
    position: fixed;
    top: max(16px, env(safe-area-inset-top, 0px), var(--tt-inset-top, 0px));
    left: 0;
    right: 0;
    z-index: 100000;
    width: min(720px, calc(100vw - 24px));
    max-height: calc(100vh - max(16px, env(safe-area-inset-top, 0px), var(--tt-inset-top, 0px)) - max(16px, env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px)));
    max-height: calc(100dvh - max(16px, env(safe-area-inset-top, 0px), var(--tt-inset-top, 0px)) - max(16px, env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px)));
    margin: 0 auto;
  }

  .acu-hd-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .acu-hd-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--acu-hd-accent-soft);
    color: var(--acu-hd-accent-ink);
    font-size: 15px;
  }
  .acu-hd-glyph.is-danger {
    background: var(--acu-hd-danger-soft);
    color: var(--acu-danger, #B4483F);
  }
  .acu-hd-title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--acu-text-1, #1C1B18);
    font: 700 16.5px/1.35 var(--acu-hd-font);
    letter-spacing: normal;
  }
  .acu-hd-meta {
    flex: 0 0 auto;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--acu-hd-accent-soft);
    color: var(--acu-hd-accent-ink);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .acu-hd-message {
    flex: 0 1 auto;
    min-height: 0;
    margin: 0;
    color: var(--acu-text-2, #4A4842);
    font-size: 13.5px;
    line-height: 1.65;
    overflow-wrap: anywhere;
    overflow-y: auto;
  }

  /* 正文替换条目 */
  .acu-hd-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .acu-hd-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 0 0 auto;
    padding: 12px;
    border: 1px solid var(--acu-border, rgba(28, 27, 24, 0.08));
    border-radius: var(--acu-hd-r-control);
    background: color-mix(in srgb, var(--acu-bg-2, #EBE9E3) 70%, var(--acu-bg-0, #F2F1ED));
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .acu-hd-item__row,
  .acu-hd-item__plan {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .acu-hd-item__row--before {
    color: var(--acu-text-3, #75726A);
  }
  .acu-hd-item__row--before .acu-hd-item__text {
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--acu-text-3, #75726A) 60%, transparent);
  }
  .acu-hd-item__row--after {
    color: var(--acu-text-1, #1C1B18);
  }
  .acu-hd-item__plan {
    padding: 8px 10px;
    border-radius: var(--acu-hd-r-control);
    background: var(--acu-hd-accent-soft);
    color: var(--acu-text-2, #4A4842);
    font-size: 12.5px;
  }
  .acu-hd-item__text {
    min-width: 0;
  }
  .acu-hd-tag {
    flex: 0 0 auto;
    padding: 1px 7px;
    border-radius: 6px;
    background: var(--acu-hover-overlay, rgba(28, 27, 24, 0.06));
    color: var(--acu-text-3, #75726A);
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.6;
    text-decoration: none;
    white-space: nowrap;
  }
  .acu-hd-tag--accent {
    background: transparent;
    color: var(--acu-hd-accent-ink);
    padding-left: 0;
    padding-right: 0;
  }
  .acu-hd-tag--ok {
    background: color-mix(in srgb, var(--acu-success, #3F7A55) 15%, transparent);
    color: var(--acu-success, #3F7A55);
  }

  .acu-hd-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
    margin-top: 4px;
  }
  .acu-hd-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    height: 36px;
    margin: 0;
    padding: 0 16px;
    border: 1px solid transparent;
    border-radius: var(--acu-hd-r-control);
    background: transparent;
    color: var(--acu-text-1, #1C1B18);
    font: 600 13.5px/1 var(--acu-hd-font);
    letter-spacing: normal;
    white-space: nowrap;
    text-shadow: none;
    box-shadow: none;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease, transform 0.08s ease;
  }
  .acu-hd-btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  .acu-hd-btn:focus-visible {
    outline: 2px solid var(--acu-accent, #2F5FD0);
    outline-offset: 2px;
  }
  .acu-hd-btn:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .acu-hd-btn--primary {
    background: var(--acu-accent, #2F5FD0);
    color: var(--acu-on-accent, #FFFFFF);
  }
  .acu-hd-btn--primary:hover:not(:disabled) {
    background: var(--acu-accent-2, #264FB0);
  }
  .acu-hd-btn--soft {
    background: var(--acu-hd-accent-soft);
    color: var(--acu-hd-accent-ink);
  }
  .acu-hd-btn--soft:hover:not(:disabled) {
    background: color-mix(in srgb, var(--acu-accent, #2F5FD0) 24%, transparent);
  }
  .acu-hd-btn--ghost {
    color: var(--acu-text-2, #4A4842);
  }
  .acu-hd-btn--ghost:hover:not(:disabled) {
    background: var(--acu-hover-overlay, rgba(28, 27, 24, 0.06));
    color: var(--acu-text-1, #1C1B18);
  }
  .acu-hd-btn--danger {
    background: var(--acu-hd-danger-soft);
    color: var(--acu-danger, #B4483F);
  }
  .acu-hd-btn--danger:hover:not(:disabled) {
    background: var(--acu-danger, #B4483F);
    color: var(--acu-on-accent, #FFFFFF);
  }

  /* 正文替换进行中的遮罩卡片 */
  .acu-hd-busy {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: min(320px, 100%);
    padding: 24px 20px 18px;
    border: 1px solid var(--acu-border, rgba(28, 27, 24, 0.08));
    border-radius: var(--acu-hd-r-card);
    background: var(--acu-bg-1, #FFFFFF);
    color: var(--acu-text-1, #1C1B18);
    box-shadow: var(--acu-shadow, 0 12px 32px rgba(28, 27, 24, 0.12));
    text-align: center;
    animation: acu-hd-pop-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .acu-hd-spinner {
    width: 34px;
    height: 34px;
    border: 3px solid color-mix(in srgb, var(--acu-accent, #2F5FD0) 18%, transparent);
    border-top-color: var(--acu-accent, #2F5FD0);
    border-radius: 50%;
    animation: acu-hd-spin 0.9s linear infinite;
  }
  .acu-hd-busy__text {
    color: var(--acu-text-1, #1C1B18);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  @keyframes acu-hd-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes acu-hd-pop-in {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to { opacity: 1; transform: none; }
  }
  @keyframes acu-hd-spin {
    to { transform: rotate(360deg); }
  }

  /* 窄屏：按钮纵向铺满，主操作在上，便于触控 */
  @media (max-width: 600px) {
    .acu-hd-dialog {
      padding: 18px 16px 16px;
    }
    .acu-hd-dialog--floating {
      width: calc(100vw - 16px);
    }
    .acu-hd-actions {
      flex-direction: column-reverse;
      flex-wrap: nowrap;
    }
    .acu-hd-actions .acu-hd-btn {
      width: 100%;
      height: 40px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .acu-hd-layer,
    .acu-hd-scrim,
    .acu-hd-dialog,
    .acu-hd-busy {
      animation: none;
    }
  }
`;

function getHostDialogDocument_ACU(): Document {
  return topLevelWindow_ACU?.document || document;
}

/** 把插件弹窗样式表注入酒馆主窗口（已存在则只同步内容）。 */
export function ensureHostDialogStylesInjected_ACU(): void {
  try {
    const doc = getHostDialogDocument_ACU();
    let style = doc.getElementById(HOST_DIALOG_STYLE_ID_ACU) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = HOST_DIALOG_STYLE_ID_ACU;
      (doc.head || doc.body).appendChild(style);
    }
    if (style.textContent !== HOST_DIALOG_CSS_ACU) style.textContent = HOST_DIALOG_CSS_ACU;
  } catch (_) {
    // 注入失败时弹窗仍可用（只是没有样式），不阻断调用方流程。
  }
}

export type HostDialogButtonVariant_ACU = 'primary' | 'soft' | 'ghost' | 'danger';

export interface HostDialogButton_ACU {
  id: string;
  label: string;
  variant: HostDialogButtonVariant_ACU;
  /** Font Awesome 图标类，如 'fa-solid fa-rotate-right' */
  icon?: string;
}

export function renderHostDialogButton_ACU(button: HostDialogButton_ACU): string {
  const icon = button.icon ? `<i class="${escapeHtml_ACU(button.icon)}" aria-hidden="true"></i>` : '';
  return `<button id="${escapeHtml_ACU(button.id)}" class="acu-hd-btn acu-hd-btn--${button.variant}" type="button">${icon}${escapeHtml_ACU(button.label)}</button>`;
}

/** 对话框头部：圆形图标 + 标题（+ 可选的进度标签），title/meta 由本函数转义。 */
export function renderHostDialogHead_ACU(title: string, options: { icon?: string; danger?: boolean; meta?: string } = {}): string {
  const icon = options.icon || (options.danger ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-question');
  const meta = options.meta ? `<span class="acu-hd-meta">${escapeHtml_ACU(options.meta)}</span>` : '';
  return `<div class="acu-hd-head">`
    + `<span class="acu-hd-glyph${options.danger ? ' is-danger' : ''}"><i class="${escapeHtml_ACU(icon)}" aria-hidden="true"></i></span>`
    + `<h3 class="acu-hd-title">${escapeHtml_ACU(title)}</h3>${meta}</div>`;
}

function truncateForPreview_ACU(value: unknown): string {
  const text = String(value ?? '');
  return `${escapeHtml_ACU(text.substring(0, 200))}${text.length > 200 ? '...' : ''}`;
}

export interface OptimizationReviewDialog_ACU {
  title: string;
  icon?: string;
  /** 已转义的摘要 HTML */
  summaryHtml: string;
  /** 进度标签，如「第 1/2 轮」 */
  meta?: string;
  optimizations: any[];
  buttons: HostDialogButton_ACU[];
}

/**
 * 正文替换对比/结果对话框：对话框 .acu-optimization-dialog（free-window）+ 同级遮罩 #acu-opt-backdrop（backdrop）。
 * 条目里的原文/方案/优化文本全部转义。
 */
export function renderOptimizationReviewDialog_ACU(dialog: OptimizationReviewDialog_ACU): string {
  const items = (Array.isArray(dialog.optimizations) ? dialog.optimizations : []).map((opt: any) => `
          <div class="acu-hd-item optimization-item">
            <div class="acu-hd-item__row acu-hd-item__row--before"><span class="acu-hd-tag">原文</span><span class="acu-hd-item__text">${truncateForPreview_ACU(opt?.original)}</span></div>
            <div class="acu-hd-item__plan"><span class="acu-hd-tag acu-hd-tag--accent">修改方案</span><span class="acu-hd-item__text">${escapeHtml_ACU(String(opt?.plan || opt?.reason || '未说明'))}</span></div>
            <div class="acu-hd-item__row acu-hd-item__row--after"><span class="acu-hd-tag acu-hd-tag--ok">优化</span><span class="acu-hd-item__text">${truncateForPreview_ACU(opt?.optimized)}</span></div>
          </div>`).join('');
  return `
      <div class="acu-optimization-dialog acu-hd-dialog acu-hd-dialog--floating ${ACU_HOST_SURFACE_CLASS_ACU}" data-tt-mobile-surface="free-window" role="dialog" aria-modal="true">
        ${renderHostDialogHead_ACU(dialog.title, { icon: dialog.icon || 'fa-solid fa-wand-magic-sparkles', meta: dialog.meta })}
        ${dialog.summaryHtml ? `<p class="acu-hd-message">${dialog.summaryHtml}</p>` : ''}
        <div class="acu-hd-list optimization-list">${items}
        </div>
        <div class="acu-hd-actions">${dialog.buttons.map(renderHostDialogButton_ACU).join('')}</div>
      </div>
      <div id="acu-opt-backdrop" class="acu-hd-scrim ${ACU_HOST_SURFACE_CLASS_ACU}" data-tt-mobile-surface="backdrop"></div>
    `;
}
