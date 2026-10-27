/**
 * service/decision-recall/decision-recall-settings.ts — 决策召回设置的规整与接口选择。
 *
 * 与正文替换的「替换前判定」完全独立：三家服务商的 Key 与模型各存各的，切换服务商不丢另一家的设置。
 */
import { DECISION_API_URL_ACU, SILICONFLOW_DECISION_API_URL_ACU } from '../optimization/decision-gate';
import { DEFAULT_DECISION_MODEL_ACU, DEFAULT_SILICONFLOW_DECISION_MODEL_ACU } from '../../shared/decision-gate-defaults';
import {
  AIHUBMIX_DECISION_API_URL_ACU,
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
  provider: DecisionRecallProvider_ACU;
  openrouterApiKey: string;
  openrouterModel: string;
  siliconflowApiKey: string;
  siliconflowModel: string;
  aihubmixApiKey: string;
  aihubmixModel: string;
  /** 打分选出几条（另固定带最新 5 条）。 */
  recallCount: number;
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
    provider: PROVIDERS_ACU.includes(source.provider) ? source.provider : 'siliconflow',
    openrouterApiKey: text(source.openrouterApiKey),
    openrouterModel: text(source.openrouterModel) || DEFAULT_DECISION_MODEL_ACU,
    siliconflowApiKey: text(source.siliconflowApiKey),
    siliconflowModel: text(source.siliconflowModel) || DEFAULT_SILICONFLOW_DECISION_MODEL_ACU,
    aihubmixApiKey: text(source.aihubmixApiKey),
    aihubmixModel: text(source.aihubmixModel) || DEFAULT_AIHUBMIX_DECISION_MODEL_ACU,
    recallCount: readInteger_ACU(source.recallCount, DEFAULT_DECISION_RECALL_COUNT_ACU, 1, DECISION_RECALL_MAX_COUNT_ACU),
    scoringContent: source.scoringContent === 'summary' ? 'summary' : 'full',
    maxRetries: readInteger_ACU(source.maxRetries, DEFAULT_DECISION_RECALL_MAX_RETRIES_ACU, 0, DECISION_RECALL_MAX_RETRIES_LIMIT_ACU),
    directive,
  };
}

/** 当前所选服务商的接口地址、Key 与模型。 */
export function resolveDecisionRecallEndpoint_ACU(settings: DecisionRecallSettings_ACU) {
  const label = DECISION_RECALL_PROVIDER_LABELS_ACU[settings.provider];
  if (settings.provider === 'openrouter') {
    return { label, url: DECISION_API_URL_ACU, apiKey: settings.openrouterApiKey, model: settings.openrouterModel };
  }
  if (settings.provider === 'aihubmix') {
    return { label, url: AIHUBMIX_DECISION_API_URL_ACU, apiKey: settings.aihubmixApiKey, model: settings.aihubmixModel };
  }
  return { label, url: SILICONFLOW_DECISION_API_URL_ACU, apiKey: settings.siliconflowApiKey, model: settings.siliconflowModel };
}

/** 单独召回生效中：发送前由决策召回占用剧情推进的规划位，剧情推进暂停。 */
export function isDecisionRecallStandaloneActive_ACU(raw: unknown): boolean {
  const settings = normalizeDecisionRecallSettings_ACU(raw);
  return settings.enabled && settings.mode === 'standalone';
}

/** 替换剧情推进任务的用法生效中：剧情推进照常运行，打开了开关的 recall 任务改由决策召回执行。 */
export function isDecisionRecallTaskModeActive_ACU(raw: unknown): boolean {
  const settings = normalizeDecisionRecallSettings_ACU(raw);
  return settings.enabled && settings.mode === 'plot_task';
}
