/**
 * tests/service/decision-recall/decision-recall-plot-task.test.ts
 * 剧情推进任务改由决策召回执行的条件：多任务预设，且任务标签恰好是一个 recall、没有注入专用标签。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stateMocks = vi.hoisted(() => ({ settings_ACU: { decisionRecallSettings: {} as Record<string, unknown> } }));
vi.mock('../../../src/service/runtime/state-manager', () => stateMocks);

import {
  canPlotTaskUseDecisionRecall_ACU,
  isDecisionRecallPlotTask_ACU,
} from '../../../src/service/decision-recall/decision-recall-plot-task';

const task = (patch: Record<string, unknown> = {}) => ({ extractTags: 'recall', extractInjectTags: '', ...patch });

describe('canPlotTaskUseDecisionRecall_ACU', () => {
  it('多任务预设里标签恰好是 recall 的任务可以替换（大小写、首尾空白不影响）', () => {
    expect(canPlotTaskUseDecisionRecall_ACU(task(), 2)).toBe(true);
    expect(canPlotTaskUseDecisionRecall_ACU(task({ extractTags: ' Recall ' }), 3)).toBe(true);
  });

  it('单任务预设不替换', () => {
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
  beforeEach(() => {
    stateMocks.settings_ACU.decisionRecallSettings = { enabled: true, mode: 'plot_task', replacePlotRecallTasks: true };
  });

  it('剧情推进页的开关开着时自动匹配标签只有 recall 的任务；单任务预设或标签不符时照常调模型', () => {
    expect(isDecisionRecallPlotTask_ACU(task(), 2)).toBe(true);
    expect(isDecisionRecallPlotTask_ACU(task(), 1)).toBe(false);
    expect(isDecisionRecallPlotTask_ACU(task({ extractTags: 'plot' }), 2)).toBe(false);
  });

  it('剧情推进页的开关没开、决策召回总开关关着、或用法是单独召回时不替换', () => {
    stateMocks.settings_ACU.decisionRecallSettings = { enabled: true, mode: 'plot_task', replacePlotRecallTasks: false };
    expect(isDecisionRecallPlotTask_ACU(task(), 2)).toBe(false);
    stateMocks.settings_ACU.decisionRecallSettings = { enabled: false, mode: 'plot_task', replacePlotRecallTasks: true };
    expect(isDecisionRecallPlotTask_ACU(task(), 2)).toBe(false);
    stateMocks.settings_ACU.decisionRecallSettings = { enabled: true, mode: 'standalone', replacePlotRecallTasks: true };
    expect(isDecisionRecallPlotTask_ACU(task(), 2)).toBe(false);
    stateMocks.settings_ACU.decisionRecallSettings = { enabled: true, replacePlotRecallTasks: true };
    expect(isDecisionRecallPlotTask_ACU(task(), 2)).toBe(false);
  });
});
