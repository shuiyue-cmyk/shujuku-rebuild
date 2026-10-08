/**
 * V2 单根不变量的共用工具：同一隔离键同一时刻只允许一个 full checkpoint。
 * 由混合存储提交（mixed-storage-commit）抽出，硬删表的终态根也复用（R2B-07）。
 */
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { countAiFloors_ACU } from '../../shared/ai-floor';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import type { TableDataObject_ACU } from '../../shared/models/table-data';

function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function aiFloor_ACU(chat: any[], index: number): number { return countAiFloors_ACU(chat.slice(0, index + 1)); }

/**
 * 写入新根（migration 根 / 硬删表后的终态根）后，同一隔离键下其余 full checkpoint（原 V2 anchor 及更早的根）
 * 必须同事务降级，否则形成多根：回放只认最后一个 full，之前增量全部失效，且后续
 * 手动重填会被锚点预检阻断。降级语义对齐 chat-service 的 checkpoint fallback：
 * checkpoint.data（含 perSheetCheckpoints 覆盖）转为 seq ≤ 0 的 data_replace fallback
 * logEntry 前置到原帧，随后删除 checkpoint——数学上不改变回放输出（降级帧位于新根
 * 之前，回放从新根起步）且原数据无损保留在帧内。
 */
export function downgradeOtherFullCheckpoints_ACU(chat: any[], isolationKey: string, keepIndex: number): number {
  let downgraded = 0;
  for (let index = 0; index < chat.length; index += 1) {
    if (index === keepIndex) continue;
    const message = chat[index];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) continue;
    const frame = tagData.storageFrame;
    const checkpoint = frame.checkpoint;
    if (checkpoint?.kind !== 'full') continue;
    const existingEntries = Array.isArray(frame.logEntries) ? frame.logEntries : [];
    const finiteSeqs = existingEntries.map((entry: any) => Number(entry?.seq)).filter(Number.isFinite);
    const seq = Math.min(0, (finiteSeqs.length > 0 ? Math.min(...finiteSeqs) : 1) - 1);
    const fallbackData = clone_ACU(checkpoint.data || {}) as Record<string, any>;
    const sheetCheckpoints = frame.perSheetCheckpoints;
    if (sheetCheckpoints && typeof sheetCheckpoints === 'object' && !Array.isArray(sheetCheckpoints)) {
      for (const [sheetKey, sheetCheckpoint] of Object.entries<any>(sheetCheckpoints)) {
        if (
          !sheetKey.startsWith('sheet_')
          || !sheetCheckpoint
          || sheetCheckpoint.kind !== 'sheet_full'
          || sheetCheckpoint.sheetKey !== sheetKey
          || !sheetCheckpoint.data
          || typeof sheetCheckpoint.data !== 'object'
          || Array.isArray(sheetCheckpoint.data)
        ) continue;
        fallbackData[sheetKey] = clone_ACU(sheetCheckpoint.data);
      }
    }
    const sheetKeys = Object.keys(fallbackData).filter(key => key.startsWith('sheet_'));
    // 导入语义必须随降级一起保留：reason==='import' 的 full 根是用户显式导入的权威快照，
    // 手动重填的 importOverlap 守卫与 chat-message-data-repo 的范围清理守卫都据此保护它。
    // 降级若一律改写成 checkpoint_fallback + source:'system'，删除 checkpoint 后这一帧在两个
    // 守卫眼里都退化成普通历史增量，破坏性重填会静默覆盖导入数据（V2-b 高危）。
    const isImportCheckpoint = checkpoint.reason === 'import';
    frame.logEntries = [{
      seq,
      entryId: `downgraded-checkpoint-${index}-${checkpoint.createdAt || Date.now()}`,
      createdAt: checkpoint.createdAt || Date.now(),
      source: isImportCheckpoint ? 'import' : 'system',
      targetMessageIndex: index,
      aiFloor: aiFloor_ACU(chat, index),
      filledSheetKeys: sheetKeys,
      changedSheetKeys: sheetKeys,
      groupKeys: [],
      operations: [{ kind: 'data_replace', data: fallbackData as TableDataObject_ACU, reason: isImportCheckpoint ? 'import' : 'checkpoint_fallback' }],
      writeSet: [{ kind: 'all' }],
    }, ...existingEntries];
    delete frame.checkpoint;
    downgraded += 1;
  }
  return downgraded;
}
