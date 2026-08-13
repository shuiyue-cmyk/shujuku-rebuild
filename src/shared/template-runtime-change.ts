/**
 * 模板运行时变更通知。
 *
 * 此模块只表达“模板已成功持久化”的事实；不依赖 Vue，也不把失败、取消或
 * 提交前状态伪装成变更。订阅者异常彼此隔离，避免 UI 刷新问题反向影响提交。
 */
export type TemplateRuntimeChangeSubscriber_ACU = () => void;

const subscribers_ACU = new Set<TemplateRuntimeChangeSubscriber_ACU>();

export function notifyTemplateRuntimeCommitted_ACU(): void {
  for (const subscriber of subscribers_ACU) {
    try {
      subscriber();
    } catch {
      // 通知是提交后的附带行为，订阅者故障不得影响其他消费者。
    }
  }
}

export function subscribeTemplateRuntimeChanges_ACU(
  subscriber: TemplateRuntimeChangeSubscriber_ACU,
): () => void {
  subscribers_ACU.add(subscriber);
  return () => subscribers_ACU.delete(subscriber);
}

/** 仅供单元测试验证订阅清理。 */
export function getTemplateRuntimeChangeSubscriberCountForTests_ACU(): number {
  return subscribers_ACU.size;
}
