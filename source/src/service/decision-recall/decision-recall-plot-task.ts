/**
 * service/decision-recall/decision-recall-plot-task.ts — 剧情推进任务改由决策召回执行。
 *
 * 只在多任务预设上生效（单任务预设请直接单独开启决策召回）；任务的标签必须恰好是一个 recall、没有注入专用标签，
 * 因为决策召回只产出编码列表，产不出别的标签。产出是与模型回复同形的 recall 标签块，
 * 交给剧情推进照常摘取、传给后续任务、按预设自己的最终注入指令写进本轮输入。
 */
import { normalizeDecisionRecallSettings_ACU } from './decision-recall-settings';
import {
  buildDecisionRecallTagBlock_ACU,
  logDecisionRecallResult_ACU,
  runDecisionRecall_ACU,
  type DecisionRecallRunDeps_ACU,
  type DecisionRecallRunResult_ACU,
} from './decision-recall-runtime';
import { settings_ACU } from '../runtime/state-manager';

export const DECISION_RECALL_PLOT_TASK_TAG_ACU = 'recall';

function splitTags_ACU(value: unknown): string[] {
  return String(value || '').split(',').map(tag => tag.trim()).filter(Boolean);
}

/** 这个任务能否改由决策召回执行：预设有多个任务，且任务标签恰好是 recall。 */
export function canPlotTaskUseDecisionRecall_ACU(task: Record<string, any> | null | undefined, presetTaskCount: number): boolean {
  if (!task || presetTaskCount < 2) return false;
  const tags = splitTags_ACU(task.extractTags);
  return tags.length === 1
    && tags[0].toLowerCase() === DECISION_RECALL_PLOT_TASK_TAG_ACU
    && splitTags_ACU(task.extractInjectTags).length === 0;
}

/** 本轮是否真的由决策召回执行：开了开关且仍满足条件（改了标签或删到只剩一个任务后自动退回模型执行）。 */
export function isDecisionRecallPlotTask_ACU(task: Record<string, any> | null | undefined, presetTaskCount: number): boolean {
  return task?.decisionRecall === true && canPlotTaskUseDecisionRecall_ACU(task, presetTaskCount);
}

export type DecisionRecallPlotTaskOutcome_ACU =
  | { kind: 'aborted' }
  | { kind: 'done'; rawResponse: string; result: DecisionRecallRunResult_ACU };

/** 跑一次决策召回并产出任务回复；纪要表为空或读不到时产出空的 recall 块（不算任务失败，也不注入）。 */
export async function runDecisionRecallForPlotTask_ACU(
  task: Record<string, any>,
  options: { userInput: string; signal?: AbortSignal | null },
  deps: DecisionRecallRunDeps_ACU = {},
): Promise<DecisionRecallPlotTaskOutcome_ACU> {
  const settings = normalizeDecisionRecallSettings_ACU(settings_ACU?.decisionRecallSettings);
  const result = await runDecisionRecall_ACU({ userInput: options.userInput, settings, signal: options.signal }, deps);
  logDecisionRecallResult_ACU(result);
  if (result.status === 'aborted') return { kind: 'aborted' };
  const tagName = splitTags_ACU(task.extractTags)[0] || DECISION_RECALL_PLOT_TASK_TAG_ACU;
  const codes = result.status === 'ok' ? result.selected.map(row => row.indexCode) : [];
  return { kind: 'done', rawResponse: buildDecisionRecallTagBlock_ACU(codes, tagName), result };
}
