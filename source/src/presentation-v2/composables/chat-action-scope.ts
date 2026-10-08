/**
 * 危险操作的「所属聊天」快照（R10A-01 / R10A-03 / R10A-04）。
 * 页面在弹确认框之前拍下快照，确认后执行前核对：聊天已经切换就不执行。
 * 确认框里写的范围、目标都是针对弹出时那个聊天的，不能落到用户没确认过的聊天上。
 */
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../../service/runtime/state-manager';

export interface ChatActionScope_ACU {
  chatIdentity: string;
  isolationKey: string;
}

export const CHAT_ACTION_SCOPE_CHANGED_MESSAGE_ACU = '确认期间当前聊天或隔离标识已切换，本次操作未执行；请在当前聊天重新操作。';

export function captureChatActionScope_ACU(): ChatActionScope_ACU {
  return {
    chatIdentity: String(currentChatFileIdentifier_ACU || ''),
    isolationKey: String(getCurrentIsolationKey_ACU() || ''),
  };
}

export function isChatActionScopeCurrent_ACU(scope: ChatActionScope_ACU | null | undefined): boolean {
  if (!scope) return true;
  return String(currentChatFileIdentifier_ACU || '') === scope.chatIdentity
    && String(getCurrentIsolationKey_ACU() || '') === scope.isolationKey;
}
