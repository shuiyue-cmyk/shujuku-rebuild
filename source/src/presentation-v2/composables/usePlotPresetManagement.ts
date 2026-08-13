/**
 * usePlotPresetManagement — 剧情推进抽屉的状态机（D23.3）
 *
 * 与 useApiPresetManagement 形态一致：drawerView = closed/manage/create/edit。
 * edit 视图内嵌 usePlotTaskEditing，drawer 关闭时丢弃 draft。
 */
import { computed, reactive, ref } from 'vue';
import { useDialogStore } from '../stores/dialog-store';
import {
  getDefaultPlotPresetRawForV2,
  getDefaultPlotRateValueForV2,
  PLOT_RATE_FIELDS,
  type PlotRateField,
  usePlotPresetStore,
} from '../stores/plot-preset-store';
import { useToastStore } from '../stores/toast-store';
import { usePlotTaskEditing } from './usePlotTaskEditing';
import { normalizeExcludeRules_ACU, normalizeExtractRules_ACU } from '../../shared/utils';

export type PlotDrawerView = 'closed' | 'manage' | 'create' | 'edit';
export type { PlotRateField } from '../stores/plot-preset-store';

export interface PlotContextRulePair {
  start: string;
  end: string;
}

interface PlotPresetMeta {
  name: string;
  /** 任务数（用于管理列表的副信息）。 */
  taskCount: number;
}

interface DraftMeta {
  name: string;
  taskApiPreset: string;
}

interface DraftContextRules {
  extractRules: PlotContextRulePair[];
  excludeRules: PlotContextRulePair[];
}

type PlotRateDraft = Record<PlotRateField, number>;

const DEFAULT_NEW_PRESET_NAME = '新预设';

function emptyDraftMeta(): DraftMeta {
  return { name: '', taskApiPreset: '' };
}

function emptyContextRules(): DraftContextRules {
  return { extractRules: [], excludeRules: [] };
}

function coercePlotRate(field: PlotRateField, value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : getDefaultPlotRateValueForV2(field);
}

function readDraftRates(raw: Record<string, any> | null | undefined): PlotRateDraft {
  return PLOT_RATE_FIELDS.reduce((acc, field) => {
    acc[field] = coercePlotRate(field, raw?.[field]);
    return acc;
  }, {} as PlotRateDraft);
}

function writeDraftRates(raw: Record<string, any>, rates: PlotRateDraft): void {
  for (const field of PLOT_RATE_FIELDS) {
    raw[field] = coercePlotRate(field, rates[field]);
  }
}

function emptyDraftRates(): PlotRateDraft {
  return readDraftRates(null);
}

function defaultRawPreset(): Record<string, any> {
  return getDefaultPlotPresetRawForV2();
}

function uniquePresetName(baseName: string, names: string[]): string {
  const normalizedBase = String(baseName || '').trim();
  if (!normalizedBase) return '';
  const usedNames = new Set(names.map(name => String(name || '').trim()).filter(Boolean));
  if (!usedNames.has(normalizedBase)) return normalizedBase;
  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${normalizedBase} (${i})`;
    if (!usedNames.has(candidate)) return candidate;
  }
  return `${normalizedBase} (${Date.now()})`;
}

function normalizeRulePairs(rules: unknown, legacyTags: unknown, kind: 'extract' | 'exclude'): PlotContextRulePair[] {
  const normalized = kind === 'extract'
    ? normalizeExtractRules_ACU(rules, String(legacyTags || ''))
    : normalizeExcludeRules_ACU(rules, String(legacyTags || ''));
  return normalized.map((rule: any) => ({
    start: String(rule.start || ''),
    end: String(rule.end || ''),
  }));
}

function coerceRulePairs(rules: unknown): PlotContextRulePair[] {
  return Array.isArray(rules)
    ? rules.map((rule: any) => ({
        start: String(rule?.start || ''),
        end: String(rule?.end || ''),
      }))
    : [];
}

function rulesForSave(rules: PlotContextRulePair[], kind: 'extract' | 'exclude'): PlotContextRulePair[] {
  return normalizeRulePairs(rules, '', kind);
}

export function usePlotPresetManagement() {
  const store = usePlotPresetStore();
  const dialogStore = useDialogStore();
  const toast = useToastStore();
  const taskEditing = usePlotTaskEditing();

  const drawerView = ref<PlotDrawerView>('closed');
  const originalName = ref<string>('');
  const draftMeta = reactive<DraftMeta>(emptyDraftMeta());
  const contextRules = reactive<DraftContextRules>(emptyContextRules());
  const draftRates = reactive<PlotRateDraft>(emptyDraftRates());
  const draftRaw = ref<Record<string, any>>(defaultRawPreset());
  const error = ref<string>('');
  const initialSnapshot = ref<string>('');

  const isDrawerOpen = computed(() => drawerView.value !== 'closed');
  const title = computed(() => {
    switch (drawerView.value) {
      case 'manage':
        return '管理剧情推进预设';
      case 'edit':
        return '编辑剧情推进预设';
      case 'create':
        return '从默认新建剧情推进预设';
      default:
        return '';
    }
  });

  const isDirty = computed<boolean>(() => {
    if (drawerView.value !== 'create' && drawerView.value !== 'edit') return false;
    return takeCurrentSnapshot() !== initialSnapshot.value;
  });

  const presetMeta = computed<PlotPresetMeta[]>(() =>
    store.presets.map(p => ({
      name: p.name,
      taskCount: Array.isArray(p.raw?.plotTasks) ? p.raw.plotTasks.length : 0,
    })),
  );

  function takeCurrentSnapshot(): string {
    return JSON.stringify({
      meta: draftMeta,
      contextRules,
      rates: draftRates,
      tasks: taskEditing.tasks.value,
      directive: taskEditing.finalDirective.value,
    });
  }

  function saveSnapshot(): void {
    initialSnapshot.value = takeCurrentSnapshot();
  }

  function confirmIfDirty(): boolean | Promise<boolean> {
    if (!isDirty.value) return true;
    return dialogStore.confirm({
      title: '退出预设编辑',
      message: '你有未保存的修改，确定要退出吗？',
      confirmLabel: '退出',
      confirmVariant: 'danger',
    });
  }

  function resetDraft(): void {
    Object.assign(draftMeta, emptyDraftMeta());
    Object.assign(contextRules, emptyContextRules());
    Object.assign(draftRates, emptyDraftRates());
    draftRaw.value = defaultRawPreset();
    originalName.value = '';
    error.value = '';
    taskEditing.tasks.value = [];
    taskEditing.currentTaskId.value = '';
    taskEditing.finalDirective.value = '';
    initialSnapshot.value = '';
  }

  function openManage(): void {
    error.value = '';
    drawerView.value = 'manage';
  }

  function openCreate(): void {
    resetDraft();
    const raw = defaultRawPreset();
    draftMeta.name = uniquePresetName(DEFAULT_NEW_PRESET_NAME, store.presets.map(p => p.name));
    draftRaw.value = raw;
    contextRules.extractRules = normalizeRulePairs(raw.contextExtractRules, raw.contextExtractTags || '', 'extract');
    contextRules.excludeRules = normalizeRulePairs(raw.contextExcludeRules, raw.contextExcludeTags || '', 'exclude');
    Object.assign(draftRates, readDraftRates(raw));
    taskEditing.loadFromRaw(raw.plotTasks || [], raw.finalSystemDirective || '');
    error.value = '';
    drawerView.value = 'create';
    saveSnapshot();
  }

  function openEdit(presetName: string): void {
    const target = store.presets.find(p => p.name === presetName);
    if (!target) return;
    resetDraft();
    originalName.value = target.name;
    draftMeta.name = target.name;
    draftMeta.taskApiPreset = '';
    draftRaw.value = JSON.parse(JSON.stringify(target.raw || {}));
    contextRules.extractRules = normalizeRulePairs(target.raw?.contextExtractRules, target.raw?.contextExtractTags || '', 'extract');
    contextRules.excludeRules = normalizeRulePairs(target.raw?.contextExcludeRules, target.raw?.contextExcludeTags || '', 'exclude');
    Object.assign(draftRates, readDraftRates(target.raw || null));
    taskEditing.loadFromRaw(target.raw?.plotTasks || [], target.raw?.finalSystemDirective || '');
    error.value = '';
    drawerView.value = 'edit';
    saveSnapshot();
  }

  /** "编辑当前预设"按钮：打开抽屉并直接进入 edit 视图。 */
  function openEditCurrent(): boolean {
    const active = store.activePreset;
    if (!active) {
      openCreate();
      return true;
    }
    openEdit(active.name);
    return true;
  }

  function closeDrawer(): void {
    drawerView.value = 'closed';
    resetDraft();
  }

  function backToManage(): void {
    error.value = '';
    drawerView.value = 'manage';
  }

  function validate(): boolean {
    const name = String(draftMeta.name || '').trim();
    if (!name) {
      error.value = '预设名称不能为空。';
      return false;
    }
    if (taskEditing.tasks.value.length === 0) {
      error.value = '至少需要一个任务。';
      return false;
    }
    error.value = '';
    return true;
  }

  function setContextExtractRules(rules: PlotContextRulePair[]): void {
    contextRules.extractRules = coerceRulePairs(rules);
  }

  function setContextExcludeRules(rules: PlotContextRulePair[]): void {
    contextRules.excludeRules = coerceRulePairs(rules);
  }

  function setDraftRate(field: PlotRateField, value: number): void {
    draftRates[field] = coercePlotRate(field, value);
  }

  function saveDraft(): boolean {
    if (!validate()) return false;
    const merged = taskEditing.serializeIntoPresetRaw(draftRaw.value || {});
    merged.name = String(draftMeta.name || '').trim();
    merged.contextExtractRules = rulesForSave(contextRules.extractRules, 'extract');
    merged.contextExcludeRules = rulesForSave(contextRules.excludeRules, 'exclude');
    writeDraftRates(merged, draftRates);
    delete merged.contextExtractTags;
    delete merged.contextExcludeTags;
    const ok = store.savePreset({ name: merged.name, raw: merged }, originalName.value);
    if (!ok) {
      error.value = '预设保存失败。';
      return false;
    }
    drawerView.value = 'manage';
    resetDraft();
    toast.success('剧情推进预设已保存。');
    return true;
  }

  function deletePreset(name: string): boolean {
    return store.deletePreset(name);
  }

  function importFromJsonText(text: string): boolean {
    const result = store.importPresetFromJson(text);
    if (!result) {
      error.value = '导入失败：JSON 无效或缺少 name 字段。';
      return false;
    }
    if (!store.setActivePresetForCurrentChat(result)) {
      error.value = '已保存到预设库，但无法切换为当前聊天预设。可在下拉框手动选择。';
      return false;
    }
    toast.success('剧情推进预设 JSON 已导入。', { muteable: false });
    return true;
  }

  function exportPresetAsText(name: string): string | null {
    return store.exportPresetAsJson(name);
  }

  return {
    drawerView,
    isDrawerOpen,
    isDirty,
    title,
    error,
    originalName,
    draftMeta,
    draftRaw,
    contextRules,
    draftRates,
    presetMeta,
    taskEditing,
    setContextExtractRules,
    setContextExcludeRules,
    setDraftRate,
    openManage,
    openCreate,
    openEdit,
    openEditCurrent,
    confirmIfDirty,
    closeDrawer,
    backToManage,
    saveDraft,
    deletePreset,
    importFromJsonText,
    exportPresetAsText,
  };
}
