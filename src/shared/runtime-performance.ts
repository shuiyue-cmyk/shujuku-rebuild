import { logDebug_ACU, logWarn_ACU } from './utils';

export type RuntimePerformanceSeverity_ACU = 'normal' | 'slow' | 'long';
export type RuntimePerformanceMetricValue_ACU = string | number | boolean;

export interface RuntimePerformanceSpanRecord_ACU {
  id: string;
  name: string;
  runId?: string;
  parentSpanId?: string;
  startedAt: number;
  durationMs: number;
  severity: RuntimePerformanceSeverity_ACU;
  metrics: Record<string, RuntimePerformanceMetricValue_ACU>;
}

export interface RuntimePerformanceSpanNode_ACU extends RuntimePerformanceSpanRecord_ACU {
  children: RuntimePerformanceSpanNode_ACU[];
}

export interface RuntimePerformanceRun_ACU {
  runId: string;
  spanCount: number;
  rootDurationMs: number | null;
  observedDurationMs: number;
  severityCounts: Record<RuntimePerformanceSeverity_ACU, number>;
  roots: RuntimePerformanceSpanNode_ACU[];
  orphans: RuntimePerformanceSpanNode_ACU[];
}

interface RuntimePerformanceSettings_ACU {
  performanceDiagnosticsEnabled?: boolean;
  performanceSlowThresholdMs?: number;
  performanceLongTaskThresholdMs?: number;
}

interface RuntimePerformanceSpanOptions_ACU {
  runId?: string;
  parentSpanId?: string;
  metrics?: Record<string, unknown>;
  settings?: RuntimePerformanceSettings_ACU | null;
  now?: () => number;
}

const MAX_SPANS_ACU = 200;
const DEFAULT_SLOW_THRESHOLD_MS_ACU = 50;
const DEFAULT_LONG_THRESHOLD_MS_ACU = 200;
const SAFE_METRIC_KEYS_ACU = new Set([
  'messageCount', 'aiMessageCount', 'sheetCount', 'rowCount', 'operationCount',
  'bucketCount', 'groupCount', 'failedGroupCount', 'changedSheetCount',
  'frameCount', 'logEntryCount', 'checkpointIndex', 'maxMessageIndex',
  'targetMessageIndex', 'storageMode', 'baseKind', 'source', 'outcome',
  'sqlite', 'success', 'strictSave', 'replacement', 'temporaryBaselineUpgrade',
  // v2-replay 纯数值安全指标（阶段 A）：只允许有限整数计数，绝不记录 SQL 文本、
  // 表名、角色内容、单元格、DDL 原文或聊天标识。
  'sqlOperationCount', 'tableAliasBuildCount', 'columnAliasBuildCount',
  'columnRebindCount', 'aliasInvalidateCount', 'aliasCacheHitCount',
  'sqliteHydrateCount', 'sqliteMaterializeCount',
  'replayReuseCount', 'replayReuseFallbackCount',
  'replayShareCount',
  'yieldCount',
]);

let nextSpanId_ACU = 1;
let recentSpans_ACU: RuntimePerformanceSpanRecord_ACU[] = [];

function defaultNow_ACU(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function positiveThreshold_ACU(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeMetrics_ACU(metrics?: Record<string, unknown>): Record<string, RuntimePerformanceMetricValue_ACU> {
  const safe: Record<string, RuntimePerformanceMetricValue_ACU> = {};
  for (const [key, value] of Object.entries(metrics || {})) {
    if (!SAFE_METRIC_KEYS_ACU.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'string' && value.length <= 64) safe[key] = value;
  }
  return safe;
}

function recordSpan_ACU(record: RuntimePerformanceSpanRecord_ACU, diagnosticsEnabled: boolean): void {
  recentSpans_ACU.push(record);
  if (recentSpans_ACU.length > MAX_SPANS_ACU) recentSpans_ACU.shift();
  const summary = `[Performance] ${record.name} durationMs=${record.durationMs.toFixed(1)} severity=${record.severity} metrics=${JSON.stringify(record.metrics)}`;
  if (record.severity === 'normal') {
    if (diagnosticsEnabled) logDebug_ACU(summary);
  } else {
    logWarn_ACU(summary);
  }
}

export function startRuntimePerformanceSpan_ACU(name: string, options: RuntimePerformanceSpanOptions_ACU = {}) {
  const now = options.now || defaultNow_ACU;
  const startedAt = now();
  const id = `perf-${nextSpanId_ACU++}`;
  const diagnosticsEnabled = options.settings?.performanceDiagnosticsEnabled === true;
  const slowThreshold = positiveThreshold_ACU(options.settings?.performanceSlowThresholdMs, DEFAULT_SLOW_THRESHOLD_MS_ACU);
  const longThreshold = Math.max(slowThreshold, positiveThreshold_ACU(options.settings?.performanceLongTaskThresholdMs, DEFAULT_LONG_THRESHOLD_MS_ACU));
  const initialMetrics = sanitizeMetrics_ACU(options.metrics);
  let ended = false;

  return {
    id,
    end(metrics?: Record<string, unknown>): RuntimePerformanceSpanRecord_ACU | null {
      if (ended) return null;
      ended = true;
      const durationMs = Math.max(0, now() - startedAt);
      const severity: RuntimePerformanceSeverity_ACU = durationMs >= longThreshold
        ? 'long'
        : durationMs >= slowThreshold ? 'slow' : 'normal';
      if (severity === 'normal' && !diagnosticsEnabled) return null;
      const record: RuntimePerformanceSpanRecord_ACU = {
        id,
        name: String(name || 'unknown').slice(0, 96),
        ...(options.runId ? { runId: String(options.runId).slice(0, 96) } : {}),
        ...(options.parentSpanId ? { parentSpanId: String(options.parentSpanId).slice(0, 96) } : {}),
        startedAt,
        durationMs,
        severity,
        metrics: { ...initialMetrics, ...sanitizeMetrics_ACU(metrics) },
      };
      recordSpan_ACU(record, diagnosticsEnabled);
      return record;
    },
  };
}

export function getRecentRuntimePerformanceSpans_ACU(): RuntimePerformanceSpanRecord_ACU[] {
  return recentSpans_ACU.map(record => ({ ...record, metrics: { ...record.metrics } }));
}

function compareSpanRecords_ACU(
  left: RuntimePerformanceSpanRecord_ACU,
  right: RuntimePerformanceSpanRecord_ACU,
): number {
  return left.startedAt - right.startedAt || left.id.localeCompare(right.id);
}

export function getRuntimePerformanceRun_ACU(runId: string): RuntimePerformanceRun_ACU | null {
  const normalizedRunId = String(runId || '').slice(0, 96);
  if (!normalizedRunId) return null;

  const records = recentSpans_ACU
    .filter(record => record.id === normalizedRunId || record.runId === normalizedRunId)
    .sort(compareSpanRecords_ACU);
  if (records.length === 0) return null;

  const nodesById = new Map<string, RuntimePerformanceSpanNode_ACU>();
  for (const record of records) {
    nodesById.set(record.id, {
      ...record,
      metrics: { ...record.metrics },
      children: [],
    });
  }

  const roots: RuntimePerformanceSpanNode_ACU[] = [];
  const orphans: RuntimePerformanceSpanNode_ACU[] = [];
  for (const record of records) {
    const node = nodesById.get(record.id)!;
    if (!record.parentSpanId) {
      roots.push(node);
      continue;
    }
    const parent = nodesById.get(record.parentSpanId);
    if (parent) parent.children.push(node);
    else orphans.push(node);
  }

  const sortTree_ACU = (nodes: RuntimePerformanceSpanNode_ACU[]): void => {
    nodes.sort(compareSpanRecords_ACU);
    nodes.forEach(node => sortTree_ACU(node.children));
  };
  sortTree_ACU(roots);
  sortTree_ACU(orphans);

  const firstStartedAt = records[0].startedAt;
  const lastEndedAt = Math.max(...records.map(record => record.startedAt + record.durationMs));
  const rootRecord = records.find(record => record.id === normalizedRunId);
  const severityCounts: Record<RuntimePerformanceSeverity_ACU, number> = { normal: 0, slow: 0, long: 0 };
  records.forEach(record => { severityCounts[record.severity] += 1; });

  return {
    runId: normalizedRunId,
    spanCount: records.length,
    rootDurationMs: rootRecord?.durationMs ?? null,
    observedDurationMs: Math.max(0, lastEndedAt - firstStartedAt),
    severityCounts,
    roots,
    orphans,
  };
}

export function clearRuntimePerformanceSpans_ACU(): void {
  recentSpans_ACU = [];
  nextSpanId_ACU = 1;
}
