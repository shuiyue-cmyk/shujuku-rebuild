import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRuntimePerformanceSpans_ACU,
  getRecentRuntimePerformanceSpans_ACU,
  getRuntimePerformanceRun_ACU,
  startRuntimePerformanceSpan_ACU,
} from '../../src/shared/runtime-performance';

describe('runtime-performance', () => {
  beforeEach(() => clearRuntimePerformanceSpans_ACU());

  it('慢阶段默认保留，并只记录脱敏的标量指标', () => {
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(175);
    const span = startRuntimePerformanceSpan_ACU('auto-plan', {
      now,
      metrics: {
        messageCount: 500,
        sqlite: false,
        storageMode: 'sqlite',
        prompt: '不应记录的正文',
        nested: { secret: '不应记录' },
      } as any,
    });

    const record = span.end({ sheetCount: 40, apiKey: 'secret' } as any);

    expect(record).toMatchObject({ name: 'auto-plan', durationMs: 75, severity: 'slow' });
    expect(record?.metrics).toEqual({ messageCount: 500, sqlite: false, storageMode: 'sqlite', sheetCount: 40 });
    expect(JSON.stringify(record)).not.toContain('不应记录');
    expect(JSON.stringify(record)).not.toContain('secret');
  });

  it('低于慢阶段阈值时默认不保留，诊断开关开启后保留详细记录', () => {
    const hidden = startRuntimePerformanceSpan_ACU('fast-default', {
      now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(10),
    });
    expect(hidden.end()).toBeNull();
    expect(getRecentRuntimePerformanceSpans_ACU()).toEqual([]);

    const detailed = startRuntimePerformanceSpan_ACU('fast-detailed', {
      now: vi.fn().mockReturnValueOnce(20).mockReturnValueOnce(30),
      settings: { performanceDiagnosticsEnabled: true },
    });
    expect(detailed.end()).toMatchObject({ durationMs: 10, severity: 'normal' });
    expect(getRecentRuntimePerformanceSpans_ACU()).toHaveLength(1);
  });

  it('支持阈值配置、runId 和 parentSpanId，便于拼接阶段树', () => {
    const span = startRuntimePerformanceSpan_ACU('persist', {
      runId: 'run-1',
      parentSpanId: 'span-parent',
      now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(250),
      settings: { performanceSlowThresholdMs: 100, performanceLongTaskThresholdMs: 200 },
    });

    expect(span.end()).toMatchObject({
      runId: 'run-1',
      parentSpanId: 'span-parent',
      durationMs: 250,
      severity: 'long',
    });
  });

  it('按 runId 构建阶段树，并将缺失父阶段显式列为 orphan', () => {
    const settings = { performanceDiagnosticsEnabled: true };
    const root = startRuntimePerformanceSpan_ACU('pipeline', {
      now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100),
      settings,
    });
    const child = startRuntimePerformanceSpan_ACU('plan', {
      runId: root.id,
      parentSpanId: root.id,
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(40),
      settings,
    });
    const grandchild = startRuntimePerformanceSpan_ACU('history-index', {
      runId: root.id,
      parentSpanId: child.id,
      now: vi.fn().mockReturnValueOnce(15).mockReturnValueOnce(25),
      settings,
    });
    const orphan = startRuntimePerformanceSpan_ACU('persist', {
      runId: root.id,
      parentSpanId: 'missing-parent',
      now: vi.fn().mockReturnValueOnce(50).mockReturnValueOnce(70),
      settings,
    });

    grandchild.end();
    child.end();
    orphan.end();
    root.end();

    const run = getRuntimePerformanceRun_ACU(root.id);

    expect(run).toMatchObject({
      runId: root.id,
      spanCount: 4,
      rootDurationMs: 100,
      observedDurationMs: 100,
      severityCounts: { normal: 3, slow: 1, long: 0 },
    });
    expect(run?.roots).toHaveLength(1);
    expect(run?.roots[0]).toMatchObject({ id: root.id, name: 'pipeline' });
    expect(run?.roots[0].children[0]).toMatchObject({ id: child.id, name: 'plan' });
    expect(run?.roots[0].children[0].children[0]).toMatchObject({ id: grandchild.id, name: 'history-index' });
    expect(run?.orphans).toHaveLength(1);
    expect(run?.orphans[0]).toMatchObject({ id: orphan.id, parentSpanId: 'missing-parent' });

    run!.roots[0].metrics.mutated = true;
    expect(getRuntimePerformanceRun_ACU(root.id)?.roots[0].metrics).toEqual({});
  });

  it('未知 runId 返回 null，且只聚合同一 run 的记录', () => {
    const first = startRuntimePerformanceSpan_ACU('first', {
      runId: 'run-a',
      now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(60),
    });
    const second = startRuntimePerformanceSpan_ACU('second', {
      runId: 'run-b',
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(80),
    });
    first.end();
    second.end();

    expect(getRuntimePerformanceRun_ACU('run-a')?.spanCount).toBe(1);
    expect(getRuntimePerformanceRun_ACU('run-a')?.roots.map(node => node.name)).toEqual(['first']);
    expect(getRuntimePerformanceRun_ACU('missing')).toBeNull();
  });
});
