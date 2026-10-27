/**
 * tests/service/decision-recall/decision-recall-selection.test.ts
 * 决策召回选纪要：最新 5 条固定带上；其余按候选范围过滤、超过召回条数才打分；
 * 分数从高到低凑满条数，同分优先较新的；最后按表号顺序排列。
 */
import { describe, expect, it } from 'vitest';
import {
  chunkDecisionRecallRows_ACU,
  pickDecisionRecallRows_ACU,
  planDecisionRecall_ACU,
} from '../../../src/service/decision-recall/decision-recall-selection';
import type { DecisionRecallRow_ACU } from '../../../src/service/decision-recall/decision-recall-scoring';

function rows(count: number): DecisionRecallRow_ACU[] {
  return Array.from({ length: count }, (_, order) => {
    const code = `AM${String(order + 1).padStart(4, '0')}`;
    return { rowKey: `k-${code}`, rowOrder: order, indexCode: code, timeSpan: '', location: '', summary: code, chronicleText: '' };
  });
}

const codes = (list: DecisionRecallRow_ACU[]) => list.map(item => item.indexCode);

describe('planDecisionRecall_ACU', () => {
  it('最新 5 条固定带上，其余进打分池；池子超过召回条数才需要打分', () => {
    const plan = planDecisionRecall_ACU(rows(30), { candidateCodes: null, recallCount: 20 });
    expect(codes(plan.fixed)).toEqual(['AM0026', 'AM0027', 'AM0028', 'AM0029', 'AM0030']);
    expect(plan.pool).toHaveLength(25);
    expect(plan.needsScoring).toBe(true);
  });

  it('固定条数按表号认最新，不受行的排列顺序影响', () => {
    const shuffled = [...rows(8)].reverse();
    const plan = planDecisionRecall_ACU(shuffled, { candidateCodes: null, recallCount: 20 });
    expect(codes(plan.fixed)).toEqual(['AM0004', 'AM0005', 'AM0006', 'AM0007', 'AM0008']);
    expect(codes(plan.pool)).toEqual(['AM0001', 'AM0002', 'AM0003']);
  });

  it('池子不超过召回条数时不打分，全部带上', () => {
    const plan = planDecisionRecall_ACU(rows(25), { candidateCodes: null, recallCount: 20 });
    expect(plan.pool).toHaveLength(20);
    expect(plan.needsScoring).toBe(false);
  });

  it('纪要不足 5 条时全部固定，池子为空', () => {
    const plan = planDecisionRecall_ACU(rows(3), { candidateCodes: null, recallCount: 20 });
    expect(codes(plan.fixed)).toEqual(['AM0001', 'AM0002', 'AM0003']);
    expect(plan.pool).toEqual([]);
    expect(plan.needsScoring).toBe(false);
  });

  it('交火筛过时池子只留纪要索引里出现的纪要；固定条数不受交火影响', () => {
    const candidateCodes = new Set(['AM0002', 'AM0010', 'AM0030']);
    const plan = planDecisionRecall_ACU(rows(30), { candidateCodes, recallCount: 1 });
    expect(codes(plan.fixed)).toEqual(['AM0026', 'AM0027', 'AM0028', 'AM0029', 'AM0030']);
    expect(codes(plan.pool)).toEqual(['AM0002', 'AM0010']);
    expect(plan.needsScoring).toBe(true);
  });
});

describe('pickDecisionRecallRows_ACU', () => {
  it('按分数从高到低取满条数，再与固定条数合并、按表号顺序排列', () => {
    const all = rows(12);
    const plan = planDecisionRecall_ACU(all, { candidateCodes: null, recallCount: 3 });
    const scored = plan.pool.map((item, index) => ({ row: item, score: [1, 4.2, 1.5, 5, 2, 3.9, 1][index] }));
    const picked = pickDecisionRecallRows_ACU(plan.fixed, scored, 3);
    expect(codes(picked)).toEqual(['AM0002', 'AM0004', 'AM0006', 'AM0008', 'AM0009', 'AM0010', 'AM0011', 'AM0012']);
  });

  it('相关的不够时用分数低的补满条数（含「无关」）', () => {
    const plan = planDecisionRecall_ACU(rows(9), { candidateCodes: null, recallCount: 3 });
    const scored = plan.pool.map(item => ({ row: item, score: 1 }));
    expect(pickDecisionRecallRows_ACU(plan.fixed, scored, 3)).toHaveLength(8);
  });

  it('同分时优先较新的纪要', () => {
    const plan = planDecisionRecall_ACU(rows(10), { candidateCodes: null, recallCount: 2 });
    const scored = plan.pool.map(item => ({ row: item, score: 3 }));
    expect(codes(pickDecisionRecallRows_ACU([], scored, 2))).toEqual(['AM0004', 'AM0005']);
  });

  it('打上分的不够条数时有多少带多少（没打上分的不补）', () => {
    const plan = planDecisionRecall_ACU(rows(30), { candidateCodes: null, recallCount: 20 });
    const scored = plan.pool.slice(0, 4).map(item => ({ row: item, score: 2 }));
    expect(pickDecisionRecallRows_ACU(plan.fixed, scored, 20)).toHaveLength(9);
  });
});

describe('chunkDecisionRecallRows_ACU', () => {
  it('每组 20 条，最后一组放剩下的', () => {
    const groups = chunkDecisionRecallRows_ACU(rows(45), 20);
    expect(groups.map(group => group.length)).toEqual([20, 20, 5]);
    expect(chunkDecisionRecallRows_ACU([], 20)).toEqual([]);
  });
});
