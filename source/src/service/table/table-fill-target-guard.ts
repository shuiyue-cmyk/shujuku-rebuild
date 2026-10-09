import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { isAiFloor_ACU } from '../../shared/ai-floor';

/**
 * 填表目标楼层守卫（移植上游 02a523c4 的思路，按本库口径收窄）。
 *
 * 填表从读楼层到写回之间隔着整轮 AI 请求。期间用户若滑动了目标楼层、或删掉重新生成，
 * 这一楼已经是另一条回复，旧回复的填表结果不能再写上去。
 *
 * 只认「是不是同一条回复」，不比正文：正文替换、MVU 追加变量块、「继续」续写都会原地改写同一条回复。
 * - 同一个消息对象：只比滑动页码。「继续」续写会原地改写 send_date / gen_started，不能拿时间戳判。
 * - 消息对象被换掉：删楼重新生成会换对象（时间戳也随之变）；宿主接口整体替换同一条回复时时间戳不变。
 *   所以对象不同时再比滑动页码 + 生成开始时间 + 发送时间。
 */
export interface TableFillTargetGuard_ACU {
  /** 目标楼层是否仍是填表开始时的那条回复；targetIndex 非法（如 -1）时按最新 AI 楼核对。 */
  isCurrent(targetIndex: number | null | undefined, chat?: any[]): boolean;
}

interface FloorSnapshot_ACU {
  message: any;
  swipeId: number;
  fingerprint: string;
}

function normalizeTime_ACU(value: unknown): number | string | null {
  if (value === undefined || value === null || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value as any).getTime();
  return Number.isFinite(time) ? time : String(value);
}

function swipeId_ACU(message: any): number {
  return typeof message?.swipe_id === 'number' ? message.swipe_id : 0;
}

function fingerprint_ACU(message: any): string {
  if (!message || typeof message !== 'object') return 'missing';
  return JSON.stringify([
    message.is_user === true,
    swipeId_ACU(message),
    normalizeTime_ACU(message.gen_started ?? message.extra?.gen_started),
    String(message.send_date ?? ''),
  ]);
}

function isSameReply_ACU(captured: FloorSnapshot_ACU, live: any): boolean {
  if (!live || typeof live !== 'object') return false;
  if (live === captured.message) return swipeId_ACU(live) === captured.swipeId;
  return fingerprint_ACU(live) === captured.fingerprint;
}

/** 与写回层同口径（isAiFloor_ACU）：隐藏楼、工具楼不算 AI 楼。 */
function findLastAiIndex_ACU(chat: any[]): number {
  for (let index = chat.length - 1; index >= 0; index--) {
    if (isAiFloor_ACU(chat[index])) return index;
  }
  return -1;
}

export function captureTableFillTargetGuard_ACU(
  chat: any[],
  readLiveChat: () => any[] = () => getChatArray_ACU() || [],
): TableFillTargetGuard_ACU {
  const source = Array.isArray(chat) ? chat : [];
  const snapshots: FloorSnapshot_ACU[] = source.map(message => ({
    message,
    swipeId: swipeId_ACU(message),
    fingerprint: fingerprint_ACU(message),
  }));
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
      if (index < 0 || index >= snapshots.length) return true;
      return isSameReply_ACU(snapshots[index], live[index]);
    },
  };
}
