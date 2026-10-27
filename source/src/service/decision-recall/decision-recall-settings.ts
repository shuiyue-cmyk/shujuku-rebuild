/**
 * service/decision-recall/decision-recall-settings.ts — 决策召回设置的规整与接口选择。
 *
 * 与正文替换的「替换前判定」完全独立：自定义接口与三家预设的地址、Key 与模型各存各的，切换服务商不丢另一家的设置。
 */
import { DECISION_API_URL_ACU, SILICONFLOW_DECISION_API_URL_ACU } from '../optimization/decision-gate';
import { DEFAULT_DECISION_MODEL_ACU, DEFAULT_SILICONFLOW_DECISION_MODEL_ACU } from '../../shared/decision-gate-defaults';
import {
  AIHUBMIX_DECISION_API_URL_ACU,
  DECISION_RECALL_BATCH_SIZE_ACU,
  DECISION_RECALL_CONCURRENCY_ACU,
  DECISION_RECALL_MAX_BATCH_SIZE_ACU,
  DECISION_RECALL_MAX_CONCURRENCY_ACU,
  DECISION_RECALL_MAX_JUDGE_RUNS_ACU,
  DEFAULT_DECISION_RECALL_JUDGE_RUNS_ACU,
  DECISION_RECALL_MAX_COUNT_ACU,
  DECISION_RECALL_PROVIDER_LABELS_ACU,
  DECISION_RECALL_MAX_RETRIES_LIMIT_ACU,
  DEFAULT_AIHUBMIX_DECISION_MODEL_ACU,
  DEFAULT_DECISION_RECALL_COUNT_ACU,
  DEFAULT_DECISION_RECALL_DIRECTIVE_ACU,
  DEFAULT_DECISION_RECALL_MAX_RETRIES_ACU,
  type DecisionRecallMode_ACU,
  type DecisionRecallProvider_ACU,
  type DecisionRecallScoringContent_ACU,
} from '../../shared/decision-recall-defaults';

export interface DecisionRecallSettings_ACU {
  /** 总开关（仪表盘进阶开关）；关着时两种用法都不生效。 */
  enabled: boolean;
  mode: DecisionRecallMode_ACU;
  /** 剧情推进页的「由决策召回执行 recall 任务」开关；关着时剧情推进照常调模型召回。 */
  replacePlotRecallTasks: boolean;
  provider: DecisionRecallProvider_ACU;
  /** 自定义接口：完整的决策接口地址、Key（不需要鉴权的接口可留空）与模型名。 */
  customUrl: string;
  customApiKey: string;
  customModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  siliconflowApiKey: string;
  siliconflowModel: string;
  aihubmixApiKey: string;
  aihubmixModel: string;
  /** 打分选出几条（另固定带最新 5 条）。 */
  recallCount: number;
  /** 每次请求放几条纪要（1–50）。 */
  batchSize: number;
  /** 同一组判定几次取平均（1–10）。 */
  judgeRuns: number;
  /** 同时在途的请求数（1–100），与其它模块无关。 */
  concurrency: number;
  scoringContent: DecisionRecallScoringContent_ACU;
  /** 一组打分失败后再试几次，用完仍失败就跳过这一组。 */
  maxRetries: number;
  /** 单独召回时写进本轮输入的注入指令。 */
  directive: string;
}

export { DECISION_RECALL_PROVIDER_LABELS_ACU };

const PROVIDERS_ACU = Object.keys(DECISION_RECALL_PROVIDER_LABELS_ACU) as DecisionRecallProvider_ACU[];

/** 空串 / null 视为没填，回到默认值；Number 会把它们当成 0。 */
function readInteger_ACU(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeDecisionRecallSettings_ACU(raw: unknown): DecisionRecallSettings_ACU {
  const source: Record<string, any> = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const directive = typeof source.directive === 'string' && source.directive.trim() ? source.directive : DEFAULT_DECISION_RECALL_DIRECTIVE_ACU;
  return {
    enabled: source.enabled === true,
    mode: source.mode === 'plot_task' ? 'plot_task' : 'standalone',
    replacePlotRecallTasks: source.replacePlotRecallTasks === true,
    provider: PROVIDERS_ACU.includes(source.provider) ? source.provider : 'custom',
    customUrl: text(source.customUrl),
    customApiKey: text(source.customApiKey),
    customModel: text(source.customModel),
    openrouterApiKey: text(source.openrouterApiKey),
    openrouterModel: text(source.openrouterModel) || DEFAULT_DECISION_MODEL_ACU,
    siliconflowApiKey: text(source.siliconflowApiKey),
    siliconflowModel: text(source.siliconflowModel) || DEFAULT_SILICONFLOW_DECISION_MODEL_ACU,
    aihubmixApiKey: text(source.aihubmixApiKey),
    aihubmixModel: text(source.aihubmixModel) || DEFAULT_AIHUBMIX_DECISION_MODEL_ACU,
    recallCount: readInteger_ACU(source.recallCount, DEFAULT_DECISION_RECALL_COUNT_ACU, 1, DECISION_RECALL_MAX_COUNT_ACU),
    batchSize: readInteger_ACU(source.batchSize, DECISION_RECALL_BATCH_SIZE_ACU, 1, DECISION_RECALL_MAX_BATCH_SIZE_ACU),
    judgeRuns: readInteger_ACU(source.judgeRuns, DEFAULT_DECISION_RECALL_JUDGE_RUNS_ACU, 1, DECISION_RECALL_MAX_JUDGE_RUNS_ACU),
    concurrency: readInteger_ACU(source.concurrency, DECISION_RECALL_CONCURRENCY_ACU, 1, DECISION_RECALL_MAX_CONCURRENCY_ACU),
    scoringContent: source.scoringContent === 'summary' ? 'summary' : 'full',
    maxRetries: readInteger_ACU(source.maxRetries, DEFAULT_DECISION_RECALL_MAX_RETRIES_ACU, 0, DECISION_RECALL_MAX_RETRIES_LIMIT_ACU),
    directive,
  };
}

export interface DecisionRecallEndpoint_ACU {
  label: string;
  url: string;
  apiKey: string;
  model: string;
  /** 还没填好的一项（「接口地址」「模型名」「Key」）；填好了是空串。没填好时不打分，只带固定的最新几条。 */
  missing: string;
}

/** 当前所选服务商的接口地址、Key 与模型。自定义接口的 Key 可留空（本地或不需要鉴权的接口）。 */
export function resolveDecisionRecallEndpoint_ACU(settings: DecisionRecallSettings_ACU): DecisionRecallEndpoint_ACU {
  const label = DECISION_RECALL_PROVIDER_LABELS_ACU[settings.provider];
  const preset = (url: string, apiKey: string, model: string) => ({ label, url, apiKey, model, missing: apiKey ? '' : 'Key' });
  if (settings.provider === 'custom') {
    const missing = !/^https?:\/\//i.test(settings.customUrl) ? '接口地址' : (!settings.customModel ? '模型名' : '');
    return { label, url: settings.customUrl, apiKey: settings.customApiKey, model: settings.customModel, missing };
  }
  if (settings.provider === 'openrouter') return preset(DECISION_API_URL_ACU, settings.openrouterApiKey, settings.openrouterModel);
  if (settings.provider === 'aihubmix') return preset(AIHUBMIX_DECISION_API_URL_ACU, settings.aihubmixApiKey, settings.aihubmixModel);
  return preset(SILICONFLOW_DECISION_API_URL_ACU, settings.siliconflowApiKey, settings.siliconflowModel);
}

/** 单独召回生效中：发送前由决策召回占用剧情推进的规划位，剧情推进暂停。 */
export function isDecisionRecallStandaloneActive_ACU(raw: unknown): boolean {
  const settings = normalizeDecisionRecallSettings_ACU(raw);
  return settings.enabled && settings.mode === 'standalone';
}

/** 替换剧情推进任务的用法生效中：剧情推进照常运行（是否真的替换还看剧情推进页的开关）。 */
export function isDecisionRecallTaskModeActive_ACU(raw: unknown): boolean {
  const settings = normalizeDecisionRecallSettings_ACU(raw);
  return settings.enabled && settings.mode === 'plot_task';
}

/** 本轮剧情推进要把标签只有 recall 的任务交给决策召回：用法是替换剧情推进的任务，且剧情推进页的开关开着。 */
export function isDecisionRecallReplacingPlotTasks_ACU(raw: unknown): boolean {
  const settings = normalizeDecisionRecallSettings_ACU(raw);
  return settings.enabled && settings.mode === 'plot_task' && settings.replacePlotRecallTasks;
}
