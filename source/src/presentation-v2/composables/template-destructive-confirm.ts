/**
 * 模板变更的「破坏性确认后重提」唯一实现（R10A-04 / R10A-23；原先三处复制）。
 *
 * 流程：不带确认标志提交（单次 stale 重试）→ 若被「删除表/列需要显式确认」拦下则弹确认 →
 * 确认后核对所属聊天未切换，即带 destructiveChangeConfirmed 提交。
 * 不再为「确认弹窗期间删除清单被别处改了」整轮重算：弹窗是模态的，模板结构只由用户操作改动。
 */
import { CHAT_ACTION_SCOPE_CHANGED_MESSAGE_ACU, captureChatActionScope_ACU, isChatActionScopeCurrent_ACU } from './chat-action-scope';

export function isStaleRevisionConflict_ACU(result: unknown): boolean {
  return !!result
    && typeof result === 'object'
    && (result as { saved?: unknown }).saved === false
    && /^V2 stale_revision_conflict(?:\b|:)/.test(String((result as { error?: unknown }).error || ''));
}

/** 被破坏性确认拦下时返回待删表/列的 blockers；否则 null。 */
export function extractDestructiveTemplateBlockers_ACU(result: any): string[] | null {
  if (!result || result.saved !== false || !Array.isArray(result.blockers)) return null;
  const blockers = result.blockers.filter((blocker: unknown): blocker is string => (
    typeof blocker === 'string' && /删除(?:表|列).+需要显式确认/.test(blocker)
  ));
  return blockers.length > 0 ? blockers : null;
}

export async function applyTemplateWithDestructiveConfirm_ACU(
  apply: (destructiveChangeConfirmed: boolean) => Promise<any>,
  options: {
    confirm: (destructiveBlockers: string[]) => Promise<boolean>;
    signal?: AbortSignal | null;
  },
): Promise<any> {
  const scope = captureChatActionScope_ACU();
  const applyWithSingleStaleRetry = async (destructiveChangeConfirmed: boolean): Promise<any> => {
    const firstAttempt = await apply(destructiveChangeConfirmed);
    // stale revision 表示本次计划的 read-plan-commit 窗口已失效。重新进入 service
    // 才会读取新基线；其它 V2 历史错误绝不能通过重试伪装成可恢复状态。
    if (!isStaleRevisionConflict_ACU(firstAttempt)) return firstAttempt;
    if (options.signal?.aborted) return firstAttempt;
    return apply(destructiveChangeConfirmed);
  };

  const firstResult = await applyWithSingleStaleRetry(false);
  const confirmedBlockers = extractDestructiveTemplateBlockers_ACU(firstResult);
  if (!confirmedBlockers) return firstResult;
  if (!(await options.confirm(confirmedBlockers))) return firstResult;
  if (!isChatActionScopeCurrent_ACU(scope)) {
    return { saved: false, error: CHAT_ACTION_SCOPE_CHANGED_MESSAGE_ACU, blockers: [] };
  }
  return applyWithSingleStaleRetry(true);
}
