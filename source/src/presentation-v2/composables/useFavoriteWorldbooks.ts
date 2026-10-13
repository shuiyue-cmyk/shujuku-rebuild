/**
 * 常用世界书面板：维护常用名单、显示各本 skill 化进度，把勾选的几本复制并挂到当前角色卡。
 */
import { computed, ref } from 'vue';
import {
  mountFavoriteWorldbooksToCurrentCharacter_ACU,
  readFavoriteWorldbookNames_ACU,
  readFavoriteWorldbookSkillStatus_ACU,
  writeFavoriteWorldbookNames_ACU,
  type FavoriteExistingCopyDecision_ACU,
  type FavoriteMountItemResult_ACU,
  type FavoriteWorldbookSkillStatus_ACU,
} from '../../service/agent/agent-favorite-worldbooks';
import { getCurrentSingleCharacter_ACU, listWorldbookNamesLive_ACU } from '../../data/gateways/worldbook-file-gateway';
import { useDialogStore } from '../stores/dialog-store';
import { useToastStore } from '../stores/toast-store';

export function useFavoriteWorldbooks(options: { skillifyBooks: (bookNames: string[]) => Promise<boolean> }) {
  const dialog = useDialogStore();
  const toast = useToastStore();

  const favorites = ref<string[]>([]);
  const statuses = ref<Record<string, FavoriteWorldbookSkillStatus_ACU>>({});
  const allNames = ref<string[]>([]);
  const characterName = ref('');
  const selected = ref<string[]>([]);
  const loading = ref(false);
  const mounting = ref(false);

  const addableNames = computed(() => allNames.value.filter(name => !favorites.value.includes(name)));
  const canMount = computed(() => !!characterName.value && !mounting.value);

  async function refreshStatus(bookName: string): Promise<void> {
    try {
      const status = await readFavoriteWorldbookSkillStatus_ACU(bookName);
      statuses.value = { ...statuses.value, [bookName]: status };
    } catch {
      statuses.value = { ...statuses.value, [bookName]: { bookName, exists: false, candidateCount: 0, skilledCount: 0 } };
    }
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      favorites.value = readFavoriteWorldbookNames_ACU();
      selected.value = selected.value.filter(name => favorites.value.includes(name));
      characterName.value = getCurrentSingleCharacter_ACU()?.name || '';
      try {
        allNames.value = await listWorldbookNamesLive_ACU();
      } catch {
        allNames.value = [];
      }
      statuses.value = {};
      await Promise.all(favorites.value.map(refreshStatus));
    } finally {
      loading.value = false;
    }
  }

  async function add(bookName: string): Promise<void> {
    if (!bookName || favorites.value.includes(bookName)) return;
    favorites.value = writeFavoriteWorldbookNames_ACU([...favorites.value, bookName]);
    await refreshStatus(bookName);
  }

  function remove(bookName: string): void {
    favorites.value = writeFavoriteWorldbookNames_ACU(favorites.value.filter(name => name !== bookName));
    selected.value = selected.value.filter(name => name !== bookName);
    const next = { ...statuses.value };
    delete next[bookName];
    statuses.value = next;
  }

  function toggleSelected(bookName: string, checked: boolean): void {
    const rest = selected.value.filter(name => name !== bookName);
    selected.value = checked ? [...rest, bookName] : rest;
  }

  async function resolveExisting(targetName: string, sourceName: string): Promise<FavoriteExistingCopyDecision_ACU> {
    const choice = await dialog.choose<FavoriteExistingCopyDecision_ACU>({
      title: '副本已存在',
      message: `这张角色卡已经有「${targetName}」（来自常用世界书「${sourceName}」）。要怎么处理？`,
      actions: [
        { value: 'keep', label: '保留副本，只确保挂上', variant: 'primary' },
        { value: 'overwrite', label: '用常用书覆盖（副本里的改动会丢失）', variant: 'danger' },
        { value: 'skip', label: '跳过这本' },
      ],
      cancelLabel: '跳过这本',
    });
    return choice || 'skip';
  }

  function describeItem(item: FavoriteMountItemResult_ACU): string {
    if (item.copy === 'failed') return `「${item.sourceName}」没有复制：${item.reason || '未知错误'}`;
    if (item.binding === 'unavailable') return `「${item.targetName}」已建好，但没能自动挂到角色卡，请在酒馆里手动把它加为附加世界书。`;
    if (item.binding === 'failed') return `「${item.targetName}」已建好，挂到角色卡时出错：${item.reason || '未知错误'}，请手动挂载。`;
    return '';
  }

  async function mountSelected(): Promise<boolean> {
    if (!canMount.value || selected.value.length === 0) return false;
    mounting.value = true;
    try {
      const ordered = favorites.value.filter(name => selected.value.includes(name));
      const result = await mountFavoriteWorldbooksToCurrentCharacter_ACU(ordered, { resolveExisting });
      if (!result.ok) {
        toast.warning('请先打开一张单人角色卡再挂载（群聊不支持）。', { muteable: false });
        return false;
      }
      const mounted = result.results.filter(item => item.binding === 'bound' || item.binding === 'already');
      const problems = result.results.map(describeItem).filter(Boolean);
      if (mounted.length > 0) {
        toast.success(`已挂到「${result.characterName}」：${mounted.map(item => item.targetName).join('、')}`, { muteable: false });
      }
      if (problems.length > 0) toast.warning(problems.join('\n'), { muteable: false });
      if (mounted.length === 0 && problems.length === 0) toast.info('没有挂载任何世界书（都已跳过）。', { muteable: false });
      selected.value = [];
      try {
        allNames.value = await listWorldbookNamesLive_ACU();
      } catch { /* 列表刷新失败不影响结果 */ }
      return mounted.length > 0;
    } catch (error: any) {
      toast.error(`挂载常用世界书失败：${error?.message || '未知错误'}`, { muteable: false });
      return false;
    } finally {
      mounting.value = false;
    }
  }

  async function skillify(bookName: string): Promise<void> {
    await options.skillifyBooks([bookName]);
    await refreshStatus(bookName);
  }

  return {
    favorites,
    statuses,
    allNames,
    addableNames,
    characterName,
    selected,
    loading,
    mounting,
    canMount,
    refresh,
    add,
    remove,
    toggleSelected,
    mountSelected,
    skillify,
  };
}
