/**
 * usePlotWorldbookEntries — 剧情推进世界书条目级启用/禁用
 *
 * 从 service 层加载条目列表，过滤掉数据库生成条目和屏蔽词条目，
 * 暴露 reactive 分组列表 + selectAll / deselectAll / toggleEntry，
 * 持久化到 plotWorldbookConfig.enabledEntries。
 */
import { ref, shallowRef } from 'vue';
import { getLorebookEntriesByNames_ACU } from '../../service/worldbook/pipeline';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU } from '../../service/agent/agent-worldbook-takeover';
import {
  parseWorldbookSkillMetaFromComment_ACU,
} from '../../service/agent/agent-worldbook-skill-meta';
import { logError_ACU } from '../../shared/utils';
import { buildWorldbookEntryDisplayLabel_ACU } from '../../shared/agent-worldbook-comment';
import {
  buildWorldbookEntryDisplayView_ACU,
  buildWorldbookSnapshotEntryIndexByBook_ACU,
  getWorldbookSnapshotEntryForDisplay_ACU,
  isWorldbookEntryVisibleForPageUI_ACU,
  resolveWorldbookEntryTakeoverState_ACU,
  type
  WorldbookEntryDisplayGroup_ACU,
  WorldbookEntryDisplayItem_ACU,
  WorldbookEntryTakeoverState_ACU,
} from './worldbook-entry-display';

export type WorldbookEntryAgentTakeoverState = WorldbookEntryTakeoverState_ACU;
export type WorldbookEntryItem = WorldbookEntryDisplayItem_ACU;
export type WorldbookEntryGroup = WorldbookEntryDisplayGroup_ACU;

export type EntryLoadStatus = 'idle' | 'loading' | 'success' | 'error';

function buildWorldbookEntryLabel_ACU(entry: any): string {
  return buildWorldbookEntryDisplayLabel_ACU(String(entry?.comment || entry?.name || ''), entry?.uid);
}

function ensurePlotWorldbookConfig(): Record<string, any> {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object') {
    settings_ACU.plotSettings = {} as Record<string, any>;
  }
  const plot = settings_ACU.plotSettings as Record<string, any>;
  if (!plot.plotWorldbookConfig || typeof plot.plotWorldbookConfig !== 'object') {
    plot.plotWorldbookConfig = { source: 'character', manualSelection: [], enabledEntries: {} };
  }
  const cfg = plot.plotWorldbookConfig;
  if (!cfg.enabledEntries || typeof cfg.enabledEntries !== 'object') {
    cfg.enabledEntries = {};
  }
  return cfg;
}

export function usePlotWorldbookEntries() {
  const groups = shallowRef<WorldbookEntryGroup[]>([]);
  const status = ref<EntryLoadStatus>('idle');
  const error = ref('');

  async function loadEntries(bookNames: string[]): Promise<void> {
    const unique = [...new Set(bookNames.filter(Boolean))];
    if (unique.length === 0) {
      groups.value = [];
      status.value = 'success';
      return;
    }

    status.value = 'loading';
    error.value = '';

    try {
      const cfg = ensurePlotWorldbookConfig();
      const snapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();
      const entriesMap = await getLorebookEntriesByNames_ACU(unique) as Record<string, any[]>;
      const snapshotEntryIndexByBook = buildWorldbookSnapshotEntryIndexByBook_ACU(snapshot);
      let settingsChanged = false;
      const result: WorldbookEntryGroup[] = [];

      for (const bookName of unique) {
        const bookEntries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
        const visibleBookEntries = bookEntries.filter((entry: any) => isWorldbookEntryVisibleForPageUI_ACU(bookName, entry, snapshotEntryIndexByBook));
        const visibleUidSet = new Set(visibleBookEntries.map((entry: any) => String(entry?.uid)));

        if (typeof cfg.enabledEntries[bookName] === 'undefined') {
          cfg.enabledEntries[bookName] = visibleBookEntries
            .filter((entry: any) => buildWorldbookEntryDisplayView_ACU(
              entry,
              getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry),
            ).enabled)
            .map((entry: any) => entry.uid);
          settingsChanged = true;
        } else if (Array.isArray(cfg.enabledEntries[bookName])) {
          const cleanedEnabledEntries = cfg.enabledEntries[bookName]
            .filter((uid: any) => visibleUidSet.has(String(uid)));
          if (cleanedEnabledEntries.length !== cfg.enabledEntries[bookName].length) {
            cfg.enabledEntries[bookName] = cleanedEnabledEntries;
            settingsChanged = true;
          }
        }

        const enabledList: number[] = Array.isArray(cfg.enabledEntries[bookName])
          ? cfg.enabledEntries[bookName]
          : [];

        const buildItems = (entries: any[]): WorldbookEntryItem[] => entries.map((entry: any) => {
          const comment = String(entry?.comment || entry?.name || '');
          const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
          const snapshotEntry = getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry);
          const displayView = buildWorldbookEntryDisplayView_ACU(entry, snapshotEntry);
          return {
            uid: entry.uid,
            bookName,
            label: buildWorldbookEntryLabel_ACU(entry),
            comment,
            skillMeta,
            hasSkill: !!skillMeta,
            agentTakeoverState: resolveWorldbookEntryTakeoverState_ACU(entry, !!skillMeta, snapshotEntry),
            checked: enabledList.includes(entry.uid),
            skillifySelected: false,
            skillifySelectable: false,
            isConstant: displayView.isConstant,
            disabled: displayView.disabled,
          };
        });

        const visible = buildItems(visibleBookEntries);

        if (visible.length > 0) {
          result.push({ bookName, entries: visible, expanded: false });
        }
      }

      if (settingsChanged) saveSettings_ACU();
      groups.value = result;
      status.value = 'success';
    } catch (e: any) {
      logError_ACU('[ACU-V2] usePlotWorldbookEntries loadEntries failed', e);
      error.value = e?.message ?? '加载条目失败';
      status.value = 'error';
    }
  }

  function reportLoadFailure(): void {
    error.value = '加载角色世界书失败';
    status.value = 'error';
  }

  function toggleEntry(bookName: string, uid: number, checked: boolean): void {
    const cfg = ensurePlotWorldbookConfig();
    if (!Array.isArray(cfg.enabledEntries[bookName])) {
      cfg.enabledEntries[bookName] = [];
    }
    const list: number[] = cfg.enabledEntries[bookName];
    const idx = list.indexOf(uid);
    if (checked && idx === -1) list.push(uid);
    else if (!checked && idx !== -1) list.splice(idx, 1);
    saveSettings_ACU();

    groups.value = groups.value.map(g => {
      if (g.bookName !== bookName) return g;
      return {
        ...g,
        entries: g.entries.map(e =>
          e.uid === uid ? { ...e, checked } : e,
        ),
      };
    });
  }

  function selectAll(): void {
    const cfg = ensurePlotWorldbookConfig();
    for (const group of groups.value) {
      cfg.enabledEntries[group.bookName] = group.entries
        .filter(e => !e.disabled)
        .map(e => e.uid);
    }
    saveSettings_ACU();

    groups.value = groups.value.map(g => ({
      ...g,
      entries: g.entries.map(e => ({ ...e, checked: !e.disabled })),
    }));
  }

  function deselectAll(): void {
    const cfg = ensurePlotWorldbookConfig();
    for (const group of groups.value) {
      cfg.enabledEntries[group.bookName] = [];
    }
    saveSettings_ACU();

    groups.value = groups.value.map(g => ({
      ...g,
      entries: g.entries.map(e => ({ ...e, checked: false })),
    }));
  }

  function toggleGroupExpanded(bookName: string): void {
    groups.value = groups.value.map(g => {
      if (g.bookName !== bookName) return g;
      return { ...g, expanded: !g.expanded };
    });
  }

  return {
    groups,
    status,
    error,
    loadEntries,
    reportLoadFailure,
    toggleEntry,
    selectAll,
    deselectAll,
    toggleGroupExpanded,
  };
}
