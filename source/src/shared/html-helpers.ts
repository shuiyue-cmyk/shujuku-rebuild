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
 * 生成 toast 中的操作按钮 HTML（终止/取消/重新优化等）
 * @param id - 按钮的 DOM id
 * @param label - 按钮文本
 * @param accent - 按钮强调色（border/文字/hover 背景）
 * @param radius - 圆角
 * @param fontSize - 字号
 */
export function renderToastActionButton_ACU(id: string, label: string, accent = '#ffc107', radius = '4px', fontSize = '0.9em'): string {
  return `<button id="${escapeHtml_ACU(id)}" style="border: 1px solid ${escapeHtml_ACU(accent)}; color: ${escapeHtml_ACU(accent)}; background: transparent; padding: 5px 10px; border-radius: ${escapeHtml_ACU(radius)}; cursor: pointer; float: right; margin-left: 15px; font-size: ${escapeHtml_ACU(fontSize)}; font-family: inherit;" onmouseover="this.style.backgroundColor='${escapeHtml_ACU(accent)}'; this.style.color='#1a1d24';" onmouseout="this.style.backgroundColor='transparent'; this.style.color='${escapeHtml_ACU(accent)}';">${escapeHtml_ACU(label)}</button>`;
}

/**
 * 生成 toast 中的终止/取消按钮 HTML
 * @param id - 按钮的 DOM id
 * @param label - 按钮文本
 */
export function renderStopButton_ACU(id: string, label: string): string {
  return renderToastActionButton_ACU(id, label);
}
