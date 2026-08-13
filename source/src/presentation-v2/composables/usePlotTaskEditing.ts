/**
 * usePlotTaskEditing — 抽屉 edit 视图内的任务列表 + 当前任务编辑（D23.3）
 *
 * 一次只编辑一个 preset 的 plotTasks 数组；操作的是抽屉内的 draft（不是 settings_ACU），
 * 直到外层的 management 调 savePreset 才落地。
 */
import { computed, reactive, ref } from 'vue';
import { normalizePlotTask_ACU, normalizePlotTasks_ACU } from '../../service/plot/plot-logic';
import { buildDefaultPlotPromptGroup_ACU } from '../../service/plot/plot-state';

export interface PlotPromptSegment {
  role: string;
  content: string;
  deletable?: boolean;
  mainSlot?: 'A' | 'B' | '';
  isMain?: boolean;
  isMain2?: boolean;
}

export interface PlotTaskDraft {
  id: string;
  name: string;
  enabled: boolean;
  promptGroup: PlotPromptSegment[];
  extractTags: string;
  extractInjectTags: string;
  finalDirectiveTemplate: string;
  minLength: number;
  maxRetries: number;
  mergeStrategy: string;
  stage: number;
  order: number;
  description: string;
  triggerWhen: string;
  agentControl: PlotTaskAgentControlDraft;
}

export interface PlotTaskAgentControlDraft {
  enabled: boolean;
  selectable: boolean;
  defaultSelected: boolean;
  allowSequential: boolean;
  allowParallel: boolean;
  preferredStage?: number;
  preferredOrder?: number;
  dependsOnTaskIds: string[];
  blocksTaskIds: string[];
}

function normalizeRoleString(role: any): string {
  const r = String(role || '').trim();
  return r || 'USER';
}

function ensureMainSlotIntegrity(segments: PlotPromptSegment[]): PlotPromptSegment[] {
  // mainSlot 'A' / 'B' 各最多一个；首次 hits-only。多余的转为空 mainSlot。
  const seenA = { v: false };
  const seenB = { v: false };
  for (const seg of segments) {
    const slot = String(seg?.mainSlot || '').toUpperCase();
    if (slot === 'A') {
      if (seenA.v) seg.mainSlot = '';
      else seenA.v = true;
    } else if (slot === 'B') {
      if (seenB.v) seg.mainSlot = '';
      else seenB.v = true;
    }
  }
  return segments;
}

function cloneSegments(group: any): PlotPromptSegment[] {
  if (!Array.isArray(group)) return [];
  return ensureMainSlotIntegrity(
    group.map((seg: any) => ({
      role: normalizeRoleString(seg?.role),
      content: typeof seg?.content === 'string' ? seg.content : '',
      deletable: seg?.deletable !== false,
      mainSlot:
        String(seg?.mainSlot || '').toUpperCase() === 'A'
          ? 'A'
          : String(seg?.mainSlot || '').toUpperCase() === 'B'
            ? 'B'
            : '',
      isMain: !!seg?.isMain,
      isMain2: !!seg?.isMain2,
    })),
  );
}

function cloneStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item ?? '').trim())
    .filter((item, index, array) => item && array.indexOf(item) === index);
}

function cloneAgentControl(value: any): PlotTaskAgentControlDraft {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const control: PlotTaskAgentControlDraft = {
    enabled: source.enabled === true,
    selectable: source.selectable !== false,
    defaultSelected: source.defaultSelected === true,
    allowSequential: source.allowSequential !== false,
    allowParallel: source.allowParallel !== false,
    dependsOnTaskIds: cloneStringArray(source.dependsOnTaskIds),
    blocksTaskIds: cloneStringArray(source.blocksTaskIds),
  };
  if (Number.isFinite(source.preferredStage) && Number(source.preferredStage) > 0) control.preferredStage = Math.trunc(Number(source.preferredStage));
  if (Number.isFinite(source.preferredOrder) && Number(source.preferredOrder) >= 0) control.preferredOrder = Math.trunc(Number(source.preferredOrder));
  return control;
}

function taskFromRaw(raw: any, index = 0): PlotTaskDraft {
  const normalized = normalizePlotTask_ACU(raw, { index });
  return {
    id: String(normalized.id || `plotTask${index + 1}`),
    name: String(normalized.name || `剧情任务${index + 1}`),
    enabled: normalized.enabled !== false,
    promptGroup: cloneSegments(normalized.promptGroup),
    extractTags: typeof normalized.extractTags === 'string' ? normalized.extractTags : '',
    extractInjectTags:
      typeof normalized.extractInjectTags === 'string' ? normalized.extractInjectTags : '',
    finalDirectiveTemplate:
      typeof normalized.finalDirectiveTemplate === 'string' ? normalized.finalDirectiveTemplate : '',
    minLength: Number.isFinite(normalized.minLength) ? Number(normalized.minLength) : 0,
    maxRetries: Number.isFinite(normalized.maxRetries) ? Number(normalized.maxRetries) : 3,
    mergeStrategy: String(normalized.mergeStrategy || 'append'),
    stage: Number.isFinite(normalized.stage) ? Number(normalized.stage) : 1,
    order: Number.isFinite(normalized.order) ? Number(normalized.order) : index,
    description: typeof normalized.description === 'string' ? normalized.description : '',
    triggerWhen: typeof normalized.triggerWhen === 'string' ? normalized.triggerWhen : '',
    agentControl: cloneAgentControl(normalized.agentControl),
  };
}

function tasksFromRaw(rawList: any[]): PlotTaskDraft[] {
  const normalized = normalizePlotTasks_ACU({ plotTasks: rawList });
  return normalized.map((t: any, i: number) => taskFromRaw(t, i));
}

function makeDefaultTask(index: number): PlotTaskDraft {
  return {
    id: `plotTask${Date.now()}`,
    name: `剧情任务${index + 1}`,
    enabled: true,
    promptGroup: cloneSegments(buildDefaultPlotPromptGroup_ACU()),
    extractTags: '',
    extractInjectTags: '',
    finalDirectiveTemplate: '',
    minLength: 0,
    maxRetries: 3,
    mergeStrategy: 'append',
    stage: 1,
    order: index,
    description: '',
    triggerWhen: '',
    agentControl: {
      enabled: false,
      selectable: true,
      defaultSelected: false,
      allowSequential: true,
      allowParallel: true,
      dependsOnTaskIds: [],
      blocksTaskIds: [],
    },
  };
}

export function usePlotTaskEditing() {
  const tasks = ref<PlotTaskDraft[]>([]);
  const currentTaskId = ref<string>('');
  const finalDirective = ref<string>('');

  const currentTask = computed<PlotTaskDraft | null>(
    () => tasks.value.find(t => t.id === currentTaskId.value) || null,
  );

  function loadFromRaw(rawTasks: any[], rawFinalDirective: string): void {
    const list = tasksFromRaw(Array.isArray(rawTasks) ? rawTasks : []);
    if (list.length === 0) list.push(makeDefaultTask(0));
    tasks.value = list;
    currentTaskId.value = list[0].id;
    finalDirective.value = String(rawFinalDirective || '');
  }

  function selectTask(taskId: string): void {
    if (tasks.value.some(t => t.id === taskId)) currentTaskId.value = taskId;
  }

  function addTask(): void {
    const next = makeDefaultTask(tasks.value.length);
    tasks.value = [...tasks.value, next];
    currentTaskId.value = next.id;
  }

  function deleteCurrentTask(): void {
    if (tasks.value.length <= 1) return;
    const idx = tasks.value.findIndex(t => t.id === currentTaskId.value);
    if (idx < 0) return;
    const copy = tasks.value.slice();
    copy.splice(idx, 1);
    tasks.value = copy;
    currentTaskId.value = copy[Math.max(0, idx - 1)].id;
  }

  function moveCurrent(delta: -1 | 1): void {
    const idx = tasks.value.findIndex(t => t.id === currentTaskId.value);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= tasks.value.length) return;
    const copy = tasks.value.slice();
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    tasks.value = copy;
  }

  function patchCurrent(patch: Partial<PlotTaskDraft>): void {
    const idx = tasks.value.findIndex(t => t.id === currentTaskId.value);
    if (idx < 0) return;
    const copy = tasks.value.slice();
    copy[idx] = { ...copy[idx], ...patch };
    tasks.value = copy;
  }

  // ── Prompt segments ──

  function addSegment(position: 'top' | 'bottom'): void {
    if (!currentTask.value) return;
    const newSeg: PlotPromptSegment = {
      role: 'USER',
      content: '',
      deletable: true,
      mainSlot: '',
    };
    const segments = currentTask.value.promptGroup.slice();
    if (position === 'top') segments.unshift(newSeg);
    else segments.push(newSeg);
    patchCurrent({ promptGroup: segments });
  }

  function deleteSegment(index: number): void {
    if (!currentTask.value) return;
    const segments = currentTask.value.promptGroup.slice();
    if (index < 0 || index >= segments.length) return;
    if (segments[index].deletable === false) return;
    segments.splice(index, 1);
    patchCurrent({ promptGroup: segments });
  }

  function moveSegment(index: number, delta: -1 | 1): void {
    if (!currentTask.value) return;
    const segments = currentTask.value.promptGroup.slice();
    const target = index + delta;
    if (index < 0 || index >= segments.length || target < 0 || target >= segments.length) return;
    [segments[index], segments[target]] = [segments[target], segments[index]];
    patchCurrent({ promptGroup: ensureMainSlotIntegrity(segments) });
  }

  function updateSegment(index: number, patch: Partial<PlotPromptSegment>): void {
    if (!currentTask.value) return;
    const segments = currentTask.value.promptGroup.slice();
    if (index < 0 || index >= segments.length) return;
    segments[index] = { ...segments[index], ...patch };
    if (patch.mainSlot === 'A' || patch.mainSlot === 'B') {
      // 取消其他段相同 slot
      for (let i = 0; i < segments.length; i++) {
        if (i === index) continue;
        if (segments[i].mainSlot === patch.mainSlot) segments[i] = { ...segments[i], mainSlot: '' };
      }
    }
    patchCurrent({ promptGroup: ensureMainSlotIntegrity(segments) });
  }

  /** 序列化整套 tasks + finalDirective，写回到 preset.raw 上。 */
  function serializeIntoPresetRaw(rawPreset: Record<string, any>): Record<string, any> {
    const out = { ...rawPreset };
    out.plotTasks = tasks.value.map((t, i) => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      promptGroup: t.promptGroup.map(seg => ({
        role: seg.role,
        content: seg.content,
        deletable: seg.deletable !== false,
        ...(seg.mainSlot ? { mainSlot: seg.mainSlot } : {}),
        ...(seg.mainSlot === 'A' ? { isMain: true } : {}),
        ...(seg.mainSlot === 'B' ? { isMain2: true } : {}),
      })),
      extractTags: t.extractTags,
      extractInjectTags: t.extractInjectTags,
      finalDirectiveTemplate: t.finalDirectiveTemplate,
      minLength: t.minLength,
      maxRetries: t.maxRetries,
      mergeStrategy: t.mergeStrategy,
      stage: t.stage,
      order: i,
      description: t.description,
      triggerWhen: t.triggerWhen,
      agentControl: {
        ...t.agentControl,
        dependsOnTaskIds: cloneStringArray(t.agentControl?.dependsOnTaskIds),
        blocksTaskIds: cloneStringArray(t.agentControl?.blocksTaskIds),
        ...(Number.isFinite(t.agentControl?.preferredStage) ? { preferredStage: Math.trunc(Number(t.agentControl.preferredStage)) } : {}),
        ...(Number.isFinite(t.agentControl?.preferredOrder) ? { preferredOrder: Math.trunc(Number(t.agentControl.preferredOrder)) } : {}),
      },
    }));
    out.finalSystemDirective = finalDirective.value;
    return out;
  }

  return {
    tasks,
    currentTaskId,
    currentTask,
    finalDirective,
    loadFromRaw,
    selectTask,
    addTask,
    deleteCurrentTask,
    moveCurrent,
    patchCurrent,
    addSegment,
    deleteSegment,
    moveSegment,
    updateSegment,
    serializeIntoPresetRaw,
  };
}
