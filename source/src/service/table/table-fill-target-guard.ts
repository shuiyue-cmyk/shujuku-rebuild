import { getChatArray_ACU } from '../../data/gateways/chat-gateway';

/**
 * 填表目标楼层守卫（移植上游 02a523c4 的思路，按本库口径收窄）。
 *
 * 填表从读楼层到写回之间隔着整轮 AI 请求。期间用户若滑动了目标楼层、或删掉重新生成，
 * 这一楼已经是另一条回复，旧回复的填表结果不能再写上去。
 *
 * 只认「是不是同一条回复」（滑动页码 + 生成开始时间 + 发送时间），不比正文：
 * 正文替换、MVU 追加变量块、「继续」续写都会原地改写同一条回复的正文，它们不该让填表作废。
 * 也不比对象引用：边界提交会整体重建聊天数组里的消息对象。
 */
export interface TableFillTargetGuard_ACU {
  /** 目标楼层是否仍是填表开始时的那条回复；targetIndex 非法（如 -1）时按最新 AI 楼核对。 */
  isCurrent(targetIndex: number | null | undefined, chat?: any[]): boolean;
}

function normalizeTime_ACU(value: unknown): number | string | null {
  if (value === undefined || value === null || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value as any).getTime();
  return Number.isFinite(time) ? time : String(value);
}

function fingerprint_ACU(message: any): string {
  if (!message || typeof message !== 'object') return 'missing';
  return JSON.stringify([
    message.is_user === true,
    typeof message.swipe_id === 'number' ? message.swipe_id : 0,
    normalizeTime_ACU(message.gen_started ?? message.extra?.gen_started),
    String(message.send_date ?? ''),
  ]);
}

function findLastAiIndex_ACU(chat: any[]): number {
  for (let index = chat.length - 1; index >= 0; index--) {
    if (chat[index] && !chat[index].is_user) return index;
  }
  return -1;
}

export function captureTableFillTargetGuard_ACU(
  chat: any[],
  readLiveChat: () => any[] = () => getChatArray_ACU() || [],
): TableFillTargetGuard_ACU {
  const source = Array.isArray(chat) ? chat : [];
  const fingerprints = source.map(fingerprint_ACU);
  const capturedLastAiIndex = findLastAiIndex_ACU(source);
  return {
    isCurrent(targetIndex, liveChat = readLiveChat()) {
      const live = Array.isArray(liveChat) ? liveChat : [];
      let index = typeof targetIndex === 'number' ? targetIndex : -1;
      if (!Number.isInteger(index) || index < 0) {
        // 「写到最新 AI 楼」：期间新生成了 AI 楼，最新楼已不是开始时那一楼
        if (findLastAiIndex_ACU(live) !== capturedLastAiIndex) return false;
        index = capturedLastAiIndex;
      }
      // 填表开始后才出现的楼层没有可比证据，交给下游既有校验
      if (index < 0 || index >= fingerprints.length) return true;
      return fingerprint_ACU(live[index]) === fingerprints[index];
    },
  };
}
