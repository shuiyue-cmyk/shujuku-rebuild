import { countAiModelOutputFloors_ACU, isAiModelOutputFloor_ACU } from '../../shared/ai-floor';
import type { ContinuationHostGenerationCapture_ACU } from './model';

export type ContinuationHostRetryMode_ACU = 'regenerate' | 'generate';

/** Hash the pre-send floor shape/content, excluding plugin envelope fields. */
export function hostBoundaryFingerprint_ACU(chat: readonly unknown[]): string {
  const payload = JSON.stringify(chat.map(message => {
    const record = message && typeof message === 'object' && !Array.isArray(message) ? message as Record<string, unknown> : {};
    return {
      messageId: record.message_id ?? null,
      isUser: record.is_user === true,
      isSystem: record.is_system === true,
      role: String(record.role ?? ''),
      name: String(record.name ?? ''),
      mes: String(record.mes ?? ''),
      swipeId: String(record.swipe_id ?? ''),
    };
  }));
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `bf-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Stable, non-content identity for the instruction floor used by host retry. */
export function hostMessageFingerprint_ACU(message: Record<string, unknown>): string {
  const text = JSON.stringify({
    is_user: message.is_user === true,
    mes: String(message.mes ?? ''),
    name: String(message.name ?? ''),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fp-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function hasInstructionAnchor_ACU(chat: readonly unknown[], capture: ContinuationHostGenerationCapture_ACU): boolean {
  if (!Number.isInteger(capture.instructionIndex) || typeof capture.instructionFingerprint !== 'string') return false;
  const index = capture.instructionIndex as number;
  if (index < 0 || index >= chat.length) return false;
  const message = chat[index];
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const record = message as Record<string, unknown>;
  return record.is_user === true && hostMessageFingerprint_ACU(record) === capture.instructionFingerprint;
}

/**
 * 依据发送时捕获的快照判断「让宿主重试当前轮」是否仍然安全，以及该用哪条原语。
 *
 * AI 楼数只能说明“可能多了一楼”，不能说明这楼属于本轮。必须同时锁定发送时的
 * 指令用户楼和尾部相对形状；旧快照没有锚点时直接 fail-closed，避免删错楼或改投新用户消息。
 */
export function resolveHostRetryMode_ACU(chat: readonly unknown[], capture: ContinuationHostGenerationCapture_ACU): ContinuationHostRetryMode_ACU | null {
  if (!Array.isArray(chat) || !chat.length || !hasInstructionAnchor_ACU(chat, capture)) return null;
  const aiCount = countAiModelOutputFloors_ACU(chat as unknown[]);
  const last = chat[chat.length - 1];
  const instructionIndex = capture.instructionIndex as number;
  if (
    aiCount === capture.capturedAiFloorCount + 1
    && isAiModelOutputFloor_ACU(last)
    && chat.length === instructionIndex + 2
  ) return 'regenerate';
  if (
    aiCount === capture.capturedAiFloorCount
    && !isAiModelOutputFloor_ACU(last)
    && chat.length === instructionIndex + 1
  ) return 'generate';
  return null;
}

/** The pre-send boundary must still be unchanged before the adapter is called. */
export function isHostSendBoundaryIntact_ACU(chat: readonly unknown[], capture: ContinuationHostGenerationCapture_ACU): boolean {
  if (!Array.isArray(chat) || chat.length !== capture.capturedChatLength) return false;
  if (capture.boundaryFingerprint !== undefined && hostBoundaryFingerprint_ACU(chat) !== capture.boundaryFingerprint) return false;
  return countAiModelOutputFloors_ACU(chat as unknown[]) === capture.capturedAiFloorCount;
}
