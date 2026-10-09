/**
 * 正文写回目标的身份快照（R9-01）。
 *
 * 正文优化要等 AI 十几秒到一分钟；这期间用户可以滑动（同一楼对象换成新 swipe 的正文）、
 * 删楼（下标 n 变成另一条消息）或切聊天（下标 n 是另一个聊天的楼）。按下标写回会写错楼
 * 甚至写错聊天，所以在读取正文时拍下快照，写回前逐项核对，任一不一致就放弃写回。
 */
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { stripMvuUpdateBlocks_ACU } from '../../shared/text-optimization';

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

/**
 * 读取正文之后本楼只被追加了 MVU 变量块时返回这段尾巴，否则返回 null。
 * MVU「额外模型解析」把结果按「最新正文去尾空白 + '\n\n' + 变量块」拼到本楼末尾；这不是滑动、删楼或改写，
 * 正文替换应写回原文部分并保留尾巴，而不是整轮作废。
 * 只认「空白开头、去掉变量块后不剩文字」的尾巴：「继续」续写或手动补字同样是追加，
 * 但拼到改写过的句子后面会出乱句，仍按楼层已修改拒绝写回。
 */
export function findAppendedTailSinceCapture_ACU(target: ChatMessageWriteTarget_ACU | null | undefined): string | null {
  if (!target || typeof target.mes !== 'string') return null;
  const message = getChatArray_ACU()?.[target.messageIndex];
  if (!message
    || message !== target.message
    || message.message_id !== target.messageId
    || message.swipe_id !== target.swipeId
    || String(currentChatFileIdentifier_ACU || '') !== target.chatIdentity) return null;
  const current = message.mes;
  const base = target.mes.trimEnd();
  if (typeof current !== 'string' || !base || current.length <= base.length || !current.startsWith(base)) return null;
  const tail = current.slice(base.length);
  if (!/^\s/.test(tail) || !tail.trim()) return null;
  return stripMvuUpdateBlocks_ACU(tail) === '' ? tail : null;
}
