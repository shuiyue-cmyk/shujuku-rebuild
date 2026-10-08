/**
 * 模板变更的「破坏性确认后重提」唯一实现（R10A-04 / R10A-23；原先三处复制）。
 *
 * 流程：不带确认标志提交（单次 stale 重试）→ 若被「删除表/列需要显式确认」拦下则弹确认 →
 * 确认后先核对所属聊天未切换、再不带确认标志重算一次，待删的表/列与用户看到的完全一致
 * 才带 destructiveChangeConfirmed 提交。否则不执行删除，返回失败结果交给调用方提示。
 */
import { CHAT_ACTION_SCOPE_CHANGED_MESSAGE_ACU, captureChatActionScope_ACU, isChatActionScopeCurrent_ACU } from './chat-action-scope';

export const DESTRUCTIVE_BLOCKERS_CHANGED_MESSAGE_ACU = '确认期间待删除的表或列发生变化，本次未执行删除；请重新操作并确认。';

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

function sameBlockerSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
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
  // 用户确认的是弹窗里那份删除清单；确认期间计划可能变了（模板被别处改动），重算核对。
  const recheck = await applyWithSingleStaleRetry(false);
  const currentBlockers = extractDestructiveTemplateBlockers_ACU(recheck);
  if (!currentBlockers) return recheck;
  if (!sameBlockerSet(currentBlockers, confirmedBlockers)) {
    return { ...recheck, error: DESTRUCTIVE_BLOCKERS_CHANGED_MESSAGE_ACU };
  }
  return applyWithSingleStaleRetry(true);
}
