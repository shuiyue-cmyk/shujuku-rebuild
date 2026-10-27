/**
 * service/decision-recall/decision-recall-selection.ts — 决策召回选哪些纪要（纯函数）。
 *
 * 最新几条固定带上；其余（交火筛过时只看纪要索引里的）超过召回条数才需要打分。
 * 分数从高到低取满条数（相关的不够就用低分的补），同分优先较新的；最后按表号顺序排列。
 */
import { DECISION_RECALL_FIXED_RECENT_COUNT_ACU } from '../../shared/decision-recall-defaults';
import type { DecisionRecallRow_ACU } from './decision-recall-scoring';

export interface DecisionRecallPlan_ACU {
  fixed: DecisionRecallRow_ACU[];
  pool: DecisionRecallRow_ACU[];
  needsScoring: boolean;
}

export interface DecisionRecallScoredRow_ACU {
  row: DecisionRecallRow_ACU;
  score: number;
}

const byOrderAsc_ACU = (left: DecisionRecallRow_ACU, right: DecisionRecallRow_ACU) => left.rowOrder - right.rowOrder;

export function planDecisionRecall_ACU(
  rows: readonly DecisionRecallRow_ACU[],
  options: { candidateCodes: ReadonlySet<string> | null; recallCount: number },
): DecisionRecallPlan_ACU {
  const ordered = [...rows].sort(byOrderAsc_ACU);
  const fixedCount = Math.min(DECISION_RECALL_FIXED_RECENT_COUNT_ACU, ordered.length);
  const fixed = ordered.slice(ordered.length - fixedCount);
  const pool = ordered
    .slice(0, ordered.length - fixedCount)
    .filter(row => !options.candidateCodes || options.candidateCodes.has(row.indexCode));
  return { fixed, pool, needsScoring: pool.length > options.recallCount };
}

export function pickDecisionRecallRows_ACU(
  fixed: readonly DecisionRecallRow_ACU[],
  scored: readonly DecisionRecallScoredRow_ACU[],
  recallCount: number,
): DecisionRecallRow_ACU[] {
  const picked = [...scored]
    .sort((left, right) => (right.score - left.score) || (right.row.rowOrder - left.row.rowOrder))
    .slice(0, Math.max(0, recallCount))
    .map(item => item.row);
  return [...fixed, ...picked].sort(byOrderAsc_ACU);
}

export function chunkDecisionRecallRows_ACU<T>(rows: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let index = 0; index < rows.length; index += step) groups.push(rows.slice(index, index + step));
  return groups;
}
