import { logWarn_ACU } from '../../shared/utils';

const tableUpdateApplyLocks_ACU = new Map<string, Promise<void>>();

export function buildTableUpdateApplyScopeKey_ACU(parts: {
  chatKey?: string | null;
  isolationKey?: string | null;
  targetMessageIndex?: number | null;
}): string {
  const chatKey = String(parts.chatKey || 'current-chat').trim() || 'current-chat';
  const isolationKey = String(parts.isolationKey || 'default').trim() || 'default';
  const targetKey = Number.isInteger(parts.targetMessageIndex)
    ? String(parts.targetMessageIndex)
    : 'latest-ai';
  return [chatKey, isolationKey, targetKey].join('::');
}

export async function runTableUpdateApplyWithScopeLock_ACU<T>(
  scopeKey: string,
  task: () => Promise<T>,
): Promise<T> {
  const active = tableUpdateApplyLocks_ACU.get(scopeKey);
  if (active) {
    await active.catch((error) => {
      logWarn_ACU('[表格并发写入] 前序同scope任务失败，继续执行后续任务:', error);
    });
    return runTableUpdateApplyWithScopeLock_ACU(scopeKey, task);
  }

  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  tableUpdateApplyLocks_ACU.set(scopeKey, current);

  try {
    return await task();
  } finally {
    releaseLock();
    if (tableUpdateApplyLocks_ACU.get(scopeKey) === current) {
      tableUpdateApplyLocks_ACU.delete(scopeKey);
    }
  }
}
