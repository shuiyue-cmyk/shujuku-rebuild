/**
 * sfc-style-runtime — 运行时 SFC 样式注入器
 *
 * unplugin-vue 把 SFC `<style>` 块拆成虚拟模块（id 形如
 * `*.vue?vue&type=style&...`）。本仓没有引入独立 CSS rollup 插件，
 * 改由 build/rollup-sfc-style-injector.js 把这些虚拟模块改写成
 * `injectSfcStyle(css, key)` 调用，运行时把 CSS 文本以 <style> 形式注入
 * host document。
 *
 * 关键约束：
 * - 每条 css 仅注入一次（按 key 去重；key 由 SFC 模块虚拟 id 提供）
 * - 必须挂到 host document（D15.1）；阶段 0 提供占位 fallback：
 *   先挂当前 document.head，等 host-document helper 在批次 B 落地后
 *   通过 setSfcStyleHost() 切到父文档。
 */

const INJECTED_STYLE_DATA_KEY = 'data-acu-v2-sfc';

interface SfcStyleHost {
  document: Document;
}

let host: SfcStyleHost | null = null;
const pendingStyles = new Map<string, string>();
const flushedKeys = new Set<string>();

function defaultHost(): SfcStyleHost | null {
  if (typeof document === 'undefined') return null;
  return { document };
}

function flushTo(target: SfcStyleHost) {
  for (const [key, css] of pendingStyles) {
    if (flushedKeys.has(key)) continue;
    appendStyleNode(target.document, key, css);
    flushedKeys.add(key);
  }
  pendingStyles.clear();
}

function appendStyleNode(doc: Document, key: string, css: string) {
  const existing = doc.querySelector(`style[${INJECTED_STYLE_DATA_KEY}="${cssKeyAttr(key)}"]`);
  if (existing) return;
  const style = doc.createElement('style');
  style.setAttribute(INJECTED_STYLE_DATA_KEY, cssKeyAttr(key));
  style.textContent = css;
  doc.head.appendChild(style);
}

function cssKeyAttr(key: string): string {
  return key.replace(/[^a-zA-Z0-9_\-:.]/g, '_');
}

/**
 * 由 SFC 虚拟样式模块在加载时调用。
 * key 为模块虚拟 id（含 type=style&index=N），保证同一组件多个 <style> 块互不覆盖。
 */
export function injectSfcStyle(css: string, key: string): void {
  if (flushedKeys.has(key)) return;
  if (host) {
    appendStyleNode(host.document, key, css);
    flushedKeys.add(key);
    return;
  }
  pendingStyles.set(key, css);
  const fallback = defaultHost();
  if (fallback) {
    flushTo(fallback);
    return;
  }
}

/**
 * 由批次 B 的挂载流程在拿到 host document 之后调用，把已经堆积的样式节点
 * 迁移到正确的 host document 上，并把后续注入直接写入 host document。
 *
 * 说明：阶段 0 的 fallback 已经把样式写到了当前 document.head；
 * 如果 host document !== 当前 document（iframe 场景），需要把节点搬过去。
 */
export function setSfcStyleHost(nextHost: SfcStyleHost): void {
  host = nextHost;
  if (typeof document !== 'undefined' && nextHost.document !== document) {
    const stale = document.querySelectorAll(`style[${INJECTED_STYLE_DATA_KEY}]`);
    stale.forEach(node => {
      const key = node.getAttribute(INJECTED_STYLE_DATA_KEY) || '';
      const css = node.textContent || '';
      node.parentNode?.removeChild(node);
      const newNode = nextHost.document.createElement('style');
      newNode.setAttribute(INJECTED_STYLE_DATA_KEY, key);
      newNode.textContent = css;
      nextHost.document.head.appendChild(newNode);
    });
  }
  flushTo(nextHost);
}

/**
 * 仅供测试使用：清空注入状态。
 */
export function __resetSfcStyleRuntimeForTests(): void {
  host = null;
  pendingStyles.clear();
  flushedKeys.clear();
}
