/**
 * 正文写回目标的身份快照（R9-01）。
 *
 * 正文优化要等 AI 十几秒到一分钟；这期间用户可以滑动（同一楼对象换成新 swipe 的正文）、
 * 删楼（下标 n 变成另一条消息）或切聊天（下标 n 是另一个聊天的楼）。按下标写回会写错楼
 * 甚至写错聊天，所以在读取正文时拍下快照，写回前逐项核对，任一不一致就放弃写回。
 */
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';

export interface ChatMessageWriteTarget_ACU {
  messageIndex: number;
  message: unknown;
  messageId: unknown;
  swipeId: unknown;
  mes: unknown;
  chatIdentity: string;
}

export const CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU = '正文优化期间该楼层已被滑动、删除或修改，或已切换聊天；本次优化结果已丢弃，没有写回。';

export function captureChatMessageWriteTarget_ACU(messageIndex: number): ChatMessageWriteTarget_ACU | null {
  const message = getChatArray_ACU()?.[messageIndex];
  if (!message || typeof message !== 'object') return null;
  return {
    messageIndex,
    message,
    messageId: message.message_id,
    swipeId: message.swipe_id,
    mes: message.mes,
    chatIdentity: String(currentChatFileIdentifier_ACU || ''),
  };
}

export function isChatMessageWriteTargetCurrent_ACU(target: ChatMessageWriteTarget_ACU | null | undefined): boolean {
  if (!target) return false;
  const message = getChatArray_ACU()?.[target.messageIndex];
  return !!message
    && message === target.message
    && message.message_id === target.messageId
    && message.swipe_id === target.swipeId
    && message.mes === target.mes
    && String(currentChatFileIdentifier_ACU || '') === target.chatIdentity;
}
