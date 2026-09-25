import * as runtimeStateManager from '../runtime/state-manager';

export function getAutoMergedOrderScopeKey_ACU(summaryKey: string): string {
  // 用 namespace 读取，兼容只提供部分 state-manager mock 的旧集成测试；
  // 正式运行时仍读取 live binding，不把 chat/isolation 降级为全局单槽。
  const chatKey = (runtimeStateManager as any).currentChatFileIdentifier_ACU || '';
  const isolationGetter = (runtimeStateManager as any).getCurrentIsolationKey_ACU;
  const isolationKey = typeof isolationGetter === 'function' ? isolationGetter() : '';
  return JSON.stringify([
    String(chatKey),
    String(isolationKey || ''),
    String(summaryKey || ''),
  ]);
}
