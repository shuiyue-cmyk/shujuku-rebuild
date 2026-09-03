import type { AgentWorldbookControl_ACU } from '../../shared/models/agent-worldbook-model';
import { callAIWithPreset_ACU, isRetryableAiRequestError_ACU } from '../ai/api-call';
import { settings_ACU } from '../runtime/state-manager';
import { getLorebookEntriesByNames_ACU } from '../worldbook/pipeline';
import { countTextTokens_ACU } from '../ai/token-counter';
import { buildDefaultAgentWorldbookControl_ACU } from '../../shared/defaults';
import {
  parseWorldbookSkillMetaFromComment_ACU,
  saveWorldbookEntrySkillMeta_ACU,
  stripWorldbookSkillMetaBlock_ACU,
  type WorldbookSkillMeta_ACU,
} from './agent-worldbook-skill-meta';
import {
  getDefaultAgentSkillifyPromptSegments_ACU,
  normalizeAgentContextSettings_ACU,
  renderAgentPromptSegments_ACU,
} from './agent-prompt-template';
import {
  readAgentWorldbookControlFromWorldbooks_ACU,
  resolveAgentWorldbookScopeBookNames_ACU,
} from './agent-worldbook-config-meta';
import { isDatabaseGeneratedLorebookEntry_ACU } from '../worldbook/worldbook-placeholder-classification';

export interface AgentSkillifyWorldbookEntrySummary_ACU {
  bookName: string;
  uid: string | number;
  comment: string;
  content: string;
  keys: string[];
  existingSkillMeta: WorldbookSkillMeta_ACU | null;
  tk: number;
}

export type AgentSkillifyEntryStatus_ACU = 'updated' | 'skipped' | 'failed';

export interface AgentSkillifyEntryResult_ACU {
  status: AgentSkillifyEntryStatus_ACU;
  bookName: string;
  uid: string | number;
  reason?: string;
  meta?: Pick<WorldbookSkillMeta_ACU, 'description' | 'triggerWhen' | 'tk'>;
}

export interface AgentSkillifyCursor_ACU {
  bookName: string;
  uid: string | number;
}

export interface AgentSkillifyRunResult_ACU {
  /** 语义保持不变：本批实际处理的条目数，既有调用方仍按它读数。 */
  totalCandidates: number;
  /** 当前待处理范围（已排除跳过项）的匹配总数，用于「本批 x / 共 y」这类进度展示。 */
  totalMatched: number;
  /** 本批被选中处理的数量。 */
  selectedForRun: number;
  /** 匹配总数中还没处理的数量。 */
  remaining: number;
  /** 是否因为批量上限而截断；true 表示还有下一批可跑。 */
  truncated: boolean;
  /** 下一批的续跑游标；本批最后一条处理项的位置，按稳定候选序列向后偏移一位续读。 */
  nextCursor?: AgentSkillifyCursor_ACU;
  updated: number;
  skipped: number;
  failed: number;
  results: AgentSkillifyEntryResult_ACU[];
}

export type AgentSkillifyProgressPhase_ACU = 'collecting' | 'processing' | 'retry' | 'saving' | 'entry_done' | 'complete' | 'error';

export interface AgentSkillifyProgressEvent_ACU {
  phase: AgentSkillifyProgressPhase_ACU;
  current: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  bookName?: string;
  uid?: string | number;
  attempt?: number;
  maxAttempts?: number;
  message?: string;
}

export interface AgentSkillifySelectedEntry_ACU {
  bookName: string;
  uid: string | number;
}

export interface AgentSkillifyOptions_ACU {
  presetName?: string;
  overwriteManual?: boolean;
  maxEntries?: number;
  selectedEntries?: AgentSkillifySelectedEntry_ACU[];
  maxConcurrency?: number;
  maxAiRetries?: number;
  cursor?: AgentSkillifyCursor_ACU;
  onProgress?: (event: AgentSkillifyProgressEvent_ACU) => void;
}

function readLegacyAgentSkillifyControl_ACU(): AgentWorldbookControl_ACU {
  const defaults = buildDefaultAgentWorldbookControl_ACU() as AgentWorldbookControl_ACU;
  const legacy = (settings_ACU.plotSettings as any)?.agentWorldbookControl;
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return defaults;

  const maxEntriesPerChannel = legacy.maxEntriesPerChannel && typeof legacy.maxEntriesPerChannel === 'object'
    ? legacy.maxEntriesPerChannel
    : defaults.maxEntriesPerChannel;
  return {
    ...defaults,
    ...legacy,
    contextSettings: normalizeAgentContextSettings_ACU(legacy.contextSettings),
    agentDecisionPromptSegments: Array.isArray(legacy.agentDecisionPromptSegments)
      ? legacy.agentDecisionPromptSegments
      : defaults.agentDecisionPromptSegments,
    agentSkillifyPromptSegments: Array.isArray(legacy.agentSkillifyPromptSegments)
      ? legacy.agentSkillifyPromptSegments
      : defaults.agentSkillifyPromptSegments,
    maxEntriesPerChannel: {
      ...defaults.maxEntriesPerChannel,
      ...maxEntriesPerChannel,
    },
  } as AgentWorldbookControl_ACU;
}

async function resolveAgentSkillifyControl_ACU(): Promise<AgentWorldbookControl_ACU> {
  try {
    const result = await readAgentWorldbookControlFromWorldbooks_ACU();
    return result.control;
  } catch {
    return readLegacyAgentSkillifyControl_ACU();
  }
}

function normalizeStringArray_ACU(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
  return [];
}

export function getWorldbookEntryKeywordsForSkillify_ACU(entry: Record<string, any>): string[] {
  return [...new Set([...normalizeStringArray_ACU(entry?.keys), ...normalizeStringArray_ACU(entry?.key)])];
}

export function isDatabaseGeneratedWorldbookEntryForAgent_ACU(entry: Record<string, any>): boolean {
  return isDatabaseGeneratedLorebookEntry_ACU(entry);
}

export function isWorldbookEntrySkillifyCandidate_ACU(entry: Record<string, any>): boolean {
  if (!entry || entry.enabled === false) return false;
  if (String(entry.type || '').trim().toLowerCase() === 'constant') return false;
  if (isDatabaseGeneratedWorldbookEntryForAgent_ACU(entry)) return false;
  return true;
}

function buildEntrySummary_ACU(
  bookName: string,
  entry: Record<string, any>,
): AgentSkillifyWorldbookEntrySummary_ACU {
  const rawComment = String(entry?.comment || entry?.name || '').trim();
  const strippedComment = stripWorldbookSkillMetaBlock_ACU(rawComment);
  const comment = strippedComment || String(entry?.name || '').trim();
  const content = String(entry?.content || '').trim();
  const existingSkillMeta = parseWorldbookSkillMetaFromComment_ACU(rawComment);
  return {
    bookName,
    uid: entry.uid,
    comment,
    content,
    keys: getWorldbookEntryKeywordsForSkillify_ACU(entry),
    existingSkillMeta,
    // tk 一律由本地统计器在选中成批后回填（见 hydrateSkillifyCandidateTokens_ACU）：
    // 让 AI 输出 tk 只会得到凭空放大的数字，而且它还得先读完整正文才能估，两头都不划算。
    tk: 0,
  };
}

export function shouldSkipSkillifyEntry_ACU(
  summary: AgentSkillifyWorldbookEntrySummary_ACU,
  options: AgentSkillifyOptions_ACU = {},
): string | null {
  const existing = summary.existingSkillMeta;
  if (!existing) return null;
  const hasExistingText = !!(existing.description || existing.triggerWhen);
  if (hasExistingText && options.overwriteManual !== true) {
    return existing.updatedBy === 'manual' ? '已存在用户手动编辑的 Skill 元数据' : '已存在 Skill 元数据';
  }
  return null;
}

export function buildWorldbookSkillifyPrompt_ACU(
  summary: AgentSkillifyWorldbookEntrySummary_ACU,
  control: AgentWorldbookControl_ACU = readLegacyAgentSkillifyControl_ACU(),
): Array<{ role: string; content: string }> {
  const placeholders = {
    'agent.skillify.bookName': summary.bookName,
    'agent.skillify.uid': summary.uid,
    'agent.skillify.comment': summary.comment || '（空）',
    'agent.skillify.content': summary.content || '（空）',
    'agent.skillify.keysText': summary.keys.join('、') || '（空）',
    'agent.skillify.tk': summary.tk,
    'agent.skillify.contentPreview': summary.content || '（空）',
    'agent.skillify.existingSkillMetaJson': summary.existingSkillMeta || {},
    'agent.skillify.outputSchemaJson': { description: '...', triggerWhen: '...' },
  };
  const messages = renderAgentPromptSegments_ACU(
    control.agentSkillifyPromptSegments || getDefaultAgentSkillifyPromptSegments_ACU(),
    placeholders,
    { enableSqlRender: true, promptKind: 'skillify' },
  );
  return messages.length > 0
    ? messages
    : renderAgentPromptSegments_ACU(getDefaultAgentSkillifyPromptSegments_ACU(), placeholders, { enableSqlRender: true, promptKind: 'skillify' });
}

function extractJsonObjectText_ACU(text: string): string | null {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}


/** 只取 description / triggerWhen 两个字段；AI 若擅自吐 tk 字段一律丢弃，tk 由本地统计器决定。 */
export function parseAgentSkillifyResponse_ACU(responseText: string): Pick<WorldbookSkillMeta_ACU, 'description' | 'triggerWhen'> | null {
  const jsonText = extractJsonObjectText_ACU(responseText);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    const triggerWhen = typeof parsed.triggerWhen === 'string' ? parsed.triggerWhen.trim() : '';
    if (!description && !triggerWhen) return null;
    return { description, triggerWhen };
  } catch {
    return null;
  }
}

function resolveAgentAiMaxAttempts_ACU(options: AgentSkillifyOptions_ACU = {}, control: AgentWorldbookControl_ACU = readLegacyAgentSkillifyControl_ACU()): number {
  const contextSettings = normalizeAgentContextSettings_ACU(control.contextSettings);
  const raw = Number.isFinite(Number(options.maxAiRetries)) && Number(options.maxAiRetries) > 0
    ? Number(options.maxAiRetries)
    : contextSettings.agentAiMaxRetries;
  return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(raw)));
}

async function skillifySingleEntry_ACU(
  summary: AgentSkillifyWorldbookEntrySummary_ACU,
  options: AgentSkillifyOptions_ACU,
  control: AgentWorldbookControl_ACU,
  progressState?: { current: number; total: number; updated: number; skipped: number; failed: number },
): Promise<AgentSkillifyEntryResult_ACU> {
  const skipReason = shouldSkipSkillifyEntry_ACU(summary, options);
  if (skipReason) {
    return { status: 'skipped', bookName: summary.bookName, uid: summary.uid, reason: skipReason };
  }

  const presetName = options.presetName ?? control.agentSkillApiPreset ?? '';
  const messages = buildWorldbookSkillifyPrompt_ACU(summary, control);
  const maxAttempts = resolveAgentAiMaxAttempts_ACU(options, control);
  let lastReason = 'AI 未返回内容';
  let meta: Pick<WorldbookSkillMeta_ACU, 'description' | 'triggerWhen'> | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryable = true;
    // AI 调用异常只作为该条目的失败原因参与重试，不允许穿透 runWithConcurrency 拖垮整批 skillify。
    try {
      const response = await callAIWithPreset_ACU(messages, presetName);
      if (!response) {
        lastReason = 'AI 未返回内容';
      } else {
        meta = parseAgentSkillifyResponse_ACU(response);
        if (meta) break;
        lastReason = 'AI 返回不是有效 Skill JSON';
      }
    } catch (error) {
      // 与 agent-decision-engine 同约定，Abort 先行：用户「停止」触发的 Abort 直接以
      // aborted 码终止整批，不当成普通失败 break→failed，更不重试。
      if ((options as any)?.signal?.aborted || (error as any)?.name === 'AbortError') {
        throw new Error(`agent_skillify_entry_aborted:${summary.bookName}:${String(summary.uid)}`);
      }
      lastReason = `AI 调用异常：${error instanceof Error ? error.message : String(error)}`;
      retryable = isRetryableAiRequestError_ACU(error);
    }
    // 401/403/4xx 这类配置性失败重试多少次结果都一样，直接跳出，把剩余尝试次数留给真能恢复的瞬时失败。
    if (!retryable) break;
    if (attempt < maxAttempts) {
      options.onProgress?.({
        phase: 'retry',
        current: progressState?.current ?? 0,
        total: progressState?.total ?? 0,
        updated: progressState?.updated ?? 0,
        skipped: progressState?.skipped ?? 0,
        failed: progressState?.failed ?? 0,
        bookName: summary.bookName,
        uid: summary.uid,
        attempt,
        maxAttempts,
        message: lastReason,
      });
    }
  }

  if (!meta) return { status: 'failed', bookName: summary.bookName, uid: summary.uid, reason: lastReason };

  options.onProgress?.({ phase: 'saving', current: progressState?.current ?? 0, total: progressState?.total ?? 0, updated: progressState?.updated ?? 0, skipped: progressState?.skipped ?? 0, failed: progressState?.failed ?? 0, bookName: summary.bookName, uid: summary.uid, maxAttempts });
  // tk 用本地统计值覆盖：AI 不参与计数，落库的 tk 永远等于宿主分词器（或字符估算）算出来的数。
  const savedMeta = { ...meta, tk: summary.tk };
  const saveResult = await saveWorldbookEntrySkillMeta_ACU(summary.bookName, summary.uid, savedMeta, 'agent-skillify');
  if (!saveResult.updated && saveResult.reason && saveResult.reason !== '世界书 Skill 元数据未变化') {
    return { status: 'failed', bookName: summary.bookName, uid: summary.uid, reason: saveResult.reason, meta: savedMeta };
  }

  return { status: saveResult.updated ? 'updated' : 'skipped', bookName: summary.bookName, uid: summary.uid, reason: saveResult.reason, meta: savedMeta };
}

async function runWithConcurrency_ACU<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}


interface AgentSkillifyCandidateBatch_ACU {
  allPendingCandidates: AgentSkillifyWorldbookEntrySummary_ACU[];
  selectedCandidates: AgentSkillifyWorldbookEntrySummary_ACU[];
  totalMatched: number;
  selectedForRun: number;
  remaining: number;
  truncated: boolean;
  nextCursor?: AgentSkillifyCursor_ACU;
}

function summarizeRunResults_ACU(
  results: AgentSkillifyEntryResult_ACU[],
  batch: AgentSkillifyCandidateBatch_ACU = {
    allPendingCandidates: [],
    selectedCandidates: [],
    totalMatched: results.length,
    selectedForRun: results.length,
    remaining: 0,
    truncated: false,
  },
): AgentSkillifyRunResult_ACU {
  return {
    totalCandidates: results.length,
    totalMatched: batch.totalMatched,
    selectedForRun: batch.selectedForRun,
    remaining: batch.remaining,
    truncated: batch.truncated,
    nextCursor: batch.nextCursor,
    updated: results.filter(result => result.status === 'updated').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    failed: results.filter(result => result.status === 'failed').length,
    results,
  };
}

function getSkillifySelectionKey_ACU(bookName: string, uid: string | number): string {
  return `${String(bookName || '').trim()}\u0000${String(uid)}`;
}

function normalizeSelectedSkillifyEntryKeys_ACU(
  selectedEntries: AgentSkillifyOptions_ACU['selectedEntries'],
): Set<string> | null {
  if (!Array.isArray(selectedEntries)) return null;
  const keys = selectedEntries
    .filter(entry => String(entry?.bookName || '').trim() && entry?.uid !== undefined && entry?.uid !== null)
    .map(entry => getSkillifySelectionKey_ACU(entry.bookName, entry.uid));
  return new Set(keys);
}

/**
 * 候选序列的稳定排序：数字 uid 按数值序，其余按字符串序，同值再按原始出现顺序。
 * 游标分批要求「同一批数据多次排出来的顺序完全一致」，否则 nextCursor 指向的下一条会漂移。
 */
function compareSkillifyCandidates_ACU(
  left: { summary: AgentSkillifyWorldbookEntrySummary_ACU; index: number },
  right: { summary: AgentSkillifyWorldbookEntrySummary_ACU; index: number },
): number {
  const leftUid = left.summary.uid;
  const rightUid = right.summary.uid;
  if (typeof leftUid === 'number' && Number.isFinite(leftUid) && typeof rightUid === 'number' && Number.isFinite(rightUid)) {
    return leftUid - rightUid || left.index - right.index;
  }
  return String(leftUid).localeCompare(String(rightUid)) || left.index - right.index;
}

/** 本批处理量：调用方显式给的 maxEntries 优先，否则回落到 Agent 上下文设置里的 skillifyMaxEntries。 */
function resolveSkillifyBatchSize_ACU(options: AgentSkillifyOptions_ACU, control: AgentWorldbookControl_ACU): number {
  const configured = Number(options.maxEntries);
  if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.trunc(configured));
  return normalizeAgentContextSettings_ACU(control.contextSettings).skillifyMaxEntries;
}

async function collectWorldbookSkillifyBatch_ACU(
  bookNames: string[],
  options: AgentSkillifyOptions_ACU = {},
  resolvedControl?: AgentWorldbookControl_ACU,
): Promise<AgentSkillifyCandidateBatch_ACU> {
  const control = resolvedControl || await resolveAgentSkillifyControl_ACU();
  const entriesMap = await getLorebookEntriesByNames_ACU(bookNames);
  const selectedKeys = normalizeSelectedSkillifyEntryKeys_ACU(options.selectedEntries);
  const normalizedBookNames = [...new Set(bookNames.map(name => String(name || '').trim()).filter(Boolean))];
  const candidatesByBook = new Map<string, AgentSkillifyWorldbookEntrySummary_ACU[]>();

  for (const bookName of normalizedBookNames) {
    const entries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
    const candidates = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => isWorldbookEntrySkillifyCandidate_ACU(entry))
      .filter(({ entry }) => !selectedKeys || selectedKeys.has(getSkillifySelectionKey_ACU(bookName, entry.uid)))
      .map(({ entry, index }) => ({ summary: buildEntrySummary_ACU(bookName, entry), index }))
      .sort(compareSkillifyCandidates_ACU)
      .map(({ summary }) => summary);
    candidatesByBook.set(bookName, candidates);
  }

  // 多本世界书按「轮转取一条」合并，而不是首本取完再取次本：
  // 否则排在后面的世界书在限量批次里永远轮不到，游标推进多少批都吃不到它。
  const allCandidates: AgentSkillifyWorldbookEntrySummary_ACU[] = [];
  for (let round = 0; ; round++) {
    let added = false;
    for (const bookName of normalizedBookNames) {
      const candidate = candidatesByBook.get(bookName)?.[round];
      if (candidate) {
        allCandidates.push(candidate);
        added = true;
      }
    }
    if (!added) break;
  }

  let cursorStart = 0;
  if (options.cursor) {
    const cursorIndex = allCandidates.findIndex(candidate =>
      candidate.bookName === options.cursor!.bookName && String(candidate.uid) === String(options.cursor!.uid));
    if (cursorIndex < 0) throw new Error('Agent Skillify 游标无效：所属世界书条目已删除或不在当前待处理范围内。');
    cursorStart = cursorIndex + 1;
  }

  // 跳过项（已有 Skill 元数据且未开覆盖）在选批之前就剔掉：
  // 它们不消耗 AI 调用，若还占批次名额，每批都会退化成「若干跳过 + 少量真处理」。
  const allPendingCandidates = allCandidates.slice(cursorStart).filter(candidate => !shouldSkipSkillifyEntry_ACU(candidate, options));
  const selectedCandidates = allPendingCandidates.slice(0, resolveSkillifyBatchSize_ACU(options, control));
  const remaining = allPendingCandidates.length - selectedCandidates.length;
  const lastSelected = selectedCandidates[selectedCandidates.length - 1];
  return {
    allPendingCandidates,
    selectedCandidates,
    totalMatched: allPendingCandidates.length,
    selectedForRun: selectedCandidates.length,
    remaining,
    truncated: remaining > 0,
    nextCursor: lastSelected ? { bookName: lastSelected.bookName, uid: lastSelected.uid } : undefined,
  };
}

/** 只对最终入选本批的条目算 tk：全量候选可能上千条，逐条走宿主分词器会把一次点击拖成几十秒卡顿。 */
async function hydrateSkillifyCandidateTokens_ACU(
  candidates: AgentSkillifyWorldbookEntrySummary_ACU[],
): Promise<AgentSkillifyWorldbookEntrySummary_ACU[]> {
  return Promise.all(candidates.map(async candidate => ({
    ...candidate,
    tk: await countTextTokens_ACU(candidate.content || candidate.comment),
  })));
}

export async function collectWorldbookSkillifyCandidates_ACU(
  bookNames: string[],
  options: AgentSkillifyOptions_ACU = {},
  resolvedControl?: AgentWorldbookControl_ACU,
): Promise<AgentSkillifyWorldbookEntrySummary_ACU[]> {
  const batch = await collectWorldbookSkillifyBatch_ACU(bookNames, options, resolvedControl);
  return hydrateSkillifyCandidateTokens_ACU(batch.selectedCandidates);
}

export async function skillifyWorldbookEntries_ACU(
  bookNames: string[],
  options: AgentSkillifyOptions_ACU = {},
): Promise<AgentSkillifyRunResult_ACU> {
  options.onProgress?.({ phase: 'collecting', current: 0, total: 0, updated: 0, skipped: 0, failed: 0 });
  const control = await resolveAgentSkillifyControl_ACU();
  const batch = await collectWorldbookSkillifyBatch_ACU(bookNames, options, control);
  const candidates = await hydrateSkillifyCandidateTokens_ACU(batch.selectedCandidates);
  if (candidates.length === 0) {
    const empty = summarizeRunResults_ACU([], batch);
    options.onProgress?.({ phase: 'complete', current: 0, total: 0, updated: 0, skipped: 0, failed: 0 });
    return empty;
  }

  const configuredConcurrency = Number.isFinite(Number(options.maxConcurrency)) && Number(options.maxConcurrency) > 0
    ? Number(options.maxConcurrency)
    : (Number(control.maxSkillifyConcurrency) || buildDefaultAgentWorldbookControl_ACU().maxSkillifyConcurrency);
  const concurrency = Math.max(1, Math.min(configuredConcurrency, candidates.length, Number.MAX_SAFE_INTEGER));
  const progressState = { current: 0, total: candidates.length, updated: 0, skipped: 0, failed: 0 };
  options.onProgress?.({ phase: 'processing', ...progressState });
  const results = await runWithConcurrency_ACU(candidates, concurrency, async (summary, index) => {
    const result = await skillifySingleEntry_ACU(summary, options, control, progressState);
    progressState.current += 1;
    if (result.status === 'updated') progressState.updated += 1;
    else if (result.status === 'skipped') progressState.skipped += 1;
    else if (result.status === 'failed') progressState.failed += 1;
    options.onProgress?.({
      phase: 'entry_done',
      ...progressState,
      bookName: summary.bookName,
      uid: summary.uid,
      message: result.reason || `条目 ${index + 1} 已处理`,
    });
    return result;
  });
  const summary = summarizeRunResults_ACU(results, batch);
  options.onProgress?.({ phase: 'complete', current: summary.totalCandidates, total: summary.totalCandidates, updated: summary.updated, skipped: summary.skipped, failed: summary.failed });
  return summary;
}

export async function skillifyCurrentPlotWorldbookSelection_ACU(
  options: AgentSkillifyOptions_ACU = {},
): Promise<AgentSkillifyRunResult_ACU> {
  const bookNames = await resolveAgentWorldbookScopeBookNames_ACU();
  if (bookNames.length === 0) return summarizeRunResults_ACU([]);
  return skillifyWorldbookEntries_ACU(bookNames, options);
}
