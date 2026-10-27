/**
 * service/decision-recall/decision-recall-runtime.ts — 决策召回一次完整的选取（单独开启与替换剧情推进任务共用）。
 *
 * 流程：读纪要表 → 最新 5 条固定 → 其余（交火开着时只看它筛过的纪要索引）超过召回条数才打分 →
 * 每组 20 条、最多同时 3 组发给决策模型 → 一组失败按重试上限重试，仍失败就跳过这一组 →
 * 分数从高到低凑满条数 → 与固定条数合并、按表号排列。
 * 没填 Key 时不发请求，只带固定条数。任何一组失败都不会让这次发送停下。
 */
import { settings_ACU } from '../runtime/state-manager';
import { readErrorMessage_ACU, runWithDeadline_ACU } from '../optimization/decision-gate';
import { abortableDelay } from '../../shared/abortable-delay';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import {
  DECISION_RECALL_BATCH_SIZE_ACU,
  DECISION_RECALL_CODES_PLACEHOLDER_ACU,
  DECISION_RECALL_CONCURRENCY_ACU,
  DECISION_RECALL_INPUT_PLACEHOLDER_ACU,
  DECISION_RECALL_TIMEOUT_MS_ACU,
} from '../../shared/decision-recall-defaults';
import {
  normalizeDecisionRecallSettings_ACU,
  resolveDecisionRecallEndpoint_ACU,
  type DecisionRecallSettings_ACU,
} from './decision-recall-settings';
import {
  buildDecisionRecallBatchBody_ACU,
  buildDecisionRecallState_ACU,
  interpretDecisionRecallBatchResponse_ACU,
  type DecisionRecallRow_ACU,
  type DecisionRecallScore_ACU,
} from './decision-recall-scoring';
import {
  chunkDecisionRecallRows_ACU,
  pickDecisionRecallRows_ACU,
  planDecisionRecall_ACU,
} from './decision-recall-selection';
import { collectDecisionRecallAiFloors_ACU } from './decision-recall-context';
import {
  DEFAULT_DECISION_RECALL_SOURCES_ACU,
  collectIndexedCodes_ACU,
  type DecisionRecallSources_ACU,
} from './decision-recall-sources';

export interface DecisionRecallRunDeps_ACU {
  sources?: DecisionRecallSources_ACU;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

export interface DecisionRecallRunOptions_ACU {
  userInput: string;
  /** 不传时读当前设置。 */
  settings?: DecisionRecallSettings_ACU;
  signal?: AbortSignal | null;
}

export interface DecisionRecallScoredEntry_ACU extends DecisionRecallScore_ACU {
  row: DecisionRecallRow_ACU;
}

export type DecisionRecallRunResult_ACU =
  | { status: 'aborted' }
  | { status: 'skipped'; reason: 'no_rows' | 'table_unavailable'; message: string }
  | {
    status: 'ok';
    /** 最终带上的纪要（固定 + 选出），按表号顺序。 */
    selected: DecisionRecallRow_ACU[];
    fixed: DecisionRecallRow_ACU[];
    /** 打上分的纪要，按分数从高到低。 */
    scored: DecisionRecallScoredEntry_ACU[];
    /** 参与挑选的纪要条数（不含固定条数）。 */
    candidateCount: number;
    candidateSource: 'crossfire_index' | 'all_rows';
    batchCount: number;
    failedBatchCount: number;
    /** 没打上分的纪要条数（失败组 + 漏答）。 */
    unscoredCount: number;
    missingKey: boolean;
    providerLabel: string;
    errors: string[];
  };

type GroupOutcome_ACU =
  | { kind: 'scored'; scores: Map<string, DecisionRecallScore_ACU> }
  | { kind: 'failed'; error: string }
  | { kind: 'aborted' };

function retryDelayMs_ACU(attempt: number, rateLimited: boolean): number {
  return (rateLimited ? 4000 : 1500) * (attempt + 1);
}

export async function runDecisionRecall_ACU(
  options: DecisionRecallRunOptions_ACU,
  deps: DecisionRecallRunDeps_ACU = {},
): Promise<DecisionRecallRunResult_ACU> {
  const sources = deps.sources ?? DEFAULT_DECISION_RECALL_SOURCES_ACU;
  const settings = options.settings ?? normalizeDecisionRecallSettings_ACU(settings_ACU?.decisionRecallSettings);
  const signal = options.signal ?? undefined;
  const sleep = deps.sleep ?? ((ms: number, s?: AbortSignal) => abortableDelay(ms, s));
  const isAborted = () => signal?.aborted === true;

  const loaded = await sources.loadRows();
  if (isAborted()) return { status: 'aborted' };
  if (loaded.error) return { status: 'skipped', reason: 'table_unavailable', message: loaded.error };
  if (loaded.rows.length === 0) return { status: 'skipped', reason: 'no_rows', message: '纪要表还没有纪要。' };

  const indexContent = await sources.loadCrossfireIndexContent();
  if (isAborted()) return { status: 'aborted' };
  const candidateCodes = collectIndexedCodes_ACU(indexContent, loaded.rows);
  const plan = planDecisionRecall_ACU(loaded.rows, { candidateCodes, recallCount: settings.recallCount });
  const endpoint = resolveDecisionRecallEndpoint_ACU(settings);
  const base = {
    fixed: plan.fixed,
    candidateCount: plan.pool.length,
    candidateSource: candidateCodes ? 'crossfire_index' as const : 'all_rows' as const,
    providerLabel: endpoint.label,
  };

  if (!plan.needsScoring) {
    return {
      status: 'ok', ...base, selected: pickDecisionRecallRows_ACU(plan.fixed, plan.pool.map(row => ({ row, score: 0 })), plan.pool.length),
      scored: [], batchCount: 0, failedBatchCount: 0, unscoredCount: 0, missingKey: false, errors: [],
    };
  }
  if (!endpoint.apiKey) {
    return {
      status: 'ok', ...base, selected: [...plan.fixed], scored: [], batchCount: 0, failedBatchCount: 0,
      unscoredCount: plan.pool.length, missingKey: true, errors: [],
    };
  }

  const state = buildDecisionRecallState_ACU({ aiFloors: collectDecisionRecallAiFloors_ACU(sources.loadChat()), userInput: options.userInput });
  const groups = chunkDecisionRecallRows_ACU(plan.pool, DECISION_RECALL_BATCH_SIZE_ACU);
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  const requestGroup = async (rows: DecisionRecallRow_ACU[]) => {
    const outcome = await runWithDeadline_ACU<{ scores?: Map<string, DecisionRecallScore_ACU>; error?: string; rateLimited?: boolean }>(
      { timeoutMs: deps.timeoutMs ?? DECISION_RECALL_TIMEOUT_MS_ACU, signal },
      async requestSignal => {
        const response = await fetchImpl(endpoint.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${endpoint.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildDecisionRecallBatchBody_ACU(endpoint.model, state, rows, settings.scoringContent)),
          signal: requestSignal,
        });
        if (!response.ok) {
          const reason = await readErrorMessage_ACU(response);
          return { error: `HTTP ${response.status}${reason ? `：${reason}` : ''}`, rateLimited: response.status === 429 };
        }
        return { scores: interpretDecisionRecallBatchResponse_ACU(await response.json(), rows) };
      },
    );
    if (outcome.ok) return outcome.value!;
    if (outcome.failure) return { error: `决策模型${outcome.failure}` };
    return { error: `请求失败：${(outcome.error as any)?.message || outcome.error}` };
  };

  const scoreGroup = async (rows: DecisionRecallRow_ACU[]): Promise<GroupOutcome_ACU> => {
    let lastError = '';
    for (let attempt = 0; attempt <= settings.maxRetries; attempt++) {
      if (isAborted()) return { kind: 'aborted' };
      const outcome = await requestGroup(rows);
      if (isAborted()) return { kind: 'aborted' };
      if (outcome.scores && outcome.scores.size > 0) return { kind: 'scored', scores: outcome.scores };
      lastError = outcome.error || '决策模型没有给出任何打分';
      if (attempt < settings.maxRetries) await sleep(retryDelayMs_ACU(attempt, outcome.rateLimited === true), signal);
    }
    return { kind: 'failed', error: lastError };
  };

  const outcomes: GroupOutcome_ACU[] = new Array(groups.length);
  let nextGroup = 0;
  const worker = async () => {
    while (nextGroup < groups.length && !isAborted()) {
      const index = nextGroup++;
      outcomes[index] = await scoreGroup(groups[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DECISION_RECALL_CONCURRENCY_ACU, groups.length) }, worker));
  if (isAborted() || outcomes.some(outcome => outcome?.kind === 'aborted')) return { status: 'aborted' };

  const scored: DecisionRecallScoredEntry_ACU[] = [];
  const errors: string[] = [];
  let failedBatchCount = 0;
  let unscoredCount = 0;
  groups.forEach((rows, index) => {
    const outcome = outcomes[index];
    if (outcome.kind !== 'scored') {
      failedBatchCount += 1;
      unscoredCount += rows.length;
      if (outcome.kind === 'failed') errors.push(outcome.error);
      return;
    }
    for (const row of rows) {
      const score = outcome.scores.get(row.rowKey);
      if (score) scored.push({ row, ...score });
      else unscoredCount += 1;
    }
  });
  scored.sort((left, right) => (right.score - left.score) || (right.row.rowOrder - left.row.rowOrder));
  if (failedBatchCount > 0) {
    logWarn_ACU(`[决策召回] ${failedBatchCount}/${groups.length} 组打分重试 ${settings.maxRetries} 次后仍失败，已跳过：${[...new Set(errors)].join('；')}`);
  }

  return {
    status: 'ok', ...base, selected: pickDecisionRecallRows_ACU(plan.fixed, scored, settings.recallCount),
    scored, batchCount: groups.length, failedBatchCount, unscoredCount, missingKey: false, errors,
  };
}

/** 打分有失败或没填 Key 时的提示；全部正常时返回空串。单独开启与替换剧情推进任务共用。 */
export function describeDecisionRecallWarning_ACU(result: DecisionRecallRunResult_ACU): string {
  if (result.status !== 'ok') return '';
  if (result.missingKey) return `决策召回还没填 ${result.providerLabel} Key，本次只带上最新 ${result.fixed.length} 条纪要。`;
  if (result.failedBatchCount > 0) {
    return `决策召回有 ${result.failedBatchCount}/${result.batchCount} 组打分重试后仍失败，已跳过这些组，从其余纪要里选取。`;
  }
  return '';
}

/** 运行日志里的一行摘要：候选来源、分组、失败与选中的编码（带分数）。 */
export function describeDecisionRecallResult_ACU(result: DecisionRecallRunResult_ACU): string {
  if (result.status === 'aborted') return '[决策召回] 已中止。';
  if (result.status === 'skipped') return `[决策召回] 跳过：${result.message}`;
  const scoreByKey = new Map(result.scored.map(entry => [entry.row.rowKey, entry.score]));
  const picked = result.selected
    .map(row => (scoreByKey.has(row.rowKey) ? `${row.indexCode}(${scoreByKey.get(row.rowKey)!.toFixed(2)})` : row.indexCode))
    .join(', ');
  const source = result.candidateSource === 'crossfire_index' ? '交火纪要索引' : '全部纪要';
  return `[决策召回] 候选 ${result.candidateCount} 条（${source}），分 ${result.batchCount} 组，失败 ${result.failedBatchCount} 组，`
    + `未打上分 ${result.unscoredCount} 条${result.missingKey ? '（未填 Key）' : ''}；带上 ${result.selected.length} 条：${picked}`;
}

export function logDecisionRecallResult_ACU(result: DecisionRecallRunResult_ACU): void {
  logDebug_ACU(describeDecisionRecallResult_ACU(result));
}

/** 召回编码块：与模型回复同形的 recall 标签，一行一个编码（替换剧情推进任务时沿用任务自己的标签写法）。 */
export function buildDecisionRecallTagBlock_ACU(codes: readonly string[], tagName = 'recall'): string {
  return `<${tagName}>\n${codes.join('\n')}\n</${tagName}>`;
}

/**
 * 单独开启时写进本轮输入的内容：先替换召回编码块占位符，再替换用户输入占位符（输入里碰巧有占位符字样也不会被二次替换）。
 * 指令里没有编码块占位符时追加在末尾；没有用户输入占位符时把输入放在最前面，免得原话丢失。
 */
export function buildDecisionRecallFinalMessage_ACU(directive: string, userInput: string, codes: readonly string[]): string {
  const block = buildDecisionRecallTagBlock_ACU(codes);
  let text = String(directive || '');
  text = text.includes(DECISION_RECALL_CODES_PLACEHOLDER_ACU)
    ? text.split(DECISION_RECALL_CODES_PLACEHOLDER_ACU).join(block)
    : `${text.trimEnd()}\n${block}`;
  if (!text.includes(DECISION_RECALL_INPUT_PLACEHOLDER_ACU)) return `${userInput}\n\n${text}`;
  return text.split(DECISION_RECALL_INPUT_PLACEHOLDER_ACU).join(userInput);
}
