import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { restoreLegacyRowIdentity_ACU } from '../../shared/canonical-row-normalizer';
import { validateCanonicalCheckpointData_ACU } from '../../shared/canonical-checkpoint-validator';
import type { Spv79TransitionCheckpointV1_ACU } from './storage-frame-v2-types';

export interface Spv79TransitionCheckpointRef_ACU {
  messageIndex: number;
  aiFloor: number;
  checkpoint: Spv79TransitionCheckpointV1_ACU;
}

function hasValidScheduleSummary_ACU(value: unknown): boolean {
  return value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(summary => !!summary
      && typeof summary === 'object' && !Array.isArray(summary)
      && ((summary as Record<string, unknown>).lastFilledAiFloor === undefined
        || (Number.isFinite((summary as Record<string, unknown>).lastFilledAiFloor)
          && Number((summary as Record<string, unknown>).lastFilledAiFloor) >= 0))
      && ((summary as Record<string, unknown>).lastChangedAiFloor === undefined
        || (Number.isFinite((summary as Record<string, unknown>).lastChangedAiFloor)
          && Number((summary as Record<string, unknown>).lastChangedAiFloor) >= 0))));
}

function isCheckpoint_ACU(value: unknown): value is Spv79TransitionCheckpointV1_ACU {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Record<string, unknown>;
  const cutoff = checkpoint.cutoff as Record<string, unknown> | undefined;
  const canonicalData = validateCanonicalCheckpointData_ACU(checkpoint.data);
  return checkpoint.kind === 'spv79_duplicate_row_id_transition'
    && checkpoint.version === 1
    && Number.isFinite(checkpoint.createdAt) && Number(checkpoint.createdAt) >= 0
    && canonicalData.valid
    && !!cutoff
    && Number.isInteger(cutoff.messageIndex) && Number(cutoff.messageIndex) >= 0
    && Number.isInteger(cutoff.seq) && Number(cutoff.seq) >= 0
    && Number.isInteger(cutoff.operationIndex) && Number(cutoff.operationIndex) >= -1
    && hasValidScheduleSummary_ACU(checkpoint.scheduleSummary);
}

export function findLatestSpv79TransitionCheckpoint_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  maxMessageIndex?: number,
): Spv79TransitionCheckpointRef_ACU | null {
  if (!Array.isArray(chat)) return null;
  const upperBound = maxMessageIndex === undefined
    ? chat.length - 1
    : Math.min(chat.length - 1, Math.max(-1, Math.floor(maxMessageIndex)));
  let aiFloor = 0;
  let latest: Spv79TransitionCheckpointRef_ACU | null = null;
  for (let messageIndex = 0; messageIndex <= upperBound; messageIndex += 1) {
    const message = chat[messageIndex];
    if (!message || message.is_user) continue;
    aiFloor += 1;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    const checkpoint = tagData?.spv79TransitionCheckpoint;
    if (isCheckpoint_ACU(checkpoint)) latest = { messageIndex, aiFloor, checkpoint };
  }
  return latest;
}

/**
 * Frame-level artifacts (full/per-sheet checkpoints and timelines) have no
 * operation cursor. A transition root therefore owns every such artifact up
 * to and including the cutoff message.
 */
export function isFrameArtifactAfterSpv79TransitionCutoff_ACU(
  messageIndex: number,
  checkpoint: Spv79TransitionCheckpointV1_ACU,
): boolean {
  return messageIndex > checkpoint.cutoff.messageIndex;
}

/** Entry-level events have a seq but no operationIndex, so the cutoff entry is absorbed whole. */
export function isEntryAfterSpv79TransitionCutoff_ACU(
  messageIndex: number,
  seq: number,
  checkpoint: Spv79TransitionCheckpointV1_ACU,
): boolean {
  if (messageIndex !== checkpoint.cutoff.messageIndex) return messageIndex > checkpoint.cutoff.messageIndex;
  return seq > checkpoint.cutoff.seq;
}

export function isAfterSpv79TransitionCutoff_ACU(
  messageIndex: number,
  seq: number,
  operationIndex: number,
  checkpoint: Spv79TransitionCheckpointV1_ACU,
): boolean {
  const cutoff = checkpoint.cutoff;
  if (messageIndex !== cutoff.messageIndex) return messageIndex > cutoff.messageIndex;
  if (seq !== cutoff.seq) return seq > cutoff.seq;
  return operationIndex > cutoff.operationIndex;
}

export function cloneSpv79TransitionData_ACU(checkpoint: Spv79TransitionCheckpointV1_ACU): TableDataObject_ACU {
  return JSON.parse(JSON.stringify(checkpoint.data)) as TableDataObject_ACU;
}

/**
 * 将旧回放的最终可见状态转为新版行身份。旧身份不再参与后续普通 V2 增量，
 * 因此按每张表的物理行序统一重编号，而不是猜测 duplicate row_id 的历史归属。
 */
export function reindexSpv79TransitionState_ACU(source: TableDataObject_ACU): TableDataObject_ACU {
  const data = JSON.parse(JSON.stringify(source)) as TableDataObject_ACU;
  restoreLegacyRowIdentity_ACU(data);
  Object.entries(data).forEach(([sheetKey, value]) => {
    if (!sheetKey.startsWith('sheet_') || !value || typeof value !== 'object') return;
    const sheet = value as any;
    if (!Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) return;
    sheet.content[0][0] = 'row_id';
    let nextId = 1;
    for (let index = 1; index < sheet.content.length; index += 1) {
      if (!Array.isArray(sheet.content[index])) continue;
      sheet.content[index][0] = String(nextId++);
    }
    if (Array.isArray(sheet.seedRows)) {
      sheet.seedRows.forEach((row: unknown) => {
        if (Array.isArray(row)) row[0] = String(nextId++);
      });
    }
  });
  return data;
}
