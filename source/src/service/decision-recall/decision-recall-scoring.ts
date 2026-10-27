/**
 * service/decision-recall/decision-recall-scoring.ts — 决策召回的打分请求与结果解读（纯函数）。
 *
 * 一次请求 = 前文与用户输入（state，只放一次）+ 一组纪要（每条一个五档单选题）。
 * 决策接口的问题键只用于对应答案、不会发给模型，所以纪要的编码与内容都写在题干里。
 * 得分 = 各档分值按模型给出的概率加权；没给概率时取所选档位的分值。
 */
import { readOptionProbability_ACU } from '../optimization/decision-gate';
import type { DecisionRecallScoringContent_ACU } from '../../shared/decision-recall-defaults';

export interface DecisionRecallRow_ACU {
  rowKey: string;
  /** 在纪要表里的先后（越大越新），也是最终排列的表号顺序。 */
  rowOrder: number;
  indexCode: string;
  timeSpan: string;
  location: string;
  summary: string;
  chronicleText: string;
}

export interface DecisionRecallScore_ACU {
  score: number;
  choice: string;
}

/** 五档相关性，分值 1–5。顺序即选项顺序，从无关到强相关。 */
export const DECISION_RECALL_LEVELS_ACU: readonly { label: string; score: number; description: string }[] = [
  { label: '无关', score: 1, description: '这件事与接下来的剧情没有关系' },
  { label: '弱相关', score: 2, description: '只有人物、地点或物品等表面重合，对接下来的剧情几乎没有影响' },
  { label: '一般相关', score: 3, description: '与当前剧情有一定联系，可以作为背景参考' },
  { label: '较相关', score: 4, description: '会明显影响接下来的剧情，例如牵涉的人物关系、未了结的事件、承诺或线索' },
  { label: '强相关', score: 5, description: '接下来的剧情直接延续、回应或依赖这件事' },
];

const LEVEL_SCORE_BY_LABEL_ACU = new Map(DECISION_RECALL_LEVELS_ACU.map(level => [level.label, level.score]));

const CRITERIA_ACU: Record<string, string> = Object.fromEntries(
  DECISION_RECALL_LEVELS_ACU.map(level => [level.label, level.description]),
);

export function buildDecisionRecallState_ACU(context: { aiFloors: string[]; userInput: string }): string {
  const parts: string[] = [];
  const floors = (context.aiFloors || []).map(text => String(text || '').trim()).filter(Boolean);
  if (floors.length > 0) {
    parts.push(`【前文（最近的 AI 回复，按时间先后）】\n${floors.join('\n\n')}`);
  }
  parts.push(`【用户最新输入】\n${String(context.userInput || '').trim()}`);
  return parts.join('\n\n');
}

function buildQuestionKey_ACU(index: number): string {
  return `r${index + 1}`;
}

function buildRowDescription_ACU(row: DecisionRecallRow_ACU, scoringContent: DecisionRecallScoringContent_ACU): string {
  const lines = [`编码：${row.indexCode}`];
  if (row.timeSpan) lines.push(`时间：${row.timeSpan}`);
  if (row.location) lines.push(`地点：${row.location}`);
  lines.push(`概要：${row.summary}`);
  if (scoringContent === 'full' && row.chronicleText) lines.push(`纪要正文：${row.chronicleText}`);
  return lines.join('\n');
}

export function buildDecisionRecallBatchBody_ACU(
  model: string,
  state: string,
  rows: readonly DecisionRecallRow_ACU[],
  scoringContent: DecisionRecallScoringContent_ACU,
) {
  const questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> = {};
  rows.forEach((row, index) => {
    questions[buildQuestionKey_ACU(index)] = {
      type: 'choice',
      instructions: [
        '下面是一条已经发生过的事件纪要。结合前文和用户最新输入，判断这件事与接下来剧情发展的相关程度。',
        buildRowDescription_ACU(row, scoringContent),
      ].join('\n'),
      criteria: { ...CRITERIA_ACU },
    };
  });
  return { model, state, questions };
}

function readRowScore_ACU(answer: any): DecisionRecallScore_ACU | null {
  if (!answer || typeof answer !== 'object') return null;
  const choice = String(answer.choice ?? '');
  let weighted = 0;
  let total = 0;
  for (const level of DECISION_RECALL_LEVELS_ACU) {
    const probability = readOptionProbability_ACU(answer.probabilities, level.label);
    if (probability === null || probability <= 0) continue;
    weighted += probability * level.score;
    total += probability;
  }
  if (total > 0) return { score: weighted / total, choice };
  const chosen = LEVEL_SCORE_BY_LABEL_ACU.get(choice);
  return chosen === undefined ? null : { score: chosen, choice };
}

/** 读出本组每条纪要的得分；漏答或答了不认识档位的纪要不在结果里。 */
export function interpretDecisionRecallBatchResponse_ACU(
  payload: any,
  rows: readonly DecisionRecallRow_ACU[],
): Map<string, DecisionRecallScore_ACU> {
  const scores = new Map<string, DecisionRecallScore_ACU>();
  const answers = payload?.answers;
  if (!answers || typeof answers !== 'object') return scores;
  rows.forEach((row, index) => {
    const score = readRowScore_ACU(answers[buildQuestionKey_ACU(index)]);
    if (score) scores.set(row.rowKey, score);
  });
  return scores;
}
