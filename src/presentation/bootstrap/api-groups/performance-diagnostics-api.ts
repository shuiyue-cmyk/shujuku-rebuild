import {
  clearRuntimePerformanceSpans_ACU,
  getRecentRuntimePerformanceSpans_ACU,
  getRuntimePerformanceRun_ACU,
} from '../../../shared/runtime-performance';

export function createPerformanceDiagnosticsApi(): Record<string, Function> {
  return {
    getRecentPerformanceSpans: function() {
      return getRecentRuntimePerformanceSpans_ACU();
    },

    getPerformanceRun: function(runId: unknown) {
      const normalizedRunId = typeof runId === 'string' ? runId.trim() : '';
      return normalizedRunId ? getRuntimePerformanceRun_ACU(normalizedRunId) : null;
    },

    clearPerformanceSpans: function() {
      clearRuntimePerformanceSpans_ACU();
      return true;
    },
  };
}
