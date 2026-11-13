/**
 * useWorldbookEntriesPanel — 「附加世界书条目」面板（来源选择 + 按条目勾选）的状态与刷新。
 *
 * 填表页与决策召回页共用同一套选法，差别只在读写哪份配置：
 * 不传 getConfig 时是当前角色的填表配置，决策召回页传它自己那份。
 */
import { ref } from 'vue';
import { worldbookEntriesCopy } from '../copy/shared-copy';
import {
  useFormFillWorldbookConfig,
  type FormFillWorldbookSource,
  type WorldbookSourceConfigReader,
} from './useFormFillWorldbookConfig';
import { useFormFillWorldbookEntries } from './useFormFillWorldbookEntries';
import { useWorldbookSelector } from './useWorldbookSelector';

export function useWorldbookEntriesPanel(getConfig?: WorldbookSourceConfigReader) {
  const config = useFormFillWorldbookConfig(getConfig);
  const entries = useFormFillWorldbookEntries(getConfig);
  const books = useWorldbookSelector();

  const filter = ref('');
  const sourceLabel = ref('');
  const emptyText = ref(worldbookEntriesCopy.emptyDefault);

  function resolveEmptyText(names: string[]): string {
    const source = config.source.value;
    if (source === 'character' && names.length === 0) return worldbookEntriesCopy.emptyCharacter;
    if (source === 'active' && names.length === 0) {
      return '未找到正文能接收到的世界书（无激活全局书且角色卡未绑定）。可切回「跟随角色卡」或「手动选择」。';
    }
    if (source === 'manual' && config.manualSelection.value.length === 0) return worldbookEntriesCopy.emptyManual;
    return worldbookEntriesCopy.emptyDefault;
  }

  /** 只有最后一次刷新能写结果：切来源、勾书、切聊天会叠加刷新。 */
  let refreshSeq = 0;
  async function refreshGroups(): Promise<void> {
    const seq = ++refreshSeq;
    const names = await config.resolveBookNames();
    if (seq !== refreshSeq) return;
    emptyText.value = resolveEmptyText(names);
    await entries.loadEntries(names);
    if (seq !== refreshSeq) return;
    const source = config.source.value;
    if (source === 'character') {
      const charPrimary = books.charPrimary.value;
      sourceLabel.value = charPrimary ? `角色卡所有世界书 · 主册 ${charPrimary}` : '角色卡所有世界书';
    } else if (source === 'active') {
      sourceLabel.value = names.length ? names.join('、') : '（未找到正文接收的世界书）';
    } else {
      const manual = config.manualSelection.value;
      sourceLabel.value = manual.length ? manual.join('、') : '（未选择）';
    }
  }

  function onSourceChange(value: FormFillWorldbookSource): void {
    config.setSource(value);
    void refreshGroups();
  }

  function onManualBookToggle(name: string, checked: boolean): void {
    config.toggleManualBook(name, checked);
    void refreshGroups();
  }

  /** 从设置重读来源，重拉世界书列表与条目（挂载、切聊天时调用）。 */
  async function refresh(): Promise<void> {
    config.refreshFromSettings();
    await books.refresh();
    await refreshGroups();
  }

  return { config, entries, books, filter, sourceLabel, emptyText, onSourceChange, onManualBookToggle, refresh };
}
