/**
 * useFormFillWorldbookEntries — 填表"附加世界书条目"启用/禁用（Component B，§4.2）
 *
 * 操作 worldbookConfig.enabledEntries（每张书 → uid[] 列表）。
 * 与 usePlotWorldbookEntries 形态一致，仅作用域不同：
 *   - usePlot…：plotSettings.plotWorldbookConfig.enabledEntries（剧情推进）
 *   - 本文件：worldbookConfig.enabledEntries（填表 / 提示词附带）
 *
 * 同样过滤掉数据库生成条目和包含屏蔽关键词的条目，避免误开关。
 */
import { ref, shallowRef } from 'vue';
import { getLorebookEntriesByNames_ACU } from '../../service/worldbook/pipeline';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
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
} from './worldbook-entry-display';

export type FormFillWorldbookEntryItem = WorldbookEntryDisplayItem_ACU;

export type FormFillWorldbookEntryGroup = WorldbookEntryDisplayGroup_ACU;

export type FormFillEntryLoadStatus = 'idle' | 'loading' | 'success' | 'error';

function ensureEnabledEntries(): Record<string, number[]> {
  const cfg = getCurrentWorldbookConfig_ACU() as any;
  if (!cfg.enabledEntries || typeof cfg.enabledEntries !== 'object') {
    cfg.enabledEntries = {};
  }
  return cfg.enabledEntries;
}

export function useFormFillWorldbookEntries() {
  const groups = shallowRef<FormFillWorldbookEntryGroup[]>([]);
  const status = ref<FormFillEntryLoadStatus>('idle');
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
      const enabledEntries = ensureEnabledEntries();
      const snapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();
      const entriesMap = await getLorebookEntriesByNames_ACU(unique) as Record<string, any[]>;
      const snapshotEntryIndexByBook = buildWorldbookSnapshotEntryIndexByBook_ACU(snapshot);
      let settingsChanged = false;
      const result: FormFillWorldbookEntryGroup[] = [];

      for (const bookName of unique) {
        const bookEntries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
        const visibleBookEntries = bookEntries.filter((entry: any) => isWorldbookEntryVisibleForPageUI_ACU(bookName, entry, snapshotEntryIndexByBook));
        const visibleUidSet = new Set(visibleBookEntries.map((entry: any) => String(entry?.uid)));

        if (typeof enabledEntries[bookName] === 'undefined') {
          enabledEntries[bookName] = visibleBookEntries
            .filter((entry: any) => buildWorldbookEntryDisplayView_ACU(
              entry,
              getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry),
            ).enabled)
            .map((entry: any) => entry.uid);
          settingsChanged = true;
        } else if (Array.isArray(enabledEntries[bookName])) {
          const cleanedEnabledEntries = enabledEntries[bookName]
            .filter((uid: any) => visibleUidSet.has(String(uid)));
          if (cleanedEnabledEntries.length !== enabledEntries[bookName].length) {
            enabledEntries[bookName] = cleanedEnabledEntries;
            settingsChanged = true;
          }
        }

        const enabledList: number[] = Array.isArray(enabledEntries[bookName])
          ? enabledEntries[bookName]
          : [];

        const visible: FormFillWorldbookEntryItem[] = visibleBookEntries.map((entry: any) => {
          const comment = String(entry?.comment || entry?.name || '');
          const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
          const snapshotEntry = getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry);
          const displayView = buildWorldbookEntryDisplayView_ACU(entry, snapshotEntry);
          return {
            uid: entry.uid,
            bookName,
            label: buildWorldbookEntryDisplayLabel_ACU(comment, entry.uid),
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

        if (visible.length > 0) {
          result.push({ bookName, entries: visible, expanded: false });
        }
      }

      if (settingsChanged) saveSettings_ACU();
      groups.value = result;
      status.value = 'success';
    } catch (e: any) {
      logError_ACU('[ACU-V2] useFormFillWorldbookEntries loadEntries failed', e);
      error.value = e?.message ?? '加载条目失败';
      status.value = 'error';
    }
  }

  function toggleEntry(bookName: string, uid: number, checked: boolean): void {
    const enabledEntries = ensureEnabledEntries();
    if (!Array.isArray(enabledEntries[bookName])) {
      enabledEntries[bookName] = [];
    }
    const list: number[] = enabledEntries[bookName];
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
    const enabledEntries = ensureEnabledEntries();
    for (const group of groups.value) {
      enabledEntries[group.bookName] = group.entries
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
    const enabledEntries = ensureEnabledEntries();
    for (const group of groups.value) {
      enabledEntries[group.bookName] = [];
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
    toggleEntry,
    selectAll,
    deselectAll,
    toggleGroupExpanded,
  };
}
