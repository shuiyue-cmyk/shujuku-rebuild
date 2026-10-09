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
 *
 * 外观由插件提示框样式的 .acu-toast-action 统一提供（颜色跟随提示框类型与主题）。
 */
export function renderToastActionButton_ACU(id: string, label: string): string {
  return `<button id="${escapeHtml_ACU(id)}" class="acu-toast-action" type="button">${escapeHtml_ACU(label)}</button>`;
}

/**
 * 生成 toast 中的终止/取消按钮 HTML
 * @param id - 按钮的 DOM id
 * @param label - 按钮文本
 */
export function renderStopButton_ACU(id: string, label: string): string {
  return renderToastActionButton_ACU(id, label);
}
