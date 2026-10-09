/**
 * presentation/theme/custom-confirm.ts
 *
 * 与插件 UI 风格一致的自定义确认框，替代原生 confirm()。
 * 返回 Promise<boolean>，调用方在 async 函数中使用 await 即可。
 *
 * 样式来自 host-dialog（与新界面对话框同一设计），颜色跟随当前主题。
 *
 * 重要：DOM 挂载到 topLevelWindow_ACU.document（酒馆主窗口），
 * 而非当前 iframe 的 document，与窗口系统（window-system.ts）保持一致。
 */
import { ACU_HOST_SURFACE_CLASS_ACU, SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import {
  ensureHostDialogStylesInjected_ACU,
  renderHostDialogButton_ACU,
  renderHostDialogHead_ACU,
} from './host-dialog';

/** 确认框选项 */
export interface CustomConfirmOptions {
  /** 确认按钮文案（默认"确定"） */
  confirmLabel?: string;
  /** 取消按钮文案（默认"取消"） */
  cancelLabel?: string;
  /** danger：警示图标 + 危险色确认按钮（用于不可逆操作） */
  tone?: 'default' | 'danger';
}

/**
 * 获取目标 document（酒馆主窗口），与窗口系统保持一致。
 */
function getTargetDoc(): Document {
  return (topLevelWindow_ACU || window).document;
}

/** 当前确认框的 resolve：被新弹框顶掉时以「取消」结束，避免旧的 await 永久挂起（R9-13）。 */
let pendingConfirmResolve_ACU: ((result: boolean) => void) | null = null;

/**
 * 弹出自定义确认框，返回 Promise<boolean>。
 * - 用户点击确认按钮 → resolve(true)
 * - 用户点击取消按钮或点击遮罩层 → resolve(false)
 *
 * @param title 标题
 * @param message 正文（支持换行 \n）
 * @param options 可选配置
 */
export function showCustomConfirm_ACU(
  title: string,
  message: string,
  options: CustomConfirmOptions = {},
): Promise<boolean> {
  const {
    confirmLabel = '确定',
    cancelLabel = '取消',
    tone = 'default',
  } = options;
  const danger = tone === 'danger';

  const targetDoc = getTargetDoc();

  // 移除可能残留的旧确认框（防止重复）；旧弹框的 await 按取消结束
  const supersededResolve = pendingConfirmResolve_ACU;
  pendingConfirmResolve_ACU = null;
  supersededResolve?.(false);
  removeExistingConfirm();
  ensureHostDialogStylesInjected_ACU();

  const confirmId = `${SCRIPT_ID_PREFIX_ACU}-custom-confirm`;

  // 将 \n 转为 <br>，HTML 转义防止 XSS
  const safeMessage = escapeHtml_ACU(message).replace(/\n/g, '<br>');

  const html = `
    <div class="acu-hd-layer ${ACU_HOST_SURFACE_CLASS_ACU}" id="${confirmId}-overlay" data-tt-mobile-surface="backdrop">
      <div class="acu-hd-dialog" id="${confirmId}" data-tt-mobile-surface="free-window" role="alertdialog" aria-modal="true">
        ${renderHostDialogHead_ACU(title, { danger })}
        <div class="acu-hd-message">${safeMessage}</div>
        <div class="acu-hd-actions">
          ${renderHostDialogButton_ACU({ id: `${confirmId}-cancel`, label: cancelLabel, variant: 'ghost' })}
          ${renderHostDialogButton_ACU({ id: `${confirmId}-ok`, label: confirmLabel, variant: danger ? 'danger' : 'primary' })}
        </div>
      </div>
    </div>
  `;

  // 挂载到主窗口（与窗口系统一致），而非当前 iframe
  targetDoc.body.insertAdjacentHTML('beforeend', html);

  // 在主窗口 document 中查找元素
  const $ok = targetDoc.getElementById(`${confirmId}-ok`);
  const $cancel = targetDoc.getElementById(`${confirmId}-cancel`);
  const $overlay = targetDoc.getElementById(`${confirmId}-overlay`);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      if (pendingConfirmResolve_ACU === settle) pendingConfirmResolve_ACU = null;
      resolve(result);
    };
    pendingConfirmResolve_ACU = settle;
    const cleanup = (result: boolean) => {
      removeExistingConfirm();
      settle(result);
    };

    $ok?.addEventListener('click', () => cleanup(true));
    $cancel?.addEventListener('click', () => cleanup(false));
    $overlay?.addEventListener('click', (e) => {
      if (e.target === $overlay) cleanup(false);
    });
  });
}

/** 移除已有的自定义确认框 DOM（从主窗口中查找并移除） */
function removeExistingConfirm(): void {
  const confirmId = `${SCRIPT_ID_PREFIX_ACU}-custom-confirm`;
  const targetDoc = getTargetDoc();
  const existing = targetDoc.getElementById(`${confirmId}-overlay`);
  if (existing) existing.remove();
}
