/**
 * host-document — 解析"宿主"窗口与文档（D15.1）
 *
 * 酒馆助手前端可能跑在楼层 iframe 内，此时 `document.body` 是 iframe 内部，
 * 用户可见的酒馆主页面其实是 `window.parent.document`。新 UI 的根节点、
 * 主题 <style>、SFC 样式注入都必须挂到同一个 host document，否则会出现
 * "console marker 正常但页面无内容"。
 *
 * 解析规则：
 * 1. 从当前 window 沿 parent 链向上探测所有可访问 document
 * 2. 选择最外层可访问 document
 * 3. 否则（顶层窗口或跨域不可访问）→ 当前 window/document
 * 4. 全程 try/catch；跨域抛错时降级到当前文档并打印可检索 warning
 */
import { logWarn_ACU } from '../../shared/utils';

const PARENT_PROBE_MARKER = '[ACU-V2] host-document parent probe';

export type HostDocumentSource = 'parent-document' | 'current-document';

export interface ResolvedHost {
  window: Window;
  document: Document;
  source: HostDocumentSource;
}

let cachedHost: ResolvedHost | null = null;

function probeOutermostAccessibleHost(): ResolvedHost | null {
  if (typeof window === 'undefined') return null;
  let current: Window = window;
  let outermost: { window: Window; document: Document } | null = null;

  while (current) {
    try {
      const doc = current.document;
      if (!doc || !doc.body) break;
      outermost = { window: current, document: doc };

      const parent = current.parent;
      if (!parent || parent === current) break;
      current = parent as Window;
    } catch (err) {
      logWarn_ACU(`${PARENT_PROBE_MARKER}: parent inaccessible (likely cross-origin), falling back. ${(err as Error)?.message ?? err}`);
      break;
    }
  }

  if (!outermost || outermost.window === window) return null;
  return { window: outermost.window, document: outermost.document, source: 'parent-document' };
}

/**
 * 解析并缓存 host window/document。后续重复调用直接返回缓存。
 *
 * 缓存原因：jsdom 测试场景里我们会 defineProperty 修改 window.parent，
 * 但运行时 host 不会变；缓存避免重复 try/catch 噪音。
 * 测试通过 __resetHostDocumentCacheForTests 清缓存。
 */
export function resolveAcuHost(): ResolvedHost {
  if (cachedHost) return cachedHost;
  const fromParent = probeOutermostAccessibleHost();
  if (fromParent) {
    cachedHost = fromParent;
    return cachedHost;
  }
  cachedHost = {
    window,
    document: window.document,
    source: 'current-document',
  };
  return cachedHost;
}

export function getAcuHostWindow(): Window {
  return resolveAcuHost().window;
}

export function getAcuHostDocument(): Document {
  return resolveAcuHost().document;
}

export function getAcuHostSource(): HostDocumentSource {
  return resolveAcuHost().source;
}

/**
 * 仅供测试使用：重置内部缓存，让后续 resolveAcuHost 重新探测。
 */
export function __resetHostDocumentCacheForTests(): void {
  cachedHost = null;
}
