/**
 * service/decision-recall/decision-recall-runtime.ts — 决策召回一次完整的选取（单独召回与替换剧情推进任务共用）。
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
import { maskSensitiveText_ACU } from '../../shared/log-buffer';
import {
  DECISION_RECALL_CODES_PLACEHOLDER_ACU,
  DECISION_RECALL_INPUT_PLACEHOLDER_ACU,
  DECISION_RECALL_TIMEOUT_MS_ACU,
  DECISION_RECALL_TOTAL_TIMEOUT_MS_ACU,
} from '../../shared/decision-recall-defaults';
import {
  normalizeDecisionRecallSettings_ACU,
  resolveDecisionRecallEndpoint_ACU,
  type DecisionRecallSettings_ACU,
} from './decision-recall-settings';
import {
  buildDecisionRecallBatchBody_ACU,
  buildDecisionRecallState_ACU,
  DECISION_RECALL_LEVELS_ACU,
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
  totalTimeoutMs?: number;
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
    /** 打分全部失败的组数（每组判定的几次都失败）。 */
    failedBatchCount: number;
    /** 每组判定几次取平均。 */
    judgeRuns: number;
    /** 失败的判定次数（含失败组里的）；部分失败的组按成功的几次取平均。 */
    failedRunCount: number;
    /** 没打上分的纪要条数（失败组 + 漏答）。 */
    unscoredCount: number;
    /** 接口没填好（缺地址、模型名或 Key），没有打分。 */
    missingKey: boolean;
    /** 缺的是哪一项，配合 missingKey 给提示。 */
    missingField?: string;
    providerLabel: string;
    errors: string[];
  };

type GroupOutcome_ACU =
  | { kind: 'scored'; scores: Map<string, DecisionRecallScore_ACU> }
  | { kind: 'failed'; error: string }
  | { kind: 'aborted' };

/** 整次召回的总时限：判定几次就放宽几倍。 */
export function resolveDecisionRecallTotalTimeoutMs_ACU(judgeRuns: number): number {
  return DECISION_RECALL_TOTAL_TIMEOUT_MS_ACU * Math.max(1, Math.floor(judgeRuns) || 1);
}

function nearestLevelLabel_ACU(score: number): string {
  return DECISION_RECALL_LEVELS_ACU.reduce((best, level) => (Math.abs(level.score - score) < Math.abs(best.score - score) ? level : best)).label;
}

function retryDelayMs_ACU(attempt: number, rateLimited: boolean): number {
  return (rateLimited ? 4000 : 1500) * (attempt + 1);
}

/** 重试也不会好的请求错误：这一组不再重试。 */
const NON_RETRYABLE_STATUSES_ACU = new Set([400, 401, 402, 403, 404, 413, 422]);
/** Key 无效、没余额、没权限或模型不存在：每一组都会一样失败，其余各组直接按失败处理。 */
const FATAL_STATUSES_ACU = new Set([401, 402, 403, 404]);
const TOTAL_TIMEOUT_ERROR_ACU = '决策召回总时长超过时限，未打完分的组已跳过';

interface GroupRequestOutcome_ACU {
  scores?: Map<string, DecisionRecallScore_ACU>;
  error?: string;
  rateLimited?: boolean;
  retryable?: boolean;
  fatal?: boolean;
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
    judgeRuns: settings.judgeRuns,
    failedRunCount: 0,
  };

  if (!plan.needsScoring) {
    return {
      status: 'ok', ...base, selected: pickDecisionRecallRows_ACU(plan.fixed, plan.pool.map(row => ({ row, score: 0 })), plan.pool.length),
      scored: [], batchCount: 0, failedBatchCount: 0, unscoredCount: 0, missingKey: false, errors: [],
    };
  }
  if (endpoint.missing) {
    return {
      status: 'ok', ...base, selected: [...plan.fixed], scored: [], batchCount: 0, failedBatchCount: 0,
      unscoredCount: plan.pool.length, missingKey: true, missingField: endpoint.missing, errors: [],
    };
  }

  const state = buildDecisionRecallState_ACU({ aiFloors: collectDecisionRecallAiFloors_ACU(sources.loadChat(), settings.contextAiFloors), userInput: options.userInput });
  const groups = chunkDecisionRecallRows_ACU(plan.pool, settings.batchSize);
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  // 总时限与鉴权类错误都要能停下其余各组的在途请求，但不算用户中止
  const runController = new AbortController();
  const stopRun = () => runController.abort();
  if (signal?.aborted) stopRun();
  signal?.addEventListener('abort', stopRun, { once: true });
  let stopError = '';
  const stopWith = (error: string) => {
    if (!stopError) stopError = error;
    stopRun();
  };
  const totalTimeoutMs = deps.totalTimeoutMs ?? resolveDecisionRecallTotalTimeoutMs_ACU(settings.judgeRuns);
  const totalTimer = setTimeout(
    () => stopWith(`${TOTAL_TIMEOUT_ERROR_ACU}（${Math.round(totalTimeoutMs / 1000)} 秒）`),
    totalTimeoutMs,
  );

  const requestGroup = async (rows: DecisionRecallRow_ACU[]): Promise<GroupRequestOutcome_ACU> => {
    const outcome = await runWithDeadline_ACU<GroupRequestOutcome_ACU>(
      { timeoutMs: deps.timeoutMs ?? DECISION_RECALL_TIMEOUT_MS_ACU, signal: runController.signal },
      async requestSignal => {
        const response = await fetchImpl(endpoint.url, {
          method: 'POST',
          headers: endpoint.apiKey
            ? { Authorization: `Bearer ${endpoint.apiKey}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildDecisionRecallBatchBody_ACU(endpoint.model, state, rows, settings.scoringContent)),
          signal: requestSignal,
        });
        if (!response.ok) {
          const reason = await readErrorMessage_ACU(response);
          return {
            error: `HTTP ${response.status}${reason ? `：${reason}` : ''}`,
            rateLimited: response.status === 429,
            retryable: !NON_RETRYABLE_STATUSES_ACU.has(response.status),
            fatal: FATAL_STATUSES_ACU.has(response.status),
          };
        }
        return { scores: interpretDecisionRecallBatchResponse_ACU(await response.json(), rows), retryable: true };
      },
    );
    if (outcome.ok) return outcome.value!;
    // 超时再试一次又是一整段超时，不重试；被总时限或其它组的鉴权错误停下时由调用方按 stopError 处理
    if (outcome.failure) return { error: `决策模型${outcome.failure}`, retryable: false };
    return { error: `请求失败：${(outcome.error as any)?.message || outcome.error}`, retryable: true };
  };

  const scoreGroup = async (rows: DecisionRecallRow_ACU[]): Promise<GroupOutcome_ACU> => {
    let lastError = '';
    for (let attempt = 0; attempt <= settings.maxRetries; attempt++) {
      if (isAborted()) return { kind: 'aborted' };
      if (stopError) return { kind: 'failed', error: stopError };
      const outcome = await requestGroup(rows);
      if (isAborted()) return { kind: 'aborted' };
      if (outcome.scores && outcome.scores.size > 0) return { kind: 'scored', scores: outcome.scores };
      if (stopError) return { kind: 'failed', error: stopError };
      lastError = outcome.error || '决策模型没有给出任何打分';
      if (outcome.fatal) {
        stopWith(lastError);
        break;
      }
      if (outcome.retryable === false) break;
      if (attempt < settings.maxRetries) await sleep(retryDelayMs_ACU(attempt, outcome.rateLimited === true), runController.signal);
    }
    return { kind: 'failed', error: lastError };
  };

  // 每组判定几次就排几个请求，并发数作用在全部请求上
  const runs = settings.judgeRuns;
  const units = groups.flatMap((_rows, groupIndex) => Array.from({ length: runs }, () => groupIndex));
  const outcomes: GroupOutcome_ACU[] = new Array(units.length);
  let nextUnit = 0;
  const worker = async () => {
    while (nextUnit < units.length && !isAborted()) {
      const index = nextUnit++;
      outcomes[index] = await scoreGroup(groups[units[index]]);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(settings.concurrency, units.length) }, worker));
  } finally {
    clearTimeout(totalTimer);
    signal?.removeEventListener('abort', stopRun);
  }
  if (isAborted() || outcomes.some(outcome => outcome?.kind === 'aborted')) return { status: 'aborted' };

  const scored: DecisionRecallScoredEntry_ACU[] = [];
  const errors: string[] = [];
  let failedBatchCount = 0;
  let failedRunCount = 0;
  let unscoredCount = 0;
  groups.forEach((rows, groupIndex) => {
    const scoredRuns: Array<Map<string, DecisionRecallScore_ACU>> = [];
    for (const outcome of outcomes.slice(groupIndex * runs, (groupIndex + 1) * runs)) {
      if (outcome?.kind === 'scored') {
        scoredRuns.push(outcome.scores);
      } else {
        failedRunCount += 1;
        if (outcome?.kind === 'failed') errors.push(outcome.error);
      }
    }
    if (scoredRuns.length === 0) {
      failedBatchCount += 1;
      unscoredCount += rows.length;
      return;
    }
    // 每条纪要按答了它的那几次取平均；一次都没答的不参与挑选
    for (const row of rows) {
      const answered = scoredRuns.map(scores => scores.get(row.rowKey)).filter((score): score is DecisionRecallScore_ACU => !!score);
      if (answered.length === 0) {
        unscoredCount += 1;
        continue;
      }
      if (answered.length === 1) {
        scored.push({ row, ...answered[0] });
        continue;
      }
      const score = answered.reduce((sum, entry) => sum + entry.score, 0) / answered.length;
      scored.push({ row, score, choice: nearestLevelLabel_ACU(score) });
    }
  });
  scored.sort((left, right) => (right.score - left.score) || (right.row.rowOrder - left.row.rowOrder));
  if (failedBatchCount > 0) {
    logWarn_ACU(`[决策召回] ${failedBatchCount}/${groups.length} 组打分失败，已跳过：${[...new Set(errors)].join('；')}`);
  } else if (failedRunCount > 0) {
    logWarn_ACU(`[决策召回] ${failedRunCount}/${units.length} 次判定失败，已按成功的几次取平均：${[...new Set(errors)].join('；')}`);
  }

  return {
    status: 'ok', ...base, selected: pickDecisionRecallRows_ACU(plan.fixed, scored, settings.recallCount),
    scored, batchCount: groups.length, failedBatchCount, failedRunCount, unscoredCount, missingKey: false, errors,
  };
}

/** 打分有失败或没填 Key 时的提示；全部正常时返回空串。单独召回与替换剧情推进任务共用。 */
export function describeDecisionRecallWarning_ACU(result: DecisionRecallRunResult_ACU): string {
  if (result.status !== 'ok') return '';
  if (result.missingKey) return `决策召回还没填 ${result.providerLabel} ${result.missingField || 'Key'}，本次只带上最新 ${result.fixed.length} 条纪要。`;
  if (result.batchCount > 0 && result.failedBatchCount >= result.batchCount) {
    return `决策召回全部 ${result.batchCount} 组打分都失败了，本次只带上最新 ${result.fixed.length} 条纪要。`;
  }
  if (result.failedBatchCount > 0) {
    return `决策召回有 ${result.failedBatchCount}/${result.batchCount} 组打分失败，已跳过这些组，从其余纪要里选取。`;
  }
  if (result.failedRunCount > 0) {
    return `决策召回有 ${result.failedRunCount}/${result.batchCount * result.judgeRuns} 次判定失败，已按成功的几次取平均。`;
  }
  const skipped = result.unscoredCount;
  if (skipped > 0) return `决策模型漏答了 ${skipped} 条纪要，这些纪要本次没参与挑选。`;
  return '';
}

/** 打分失败的原因（去重、脱敏），给测试召回等需要排查 Key 与模型问题的地方看；没有失败时返回空串。 */
export function describeDecisionRecallErrors_ACU(result: DecisionRecallRunResult_ACU): string {
  if (result.status !== 'ok' || result.errors.length === 0) return '';
  return [...new Set(result.errors)].map(error => maskSensitiveText_ACU(error)).join('；');
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
    + `未打上分 ${result.unscoredCount} 条${result.missingKey ? `（未填 ${result.missingField || 'Key'}）` : ''}；带上 ${result.selected.length} 条：${picked}`;
}

export function logDecisionRecallResult_ACU(result: DecisionRecallRunResult_ACU): void {
  logDebug_ACU(describeDecisionRecallResult_ACU(result));
}

/** 召回编码块：与模型回复同形的 recall 标签，一行一个编码（替换剧情推进任务时沿用任务自己的标签写法）。 */
export function buildDecisionRecallTagBlock_ACU(codes: readonly string[], tagName = 'recall'): string {
  return `<${tagName}>\n${codes.join('\n')}\n</${tagName}>`;
}

/**
 * 单独召回时写进本轮输入的内容：先替换召回编码块占位符，再替换用户输入占位符（输入里碰巧有占位符字样也不会被二次替换）。
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
