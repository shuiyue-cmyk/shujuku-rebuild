/**
 * tests/service/decision-recall/decision-recall-scoring.test.ts
 * 决策召回打分：前文与输入只放一次，一组纪要每条一个五档单选题；按各档概率加权得分。
 */
import { describe, expect, it } from 'vitest';
import {
  DECISION_RECALL_LEVELS_ACU,
  buildDecisionRecallBatchBody_ACU,
  buildDecisionRecallState_ACU,
  interpretDecisionRecallBatchResponse_ACU,
  type DecisionRecallRow_ACU,
} from '../../../src/service/decision-recall/decision-recall-scoring';

function row(order: number, extra: Partial<DecisionRecallRow_ACU> = {}): DecisionRecallRow_ACU {
  const code = `AM${String(order + 1).padStart(4, '0')}`;
  return {
    rowKey: `k-${code}`,
    rowOrder: order,
    indexCode: code,
    timeSpan: `第${order + 1}天`,
    location: '王都',
    summary: `概要${order + 1}`,
    chronicleText: `纪要正文${order + 1}`,
    ...extra,
  };
}

function probabilities(weights: number[]) {
  return Object.fromEntries(DECISION_RECALL_LEVELS_ACU.map((level, index) => [level.label, weights[index]]));
}

describe('DECISION_RECALL_LEVELS_ACU', () => {
  it('五档，从无关（1 分）到强相关（5 分）', () => {
    expect(DECISION_RECALL_LEVELS_ACU.map(level => level.score)).toEqual([1, 2, 3, 4, 5]);
    expect(DECISION_RECALL_LEVELS_ACU[0].label).toBe('无关');
    expect(DECISION_RECALL_LEVELS_ACU[4].label).toBe('强相关');
  });
});

describe('buildDecisionRecallState_ACU', () => {
  it('前文按时间先后排列，最后是用户最新输入', () => {
    const state = buildDecisionRecallState_ACU({ aiFloors: ['较早的回复', '最近的回复'], userInput: '我推开门' });
    expect(state.indexOf('较早的回复')).toBeLessThan(state.indexOf('最近的回复'));
    expect(state.indexOf('最近的回复')).toBeLessThan(state.indexOf('我推开门'));
  });

  it('没有前文时只带用户输入，不留空的前文段', () => {
    const state = buildDecisionRecallState_ACU({ aiFloors: [], userInput: '开始冒险' });
    expect(state).toContain('开始冒险');
    expect(state).not.toContain('前文');
  });
});

describe('buildDecisionRecallBatchBody_ACU', () => {
  it('一组纪要每条一个单选题，选项是五档相关性；前文只在 state 里放一次', () => {
    const rows = [row(0), row(1), row(2)];
    const body = buildDecisionRecallBatchBody_ACU('SemIf', '前文与输入', rows, 'full');
    expect(body.model).toBe('SemIf');
    expect(body.state).toBe('前文与输入');
    const questions = Object.values(body.questions) as any[];
    expect(questions).toHaveLength(3);
    for (const question of questions) {
      expect(question.type).toBe('choice');
      expect(Object.keys(question.criteria)).toEqual(DECISION_RECALL_LEVELS_ACU.map(level => level.label));
      expect(question.instructions).not.toContain('前文与输入');
    }
  });

  it('问题里写明这条纪要的编码、时间、地点与概要，并问与接下来剧情发展的相关性', () => {
    const body = buildDecisionRecallBatchBody_ACU('SemIf', 's', [row(4)], 'summary');
    const [question] = Object.values(body.questions) as any[];
    expect(question.instructions).toContain('AM0005');
    expect(question.instructions).toContain('第5天');
    expect(question.instructions).toContain('王都');
    expect(question.instructions).toContain('概要5');
    expect(question.instructions).toContain('接下来');
  });

  it('只看概要时不带纪要正文；看概要加正文时带上', () => {
    const [summaryOnly] = Object.values(buildDecisionRecallBatchBody_ACU('m', 's', [row(0)], 'summary').questions) as any[];
    const [full] = Object.values(buildDecisionRecallBatchBody_ACU('m', 's', [row(0)], 'full').questions) as any[];
    expect(summaryOnly.instructions).not.toContain('纪要正文1');
    expect(full.instructions).toContain('纪要正文1');
  });

  it('纪要正文为空时不写正文一栏', () => {
    const [question] = Object.values(buildDecisionRecallBatchBody_ACU('m', 's', [row(0, { chronicleText: '' })], 'full').questions) as any[];
    expect(question.instructions).not.toMatch(/纪要正文[：:]/);
  });
});

describe('interpretDecisionRecallBatchResponse_ACU', () => {
  const rows = [row(0), row(1)];
  const keys = Object.keys(buildDecisionRecallBatchBody_ACU('m', 's', rows, 'full').questions);

  it('按各档概率加权得分：全押强相关得 5 分，全押无关得 1 分', () => {
    const scores = interpretDecisionRecallBatchResponse_ACU({
      answers: {
        [keys[0]]: { type: 'choice', choice: '强相关', probabilities: probabilities([0, 0, 0, 0, 1]) },
        [keys[1]]: { type: 'choice', choice: '无关', probabilities: probabilities([1, 0, 0, 0, 0]) },
      },
    }, rows);
    expect(scores.get('k-AM0001')?.score).toBeCloseTo(5);
    expect(scores.get('k-AM0002')?.score).toBeCloseTo(1);
    expect(scores.get('k-AM0001')?.choice).toBe('强相关');
  });

  it('概率在两档之间时得到中间值，便于排序', () => {
    const scores = interpretDecisionRecallBatchResponse_ACU({
      answers: { [keys[0]]: { choice: '较相关', probabilities: probabilities([0, 0, 0.5, 0.5, 0]) } },
    }, rows);
    expect(scores.get('k-AM0001')?.score).toBeCloseTo(3.5);
  });

  it('概率之和不为 1 时按已给出的部分归一', () => {
    const scores = interpretDecisionRecallBatchResponse_ACU({
      answers: { [keys[0]]: { choice: '强相关', probabilities: { 强相关: 0.3, 一般相关: 0.1 } } },
    }, rows);
    expect(scores.get('k-AM0001')?.score).toBeCloseTo((0.3 * 5 + 0.1 * 3) / 0.4);
  });

  it('也接受数组形式的概率', () => {
    const scores = interpretDecisionRecallBatchResponse_ACU({
      answers: { [keys[0]]: { choice: '弱相关', probabilities: [{ choice: '弱相关', probability: 1 }] } },
    }, rows);
    expect(scores.get('k-AM0001')?.score).toBeCloseTo(2);
  });

  it('没给概率时按所选档位记分', () => {
    const scores = interpretDecisionRecallBatchResponse_ACU({ answers: { [keys[1]]: { choice: '一般相关' } } }, rows);
    expect(scores.get('k-AM0002')?.score).toBe(3);
  });

  it('漏答、答了不认识的档位的纪要不记分；整个回复读不出答案时返回空', () => {
    const scores = interpretDecisionRecallBatchResponse_ACU({
      answers: { [keys[0]]: { choice: '非常相关' } },
    }, rows);
    expect(scores.size).toBe(0);
    expect(interpretDecisionRecallBatchResponse_ACU(null, rows).size).toBe(0);
    expect(interpretDecisionRecallBatchResponse_ACU({ answers: 'x' }, rows).size).toBe(0);
  });
});
