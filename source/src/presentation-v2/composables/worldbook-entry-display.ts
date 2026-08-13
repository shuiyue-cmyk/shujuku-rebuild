import type { WorldbookSkillMeta_ACU } from '../../service/agent/agent-worldbook-skill-meta';
import { isEntryBlocked_ACU } from '../../shared/utils';
import type { AgentWorldbookControlSnapshot_ACU, AgentWorldbookControlSnapshotEntry_ACU } from '../../shared/models/agent-worldbook-model';

export type WorldbookEntryTakeoverState_ACU =
  | 'native'
  | 'skill_ready'
  | 'taken_over'
  | 'final_greenlight'
  | 'initial_disabled';

export interface WorldbookEntryDisplayItem_ACU {
  uid: number;
  bookName: string;
  label: string;
  comment: string;
  skillMeta: WorldbookSkillMeta_ACU | null;
  hasSkill: boolean;
  agentTakeoverState: WorldbookEntryTakeoverState_ACU;
  checked: boolean;
  skillifySelected: boolean;
  skillifySelectable: boolean;
  isConstant?: boolean;
  disabled: boolean;
}

export interface WorldbookEntryDisplayGroup_ACU {
  bookName: string;
  entries: WorldbookEntryDisplayItem_ACU[];
  expanded: boolean;
}

export interface WorldbookSkillifySelectedEntry_ACU {
  bookName: string;
  uid: number;
}

export interface WorldbookEntryDisplayView_ACU {
  enabled: boolean;
  type: string;
  keys: string[];
  isConstant: boolean;
  disabled: boolean;
}

export function buildWorldbookSnapshotEntryIndexByBook_ACU(
  snapshot: AgentWorldbookControlSnapshot_ACU,
): Map<string, Map<string, AgentWorldbookControlSnapshotEntry_ACU>> {
  const result = new Map<string, Map<string, AgentWorldbookControlSnapshotEntry_ACU>>();
  if (snapshot.active !== true) return result;
  for (const [bookName, entries] of Object.entries(snapshot.books || {})) {
    if (!Array.isArray(entries)) continue;
    const entriesByUid = new Map(
      entries
        .filter((entry): entry is AgentWorldbookControlSnapshotEntry_ACU => !!entry
          && entry.takeoverStatus !== 'pending'
          && String(entry.uid ?? '') !== '')
        .map(entry => [String(entry.uid), entry]),
    );
    if (entriesByUid.size > 0) result.set(bookName, entriesByUid);
  }
  return result;
}

export function getWorldbookSnapshotEntryForDisplay_ACU(
  snapshotEntryIndexByBook: Map<string, Map<string, AgentWorldbookControlSnapshotEntry_ACU>>,
  bookName: string,
  entry: any,
): AgentWorldbookControlSnapshotEntry_ACU | undefined {
  return snapshotEntryIndexByBook.get(bookName)?.get(String(entry?.uid));
}

export function buildWorldbookEntryDisplayView_ACU(
  entry: any,
  snapshotEntry?: AgentWorldbookControlSnapshotEntry_ACU,
): WorldbookEntryDisplayView_ACU {
  const enabled = snapshotEntry ? snapshotEntry.previousEnabled : entry?.enabled !== false;
  const type = snapshotEntry?.previousType ?? String(entry?.type || '');
  const keys = snapshotEntry?.previousKeys ?? (Array.isArray(entry?.keys)
    ? entry.keys
    : (entry?.key ? [entry.key] : []));
  return {
    enabled,
    type,
    keys,
    isConstant: type.trim().toLowerCase() === 'constant',
    disabled: !enabled,
  };
}

export function isWorldbookEntryVisibleForPageUI_ACU(
  bookName: string,
  entry: any,
  snapshotEntryIndexByBook: Map<string, Map<string, AgentWorldbookControlSnapshotEntry_ACU>>,
): boolean {
  if (getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry)) return true;
  const comment = String(entry?.comment || entry?.name || '');
  const commentWithoutIsolationPrefix = comment.replace(/^ACU-\[[^\]]+\]-/, '');
  if (!commentWithoutIsolationPrefix.trim().startsWith('外部导入-')) {
    const normalized = commentWithoutIsolationPrefix.replace(/^外部导入-(?:[^-]+-)?/, '');
    if (normalized.startsWith('TavernDB-ACU-OutlineTable')
      || normalized.startsWith('TavernDB-ACU-')
      || normalized.startsWith('重要人物条目')
      || normalized.startsWith('总结条目')
      || normalized.startsWith('小总结条目')) return false;
  }
  return !isEntryBlocked_ACU({ comment });
}

export function resolveWorldbookEntryTakeoverState_ACU(
  entry: any,
  hasSkill: boolean,
  snapshotEntry?: AgentWorldbookControlSnapshotEntry_ACU,
): WorldbookEntryTakeoverState_ACU {
  if (snapshotEntry) {
    return entry?.enabled !== false && String(entry?.type || '').trim().toLowerCase() === 'constant'
      ? 'final_greenlight'
      : 'taken_over';
  }
  if (entry?.enabled === false) return 'initial_disabled';
  return hasSkill ? 'skill_ready' : 'native';
}
