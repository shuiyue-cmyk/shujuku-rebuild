import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRecentSpans: vi.fn(),
  getRun: vi.fn(),
  clearSpans: vi.fn(),
}));

vi.mock('../../../../src/shared/runtime-performance', () => ({
  getRecentRuntimePerformanceSpans_ACU: mocks.getRecentSpans,
  getRuntimePerformanceRun_ACU: mocks.getRun,
  clearRuntimePerformanceSpans_ACU: mocks.clearSpans,
}));

import { createPerformanceDiagnosticsApi } from '../../../../src/presentation/bootstrap/api-groups/performance-diagnostics-api';

describe('performance-diagnostics-api', () => {
  beforeEach(() => vi.clearAllMocks());

  it('提供脱敏 span 列表与 run 阶段树读取入口', () => {
    const spans = [{ id: 'perf-1', name: 'pipeline', metrics: {} }];
    const run = { runId: 'perf-1', spanCount: 1, roots: [] };
    mocks.getRecentSpans.mockReturnValue(spans);
    mocks.getRun.mockReturnValue(run);
    const api = createPerformanceDiagnosticsApi();

    expect(api.getRecentPerformanceSpans()).toBe(spans);
    expect(api.getPerformanceRun('perf-1')).toBe(run);
    expect(mocks.getRun).toHaveBeenCalledWith('perf-1');
  });

  it('拒绝空 runId，清理操作委托性能记录模块', () => {
    const api = createPerformanceDiagnosticsApi();

    expect(api.getPerformanceRun('')).toBeNull();
    expect(api.getPerformanceRun(null)).toBeNull();
    expect(mocks.getRun).not.toHaveBeenCalled();

    expect(api.clearPerformanceSpans()).toBe(true);
    expect(mocks.clearSpans).toHaveBeenCalledTimes(1);
  });
});
