import type {
  AgentWorldbookControlSnapshot_ACU
} from '../../shared/models/agent-worldbook-model';
import {
  getLorebookEntries_ACU,
  setLorebookEntries_ACU
} from '../../data/gateways/worldbook-gateway';
import {
  logWarn_ACU
} from '../../shared/utils';
import {
  buildAgentWorldbookSnapshotSelectionSignature_ACU
} from '../../shared/agent-worldbook-snapshot';
import { decideAgentWorldbookEntryRestore_ACU, isAgentWorldbookEntryRestored_ACU, selectRestorableSnapshotEntries_ACU, type AgentWorldbookRestorePatch_ACU } from './agent-worldbook-restore-core';

export interface AgentWorldbookSnapshotRestoreResult_ACU {
  restored: number;
  skipped: number;
  failed: number;
  signatureMatched: boolean;
  rollbackPatchesByBook: Record<string, Record<string, any>[]>;
  restoredPatchesByBook: Record<string, Record<string, any>[]>;
}

function isSamePatchValue_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function doesEntryMatchPatch_ACU(entry: any, patch: Record<string, any>): boolean {
  if (!entry || String(entry.uid) !== String(patch.uid)) return false;
  return Object.entries(patch)
    .filter(([key]) => key !== 'uid')
    .every(([key, value]) => isSamePatchValue_ACU(entry[key], value));
}

async function readConfirmedPatches_ACU(
  bookName: string,
  patches: Record<string, any>[],
): Promise<Record<string, any>[]> {
  const entries = await getLorebookEntries_ACU(bookName);
  const entriesByUid = new Map((entries || []).map(entry => [String(entry?.uid), entry]));
  return patches.filter(patch => doesEntryMatchPatch_ACU(entriesByUid.get(String(patch.uid)), patch));
}

/**
 * 恢复操作实际改动过的字段在写入前的值。仅保存此次 restore patch 涉及的字段，
 * 使调用方可在后续 scope 配置持久化失败时将条目恢复为接管中的原始状态。
 */
export async function rollbackAgentWorldbookSnapshotRestore_ACU(
  rollbackPatchesByBook: Record<string, Record<string, any>[]>,
  restoredPatchesByBook: Record<string, Record<string, any>[]>,
): Promise<boolean> {
  let succeeded = true;
  for (const [rawBookName, patches] of Object.entries(rollbackPatchesByBook || {})) {
    const bookName = String(rawBookName || '').trim();
    if (!bookName || !Array.isArray(patches) || patches.length === 0) continue;
    try {
      const restoredPatches = restoredPatchesByBook?.[bookName];
      if (!Array.isArray(restoredPatches) || restoredPatches.length === 0) {
        succeeded = false;
        logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复缺少恢复后状态：${bookName}`);
        continue;
      }
      const restoredByUid = new Map(restoredPatches.map(patch => [String(patch.uid), patch]));
      const entries = await getLorebookEntries_ACU(bookName);
      const entriesByUid = new Map((entries || []).map(entry => [String(entry?.uid), entry]));
      const safePatches = patches.filter(patch => {
        const restoredPatch = restoredByUid.get(String(patch.uid));
        return restoredPatch !== undefined
          && doesEntryMatchPatch_ACU(entriesByUid.get(String(patch.uid)), restoredPatch);
      });
      if (safePatches.length !== patches.length) {
        succeeded = false;
        logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复发生并发冲突：${bookName}`);
      }
      if (safePatches.length === 0) continue;
      await setLorebookEntries_ACU(bookName, safePatches);
      const confirmed = await readConfirmedPatches_ACU(bookName, safePatches);
      if (confirmed.length !== safePatches.length) {
        succeeded = false;
        logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复未被完整确认：${bookName}`);
      }
    } catch (error) {
      succeeded = false;
      logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复失败：${bookName}`, error);
    }
  }
  return succeeded;
}

export function buildAgentWorldbookSelectionSignature_ACU(bookNames: string[]): string {
  return buildAgentWorldbookSnapshotSelectionSignature_ACU(bookNames);
}


export async function restoreAgentWorldbookSnapshotEntries_ACU(
  snapshot: AgentWorldbookControlSnapshot_ACU,
  expectedBookNames: string[],
): Promise<AgentWorldbookSnapshotRestoreResult_ACU> {
  const expectedSignature = buildAgentWorldbookSelectionSignature_ACU(expectedBookNames);
  if (snapshot.active !== true || snapshot.selectionSignature !== expectedSignature) {
    return {
      restored: 0,
      skipped: 0,
      failed: 0,
      signatureMatched: false,
      rollbackPatchesByBook: {},
      restoredPatchesByBook: {},
    };
  }

  let restored = 0;
  let skipped = 0;
  let failed = 0;
  const rollbackPatchesByBook: Record<string, Record<string, any>[]> = {};
  const restoredPatchesByBook: Record<string, Record<string, any>[]> = {};
  for (const [rawBookName, rawSnapshotEntries] of Object.entries(snapshot.books || {})) {
    const bookName = String(rawBookName || '').trim();
    // 逐条目决策与「已恢复」判定走共用核心（R4-07），与接管停用同口径：pending 条目不碰；
    // 注释被改过的条目跳过且保留接管块（不再先剥后靠整体回滚补救）。缺指纹照常恢复、宽松剥离残留接管块是 scope 路径的既定口径。
    const snapshotEntries = selectRestorableSnapshotEntries_ACU(rawSnapshotEntries);
    if (!bookName || snapshotEntries.length === 0) continue;
    try {
      const entries = await getLorebookEntries_ACU(bookName);
      const currentByUid = new Map((entries || []).map(entry => [String(entry?.uid), entry]));
      const patches: AgentWorldbookRestorePatch_ACU[] = [];
      const rollbackPatches: Record<string, any>[] = [];
      for (const snapshotEntry of snapshotEntries) {
        const decision = decideAgentWorldbookEntryRestore_ACU(snapshotEntry, currentByUid.get(String(snapshotEntry?.uid)), { missingCommentHash: 'restore', metaStripMode: 'loose' });
        // 条目已被宿主删除：无可恢复对象，不算 skipped（否则 scope 变更永远被拒）。
        if (decision.kind === 'missing') continue;
        if (decision.kind !== 'restore') {
          skipped += 1;
          continue;
        }
        patches.push(decision.patch);
        rollbackPatches.push(decision.preImage);
      }
      if (patches.length > 0) {
        // 宿主批量写在 reject 前仍可能已应用部分 patch，因此先保留完整 pre-image。
        rollbackPatchesByBook[bookName] = rollbackPatches;
        restoredPatchesByBook[bookName] = patches as Record<string, any>[];
        let writeFailed = false;
        try {
          await setLorebookEntries_ACU(bookName, patches);
        } catch (error) {
          writeFailed = true;
          logWarn_ACU(`[Agent世界书] 恢复世界书条目写入失败：${bookName}`, error);
        }
        try {
          const afterByUid = new Map((await getLorebookEntries_ACU(bookName) || []).map(entry => [String(entry?.uid), entry]));
          const confirmedUidSet = new Set(patches
            .filter(restorePatch => isAgentWorldbookEntryRestored_ACU(afterByUid.get(String(restorePatch.uid)), restorePatch))
            .map(restorePatch => String(restorePatch.uid)));
          rollbackPatchesByBook[bookName] = rollbackPatches.filter(rollbackPatch => confirmedUidSet.has(String(rollbackPatch.uid)));
          restoredPatchesByBook[bookName] = patches.filter(restorePatch => confirmedUidSet.has(String(restorePatch.uid))) as Record<string, any>[];
          if (rollbackPatchesByBook[bookName].length === 0) delete rollbackPatchesByBook[bookName];
          if (restoredPatchesByBook[bookName].length === 0) delete restoredPatchesByBook[bookName];
          if (writeFailed || confirmedUidSet.size !== patches.length) {
            failed += snapshotEntries.length;
          } else {
            restored += patches.length;
          }
        } catch (error) {
          // 无法读回时不能假定零副作用；保留完整 pre-image 交由上层补偿。
          failed += snapshotEntries.length;
          logWarn_ACU(`[Agent世界书] 恢复世界书条目后确认失败：${bookName}`, error);
        }
      }
    } catch (error) {
      logWarn_ACU(`[Agent世界书] 恢复世界书条目失败：${bookName}`, error);
      failed += snapshotEntries.length;
    }
  }
  return { restored, skipped, failed, signatureMatched: true, rollbackPatchesByBook, restoredPatchesByBook };
}
