/**
 * host-claude-skin — Claude 风格下面板外的插件弹窗外观。
 *
 * 面板外弹窗（插件提示条、手动填表确认框、正文替换对比 / 结果对话框与进行中遮罩）挂在酒馆页面上，
 * 不在面板根节点之内，读不到面板的 data-ub-style。它们本就带 .acu-host-surface 并读 --acu-* 令牌，
 * Claude 风格下令牌已是 Claude 配色；这里再补形状、字阶与动效，同一个样式节点开关：
 * Claude 风格写入、默认风格清空，不动这些弹窗自己的样式表。
 */
import { ACU_HOST_SURFACE_CLASS_ACU } from '../../shared/constants';
import { getAcuHostDocument } from '../bootstrap/host-document';
import type { AcuV2ColorScheme } from './theme-types';

export const HOST_CLAUDE_SKIN_STYLE_ID = 'acu-v2-host-claude-skin';

const S = `.${ACU_HOST_SURFACE_CLASS_ACU}`;
const DIALOG = `:is(${S}.acu-hd-dialog, ${S} .acu-hd-dialog)`;
const TOAST = `#toast-container > .acu-toast.toast${S}`;

export function buildHostClaudeSkinCss(colorScheme: AcuV2ColorScheme): string {
  const dark = colorScheme === 'dark';
  const scrim = dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.30)';
  const ring = dark ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.09)' : 'inset 0 0 0 1px rgba(20, 20, 20, 0.10)';
  const fillSecondary = dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)';
  const fillSecondaryHover = dark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.10)';
  const clayInk = dark ? '#e08264' : '#c4532f';
  const claySoft = dark ? 'rgba(217, 119, 87, 0.15)' : '#fbf3ef';
  const focus = `inset 0 0 0 1px var(--acu-bg-0), 0 0 0 1.5px var(--acu-accent), 0 0 6px 1px rgba(217, 119, 87, ${dark ? '0.35' : '0.25'})`;
  return `/* UnbirthDB：Claude 风格下的面板外弹窗 */
:is(${S}.acu-hd-layer, ${S}.acu-hd-scrim) {
  background: ${scrim};
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

${DIALOG},
${S} .acu-hd-busy {
  border: 0;
  border-radius: 16px;
  background: var(--acu-bg-1);
  box-shadow: var(--acu-shadow);
  animation-duration: 200ms;
  animation-timing-function: cubic-bezier(0.34, 1.3, 0.64, 1);
}

${DIALOG} {
  gap: 16px;
  padding: 20px;
  font-size: 14px;
}

${S}.acu-hd-dialog:not(.acu-hd-dialog--floating),
${S} .acu-hd-dialog:not(.acu-hd-dialog--floating) {
  width: min(448px, 100%);
}

${S} .acu-hd-head,
${DIALOG} .acu-hd-head {
  align-items: flex-start;
  gap: 14px;
}

${DIALOG} .acu-hd-glyph {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: ${claySoft};
  color: ${clayInk};
  font-size: 14px;
}

${DIALOG} .acu-hd-glyph.is-danger {
  background: color-mix(in srgb, var(--acu-danger) 11%, transparent);
  color: var(--acu-danger);
}

${DIALOG} .acu-hd-title {
  font: 600 16px/1.25 var(--acu-font-ui);
  letter-spacing: -0.005em;
  text-wrap: balance;
}

${DIALOG} .acu-hd-meta {
  padding: 1px 6px;
  border-radius: 5px;
  background: ${claySoft};
  color: ${clayInk};
  font-size: 11px;
  font-weight: 500;
}

${DIALOG} .acu-hd-message {
  color: var(--acu-text-2);
  font-size: 13px;
  line-height: 1.6;
  text-wrap: pretty;
}

${DIALOG} .acu-hd-item {
  padding: 12px 14px;
  border: 0;
  border-radius: 12px;
  background: var(--acu-bg-0);
  box-shadow: ${ring};
  font-size: 13px;
}

${DIALOG} .acu-hd-item__plan {
  border-radius: 8px;
  background: ${claySoft};
  font-size: 12px;
}

${DIALOG} .acu-hd-tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

${DIALOG} .acu-hd-tag--accent {
  padding: 0;
  color: ${clayInk};
}

${S} .acu-hd-actions .acu-hd-btn {
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: ${fillSecondary};
  color: var(--acu-text-1);
  font: 500 13px/1 var(--acu-font-ui);
  transition: background-color 150ms cubic-bezier(0.16, 1, 0.3, 1), color 150ms ease, box-shadow 150ms ease, transform 100ms ease;
}

${S} .acu-hd-actions .acu-hd-btn:hover:not(:disabled) {
  background: ${fillSecondaryHover};
}

${S} .acu-hd-actions .acu-hd-btn:focus-visible {
  outline: none;
  box-shadow: ${focus};
}

${S} .acu-hd-actions .acu-hd-btn:disabled {
  opacity: 0.35;
}

${S} .acu-hd-actions .acu-hd-btn--primary {
  background: var(--acu-accent);
  color: #ffffff;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
}

${S} .acu-hd-actions .acu-hd-btn--primary:hover:not(:disabled) {
  background: var(--acu-accent-2);
}

${S} .acu-hd-actions .acu-hd-btn--soft {
  background: ${claySoft};
  color: ${clayInk};
}

${S} .acu-hd-actions .acu-hd-btn--soft:hover:not(:disabled) {
  background: color-mix(in srgb, var(--acu-accent) 18%, transparent);
}

${S} .acu-hd-actions .acu-hd-btn--ghost {
  background: transparent;
  color: var(--acu-text-2);
}

${S} .acu-hd-actions .acu-hd-btn--ghost:hover:not(:disabled) {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

${S} .acu-hd-actions .acu-hd-btn--danger {
  background: #dc2626;
  color: #ffffff;
}

${S} .acu-hd-actions .acu-hd-btn--danger:hover:not(:disabled) {
  background: ${dark ? '#ef4444' : '#b91c1c'};
  color: #ffffff;
}

${S} .acu-hd-busy {
  gap: 12px;
  padding: 24px 20px 20px;
}

${S} .acu-hd-busy__text {
  font-size: 13px;
  font-weight: 500;
}

${S} .acu-hd-spinner {
  width: 28px;
  height: 28px;
  border-width: 2.5px;
}

@media (max-width: 600px) {
  ${S} .acu-hd-actions .acu-hd-btn {
    height: 40px;
  }
}

${TOAST} {
  border: 0 !important;
  border-radius: 12px !important;
  background: var(--acu-bg-1) !important;
  box-shadow: var(--acu-shadow) !important;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  font-size: 13px !important;
}

${TOAST}:hover {
  box-shadow: var(--acu-shadow) !important;
}

${TOAST} .toast-title {
  font: 500 11px/1.45 var(--acu-font-ui) !important;
  letter-spacing: 0 !important;
}

${TOAST} .toast-message {
  font: 400 13px/1.55 var(--acu-font-ui) !important;
}

${TOAST} .toast-close-button {
  border-radius: 6px !important;
}

${TOAST} :is(.acu-toast-action, .qrf-abort-btn) {
  min-height: 26px;
  padding: 3px 10px !important;
  border: 0 !important;
  border-radius: 8px !important;
  background: color-mix(in srgb, var(--acu-toast-tone) 12%, transparent) !important;
  font: 500 12px/1.4 var(--acu-font-ui) !important;
}

${TOAST} :is(.acu-toast-action, .qrf-abort-btn):hover {
  background: color-mix(in srgb, var(--acu-toast-tone) 20%, transparent) !important;
}

${TOAST} .toast-progress {
  opacity: 0.35 !important;
}

@media (prefers-reduced-motion: reduce) {
  ${DIALOG},
  ${S} .acu-hd-busy {
    animation: none;
  }
}
`;
}

/** colorScheme 为 null 表示不是 Claude 风格：清空样式节点，弹窗回到各自的默认外观。 */
export function applyHostClaudeSkin(colorScheme: AcuV2ColorScheme | null): void {
  const doc = getAcuHostDocument();
  let style = doc.getElementById(HOST_CLAUDE_SKIN_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    if (colorScheme === null) return;
    style = doc.createElement('style');
    style.id = HOST_CLAUDE_SKIN_STYLE_ID;
    (doc.head || doc.body).appendChild(style);
  }
  const css = colorScheme === null ? '' : buildHostClaudeSkinCss(colorScheme);
  if (style.textContent !== css) style.textContent = css;
}
