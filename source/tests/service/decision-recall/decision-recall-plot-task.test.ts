/**
 * tests/service/decision-recall/decision-recall-plot-task.test.ts
 * 剧情推进任务改由决策召回执行的条件：多任务预设，且任务标签恰好是一个 recall、没有注入专用标签。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: { decisionRecallSettings: {} } }));

import {
  canPlotTaskUseDecisionRecall_ACU,
  isDecisionRecallPlotTask_ACU,
} from '../../../src/service/decision-recall/decision-recall-plot-task';

const task = (patch: Record<string, unknown> = {}) => ({ extractTags: 'recall', extractInjectTags: '', decisionRecall: true, ...patch });

describe('canPlotTaskUseDecisionRecall_ACU', () => {
  it('多任务预设里标签恰好是 recall 的任务可以替换（大小写、首尾空白不影响）', () => {
    expect(canPlotTaskUseDecisionRecall_ACU(task(), 2)).toBe(true);
    expect(canPlotTaskUseDecisionRecall_ACU(task({ extractTags: ' Recall ' }), 3)).toBe(true);
  });

  it('单任务预设不能替换（请直接单独开启决策召回）', () => {
    expect(canPlotTaskUseDecisionRecall_ACU(task(), 1)).toBe(false);
  });

  it('标签不止 recall、标签不是 recall、或带注入专用标签时不能替换', () => {
    expect(canPlotTaskUseDecisionRecall_ACU(task({ extractTags: 'recall,match' }), 2)).toBe(false);
    expect(canPlotTaskUseDecisionRecall_ACU(task({ extractTags: 'plot' }), 2)).toBe(false);
    expect(canPlotTaskUseDecisionRecall_ACU(task({ extractTags: '' }), 2)).toBe(false);
    expect(canPlotTaskUseDecisionRecall_ACU(task({ extractInjectTags: 'recall' }), 2)).toBe(false);
    expect(canPlotTaskUseDecisionRecall_ACU(null, 2)).toBe(false);
  });
});

describe('isDecisionRecallPlotTask_ACU', () => {
  it('开了开关且满足条件才由决策召回执行；条件不满足时开关自动失效', () => {
    expect(isDecisionRecallPlotTask_ACU(task(), 2)).toBe(true);
    expect(isDecisionRecallPlotTask_ACU(task({ decisionRecall: false }), 2)).toBe(false);
    expect(isDecisionRecallPlotTask_ACU(task(), 1)).toBe(false);
    expect(isDecisionRecallPlotTask_ACU(task({ extractTags: 'plot' }), 2)).toBe(false);
  });
});
