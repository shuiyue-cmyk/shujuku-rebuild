/**
 * tests/presentation-v2/stores/decision-recall-test-output.test.ts
 * 「测试召回」的结果文本：打分失败时写出原因（去重、脱敏），方便排查 Key 与模型问题。
 */
import { describe, expect, it } from 'vitest';
import { formatDecisionRecallTestOutput_ACU } from '../../../src/presentation-v2/stores/decision-recall-store';
import { decisionRecallLevelLabel_ACU } from '../../../src/service/decision-recall/decision-recall-scoring';

const row = (order: number) => ({
  rowKey: `k${order}`, rowOrder: order, indexCode: `AM${String(order).padStart(4, '0')}`, timeSpan: '', location: '', summary: `概要${order}`, chronicleText: '',
});

describe('formatDecisionRecallTestOutput_ACU', () => {
  it('打分失败时列出失败原因，Key 不会出现在结果里', () => {
    const fixed = [row(6), row(7), row(8), row(9), row(10)];
    const text = formatDecisionRecallTestOutput_ACU({
      status: 'ok', selected: fixed, fixed, scored: [], candidateCount: 5, candidateSource: 'all_rows',
      batchCount: 1, failedBatchCount: 1, unscoredCount: 5, missingKey: false, providerLabel: '硅基流动（中国）',
      errors: ['HTTP 401：invalid api key sk-abcdefghijklmnopqrstuvwxyz123456'],
    });
    expect(text).toContain('失败原因：HTTP 401');
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });

  it('档位标签与 decisionRecallLevelLabel_ACU 单一出处一致（G01-03：选中与落选两处口径相同）', () => {
    const fixed = [row(1)];
    const selected = [row(1), row(2)];
    const text = formatDecisionRecallTestOutput_ACU({
      status: 'ok', selected, fixed,
      scored: [{ row: row(2), score: 4.6 }, { row: row(3), score: 3.5 }],
      candidateCount: 2, candidateSource: 'all_rows',
      batchCount: 1, failedBatchCount: 0, judgeRuns: 1, failedRunCount: 0, unscoredCount: 0,
      missingKey: false, providerLabel: '硅基流动（中国）', errors: [],
    } as any);
    // 选中行（非固定）与落选行的标签都来自同一映射函数
    expect(text).toContain(`4.60 分 · ${decisionRecallLevelLabel_ACU(4.6)}`);
    expect(text).toContain(`3.50 分 · ${decisionRecallLevelLabel_ACU(3.5)}`);
    expect(decisionRecallLevelLabel_ACU(4.6)).toBe('强相关');
    expect(decisionRecallLevelLabel_ACU(3.5)).toBe('一般相关');
  });
});
