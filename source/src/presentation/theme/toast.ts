// toast.ts — presentation 层 toast 通知（含主题样式注入+消息过滤+去重）
// 核心逻辑原位于 service/runtime/toast-service.ts，已搬回 presentation 层

import { toastr_API_ACU } from '../../shared/host-api';
import { SCRIPT_ID_PREFIX_ACU, ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { logDebug_ACU } from '../../shared/utils';
import { settings_ACU } from '../../service/runtime/state-manager';

// toast 相关状态
export const ACU_TOAST_TITLE_ACU = 'TTonly·数据库';
export const _acuToastDedup_ACU = new Map<string, number>(); // key -> ts
let _acuToastStyleInjected_ACU = false;

function ensureAcuToastStylesInjected_ACU() {
  if (_acuToastStyleInjected_ACU) return;
  try {
    const doc = topLevelWindow_ACU?.document || document;
    const styleId = `${SCRIPT_ID_PREFIX_ACU}-acu-toast-style`;
    if (doc.getElementById(styleId)) {
      _acuToastStyleInjected_ACU = true;
      return;
    }
    const style = doc.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* ACU Toast Theme — 使用新主题系统的变量 */
      #toast-container .acu-toast.toast {
        --toast-accent: var(--acu-accent, #2563eb);
        --toast-bg: var(--acu-bg-1, #ffffff);
        --toast-text: var(--acu-text-1, #1a2332);
        --toast-border: var(--acu-border, #e0e4ea);
        --toast-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .acu-toast.toast {
        font-family: var(--toast-font) !important;
        font-weight: 500 !important;
        font-size: 14px !important;
        letter-spacing: 0.2px;
        --acu-toast-accent: var(--toast-accent);
        background: var(--toast-bg) !important;
        color: var(--toast-text) !important;
        border: 1px solid var(--toast-border) !important;
        border-radius: 8px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important;
        padding: 12px 14px 12px 50px !important;
        width: min(420px, calc(100vw - 24px)) !important;
        opacity: 1 !important;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        position: relative !important;
        overflow: hidden !important;
        border-left: 3px solid var(--toast-accent) !important;
      }
      #toast-container .acu-toast.toast,
      #toast-container .acu-toast.toast.toast-success,
      #toast-container .acu-toast.toast.toast-info,
      #toast-container .acu-toast.toast.toast-warning,
      #toast-container .acu-toast.toast.toast-error {
        background: var(--toast-bg) !important;
        opacity: 1 !important;
      }
      #toast-container .acu-toast.toast .toast-title,
      #toast-container .acu-toast.toast .toast-message {
        background: transparent !important;
      }
      .acu-toast.toast,
      .acu-toast.toast.toast-success,
      .acu-toast.toast.toast-info,
      .acu-toast.toast.toast-warning,
      .acu-toast.toast.toast-error {
        background: var(--toast-bg) !important;
        background-repeat: repeat !important;
        background-position: 0 0 !important;
      }
      #toast-container .acu-toast.toast::before {
        content: "i" !important;
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        width: 26px;
        height: 26px;
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 400;
        font-size: 14px;
        font-family: var(--toast-font);
        color: var(--toast-bg);
        background: var(--toast-accent);
        border: none;
        box-shadow: none;
      }
      #toast-container .acu-toast.acu-toast--success::before { content: "达" !important; }
      #toast-container .acu-toast.acu-toast--info::before { content: "知" !important; }
      #toast-container .acu-toast.acu-toast--warning::before { content: "警" !important; }
      #toast-container .acu-toast.acu-toast--error::before { content: "误" !important; }
      .acu-toast.acu-toast--success { --acu-toast-accent: #5a8a5a; }
      .acu-toast.acu-toast--info { --acu-toast-accent: #8a6b5e; }
      .acu-toast.acu-toast--warning { --acu-toast-accent: #b08a5a; }
      .acu-toast.acu-toast--error { --acu-toast-accent: #8a5a5a; }
      .acu-toast.toast .toast-title {
        font-weight: 650 !important;
        letter-spacing: 0.4px;
        margin-bottom: 4px !important;
        opacity: 1;
        text-shadow: none;
        font-family: var(--toast-font);
      }
      .acu-toast.toast .toast-message {
        line-height: 1.55;
        color: var(--toast-text) !important;
        text-shadow: none;
        font-family: var(--toast-font);
        font-weight: 500 !important;
        font-size: 13px !important;
      }
      .acu-toast.toast .toast-close-button {
        color: var(--toast-text) !important;
        text-shadow: none !important;
        opacity: 0.6 !important;
        font-size: 18px;
        right: 8px;
        top: 8px;
      }
      .acu-toast.toast .toast-close-button:hover {
        opacity: 1 !important;
      }
      .acu-toast.toast .toast-progress {
        background: var(--toast-accent) !important;
      }
      .acu-toast.acu-toast--success { border-color: rgba(90,138,90,0.5) !important; }
      .acu-toast.acu-toast--info { border-color: rgba(138,107,94,0.5) !important; }
      .acu-toast.acu-toast--warning { border-color: rgba(176,138,90,0.5) !important; }
      .acu-toast.acu-toast--error { border-color: rgba(138,90,90,0.5) !important; }
      .acu-toast .qrf-abort-btn {
        padding: 4px 12px !important;
        border-radius: 1px !important;
        border: 1px solid var(--toast-accent) !important;
        background: transparent !important;
        color: var(--toast-text) !important;
        font-weight: 600 !important;
        font-family: var(--toast-font) !important;
        cursor: pointer !important;
        font-size: 0.85em;
        box-shadow: none !important;
      }
      .acu-toast .qrf-abort-btn:hover {
        background: var(--toast-accent) !important;
        color: var(--toast-bg) !important;
      }
      @media (max-width: 520px) {
        #toast-container .acu-toast.toast {
          width: min(320px, calc(100vw - 16px)) !important;
          padding: 10px 12px 10px 42px !important;
        }
        #toast-container .acu-toast.toast::before {
          left: 9px;
          width: 22px;
          height: 22px;
          font-size: 12px;
        }
        .acu-toast.toast .toast-title {
          font-size: 13px !important;
          margin-bottom: 3px !important;
        }
        .acu-toast.toast .toast-message {
          font-size: 12px !important;
          line-height: 1.45 !important;
        }
        .acu-toast.toast .toast-close-button {
          font-size: 16px;
          right: 6px;
          top: 6px;
        }
        .acu-toast .qrf-abort-btn {
          padding: 3px 10px !important;
          font-size: 12px !important;
        }
      }
    `;
    doc.head.appendChild(style);
    _acuToastStyleInjected_ACU = true;
  } catch (e) {
    _acuToastStyleInjected_ACU = true;
  }
}

function _acuNormalizeToastArgs_ACU(type: any, message: any, titleOrOptions: any = {}, maybeOptions: any = {}) {
  let title = ACU_TOAST_TITLE_ACU;
  let options: any = {};
  if (typeof titleOrOptions === 'string') {
    title = titleOrOptions || title;
    options = (maybeOptions && typeof maybeOptions === 'object') ? maybeOptions : {};
  } else {
    options = (titleOrOptions && typeof titleOrOptions === 'object') ? titleOrOptions : {};
  }
  const defaultTimeOut =
    type === 'success' ? 1500 :
    type === 'info' ? 1500 :
    type === 'warning' ? 2000 :
    type === 'error' ? 4000 : 1500;
  const isNarrow = (() => {
    try {
      const w = (topLevelWindow_ACU && typeof topLevelWindow_ACU.innerWidth === 'number')
        ? topLevelWindow_ACU.innerWidth
        : window.innerWidth;
      return w <= 520;
    } catch (e) { return false; }
  })();
  const finalOptions = {
    // C8：默认转义 HTML（防 toast 内容注入 XSS）；需要富文本的调用方显式传 escapeHtml:false
    escapeHtml: options.escapeHtml !== undefined ? !!options.escapeHtml : true,
    closeButton: true,
    progressBar: true,
    newestOnTop: true,
    timeOut: defaultTimeOut,
    extendedTimeOut: 1000,
    tapToDismiss: true,
    toastClass: `toast acu-toast acu-toast--${type}`,
    positionClass: isNarrow ? 'toast-top-center' : 'toast-top-right',
    ...options,
  };
  return { title, finalOptions };
}

function _acuShouldShowToast_ACU(type: any, title: any, message: any, options: any = {}) {
  try {
    if (!settings_ACU?.toastMuteEnabled) return true;
    if (String(type).toLowerCase() === 'error') return true;
    const cat = options?.acuToastCategory || null;
    const allow = new Set([
      ACU_TOAST_CATEGORY_ACU.ERROR,
      ACU_TOAST_CATEGORY_ACU.TABLE_OK,
      ACU_TOAST_CATEGORY_ACU.PLAN_OK,
      ACU_TOAST_CATEGORY_ACU.PLANNING,
      ACU_TOAST_CATEGORY_ACU.MANUAL_TABLE,
      ACU_TOAST_CATEGORY_ACU.MERGE_TABLE,
      ACU_TOAST_CATEGORY_ACU.IMPORT,
    ]);
    if (cat && allow.has(cat)) return true;
    try {
      const raw = `${title || ''}\n${message || ''}`;
      const text = String(raw)
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
      const t = String(type).toLowerCase();
      const has = (s: string) => text.includes(String(s).toLowerCase());
      if (has('正在规划')) return true;
      if (t === 'success' && (has('填表') || has('规划'))) return true;
      if (t === 'success' && (has('更新') && has('成功'))) return true;
      const allowKeywords = ['手动填表', '手动更新', '合并', '外部导入', '导入', '注入'];
      if (allowKeywords.some(k => has(k))) return true;
    } catch (e) {}
    return false;
  } catch (e) {
    return true;
  }
}

export function showToastr_ACU(type: string, message: string, titleOrOptions: any = {}, maybeOptions: any = {}): JQuery<HTMLElement> | null {
  if (!toastr_API_ACU) {
    logDebug_ACU(`Toastr (${type}): ${message}`);
    return null;
  }
  ensureAcuToastStylesInjected_ACU();
  const { title, finalOptions } = _acuNormalizeToastArgs_ACU(type, message, titleOrOptions, maybeOptions);
  if (!_acuShouldShowToast_ACU(type, title, message, finalOptions)) return null;
  try {
    const key = `${type}|${title}|${String(message).replace(/<[^>]*>/g, '').slice(0, 120)}`;
    const now = Date.now();
    const last = _acuToastDedup_ACU.get(key) || 0;
    if (now - last < 1200) return null;
    _acuToastDedup_ACU.set(key, now);
  } catch (e) {}
  // 富文本修复：标准 toastr 尊重 escapeHtml:false，但部分宿主/美化脚本会替换 toastr
  // 实现并忽略该选项、把 message 按纯文本转义（用户可见 <div><span…> 字面量）。
  // 渲染后检测消息节点是否被转义，是则用我们自己的受信标记重写。
  // 双保险：onShown 钩子 + 400ms 定时兜底（被替换的 toastr 可能不回调 onShown）。
  const wantsHtml = finalOptions.escapeHtml === false && /<[^>]+>/.test(String(message));
  if (wantsHtml) {
    const repairEscapedMessage = (): void => {
      try {
        const raw = String(message);
        const prefix = raw.replace(/\s+/g, ' ').slice(0, 40);
        const candidates = typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll('.acu-toast .toast-message'))
          : [];
        for (const el of candidates) {
          const text = (el.textContent || '').replace(/\s+/g, ' ');
          if (!el.children.length && text.startsWith(prefix)) {
            el.innerHTML = raw;
            break;
          }
        }
      } catch (e) {}
    };
    const userOnShown = finalOptions.onShown;
    finalOptions.onShown = function (this: unknown, ...args: unknown[]) {
      try { repairEscapedMessage(); } catch (e) {}
      if (typeof userOnShown === 'function') userOnShown.apply(this, args as any);
    };
    setTimeout(repairEscapedMessage, 400);
  }
  return (toastr_API_ACU as unknown as Record<string, (message: string, title: string, options: Record<string, unknown>) => JQuery<HTMLElement> | null>)[type]?.(message, title, finalOptions) ?? null;
}
