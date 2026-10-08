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
  isWorldbookEntryBlockedByDefault_ACU,
  isWorldbookEntryVisibleForPageUI_ACU,
  resolveWorldbookEntryTakeoverState_ACU,
  WORLDBOOK_BLOCKED_ENTRY_LABEL_SUFFIX_ACU,
  type
  WorldbookEntryDisplayGroup_ACU,
  WorldbookEntryDisplayItem_ACU,
} from './worldbook-entry-display';
import { createWorldbookEntryScopePredicate_ACU, type WorldbookEntryScope_ACU } from './worldbook-entry-scope';

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

  /** R10B-17：只有最后一次加载能写结果，较慢的旧请求晚到时直接丢弃。 */
  let loadSeq = 0;

  async function loadEntries(bookNames: string[]): Promise<void> {
    const seq = ++loadSeq;
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
      const failedBooks = new Set<string>();
      const entriesMap = await getLorebookEntriesByNames_ACU(unique, { failedBooks }) as Record<string, any[]>;
      if (seq !== loadSeq) return;
      const snapshotEntryIndexByBook = buildWorldbookSnapshotEntryIndexByBook_ACU(snapshot);
      let settingsChanged = false;
      const result: FormFillWorldbookEntryGroup[] = [];

      for (const bookName of unique) {
        const bookEntries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
        const visibleBookEntries = bookEntries.filter((entry: any) => isWorldbookEntryVisibleForPageUI_ACU(bookName, entry, snapshotEntryIndexByBook));
        const visibleUidSet = new Set(visibleBookEntries.map((entry: any) => String(entry?.uid)));

        // R10A-06：读取失败（服务层同样返回空数组）或读到空书时不动勾选——无法区分「条目已删」与「暂时读不到」，
        // 清理会把用户的勾选永久抹掉。
        const readUnreliable = failedBooks.has(bookName) || bookEntries.length === 0;
        if (readUnreliable) {
          // 保持原样
        } else if (typeof enabledEntries[bookName] === 'undefined') {
          // 默认全不选：首次加载不勾选任何条目
          enabledEntries[bookName] = [];
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
        const cfgSource = (getCurrentWorldbookConfig_ACU() as any)?.source;

        const visible: FormFillWorldbookEntryItem[] = visibleBookEntries.map((entry: any) => {
          const comment = String(entry?.comment || entry?.name || '');
          const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
          const snapshotEntry = getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry);
          const displayView = buildWorldbookEntryDisplayView_ACU(entry, snapshotEntry);
          const agentState = resolveWorldbookEntryTakeoverState_ACU(entry, !!skillMeta, snapshotEntry);
          const blockedByDefault = isWorldbookEntryBlockedByDefault_ACU(entry);
          // 命中屏蔽词的条目不属于「默认已发送」，只能靠显式勾选参与（R7-03）。
          const isDefaultActive = cfgSource === 'active'
            && !blockedByDefault
            && !displayView.disabled
            && (
              (displayView.isConstant && !skillMeta) // 全部挂载的蓝灯
              || agentState === 'final_greenlight' // 正文放行的 skill 化
            );
          const checked = isDefaultActive ? true : enabledList.includes(entry.uid);
          const disabled = displayView.disabled || isDefaultActive;
          return {
            uid: entry.uid,
            bookName,
            label: `${buildWorldbookEntryDisplayLabel_ACU(comment, entry.uid)}${blockedByDefault ? WORLDBOOK_BLOCKED_ENTRY_LABEL_SUFFIX_ACU : ''}`,
            comment,
            skillMeta,
            hasSkill: !!skillMeta,
            agentTakeoverState: agentState,
            checked,
            skillifySelected: false,
            skillifySelectable: false,
            isConstant: displayView.isConstant,
            disabled,
            blockedByDefault,
            // @ts-ignore 额外标记供 UI 区分默认已发送
            _isDefaultActive: isDefaultActive,
          } as any;
        });

        if (visible.length > 0) {
          result.push({ bookName, entries: visible, expanded: false });
        }
      }

      if (settingsChanged) saveSettings_ACU();
      groups.value = result;
      status.value = 'success';
    } catch (e: any) {
      if (seq !== loadSeq) return;
      logError_ACU('[ACU-V2] useFormFillWorldbookEntries loadEntries failed', e);
      error.value = e?.message ?? '加载条目失败';
      status.value = 'error';
    }
  }

  function toggleEntry(bookName: string, uid: number, checked: boolean): void {
    const targetGroup = groups.value.find(g => g.bookName === bookName);
    const targetEntry: any = targetGroup?.entries.find((e: any) => e.uid === uid);
    if ((targetEntry as any)?._isDefaultActive) return;
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

  /** 批量改勾选：只动 scope 内条目（R10B-05），再按展示状态回写涉及的书。 */
  function applyBulkSelection(scope: WorldbookEntryScope_ACU, nextChecked: (e: any) => boolean): void {
    const inScope = createWorldbookEntryScopePredicate_ACU(scope);
    const touchedBooks = new Set<string>();
    groups.value = groups.value.map(g => ({
      ...g,
      entries: g.entries.map((e: any) => {
        if (!inScope(g.bookName, e.uid)) return e;
        touchedBooks.add(g.bookName);
        return { ...e, checked: nextChecked(e) };
      }),
    }));
    const enabledEntries = ensureEnabledEntries();
    for (const group of groups.value) {
      if (!touchedBooks.has(group.bookName)) continue;
      enabledEntries[group.bookName] = group.entries
        .filter((e: any) => e.checked && !e.disabled && !e._isDefaultActive)
        .map(e => e.uid);
    }
    saveSettings_ACU();
  }

  function selectAll(scope?: WorldbookEntryScope_ACU): void {
    applyBulkSelection(scope, (e: any) => {
      if (e._isDefaultActive) return true;
      if (e.disabled) return false;
      if (e.blockedByDefault) return !!e.checked;
      return true;
    });
  }

  function deselectAll(scope?: WorldbookEntryScope_ACU): void {
    applyBulkSelection(scope, (e: any) => !!e._isDefaultActive);
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
