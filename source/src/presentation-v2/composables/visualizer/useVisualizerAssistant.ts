import { computed, ref, watch } from 'vue';
import { applySheetOrderNumbers_ACU, logWarn_ACU } from '../../../shared/utils';
import { settings_ACU } from '../../../service/runtime/state-manager';
import {
  buildTemplateAssistantFingerprint_ACU,
  buildPseudoRoleTemplateAssistantPromptSegments_ACU,
  createTemplateAssistantSessionGuard_ACU,
  hasTemplateAssistantApplicableDraft_ACU,
  getTemplateAssistantApplyBaselineFingerprint_ACU,
  runTemplateAssistantSession_ACU,
  setTemplateAssistantPrompt_ACU,
  TemplateAssistantSessionStoppedError_ACU,
  type TemplateAssistantFailureInfo_ACU,
  type TemplateAssistantPromptSegment_ACU,
  type TemplateAssistantSessionResult_ACU,
  type TemplateAssistantSessionRound_ACU,
} from '../../../service/template-assistant/service';
import { assertVisualizerDataOpsEditable_ACU } from '../../../service/visualizer/visualizer-data-ops';
import { useToastStore } from '../../stores/toast-store';
import {
  useVisualizerStore,
  type VisualizerAssistantTurnState,
} from '../../stores/visualizer-store';

export interface VisualizerAssistantDiffGroup {
  key: string;
  title: string;
  tone: 'normal' | 'warning';
  items: string[];
}

export type VisualizerAssistantTurn =
  | (Extract<VisualizerAssistantTurnState, { type: 'user' }>)
  | (Omit<Extract<VisualizerAssistantTurnState, { type: 'round' }>, 'roundData'> & {
      roundData: TemplateAssistantSessionRound_ACU;
    })
  | (Omit<Extract<VisualizerAssistantTurnState, { type: 'final' }>, 'result'> & {
      result: TemplateAssistantSessionResult_ACU;
    })
  | (Extract<VisualizerAssistantTurnState, { type: 'error' }>);

export interface VisualizerAssistantRiskItem {
  key: string;
  type: string;
  label: string;
}

let guardController = createTemplateAssistantSessionGuard_ACU();

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function asList(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function createTurnId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function joinKeys(keys: unknown): string {
  return asList(keys).map(item => String(item)).filter(Boolean).join(', ') || '字段已修改';
}

function joinChanges(changes: unknown): string {
  return asList(changes).map(item => String(item)).filter(Boolean).join('；') || '已修改';
}

function resolveEffectiveTableApiPreset(visualizer = useVisualizerStore()): string {
  const currentSheet = visualizer.currentSheet;
  const currentTableName = String(currentSheet?.name || '').trim();
  const overrides = settings_ACU.tableApiPresetOverridesByName;
  if (
    currentTableName
    && overrides
    && typeof overrides === 'object'
    && typeof overrides[currentTableName] === 'string'
    && overrides[currentTableName].trim()
  ) {
    return overrides[currentTableName].trim();
  }
  return String(settings_ACU.tableApiPreset || '').trim();
}

export function buildVisualizerAssistantDiffGroups(
  result: TemplateAssistantSessionResult_ACU | null | undefined,
  currentSheetKey: string | null | undefined,
): VisualizerAssistantDiffGroup[] {
  const diff = result?.compileResult?.diff;
  if (!diff) return [];
  const currentKey = String(currentSheetKey || '').trim();
  const currentItems: string[] = [];
  const otherItems: string[] = [];
  const addedItems: string[] = [];
  const deletedItems: string[] = [];
  const orderItems: string[] = [];
  const globalItems: string[] = [];
  const lockItems: string[] = [];

  const pushSheetPatch = (items: any[], render: (item: any) => string) => {
    asList(items).forEach(item => {
      const target = item?.sheetKey === currentKey ? currentItems : otherItems;
      target.push(render(item));
    });
  };

  pushSheetPatch(diff.patchedContentSheets, item => `${item.name || item.sheetKey}: ${joinChanges(item.changes)}`);
  pushSheetPatch(diff.patchedSourceDataSheets, item => `${item.name || item.sheetKey}: 提示词字段 ${joinKeys(item.keys)}`);
  pushSheetPatch(diff.patchedUpdateConfigSheets, item => `${item.name || item.sheetKey}: 更新参数 ${joinKeys(item.keys)}`);
  pushSheetPatch(diff.patchedExportConfigSheets, item => `${item.name || item.sheetKey}: 世界书配置 ${joinKeys(item.keys)}`);
  pushSheetPatch(diff.patchedSchemaSheets, item => `${item.name || item.sheetKey}: ${joinChanges(item.changes)}`);
  pushSheetPatch(diff.renamedSheets, item => `${item.beforeName || item.sheetKey} -> ${item.afterName || item.sheetKey}`);

  asList(diff.addedSheets).forEach(item => {
    addedItems.push(`${item.name || item.sheetKey} [${item.sheetKey}]`);
  });
  asList(diff.deletedSheets).forEach(item => {
    deletedItems.push(`${item.name || item.sheetKey} [${item.sheetKey}]`);
  });
  asList(diff.movedSheets).forEach(item => {
    orderItems.push(`${item.name || item.sheetKey}: ${item.fromIndex} -> ${item.toIndex}`);
  });
  asList(diff.patchedLockSheets).forEach(item => {
    lockItems.push(`${item.name || item.sheetKey}: ${joinChanges(item.changes)}`);
  });
  if (diff.globalInjectionChanged) {
    globalItems.push('全局注入配置已修改。');
  }

  const groups: VisualizerAssistantDiffGroup[] = [
    { key: 'current', title: '当前锚点表内容 / 结构 / 参数', tone: 'normal', items: currentItems },
    { key: 'other', title: '其他表修改', tone: otherItems.length ? 'warning' : 'normal', items: otherItems },
    { key: 'added', title: '新增表', tone: addedItems.length ? 'warning' : 'normal', items: addedItems },
    { key: 'deleted', title: '删除表', tone: deletedItems.length ? 'warning' : 'normal', items: deletedItems },
    { key: 'order', title: '表排序', tone: orderItems.length ? 'warning' : 'normal', items: orderItems },
    { key: 'global', title: '全局注入配置', tone: globalItems.length ? 'warning' : 'normal', items: globalItems },
    { key: 'locks', title: '锁变化', tone: lockItems.length ? 'warning' : 'normal', items: lockItems },
  ];
  return groups.filter(group => group.items.length > 0);
}

export function buildVisualizerAssistantHighRiskItems(
  result: TemplateAssistantSessionResult_ACU | null | undefined,
  currentSheetKey: string | null | undefined,
): VisualizerAssistantRiskItem[] {
  const compileResult = result?.compileResult;
  const diff = compileResult?.diff;
  if (!compileResult) return [];
  const currentKey = String(currentSheetKey || '').trim();
  const items: VisualizerAssistantRiskItem[] = [];
  const seen = new Set<string>();
  const add = (type: string, label: string, key = `${type}:${label}`) => {
    const normalizedLabel = String(label || '').trim();
    if (!normalizedLabel || seen.has(key)) return;
    seen.add(key);
    items.push({ key, type, label: normalizedLabel });
  };

  asList(compileResult.highRiskItems).forEach((item, index) => {
    add(String(item?.type || 'service_high_risk'), String(item?.label || ''), `service:${index}:${item?.type}:${item?.label}`);
  });

  // v3 row_id 集合守卫：replace 目标表出现「AI 未请求删行但 row_id 集合缩减」时，
  // 必须作为高风险项要求用户显式确认，未确认前不得应用（见 getTurnApplyBlockReason）。
  asList(result?.session?.v3RowIdGuardFindings).forEach((finding, index) => {
    const sheetKey = String(finding?.sheetKey || '').trim();
    const beforeCount = Number(finding?.beforeRowCount ?? -1);
    const afterCount = Number(finding?.afterRowCount ?? -1);
    const label = sheetKey
      ? `row_id 集合缩减：${sheetKey} 的行由 ${beforeCount} 缩减到 ${afterCount}（AI 未显式请求删行，请确认是否允许）`
      : `row_id 集合缩减：${beforeCount} → ${afterCount}（AI 未显式请求删行，请确认是否允许）`;
    add('v3_row_id_set_reduction', label, `v3-rowid:${index}:${sheetKey}`);
  });

  const addCrossSheetPatch = (patches: any[], kind: string, render: (item: any) => string) => {
    asList(patches).forEach(item => {
      const sheetKey = String(item?.sheetKey || '').trim();
      if (!sheetKey || sheetKey === currentKey) return;
      add('cross_sheet_change', `跨表变更：${render(item)}`, `cross:${kind}:${sheetKey}:${render(item)}`);
    });
  };

  addCrossSheetPatch(diff?.patchedContentSheets, 'content', item => `${item.name || item.sheetKey} 的数据内容`);
  addCrossSheetPatch(diff?.patchedSourceDataSheets, 'source', item => `${item.name || item.sheetKey} 的提示词字段`);
  addCrossSheetPatch(diff?.patchedUpdateConfigSheets, 'update', item => `${item.name || item.sheetKey} 的更新参数`);
  addCrossSheetPatch(diff?.patchedExportConfigSheets, 'export', item => `${item.name || item.sheetKey} 的世界书配置`);
  addCrossSheetPatch(diff?.patchedSchemaSheets, 'schema', item => `${item.name || item.sheetKey} 的结构`);
  addCrossSheetPatch(diff?.patchedLockSheets, 'locks', item => `${item.name || item.sheetKey} 的锁设置`);
  addCrossSheetPatch(diff?.renamedSheets, 'rename', item => `${item.beforeName || item.sheetKey} 重命名为 ${item.afterName || item.sheetKey}`);

  asList(diff?.movedSheets).forEach(item => {
    add('cross_sheet_change', `跨表变更：调整表排序 ${item.name || item.sheetKey}`, `cross:move:${item.sheetKey}:${item.fromIndex}:${item.toIndex}`);
  });

  return items;
}

function buildPriorTurns(turns: VisualizerAssistantTurn[], currentSheetKey: string | null | undefined) {
  const anchorKey = String(currentSheetKey || '').trim();
  return turns
    .filter((turn): turn is Extract<VisualizerAssistantTurn, { type: 'final' }> =>
      turn.type === 'final' && (!anchorKey || getResultAnchorSheetKey(turn.result) === anchorKey),
    )
    .map(turn => {
      const rawText = String(turn.result.aiRawText || '').trim()
        || String(turn.result.session?.lastFailure?.rawText || '').trim()
        || undefined;
      const failureMessage = turn.result.session?.lastFailure?.message;
      const user = failureMessage
        ? `${turn.userRequest}\n\n（上一轮输出未通过本地校验：${failureMessage}）`
        : turn.userRequest;
      return {
        user,
        assistant: rawText,
      };
    });
}

function getResultAnchorSheetKey(result: TemplateAssistantSessionResult_ACU | null | undefined): string {
  return String(result?.draft?.selectedSheetKey || '').trim();
}

function getRoundAnchorSheetKey(round: TemplateAssistantSessionRound_ACU | null | undefined): string {
  return String(round?.draft?.selectedSheetKey || '').trim();
}

export interface VisualizerAssistantTurnApplyPayload {
  candidateData: Record<string, any>;
  orderedSheetKeys: string[];
  deletedSheetKeys: string[];
  lockChanges: any[];
  focusSheetKey: string | null;
  anchorSheetKey: string;
  baselineFingerprint: string;
}

/**
 * 把一张 turn 提炼成「可应用到编辑器的载荷」。
 *
 * - round：取 `perRoundCompileResult`（累计候选：原始 + 前 N 轮），anchor 用 round draft 的 selectedSheetKey，
 *   baseline 用会话落盘时记录的 `turn.baselineFingerprint`（T10）。
 * - final：取 `compileResult`，baseline 优先 `getTemplateAssistantApplyBaselineFingerprint_ACU(result)`，
 *   为空时回退 `turn.baselineFingerprint`（与 applyLatestDraft 语义一致）。
 * - user / error：无载荷，返回 null。
 * - draft.operations 为空的 turn 返回 null（没有可应用的变更）。
 */
export function getTurnApplyPayload(turn: VisualizerAssistantTurn): VisualizerAssistantTurnApplyPayload | null {
  const anchorSheetKey = turn.anchorSheetKey;
  if (turn.type === 'round') {
    const compileResult = turn.roundData.perRoundCompileResult;
    const draft = turn.roundData.draft;
    if (!compileResult || !draft || !hasTemplateAssistantApplicableDraft_ACU(draft)) return null;
    const candidateData = compileResult.candidateData && typeof compileResult.candidateData === 'object'
      ? compileResult.candidateData
      : null;
    if (!candidateData || !Object.keys(candidateData).length) return null;
    return {
      candidateData,
      orderedSheetKeys: Array.isArray(compileResult.orderedSheetKeys) ? [...compileResult.orderedSheetKeys] : [],
      deletedSheetKeys: asList(compileResult.deletedSheetKeys).map((item: any) => String(item)),
      lockChanges: asList(compileResult.lockChanges),
      focusSheetKey: compileResult.focusSheetKey || null,
      anchorSheetKey,
      baselineFingerprint: String(turn.baselineFingerprint || '').trim(),
    };
  }
  if (turn.type === 'final') {
    const compileResult = turn.result.compileResult;
    const draft = turn.result.draft;
    if (!compileResult || !draft || !hasTemplateAssistantApplicableDraft_ACU(draft)) return null;
    const candidateData = compileResult.candidateData && typeof compileResult.candidateData === 'object'
      ? compileResult.candidateData
      : null;
    if (!candidateData || !Object.keys(candidateData).length) return null;
    const baselineFingerprint = String(
      getTemplateAssistantApplyBaselineFingerprint_ACU(turn.result) || turn.baselineFingerprint || '',
    ).trim();
    return {
      candidateData,
      orderedSheetKeys: Array.isArray(compileResult.orderedSheetKeys) ? [...compileResult.orderedSheetKeys] : [],
      deletedSheetKeys: asList(compileResult.deletedSheetKeys).map((item: any) => String(item)),
      lockChanges: asList(compileResult.lockChanges),
      focusSheetKey: compileResult.focusSheetKey || null,
      anchorSheetKey,
      baselineFingerprint,
    };
  }
  return null;
}

export function useVisualizerAssistant() {
  const visualizer = useVisualizerStore();
  const toastStore = useToastStore();
  if (
    !visualizer.assistantTableApiPreset
    && !visualizer.assistantUserRequest
    && !visualizer.assistantLatestResult
    && !visualizer.assistantTurns.length
  ) {
    visualizer.assistantTableApiPreset = resolveEffectiveTableApiPreset(visualizer);
  }

  const userRequest = computed({
    get: () => visualizer.assistantUserRequest,
    set: value => { visualizer.assistantUserRequest = String(value || ''); },
  });
  const tableApiPreset = computed({
    get: () => visualizer.assistantTableApiPreset,
    set: value => { visualizer.assistantTableApiPreset = String(value || ''); },
  });
  const isRunning = computed(() => visualizer.assistantIsRunning);
  const errorMessage = computed(() => visualizer.assistantErrorMessage);
  const rounds = computed(() => visualizer.assistantRounds as TemplateAssistantSessionRound_ACU[]);
  const latestResult = computed(() => visualizer.assistantLatestResult as TemplateAssistantSessionResult_ACU | null);
  const turns = computed(() => visualizer.assistantTurns as VisualizerAssistantTurn[]);
  const riskConfirmations = computed(() => visualizer.assistantRiskConfirmations);

  const apiPresetOptions = computed(() => [
    { value: '', label: '当前配置' },
    ...(Array.isArray(settings_ACU.apiPresets) ? settings_ACU.apiPresets : [])
      .map((preset: any) => String(preset?.name || '').trim())
      .filter(Boolean)
      .map((name: string) => ({ value: name, label: name })),
  ]);

  const anchorSheetLabel = computed(() => {
    const key = getResultAnchorSheetKey(latestResult.value) || visualizer.currentSheetKey;
    const sheet = key && visualizer.tempData ? visualizer.tempData[key] : null;
    const name = String(sheet?.name || '').trim();
    if (!key) return '当前未选中表';
    return `${name || key} (${key})`;
  });

  const diffGroups = computed(() =>
    buildVisualizerAssistantDiffGroups(
      latestResult.value,
      getResultAnchorSheetKey(latestResult.value) || visualizer.currentSheetKey,
    ),
  );

  const highRiskItems = computed(() =>
    buildVisualizerAssistantHighRiskItems(
      latestResult.value,
      getResultAnchorSheetKey(latestResult.value) || visualizer.currentSheetKey,
    ),
  );

  // T12：风险确认键改为 turn 级（turnId:index）。allHighRiskConfirmed 保留导出但语义
  // 委托到「最后一张可应用 final turn」的 turn 级确认，与 applyLatestDraft 的委托目标一致。
  const allHighRiskConfirmed = computed(() => {
    const result = latestResult.value;
    if (!result) return false;
    const latestRequestId = String((result.draft as any)?.requestId || '').trim();
    const target = turns.value
      .filter((turn): turn is Extract<VisualizerAssistantTurn, { type: 'final' }> => turn.type === 'final')
      .filter(turn => turn.result === result || (latestRequestId && String((turn.result.draft as any)?.requestId || '').trim() === latestRequestId))
      .pop();
    return target ? isTurnAllHighRiskConfirmed(target) : false;
  });

  const isLatestDraftForCurrentSheet = computed(() => {
    const result = latestResult.value;
    if (!result) return false;
    const anchorKey = getResultAnchorSheetKey(result);
    return !!anchorKey && anchorKey === visualizer.currentSheetKey;
  });

  const canApply = computed(() =>
    !!latestResult.value
    && !isRunning.value
    && allHighRiskConfirmed.value
    && isLatestDraftForCurrentSheet.value
    && latestResult.value?.session?.stopReason !== 'repair_retry_capped'
    && latestResult.value?.session?.stopReason !== 'environment_failure',
  );

  const sessionSummary = computed(() => {
    const session = latestResult.value?.session;
    if (!session) return '';
    const stopReasonLabel: Record<string, string> = {
      empty_operations: 'AI 未生成任何修改（可继续重试）',
      repair_retry_capped: '修复重试已达上限',
      environment_failure: 'SQLite 引擎不可用',
    };
    const repairPart =
      session.repairRetriesUsed > 0 ? ` · 修复 ${session.repairRetriesUsed} 次` : '';
    return `${stopReasonLabel[session.stopReason] || session.stopReason}${repairPart}`;
  });

  const lastFailure = computed<TemplateAssistantFailureInfo_ACU | null>(() => {
    const failure = latestResult.value?.session?.lastFailure;
    if (!failure) return null;
    return { kind: failure.kind, message: failure.message, rawText: failure.rawText };
  });

  const promptSegments = ref<TemplateAssistantPromptSegment_ACU[]>([]);
  const promptDirty = ref(false);

  function loadPromptSegments(): void {
    const saved = settings_ACU.templateAssistantPromptSegments;
    if (Array.isArray(saved) && saved.length > 0) {
      promptSegments.value = saved.map((seg: any) => ({
        role: String(seg?.role || 'SYSTEM'),
        content: String(seg?.content ?? ''),
        deletable: seg?.deletable !== false,
        pinned: seg?.pinned === true,
      }));
    } else {
      promptSegments.value = buildPseudoRoleTemplateAssistantPromptSegments_ACU();
    }
    promptDirty.value = false;
  }

  function savePrompt(): boolean {
    const result = setTemplateAssistantPrompt_ACU(promptSegments.value);
    if (!result.ok) {
      toastStore.error(result.message || '提示词保存失败。', { muteable: false });
      return false;
    }
    promptDirty.value = false;
    toastStore.success('提示词已保存，下一次会话生效。', { muteable: false });
    return true;
  }

  function resetPrompt(): void {
    promptSegments.value = buildPseudoRoleTemplateAssistantPromptSegments_ACU();
    promptDirty.value = true;
  }

  function addPromptSegment(position: 'top' | 'bottom'): void {
    const seg: TemplateAssistantPromptSegment_ACU = { role: 'SYSTEM', content: '', deletable: true };
    const next = promptSegments.value.slice();
    if (position === 'top') next.unshift(seg);
    else next.push(seg);
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function deletePromptSegment(index: number): void {
    const target = promptSegments.value[index];
    if (!target || target.deletable === false) return;
    const next = promptSegments.value.slice();
    next.splice(index, 1);
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function updatePromptSegment(index: number, patch: Partial<TemplateAssistantPromptSegment_ACU>): void {
    if (!promptSegments.value[index]) return;
    const next = promptSegments.value.map((seg, i) => (i === index ? { ...seg, ...patch } : { ...seg }));
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function importPromptFile(file: File): Promise<void> {
    return file
      .text()
      .then((text) => JSON.parse(text))
      .then((parsed) => {
        if (!Array.isArray(parsed)) throw new Error('提示词 JSON 必须是数组。');
        promptSegments.value = parsed.map((seg: any) => ({
          role: String(seg?.role || 'SYSTEM'),
          content: String(seg?.content ?? ''),
          deletable: seg?.deletable !== false,
        }));
        promptDirty.value = true;
        toastStore.success('提示词 JSON 已载入，保存后生效。', { muteable: false });
      })
      .catch((error: any) => {
        toastStore.error(error?.message || '提示词 JSON 读取失败。', { muteable: false });
      });
  }

  function exportPrompt(): void {
    try {
      const text = JSON.stringify(promptSegments.value, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'acu-visualizer-assistant-prompt.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toastStore.error(error?.message || '提示词导出失败。', { muteable: false });
    }
  }

  loadPromptSegments();

  function resetRiskConfirmations(): void {
    visualizer.assistantRiskConfirmations = {};
  }

  function getTurnRawText(turn: VisualizerAssistantTurn): string {
    if (turn.type === 'round') return String(turn.roundData.aiRawText || '');
    if (turn.type === 'final') {
      const raw = String(turn.result.aiRawText || '').trim();
      if (raw) return raw;
      return String(turn.result.session?.lastFailure?.rawText || '');
    }
    if (turn.type === 'error') return String(turn.rawText || '');
    return '';
  }

  function getTurnValidationError(turn: VisualizerAssistantTurn): string {
    if (turn.type === 'round' || turn.type === 'final') {
      const failure = turn.type === 'round'
        ? (turn.roundData as any).lastFailure
        : turn.result.session?.lastFailure;
      if (failure?.message) return String(failure.message);
    }
    return '';
  }

  async function runWithRepairFeedback(feedbackText: string): Promise<boolean> {
    const feedback = String(feedbackText || '').trim();
    const baseRequest = String(userRequest.value || '').trim();
    const combined = feedback ? [baseRequest, feedback].filter(Boolean).join('\n\n补充要求：') : baseRequest;
    if (!combined.trim()) {
      visualizer.assistantErrorMessage = '请输入改表需求。';
      return false;
    }
    userRequest.value = combined.trim();
    return run();
  }

  function appendTurn(turn: VisualizerAssistantTurnState): void {
    visualizer.assistantTurns = [...visualizer.assistantTurns, turn];
  }

  function appendErrorTurn(message: string, anchorSheetKey: string, rawText?: string): void {
    appendTurn({
      id: createTurnId('error'),
      type: 'error',
      errorMessage: message,
      anchorSheetKey,
      createdAt: Date.now(),
      rawText: rawText ? String(rawText) : undefined,
    });
  }

  async function run(): Promise<boolean> {
    const request = String(userRequest.value || '').trim();
    if (!request) {
      visualizer.assistantErrorMessage = '请输入改表需求。';
      return false;
    }
    if (!visualizer.tempData || !visualizer.currentSheetKey) {
      visualizer.assistantErrorMessage = '请先选中一张表后再使用 AI 改表助手。';
      return false;
    }

    const requestSheetKey = visualizer.currentSheetKey;
    const createdAt = Date.now();
    const sessionBaselineFingerprint = buildTemplateAssistantFingerprint_ACU(visualizer.tempData || {});
    guardController = createTemplateAssistantSessionGuard_ACU();
    // 初始化 AbortController，使本会话的 runGuard.signal 持有可中断的 signal
    guardController.getSignal();
    visualizer.assistantIsRunning = true;
    visualizer.assistantErrorMessage = '';
    visualizer.assistantRounds = [];
    visualizer.assistantLatestResult = null;
    resetRiskConfirmations();
    appendTurn({
      id: createTurnId('user'),
      type: 'user',
      userRequest: request,
      anchorSheetKey: requestSheetKey,
      createdAt,
    });

    try {
      const result = await runTemplateAssistantSession_ACU({
        tempData: cloneData(visualizer.tempData),
        currentSheetKey: visualizer.currentSheetKey,
        sheetOrder: [...visualizer.sheetOrder],
        userRequest: request,
        priorTurns: buildPriorTurns(turns.value, requestSheetKey),
        tableApiPreset: tableApiPreset.value,
        guard: guardController.createRunGuard(),
        onRoundComplete(progress) {
          if (requestSheetKey !== visualizer.currentSheetKey) return;
          // 一问一答：单轮即最终，round 与 final 是同一份成功结果。
          // 不创建独立 round turn（避免一条请求出现两条 AI 消息），仅同步轮次状态供摘要使用。
          visualizer.assistantRounds = [...progress.rounds];
        },
      });
      if (requestSheetKey !== visualizer.currentSheetKey) {
        visualizer.assistantErrorMessage = '当前选中表已变化，请重新生成 AI 草稿。';
        appendErrorTurn(
          visualizer.assistantErrorMessage,
          requestSheetKey,
          result.session?.lastFailure?.rawText,
        );
        toastStore.warning(visualizer.assistantErrorMessage, { muteable: false });
        return false;
      }
      visualizer.assistantLatestResult = result;
      visualizer.assistantRounds = [...result.rounds];
      appendTurn({
        id: createTurnId('final'),
        type: 'final',
        userRequest: request,
        result,
        anchorSheetKey: getResultAnchorSheetKey(result) || requestSheetKey,
        createdAt: Date.now(),
        baselineFingerprint: sessionBaselineFingerprint,
      });
      resetRiskConfirmations();
      userRequest.value = '';
      return true;
    } catch (error) {
      if (error instanceof TemplateAssistantSessionStoppedError_ACU) {
        visualizer.assistantErrorMessage = error.message;
        appendErrorTurn(error.message, requestSheetKey, (error as any)?.failureRawText);
        toastStore.warning(error.message, { muteable: false });
      } else {
        const message = error instanceof Error ? error.message : 'AI 改表助手执行失败。';
        visualizer.assistantErrorMessage = message;
        appendErrorTurn(message, requestSheetKey, (error as any)?.failureRawText);
        logWarn_ACU('[ACU-V2 Visualizer Assistant] run failed:', error);
        toastStore.error(message, { muteable: false });
      }
      return false;
    } finally {
      visualizer.assistantIsRunning = false;
    }
  }

  /** 删除一条会话记录。运行中禁止删除，避免与 in-flight 会话写入竞争。 */
  function deleteTurn(turnId: string): boolean {
    if (isRunning.value) {
      toastStore.warning('会话运行中，暂不能删除记录。', { muteable: false });
      return false;
    }
    visualizer.removeAssistantTurn(turnId);
    return true;
  }

  /**
   * 从某条用户需求重新生成：丢弃该条及其后的全部记录，用原需求重新发起会话。
   * 复用 run() 的全部前置校验与闸门，不新增旁路。
   */
  async function regenerateFromUserTurn(turn: VisualizerAssistantTurn): Promise<boolean> {
    if (isRunning.value) {
      toastStore.warning('会话运行中，暂不能重新生成。', { muteable: false });
      return false;
    }
    if (turn.type !== 'user') return false;
    const request = String(turn.userRequest || '').trim();
    if (!request) return false;
    visualizer.truncateAssistantTurnsFrom(turn.id);
    userRequest.value = request;
    return run();
  }

  function cancel(): void {
    guardController.cancel();
  }

  function setRiskConfirmation(turnId: string, index: number, value: boolean): void {
    visualizer.assistantRiskConfirmations[`${turnId}:${index}`] = value;
  }

  function getTurnHighRiskItems(turn: VisualizerAssistantTurn): VisualizerAssistantRiskItem[] {
    if (turn.type === 'round') {
      return buildVisualizerAssistantHighRiskItems(
        { compileResult: turn.roundData.perRoundCompileResult } as TemplateAssistantSessionResult_ACU,
        getRoundAnchorSheetKey(turn.roundData) || turn.anchorSheetKey,
      );
    }
    if (turn.type === 'final') {
      return buildVisualizerAssistantHighRiskItems(
        turn.result,
        getResultAnchorSheetKey(turn.result) || turn.anchorSheetKey,
      );
    }
    return [];
  }

  function isTurnAllHighRiskConfirmed(turn: VisualizerAssistantTurn): boolean {
    return getTurnHighRiskItems(turn).every((_, index) =>
      visualizer.assistantRiskConfirmations[`${turn.id}:${index}`] === true,
    );
  }

  function applyCompileResultToVisualizer(payload: VisualizerAssistantTurnApplyPayload): boolean {
    assertVisualizerDataOpsEditable_ACU(visualizer);
    visualizer.tempData = cloneData(payload.candidateData || {});
    visualizer.sheetOrder = Array.isArray(payload.orderedSheetKeys) ? [...payload.orderedSheetKeys] : [];
    applySheetOrderNumbers_ACU(visualizer.tempData, visualizer.sheetOrder);
    const deleted = new Set<string>(visualizer.deletedSheetKeys || []);
    asList(payload.deletedSheetKeys).forEach(key => deleted.add(String(key)));
    visualizer.deletedSheetKeys = Array.from(deleted);

    visualizer.queueLockChanges(asList(payload.lockChanges));

    const previousSheetKey = visualizer.currentSheetKey;
    if (previousSheetKey && visualizer.tempData?.[previousSheetKey]) {
      visualizer.currentSheetKey = previousSheetKey;
    } else if (payload.focusSheetKey && visualizer.tempData?.[payload.focusSheetKey]) {
      visualizer.currentSheetKey = payload.focusSheetKey;
    } else {
      visualizer.currentSheetKey = visualizer.sheetOrder[0] || null;
    }
    if (visualizer.currentSheetKey) visualizer.mode = 'data';
    visualizer.setDirty(true);
    toastStore.success('AI 草稿已应用到编辑器，保存前不会写回聊天。', { muteable: false });
    return true;
  }

  function getTurnApplyBlockReason(turn: VisualizerAssistantTurn): string {
    if (isRunning.value) return '会话运行中，暂不能应用。';
    if (visualizer.isSaving) return '保存进行中，暂不能应用。';
    if (!getTurnApplyPayload(turn)) return '这张卡片没有可应用的变更。';
    if (!isTurnAllHighRiskConfirmed(turn)) return '请先确认该卡片列出的所有高风险项。';
    const payload = getTurnApplyPayload(turn);
    if (payload && payload.anchorSheetKey && payload.anchorSheetKey !== visualizer.currentSheetKey) {
      return '这份草稿属于其他锚点表，请切回原表或重新生成。';
    }
    if (payload && !payload.baselineFingerprint) return '缺少基线指纹，无法校验当前结构，请重新生成。';
    const currentFingerprint = buildTemplateAssistantFingerprint_ACU(visualizer.tempData || {});
    if (payload && payload.baselineFingerprint !== currentFingerprint) {
      return '当前结构已变化，该草稿已失效，请重新生成。';
    }
    return '';
  }

  function canApplyTurn(turn: VisualizerAssistantTurn): boolean {
    return !isRunning.value
      && !!getTurnApplyPayload(turn)
      && getTurnApplyBlockReason(turn) === '';
  }

  function applyTurnDraft(turn: VisualizerAssistantTurn): boolean {
    const blockReason = getTurnApplyBlockReason(turn);
    if (blockReason) {
      // saving 是数据写保护硬闸门：与 applyCompileResultToVisualizer 内
      // assertVisualizerDataOpsEditable_ACU 的 throw 语义保持一致（既有测试断言 throw），
      // 其余原因走 toast 返回 false。
      if (visualizer.isSaving) {
        assertVisualizerDataOpsEditable_ACU(visualizer);
      }
      toastStore.warning(blockReason, { muteable: false });
      return false;
    }
    const payload = getTurnApplyPayload(turn);
    if (!payload) {
      toastStore.warning('这张卡片没有可应用的变更。', { muteable: false });
      return false;
    }
    return applyCompileResultToVisualizer(payload);
  }

  function applyLatestDraft(): boolean {
    const result = latestResult.value;
    if (!result) return false;
    const latestRequestId = String((result.draft as any)?.requestId || '').trim();
    const finalTurns = turns.value
      .filter((turn): turn is Extract<VisualizerAssistantTurn, { type: 'final' }> => turn.type === 'final')
      .filter(turn =>
        // 优先按对象引用（同一次 run() 内）；反序列化/重建后用 requestId 内容匹配
        turn.result === result
        || (latestRequestId && String((turn.result.draft as any)?.requestId || '').trim() === latestRequestId),
      );
    const target = finalTurns[finalTurns.length - 1];
    if (!target) return false;
    return applyTurnDraft(target);
  }

  function syncApiPresetFromCurrentSheet(): void {
    visualizer.assistantTableApiPreset = resolveEffectiveTableApiPreset(visualizer);
  }

  function getTurnSummary(turn: VisualizerAssistantTurn): string {
    if (turn.type === 'user') return turn.userRequest;
    if (turn.type === 'error') return turn.errorMessage;
    if (turn.type === 'round') return turn.roundData.draft.summary || '无摘要';
    return turn.result.draft.summary || '无摘要';
  }

  /** 对 final turn 生成会话摘要（读 turn.result.session，而非 latestResult）。 */
  function getTurnSessionSummary(turn: VisualizerAssistantTurn): string {
    if (turn.type !== 'final') return '';
    const session = turn.result.session;
    if (!session) return '';
    const stopReasonLabel: Record<string, string> = {
      empty_operations: 'AI 未生成任何修改（可继续重试）',
      repair_retry_capped: '修复重试已达上限',
      environment_failure: 'SQLite 引擎不可用',
    };
    const repairPart =
      session.repairRetriesUsed > 0 ? ` · 修复 ${session.repairRetriesUsed} 次` : '';
    return `${stopReasonLabel[session.stopReason] || session.stopReason}${repairPart}`;
  }

  function getTurnWarnings(turn: VisualizerAssistantTurn): string[] {
    if (turn.type === 'round') return asList(turn.roundData.draft.warnings).map(item => String(item));
    if (turn.type === 'final') return asList(turn.result.draft.warnings).map(item => String(item));
    return [];
  }

  function getTurnDiffGroups(turn: VisualizerAssistantTurn): VisualizerAssistantDiffGroup[] {
    if (turn.type === 'round') {
      return buildVisualizerAssistantDiffGroups(
        { compileResult: turn.roundData.perRoundCompileResult } as TemplateAssistantSessionResult_ACU,
        getRoundAnchorSheetKey(turn.roundData) || turn.anchorSheetKey,
      );
    }
    if (turn.type === 'final') {
      return buildVisualizerAssistantDiffGroups(
        turn.result,
        getResultAnchorSheetKey(turn.result) || turn.anchorSheetKey,
      );
    }
    return [];
  }

  watch(
    () => [visualizer.currentSheetKey, visualizer.openTick, visualizer.lastLoadedAt],
    () => {
      guardController.invalidate();
      if (isRunning.value) {
        visualizer.assistantIsRunning = false;
        visualizer.assistantErrorMessage = '会话已失效（结构变化或切表）。';
      }
      syncApiPresetFromCurrentSheet();
    },
  );

  return {
    userRequest,
    tableApiPreset,
    apiPresetOptions,
    anchorSheetLabel,
    isRunning,
    errorMessage,
    rounds,
    latestResult,
    turns,
    riskConfirmations,
    diffGroups,
    highRiskItems,
    allHighRiskConfirmed,
    canApply,
    sessionSummary,
    lastFailure,
    promptSegments,
    promptDirty,
    loadPromptSegments,
    savePrompt,
    resetPrompt,
    addPromptSegment,
    deletePromptSegment,
    updatePromptSegment,
    importPromptFile,
    exportPrompt,
    run,
    cancel,
    setRiskConfirmation,
    applyLatestDraft,
    getTurnHighRiskItems,
    isTurnAllHighRiskConfirmed,
    getTurnApplyPayload,
    getTurnApplyBlockReason,
    canApplyTurn,
    applyTurnDraft,
    syncApiPresetFromCurrentSheet,
    runWithRepairFeedback,
    deleteTurn,
    regenerateFromUserTurn,
    getTurnRawText,
    getTurnValidationError,
    getTurnSummary,
    getTurnSessionSummary,
    getTurnWarnings,
    getTurnDiffGroups,
  };
}
