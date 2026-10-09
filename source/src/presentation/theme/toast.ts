// toast.ts — presentation 层 toast 通知（含主题样式注入+消息过滤+去重）
// 核心逻辑原位于 service/runtime/toast-service.ts，已搬回 presentation 层

import { toastr_API_ACU } from '../../shared/host-api';
import { SCRIPT_ID_PREFIX_ACU, ACU_TOAST_CATEGORY_ACU, ACU_HOST_SURFACE_CLASS_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { logDebug_ACU } from '../../shared/utils';
import { settings_ACU } from '../../service/runtime/state-manager';
import { escapeHtml_ACU, renderToastActionButton_ACU } from '../../shared/html-helpers';
import { registerHostToastRenderer_ACU, type UiToastPayload_ACU } from '../../shared/ui-surface-registry';

// toast 相关状态
export const ACU_TOAST_TITLE_ACU = 'UnbirthDB';
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
      /* UnbirthDB 插件提示框：与新界面提示框同一套设计，颜色取当前主题 token
         （主题注入器给 .acu-host-surface 写 token；未注入时回退默认浅色）。 */
      #toast-container > .acu-toast.toast {
        --acu-toast-tone: var(--acu-accent, #2F5FD0);
        --acu-toast-font: var(--acu-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
        position: relative !important;
        width: min(420px, calc(100vw - 24px)) !important;
        margin: 0 0 8px !important;
        padding: 10px 36px 10px 42px !important;
        border: 1px solid var(--acu-border, rgba(28, 27, 24, 0.08)) !important;
        border-radius: 14px !important;
        background: color-mix(in srgb, var(--acu-bg-1, #FFFFFF) 94%, transparent) !important;
        background-image: none !important;
        color: var(--acu-text-1, #1C1B18) !important;
        box-shadow: var(--acu-shadow, 0 12px 32px rgba(28, 27, 24, 0.12)) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        opacity: 1 !important;
        overflow: hidden !important;
        font-family: var(--acu-toast-font) !important;
        font-size: 13.5px !important;
        font-weight: 400 !important;
        line-height: 1.5 !important;
        letter-spacing: normal !important;
        text-shadow: none !important;
      }
      #toast-container > .acu-toast.toast:not(:has(> .toast-close-button)) {
        padding-right: 14px !important;
      }
      #toast-container > .acu-toast.toast:hover {
        box-shadow: var(--acu-shadow, 0 12px 32px rgba(28, 27, 24, 0.12)) !important;
        opacity: 1 !important;
      }
      #toast-container > .acu-toast.acu-toast--success { --acu-toast-tone: var(--acu-success, #3F7A55); }
      #toast-container > .acu-toast.acu-toast--warning { --acu-toast-tone: var(--acu-warning, #8F6420); }
      #toast-container > .acu-toast.acu-toast--error { --acu-toast-tone: var(--acu-danger, #B4483F); }

      /* 类型图标：与新界面相同的 Font Awesome 实心图标，取类型色 */
      #toast-container > .acu-toast.toast::before {
        content: "\\f05a";
        position: absolute;
        left: 15px;
        top: 11px;
        width: 16px;
        text-align: center;
        font-family: "Font Awesome 6 Free", "Font Awesome 5 Free", "FontAwesome";
        font-weight: 900;
        font-style: normal;
        font-size: 15px;
        line-height: 21px;
        color: var(--acu-toast-tone);
        -webkit-font-smoothing: antialiased;
      }
      #toast-container > .acu-toast.acu-toast--success::before { content: "\\f058"; }
      #toast-container > .acu-toast.acu-toast--warning::before { content: "\\f071"; }
      #toast-container > .acu-toast.acu-toast--error::before { content: "\\f06a"; }

      /* 标题（默认 UnbirthDB）做成小号来源标签，正文为主 */
      #toast-container > .acu-toast .toast-title {
        margin: 0 0 1px !important;
        color: var(--acu-text-3, #8A8780) !important;
        font: 600 11.5px/1.45 var(--acu-toast-font) !important;
        letter-spacing: 0.02em !important;
        text-shadow: none !important;
        background: transparent !important;
      }
      #toast-container > .acu-toast .toast-message {
        color: var(--acu-text-1, #1C1B18) !important;
        font: 400 13.5px/1.5 var(--acu-toast-font) !important;
        overflow-wrap: anywhere;
        text-shadow: none !important;
        background: transparent !important;
      }
      #toast-container > .acu-toast .toast-message a {
        color: color-mix(in srgb, var(--acu-accent, #2F5FD0) 82%, var(--acu-text-1, #1C1B18)) !important;
      }
      #toast-container > .acu-toast .toast-close-button {
        position: absolute !important;
        top: 8px !important;
        right: 8px !important;
        float: none !important;
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        width: 22px !important;
        height: 22px !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 7px !important;
        background: transparent !important;
        color: var(--acu-text-3, #8A8780) !important;
        font: 400 17px/1 var(--acu-toast-font) !important;
        opacity: 1 !important;
        text-shadow: none !important;
        cursor: pointer;
      }
      #toast-container > .acu-toast .toast-close-button:hover {
        background: var(--acu-hover-overlay, rgba(28, 27, 24, 0.05)) !important;
        color: var(--acu-text-1, #1C1B18) !important;
      }
      #toast-container > .acu-toast .toast-progress {
        left: 0 !important;
        bottom: 0 !important;
        height: 2px !important;
        border-radius: 0 !important;
        background: var(--acu-toast-tone) !important;
        opacity: 0.5 !important;
      }

      /* 提示框里的操作按钮（终止 / 取消优化 / 规划中止） */
      #toast-container > .acu-toast .toast-message > div:has(> .acu-toast-action),
      #toast-container > .acu-toast .toast-message > div:has(> .qrf-abort-btn) {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      #toast-container > .acu-toast .acu-toast-action,
      #toast-container > .acu-toast .qrf-abort-btn {
        float: right;
        flex: 0 0 auto;
        margin: 0 0 0 10px !important;
        min-height: 26px;
        padding: 3px 11px !important;
        border: 1px solid color-mix(in srgb, var(--acu-toast-tone) 42%, transparent) !important;
        border-radius: 9px !important;
        background: color-mix(in srgb, var(--acu-toast-tone) 12%, transparent) !important;
        color: color-mix(in srgb, var(--acu-toast-tone) 78%, var(--acu-text-1, #1C1B18)) !important;
        font: 600 12.5px/1.4 var(--acu-toast-font) !important;
        box-shadow: none !important;
        text-shadow: none !important;
        cursor: pointer !important;
        transition: background-color 0.15s ease;
      }
      #toast-container > .acu-toast .acu-toast-action:hover,
      #toast-container > .acu-toast .qrf-abort-btn:hover {
        background: color-mix(in srgb, var(--acu-toast-tone) 22%, transparent) !important;
      }
      #toast-container > .acu-toast .acu-toast-action:disabled {
        opacity: 0.55;
        cursor: default !important;
      }

      @media (max-width: 520px) {
        #toast-container > .acu-toast.toast {
          width: min(380px, calc(100vw - 16px)) !important;
          padding: 9px 34px 9px 38px !important;
        }
        #toast-container > .acu-toast.toast::before {
          left: 13px;
          top: 10px;
          font-size: 14px;
        }
        #toast-container > .acu-toast .toast-message {
          font-size: 13px !important;
        }
      }
    `;
    doc.head.appendChild(style);
    _acuToastStyleInjected_ACU = true;
  } catch (e) {
    _acuToastStyleInjected_ACU = true;
  }
}

/** 调用方可自带 toastClass；样式与主题 token 依赖的类必须始终在场。 */
function withRequiredToastClasses_ACU(toastClass: unknown, type: unknown): string {
  const classes = String(toastClass || '').split(/\s+/).filter(Boolean);
  const required = ['toast', 'acu-toast', ACU_HOST_SURFACE_CLASS_ACU];
  if (!classes.some(c => c.startsWith('acu-toast--'))) required.push(`acu-toast--${String(type)}`);
  for (const c of required) if (!classes.includes(c)) classes.push(c);
  return classes.join(' ');
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
  finalOptions.toastClass = withRequiredToastClasses_ACU(finalOptions.toastClass, type);
  return { title, finalOptions };
}

function _acuShouldShowToast_ACU(type: any, title: any, message: any, options: any = {}) {
  try {
    if (!settings_ACU?.toastMuteEnabled) return true;
    if (options?.acuBypassMute === true) return true;
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

// ═══ 富文本净化（toast repair 路径专用，v9.1.8）═══
// repairEscapedMessage 用 innerHTML 重写消息节点，message 内容此前未经过任何过滤；
// 虽然调用方都是插件内部代码，但宿主/美化脚本注入的 toastr 替换实现可能把任意
// 字符串送进该路径。这里按白名单净化后再注入，骰子/美化的富文本形状
// （div/span/table + style/class）必须原样通过，输出不变（0214ca7 契约）。

/** 允许保留的标签：既有富文本用例（optimization-ui 的 div/br/small/button、plot-planning 的
 * div/span/button、骰子形状 div/span/table）+ 常规排版标签。button 必须保留，否则
 * qrf-abort-btn / acu-opt-stop-btn 等中止按钮会被剥掉导致功能回归。 */
const TOAST_HTML_ALLOWED_TAGS_ACU: ReadonlySet<string> = new Set([
  'div', 'span', 'p', 'br', 'hr', 'small', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'code', 'pre', 'blockquote',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'ul', 'ol', 'li',
  'a', 'img', 'button',
]);

/** 连内容一起整个移除的危险标签（脚本/样式/外链资源/插件嵌入点）。 */
const TOAST_HTML_REMOVE_TAGS_ACU: ReadonlySet<string> = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'noscript', 'template',
  'svg', 'math', 'form', 'input', 'select', 'textarea', 'option',
  'audio', 'video', 'source', 'track', 'applet', 'frame', 'frameset', 'dialog', 'portal', 'slot', 'title',
]);

/** 无条件保留的安全属性；on* 事件属性一律剥除。id 必须保留：repair 重写发生在
 * onShown 之后、调用方按 id 绑定按钮（#acu-opt-stop-btn 等）之前/之后均需能找到。 */
const TOAST_HTML_SAFE_ATTRS_ACU: ReadonlySet<string> = new Set([
  'style', 'class', 'id', 'colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'title',
]);

/** URL 白名单：http(s) 绝对地址；img 额外放行非 SVG 位图 data:image/*（SVG 可带脚本，不放行）。
 * 归一化时剥掉所有控制符与空白，防 java\tscript: 之类混淆绕过。 */
function _acuIsSafeToastUrl_ACU(value: string, allowDataImage: boolean): boolean {
  const normalized = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (/^https?:/.test(normalized)) return true;
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp|bmp|avif);/.test(normalized)) return true;
  return false;
}

/**
 * 按白名单净化富文本 toast 标记：危险标签连内容移除、未知标签解包保留文本、
 * on* 事件属性剥除、javascript:/data:(非图片) URL 的 href/src 剥除；style/class
 * 保留（骰子/美化依赖）。非浏览器环境（无 DOMParser）返回空串（宁可不渲染富文本）。
 */
export function sanitizeToastHtml_ACU(raw: string): string {
  if (typeof DOMParser === 'undefined') return '';
  try {
    const doc = new DOMParser().parseFromString(String(raw ?? ''), 'text/html');
    const sanitizeElement = (el: Element): void => {
      const tag = el.tagName.toLowerCase();
      if (TOAST_HTML_REMOVE_TAGS_ACU.has(tag)) {
        el.remove();
        return;
      }
      if (!TOAST_HTML_ALLOWED_TAGS_ACU.has(tag)) {
        // 未知标签：先净化子树再解包，保留其中的文本与合法标记。
        Array.from(el.children).forEach(child => sanitizeElement(child));
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          el.remove();
        }
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
        // href/src 先于通用白名单判定：按标签 + URL 白名单决定去留
        if (name === 'href') {
          if (tag !== 'a' || !_acuIsSafeToastUrl_ACU(attr.value, false)) el.removeAttribute(attr.name);
          continue;
        }
        if (name === 'src') {
          if (tag !== 'img' || !_acuIsSafeToastUrl_ACU(attr.value, true)) el.removeAttribute(attr.name);
          continue;
        }
        if (!TOAST_HTML_SAFE_ATTRS_ACU.has(name)) { el.removeAttribute(attr.name); continue; }
      }
      Array.from(el.children).forEach(child => sanitizeElement(child));
    };
    Array.from(doc.body.children).forEach(child => sanitizeElement(child));
    return doc.body.innerHTML;
  } catch (e) {
    return '';
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
            // v9.1.8：白名单净化后再注入（剥 script/iframe/on*/javascript: 等），
            // 骰子/美化形状 div/span/table+style 经白名单原样通过，渲染输出不变。
            el.innerHTML = sanitizeToastHtml_ACU(raw);
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

let hostToastActionSeq_ACU = 0;

/**
 * 面板未打开时的统一提示（加载失败引导、回放告警等）走插件提示框：与新界面同一设计、跟随主题；
 * 带操作的提示渲染为按钮（点提示框任意处同样触发）。这些提示原本直接调宿主 toastr，从不被静默。
 */
export function showHostSurfaceToast_ACU(payload: UiToastPayload_ACU): void {
  const action = payload.action;
  const text = escapeHtml_ACU(String(payload.text ?? ''));
  if (!action) {
    showToastr_ACU(payload.kind, text, { escapeHtml: false, acuBypassMute: true });
    return;
  }
  const buttonId = `acu-toast-action-${++hostToastActionSeq_ACU}`;
  showToastr_ACU(payload.kind, `<div><span>${text}</span>${renderToastActionButton_ACU(buttonId, action.label)}</div>`, {
    escapeHtml: false,
    acuBypassMute: true,
    timeOut: 8000,
    onclick: () => { void action.onClick(); },
  });
}

registerHostToastRenderer_ACU(showHostSurfaceToast_ACU);
