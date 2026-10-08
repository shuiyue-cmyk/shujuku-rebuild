/**
 * 剧情推进挂在聊天消息上的运行时标记（R8-12）。
 * 原先直接写成消息对象上的 `_plot_processed` / `_qrf_plot_pending_hash` 字段，会随聊天文件落盘，
 * 异常路径还只清掉其中一个。这些标记只在本次生成流程内有意义，改为按消息对象登记在 WeakMap 里，
 * 重载聊天（消息对象换新）即自然失效。写入时顺手清掉旧版残留在消息上的同名字段。
 */
const processedMessages = new WeakSet<object>();
const pendingHashes = new WeakMap<object, string>();

function isMessageObject(message: unknown): message is Record<string, any> {
  return !!message && typeof message === 'object';
}

function stripLegacyMarkers(message: Record<string, any>): void {
  if ('_plot_processed' in message) delete message._plot_processed;
  if ('_qrf_plot_pending_hash' in message) delete message._qrf_plot_pending_hash;
}

export function isPlotMessageProcessed_ACU(message: unknown): boolean {
  return isMessageObject(message) && processedMessages.has(message);
}

export function markPlotMessageProcessed_ACU(message: unknown): void {
  if (!isMessageObject(message)) return;
  stripLegacyMarkers(message);
  processedMessages.add(message);
}

export function clearPlotMessageProcessed_ACU(message: unknown): void {
  if (isMessageObject(message)) processedMessages.delete(message);
}

export function getPlotPendingHash_ACU(message: unknown): string | undefined {
  return isMessageObject(message) ? pendingHashes.get(message) : undefined;
}

export function setPlotPendingHash_ACU(message: unknown, hash: string): void {
  if (!isMessageObject(message)) return;
  stripLegacyMarkers(message);
  pendingHashes.set(message, hash);
}

export function clearPlotPendingHash_ACU(message: unknown): void {
  if (isMessageObject(message)) pendingHashes.delete(message);
}
