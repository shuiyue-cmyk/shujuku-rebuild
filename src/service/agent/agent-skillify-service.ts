import type { AgentWorldbookControl_ACU } from '../../shared/models/agent-worldbook-model';
import { callAIWithPreset_ACU } from '../ai/api-call';
import { settings_ACU } from '../runtime/state-manager';
import { getLorebookEntriesByNames_ACU } from '../worldbook/pipeline';
import { estimateTextTk_ACU, normalizeTkBudgetNumber_ACU } from '../../shared/token-estimate';
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

export interface AgentSkillifyRunResult_ACU {
  totalCandidates: number;
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
  const estimatedTk = estimateTextTk_ACU(content || comment);
  const existingTk = Number(existingSkillMeta?.tk);
  return {
    bookName,
    uid: entry.uid,
    comment,
    content,
    keys: getWorldbookEntryKeywordsForSkillify_ACU(entry),
    existingSkillMeta,
    tk: Number.isFinite(existingTk) && existingTk > 0 ? Math.trunc(existingTk) : estimatedTk,
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
    'agent.skillify.outputSchemaJson': { description: '...', triggerWhen: '...', tk: 0 },
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


export function parseAgentSkillifyResponse_ACU(responseText: string, fallbackTk = 0): Pick<WorldbookSkillMeta_ACU, 'description' | 'triggerWhen' | 'tk'> | null {
  const jsonText = extractJsonObjectText_ACU(responseText);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    const triggerWhen = typeof parsed.triggerWhen === 'string' ? parsed.triggerWhen.trim() : '';
    const tk = normalizeTkBudgetNumber_ACU(parsed.tk, fallbackTk);
    if (!description && !triggerWhen) return null;
    return { description, triggerWhen, tk };
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
  let meta: Pick<WorldbookSkillMeta_ACU, 'description' | 'triggerWhen' | 'tk'> | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await callAIWithPreset_ACU(messages, presetName);
    if (!response) {
      lastReason = 'AI 未返回内容';
    } else {
      meta = parseAgentSkillifyResponse_ACU(response, summary.tk);
      if (meta) break;
      lastReason = 'AI 返回不是有效 Skill JSON';
    }
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
  const saveResult = await saveWorldbookEntrySkillMeta_ACU(summary.bookName, summary.uid, meta, 'agent-skillify');
  if (!saveResult.updated && saveResult.reason && saveResult.reason !== '世界书 Skill 元数据未变化') {
    return { status: 'failed', bookName: summary.bookName, uid: summary.uid, reason: saveResult.reason, meta };
  }

  return { status: saveResult.updated ? 'updated' : 'skipped', bookName: summary.bookName, uid: summary.uid, reason: saveResult.reason, meta };
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


function summarizeRunResults_ACU(results: AgentSkillifyEntryResult_ACU[]): AgentSkillifyRunResult_ACU {
  return {
    totalCandidates: results.length,
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

export async function collectWorldbookSkillifyCandidates_ACU(
  bookNames: string[],
  options: AgentSkillifyOptions_ACU = {},
  resolvedControl?: AgentWorldbookControl_ACU,
): Promise<AgentSkillifyWorldbookEntrySummary_ACU[]> {
  const control = resolvedControl || await resolveAgentSkillifyControl_ACU();
  const contextSettings = normalizeAgentContextSettings_ACU(control.contextSettings);
  const entriesMap = await getLorebookEntriesByNames_ACU(bookNames);
  const selectedKeys = normalizeSelectedSkillifyEntryKeys_ACU(options.selectedEntries);
  const summaries: AgentSkillifyWorldbookEntrySummary_ACU[] = [];

  for (const bookName of [...new Set(bookNames.map(name => String(name || '').trim()).filter(Boolean))]) {
    const entries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
    for (const entry of entries) {
      if (!isWorldbookEntrySkillifyCandidate_ACU(entry)) continue;
      if (selectedKeys && !selectedKeys.has(getSkillifySelectionKey_ACU(bookName, entry.uid))) continue;
      summaries.push(buildEntrySummary_ACU(bookName, entry));
    }
  }

  const maxEntries = Number.isFinite(Number(options.maxEntries)) && Number(options.maxEntries) > 0
    ? Number(options.maxEntries)
    : contextSettings.skillifyMaxEntries;
  return summaries.slice(0, maxEntries);
}

export async function skillifyWorldbookEntries_ACU(
  bookNames: string[],
  options: AgentSkillifyOptions_ACU = {},
): Promise<AgentSkillifyRunResult_ACU> {
  options.onProgress?.({ phase: 'collecting', current: 0, total: 0, updated: 0, skipped: 0, failed: 0 });
  const control = await resolveAgentSkillifyControl_ACU();
  const candidates = await collectWorldbookSkillifyCandidates_ACU(bookNames, options, control);
  if (candidates.length === 0) {
    const empty = summarizeRunResults_ACU([]);
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
  const summary = summarizeRunResults_ACU(results);
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
