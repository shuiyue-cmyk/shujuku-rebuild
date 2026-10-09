/**
 * 全局错误来源判定：全局错误捕获会收到页面上所有未捕获异常（含宿主与其他扩展），
 * 按调用链里是否出现本插件脚本地址区分，避免把宿主报错当成插件报错排查。
 */
export type GlobalErrorOrigin_ACU = 'own' | 'foreign' | 'unknown';

/** 去掉查询串与锚点：宿主可能带缓存参数加载脚本，调用链里的地址仍以这段开头。 */
export function normalizeScriptUrl_ACU(url: unknown): string {
  const text = String(url || '').trim();
  if (!text) return '';
  return text.replace(/[?#].*$/, '');
}

/**
 * @param detail 错误堆栈或出错文件名
 * @param ownScriptUrl 本插件脚本地址（已去查询串）
 * @returns own：调用链含本插件；foreign：有文件位置但都不是本插件；unknown：无从判断
 */
export function classifyGlobalErrorOrigin_ACU(detail: unknown, ownScriptUrl: string): GlobalErrorOrigin_ACU {
  const text = String(detail || '');
  if (!ownScriptUrl || !text) return 'unknown';
  if (text.includes(ownScriptUrl)) return 'own';
  return /[a-z][a-z0-9+.-]*:\/\/|blob:/i.test(text) ? 'foreign' : 'unknown';
}
