/**
 * shared/html-helpers.ts — HTML 工具函数
 *
 * 零副作用、零全局依赖、零 DOM 操作。
 * 从 src/ui/03_theme_and_toast.js 和 src/core/02_storage_and_profile.js 迁移而来。
 */

/**
 * HTML 特殊字符转义（防 XSS）
 */
export function escapeHtml_ACU(unsafe: string): string {
  if (typeof unsafe !== 'string' || !unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── HTML 模板函数 ──────────────────────────────────────

/**
 * 生成转义后的 <option> 标签
 * @param value - option 的 value 属性（会被转义）
 * @param text - option 的显示文本（会被转义）
 * @param selected - 是否选中
 */
export function renderOption_ACU(value: string, text: string, selected = false): string {
  return `<option value="${escapeHtml_ACU(value)}"${selected ? ' selected' : ''}>${escapeHtml_ACU(text)}</option>`;
}

/**
 * 生成 toast 中的终止/取消按钮 HTML
 * @param id - 按钮的 DOM id
 * @param label - 按钮文本
 */
export function renderStopButton_ACU(id: string, label: string): string {
  return `<button id="${escapeHtml_ACU(id)}" style="border: 1px solid #ffc107; color: #ffc107; background: transparent; padding: 5px 10px; border-radius: 4px; cursor: pointer; float: right; margin-left: 15px; font-size: 0.9em; transition: all 0.2s ease;" onmouseover="this.style.backgroundColor='#ffc107'; this.style.color='#1a1d24';" onmouseout="this.style.backgroundColor='transparent'; this.style.color='#ffc107';">${escapeHtml_ACU(label)}</button>`;
}

/**
 * 生成正文替换 toast 中的"重新优化"按钮 HTML
 */
export function renderReoptButton_ACU(): string {
  return `<button id="acu-opt-toast-reoptimize" style="border: 1px solid var(--acu-accent, #7d4940); color: var(--acu-accent, #7d4940); background: transparent; padding: 5px 10px; border-radius: 1px; cursor: pointer; float: right; margin-left: 15px; font-size: 0.85em; font-family: inherit;" onmouseover="this.style.backgroundColor='var(--acu-accent, #7d4940)'; this.style.color='var(--acu-bg-0, #24221f)';" onmouseout="this.style.backgroundColor='transparent'; this.style.color='var(--acu-accent, #7d4940)';">🔄 重新优化</button>`;
}
