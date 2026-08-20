import { ref, shallowRef } from 'vue';
import { getLorebookEntriesByNames_ACU } from '../../service/worldbook/pipeline';
import { getLorebookEntries_ACU, setLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import { refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU } from '../../service/agent/agent-worldbook-takeover';
import {
  buildWorldbookSnapshotEntryIndexByBook_ACU,
  getWorldbookSnapshotEntryForDisplay_ACU,
  resolveWorldbookEntryTakeoverState_ACU,
} from './worldbook-entry-display';
import {
  deleteWorldbookEntrySkillMeta_ACU,
  parseWorldbookSkillMetaFromComment_ACU,
  saveWorldbookEntrySkillMeta_ACU,
  type WorldbookSkillMeta_ACU,
  type WorldbookSkillMetaUpdatedBy_ACU,
} from '../../service/agent/agent-worldbook-skill-meta';
import { isWorldbookEntrySkillifyCandidate_ACU } from '../../service/agent/agent-skillify-service';
import { resolveAgentWorldbookScopeBookNames_ACU } from '../../service/agent/agent-worldbook-config-meta';
import { logError_ACU } from '../../shared/utils';
import { buildWorldbookEntryDisplayLabel_ACU } from '../../shared/agent-worldbook-comment';
import type {
  WorldbookEntryDisplayGroup_ACU,
  WorldbookEntryDisplayItem_ACU,
  WorldbookEntryTakeoverState_ACU,
  WorldbookSkillifySelectedEntry_ACU,
} from './worldbook-entry-display';

export type AgentWorldbookEntryTakeoverState = WorldbookEntryTakeoverState_ACU;
export type AgentWorldbookEntryLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export type AgentWorldbookEntryItem = WorldbookEntryDisplayItem_ACU;
export type AgentWorldbookEntryGroup = WorldbookEntryDisplayGroup_ACU;
export type AgentWorldbookSkillifySelectedEntry = WorldbookSkillifySelectedEntry_ACU;

function getEntryLabel_ACU(entry: any): string {
  return buildWorldbookEntryDisplayLabel_ACU(String(entry?.comment || entry?.name || ''), entry?.uid);
}

function selectionKey_ACU(bookName: string, uid: number): string {
  return `${bookName}\u0000${String(uid)}`;
}

function isAgentWorldbookEntryVisible_ACU(
  bookName: string,
  entry: any,
  skillMeta: WorldbookSkillMeta_ACU | null,
  snapshotEntry: unknown,
): boolean {
  return isWorldbookEntrySkillifyCandidate_ACU(entry)
    || skillMeta !== null
    || !!snapshotEntry;
}

export interface UseAgentWorldbookEntriesOptions {
  onSkillMetaChanged?: () => Promise<unknown> | unknown;
}

export function useAgentWorldbookEntries(options: UseAgentWorldbookEntriesOptions = {}) {
  const groups = shallowRef<AgentWorldbookEntryGroup[]>([]);
  const status = ref<AgentWorldbookEntryLoadStatus>('idle');
  const error = ref('');
  const selected = ref(new Map<string, AgentWorldbookSkillifySelectedEntry>());
  const batchBusy = ref(false);

  async function loadEntries(): Promise<string[]> {
    status.value = 'loading';
    error.value = '';
    try {
      const bookNames = await resolveAgentWorldbookScopeBookNames_ACU();
      const uniqueBookNames = [...new Set(bookNames.map(name => String(name || '').trim()).filter(Boolean))];
      if (uniqueBookNames.length === 0) {
        groups.value = [];
        selected.value = new Map();
        status.value = 'success';
        return [];
      }
      const snapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();
      const snapshotEntryIndexByBook = buildWorldbookSnapshotEntryIndexByBook_ACU(snapshot);
      const entriesByBook = await getLorebookEntriesByNames_ACU(uniqueBookNames) as Record<string, any[]>;
      const nextGroups: AgentWorldbookEntryGroup[] = [];
      const visibleSelections = new Set<string>();
      for (const bookName of uniqueBookNames) {
        const entries = Array.isArray(entriesByBook[bookName]) ? entriesByBook[bookName] : [];
        const items = entries.flatMap((entry: any): AgentWorldbookEntryItem[] => {
          const comment = String(entry?.comment || entry?.name || '');
          const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
          const snapshotEntry = getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry);
          if (!isAgentWorldbookEntryVisible_ACU(bookName, entry, skillMeta, snapshotEntry)) {
            return [];
          }
          const key = selectionKey_ACU(bookName, entry.uid);
          visibleSelections.add(key);
          const isConstant = String((entry as any)?.type || '').trim().toLowerCase() === 'constant';
          return [{
            uid: entry.uid,
            bookName,
            label: getEntryLabel_ACU(entry),
            comment,
            skillMeta,
            hasSkill: !!skillMeta,
            agentTakeoverState: resolveWorldbookEntryTakeoverState_ACU(entry, !!skillMeta, snapshotEntry),
            checked: false,
            skillifySelected: selected.value.has(key),
            skillifySelectable: isWorldbookEntrySkillifyCandidate_ACU(entry),
            isConstant,
            disabled: false,
          }];
        });
        if (items.length > 0) nextGroups.push({ bookName, entries: items, expanded: false });
      }
      selected.value = new Map([...selected.value].filter(([key]) => visibleSelections.has(key)));
      groups.value = nextGroups;
      status.value = 'success';
      return uniqueBookNames;
    } catch (cause: any) {
      logError_ACU('[ACU-V2] useAgentWorldbookEntries loadEntries failed', cause);
      error.value = cause?.message || '加载 Agent 世界书条目失败';
      status.value = 'error';
      return [];
    }
  }

  function syncSelection(): void {
    groups.value = groups.value.map(group => ({
      ...group,
      entries: group.entries.map(entry => ({ ...entry, skillifySelected: selected.value.has(selectionKey_ACU(entry.bookName, entry.uid)) })),
    }));
  }

  function toggleSkillifyEntry(bookName: string, uid: number, checked: boolean): void {
    const key = selectionKey_ACU(bookName, uid);
    const next = new Map(selected.value);
    const entry = groups.value.find(group => group.bookName === bookName)?.entries.find(item => item.uid === uid);
    if (checked && entry?.skillifySelectable) {
      next.set(key, { bookName, uid });
    } else {
      next.delete(key);
    }
    selected.value = next;
    syncSelection();
  }

  function selectAllForSkillify(): void {
    selected.value = new Map(groups.value.flatMap(group => group.entries
      .filter(entry => entry.skillifySelectable)
      .map(entry => [
        selectionKey_ACU(entry.bookName, entry.uid),
        { bookName: entry.bookName, uid: entry.uid },
      ] as const)));
    syncSelection();
  }

  function deselectAllForSkillify(): void {
    selected.value = new Map();
    syncSelection();
  }

  function getSelectedSkillifyEntries(): AgentWorldbookSkillifySelectedEntry[] {
    return Array.from(selected.value.values());
  }

  function updateEntrySkillMetaLocal(bookName: string, uid: number, comment: string): void {
    const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
    groups.value = groups.value.map(group => {
      if (group.bookName !== bookName) return group;
      return {
        ...group,
        entries: group.entries.map(entry => {
          if (entry.uid !== uid) return entry;
          return {
            ...entry,
            comment,
            label: buildWorldbookEntryDisplayLabel_ACU(comment, uid),
            skillMeta,
            hasSkill: !!skillMeta,
          };
        }),
      };
    });
  }

  async function notifySkillMetaChanged(): Promise<void> {
    if (!options.onSkillMetaChanged) return;
    try {
      await options.onSkillMetaChanged();
    } catch (cause) {
      logError_ACU('[ACU-V2] sync Agent worldbook takeover after Skill meta change failed', cause);
    }
  }

  async function saveEntrySkillMeta(
    bookName: string,
    uid: number,
    draft: Partial<WorldbookSkillMeta_ACU>,
    updatedBy: WorldbookSkillMetaUpdatedBy_ACU = 'manual',
  ): Promise<void> {
    const result = await saveWorldbookEntrySkillMeta_ACU(bookName, uid, draft, updatedBy);
    if (result.entry && typeof result.entry.comment === 'string') {
      updateEntrySkillMetaLocal(bookName, uid, result.entry.comment);
    }
    if (result.updated) await notifySkillMetaChanged();
  }

  async function deleteEntrySkillMeta(bookName: string, uid: number): Promise<void> {
    const result = await deleteWorldbookEntrySkillMeta_ACU(bookName, uid);
    if (result.entry && typeof result.entry.comment === 'string') {
      updateEntrySkillMetaLocal(bookName, uid, result.entry.comment);
    }
    if (result.updated) await notifySkillMetaChanged();
  }

  function toggleGroupExpanded(bookName: string): void {
    groups.value = groups.value.map(group => group.bookName === bookName ? { ...group, expanded: !group.expanded } : group);
  }

  /**
   * 收集目标条目（按书分组 uid 列表）。
   * predicate 逐条判定是否命中；命中条目 uid 按 bookName 归组，供批量读改写回。
   */
  function collectTargetUidsByBook(predicate: (entry: AgentWorldbookEntryItem) => boolean): Map<string, number[]> {
    const byBook = new Map<string, number[]>();
    for (const group of groups.value) {
      for (const entry of group.entries) {
        if (!predicate(entry)) continue;
        const bookName = String(entry.bookName || '').trim();
        if (!bookName) continue;
        const list = byBook.get(bookName) ?? [];
        list.push(entry.uid);
        byBook.set(bookName, list);
      }
    }
    return byBook;
  }

  /** 世界书编辑①：把「skill 化且当前关闭（enabled=false，initial_disabled）」的条目一键启用 */
  async function batchEnableDisabledSkillEntries(): Promise<number> {
    if (batchBusy.value) return 0;
    batchBusy.value = true;
    const byBook = collectTargetUidsByBook(entry => entry.hasSkill === true && entry.agentTakeoverState === 'initial_disabled');
    let changed = 0;
    try {
      for (const [bookName, uids] of byBook) {
        const uidSet = new Set(uids.map(uid => String(uid)));
        try {
          const all = await getLorebookEntries_ACU(bookName);
          let touchedInBook = 0;
          const patched = (Array.isArray(all) ? all : []).map(entry => {
            if (!uidSet.has(String(entry.uid))) return entry;
            if (entry.enabled === false) {
              touchedInBook++;
              return { ...entry, enabled: true };
            }
            return entry;
          });
          if (touchedInBook === 0) continue;
          await setLorebookEntries_ACU(bookName, patched);
          changed += touchedInBook;
        } catch (cause: any) {
          logError_ACU(`[ACU-V2] 启用 skill 世界书失败（${bookName}）`, cause);
        }
      }
    } finally {
      batchBusy.value = false;
    }
    if (changed > 0) {
      try { await loadEntries(); } catch {}
      try { await notifySkillMetaChanged(); } catch {}
    }
    return changed;
  }

  /** 世界书编辑②：把「skill 化且当前为蓝灯（type=constant，恒常注入）」的条目转为绿灯（去掉 constant，改由 agent 放行） */
  async function batchConvertBlueToGreenEntries(): Promise<number> {
    if (batchBusy.value) return 0;
    batchBusy.value = true;
    const byBook = collectTargetUidsByBook(entry => entry.hasSkill === true && entry.isConstant === true);
    let changed = 0;
    try {
      for (const [bookName, uids] of byBook) {
        const uidSet = new Set(uids.map(uid => String(uid)));
        try {
          const all = await getLorebookEntries_ACU(bookName);
          let touchedInBook = 0;
          const patched = (Array.isArray(all) ? all : []).map(entry => {
            if (!uidSet.has(String(entry.uid))) return entry;
            const currentType = String(entry.type || '').trim().toLowerCase();
            if (currentType === 'constant') {
              touchedInBook++;
              return { ...entry, type: '' };
            }
            return entry;
          });
          if (touchedInBook === 0) continue;
          await setLorebookEntries_ACU(bookName, patched);
          changed += touchedInBook;
        } catch (cause: any) {
          logError_ACU(`[ACU-V2] 蓝灯转绿灯失败（${bookName}）`, cause);
        }
      }
    } finally {
      batchBusy.value = false;
    }
    if (changed > 0) {
      try { await loadEntries(); } catch {}
      try { await notifySkillMetaChanged(); } catch {}
    }
    return changed;
  }

  /** 世界书编辑③二合一：skill 化蓝灯变绿灯，然后绿灯全开启（两步合并为一次遍历） */
  async function batchCombinedBlueToGreenAndEnable(): Promise<{ converted: number; enabled: number }> {
    if (batchBusy.value) return { converted: 0, enabled: 0 };
    batchBusy.value = true;
    const blueByBook = collectTargetUidsByBook(entry => entry.hasSkill === true && entry.isConstant === true);
    const disabledByBook = collectTargetUidsByBook(entry => entry.hasSkill === true && entry.agentTakeoverState === 'initial_disabled');
    const allBooks = new Set<string>([...blueByBook.keys(), ...disabledByBook.keys()]);
    let converted = 0;
    let enabled = 0;
    try {
      for (const bookName of allBooks) {
        const blueSet = new Set((blueByBook.get(bookName) || []).map(uid => String(uid)));
        const disabledSet = new Set((disabledByBook.get(bookName) || []).map(uid => String(uid)));
        try {
          const all = await getLorebookEntries_ACU(bookName);
          let convertedInBook = 0;
          let enabledInBook = 0;
          const patched = (Array.isArray(all) ? all : []).map(entry => {
            const uidStr = String(entry.uid);
            let next = entry;
            if (blueSet.has(uidStr)) {
              const currentType = String(entry.type || '').trim().toLowerCase();
              if (currentType === 'constant') { next = { ...next, type: '' }; convertedInBook++; }
            }
            if (disabledSet.has(uidStr) && (entry as any).enabled === false) {
              next = { ...next, enabled: true }; enabledInBook++;
            }
            return next;
          });
          if (convertedInBook > 0 || enabledInBook > 0) {
            await setLorebookEntries_ACU(bookName, patched);
            converted += convertedInBook;
            enabled += enabledInBook;
          }
      } catch (cause: any) {
        logError_ACU(`[ACU-V2] 二合一失败（${bookName}）`, cause);
      }
    }
      if (converted > 0 || enabled > 0) {
        try { await loadEntries(); } catch {}
        try { await notifySkillMetaChanged(); } catch {}
      }
    } finally {
      batchBusy.value = false;
    }
    return { converted, enabled };
  }

  return {
    groups,
    status,
    error,
    loadEntries,
    toggleSkillifyEntry,
    selectAllForSkillify,
    deselectAllForSkillify,
    getSelectedSkillifyEntries,
    saveEntrySkillMeta,
    deleteEntrySkillMeta,
    toggleGroupExpanded,
    batchEnableDisabledSkillEntries,
    batchConvertBlueToGreenEntries,
    batchCombinedBlueToGreenAndEnable,
  };
}
