/**
 * service/runtime/plot-runtime/plot-runtime-phase.ts
 * 剧情推进 — 阶段化错误模型
 *
 * 目标：让每次顶层异常都能安全标识具体阶段与错误类别，
 * 且日志/返回值只走白名单摘要，不泄露用户输入、提示词、世界书正文或堆栈正文。
 */
import { isLorebookReadAbortedError_ACU, isStrictLorebookReadError_ACU, normalizeSafePreflightSummary_ACU, summarizeLorebookRuntimeError_ACU, summarizeStrictLorebookReadError_ACU } from '../../../shared/lorebook-read-error';

export type PlotRuntimePhase_ACU =
  | 'clear_final_generation_greenlights'
  | 'build_shared_context'
  | 'resolve_agent_availability'
  | 'execute_tasks'
  | 'persist_plot';

export const PLOT_RUNTIME_PHASES_ACU: readonly PlotRuntimePhase_ACU[] = [
  'clear_final_generation_greenlights',
  'build_shared_context',
  'resolve_agent_availability',
  'execute_tasks',
  'persist_plot',
];

export function isPlotRuntimePhase_ACU(value: unknown): value is PlotRuntimePhase_ACU {
  return typeof value === 'string' && (PLOT_RUNTIME_PHASES_ACU as readonly string[]).includes(value);
}

/**
 * 阶段错误包装器：保存 phase 与原始 cause，但任何日志/摘要都只输出白名单。
 * message 用于编程内部分类（不在日志/UI 中直接呈现）。
 */
export class PlotStageError_ACU extends Error {
  readonly phase: PlotRuntimePhase_ACU;
  readonly cause?: unknown;

  constructor(phase: PlotRuntimePhase_ACU, message: string, cause?: unknown) {
    super(message);
    this.name = 'PlotStageError_ACU';
    this.phase = phase;
    this.cause = cause;
  }
}

export function isPlotStageError_ACU(error: unknown): error is PlotStageError_ACU {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; phase?: unknown };
  return candidate.name === 'PlotStageError_ACU' && isPlotRuntimePhase_ACU(candidate.phase);
}

/**
 * 阶段错误的 cause 安全摘要：只输出白名单类别，不复制 cause 的 message/stack。
 */
export function summarizePlotStageErrorCause_ACU(cause: unknown) {
  // 已安全摘要对象（clearFinalGenerationGreenlights 直接透传的 error）不得二次压缩为 unknown。
  if (cause && typeof cause === 'object' && typeof (cause as { category?: unknown }).category === 'string') {
    const normalized = normalizeSafePreflightSummary_ACU(cause);
    if (Object.keys(normalized).length > 0) return normalized;
  }
  if (isStrictLorebookReadError_ACU(cause)) {
    return { category: 'strict_lorebook_read', ...summarizeStrictLorebookReadError_ACU(cause) };
  }
  if (isLorebookReadAbortedError_ACU(cause)) return { category: 'aborted' };
  if (cause && typeof cause === 'object') {
    const name = (cause as { name?: unknown }).name;
    if (typeof name === 'string' && name) return { category: 'known', name };
  }
  const summarized = summarizeLorebookRuntimeError_ACU(cause);
  if (summarized) return summarized;
  return { category: 'unknown' };
}

/**
 * 阶段错误安全摘要：只输出 phase + cause 摘要。
 */
export function summarizePlotStageError_ACU(error: unknown) {
  if (!isPlotStageError_ACU(error)) return null;
  return {
    category: 'stage',
    phase: error.phase,
    cause: summarizePlotStageErrorCause_ACU(error.cause),
  };
}
