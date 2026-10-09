/**
 * service/optimization/decision-gate.ts — 正文替换「替换前判定」（OpenRouter 决策模型）
 *
 * 思路（用户拍板）：RP 常用的性价比模型 AI 味重，而决策模型恰好偏爱这种写法。
 * 所以正文出来后先问决策模型「这篇文章写得好不好」，判为「好」的才交给替换模型润色，
 * 判为「不好」的保持原文。决策模型只回答预设选项并附概率，不生成文字，单次花费可忽略。
 *
 * 决策接口与聊天接口格式不同，宿主的 chat-completions 转发带不了它；OpenRouter 对任意来源放行跨域，
 * 插件在 TT WebView 内直连（与向量 embedding / rerank 直连外部接口同一做法）。
 * 判定失败一律返回 error，由调用方照常替换，判定永远不会卡住正文。
 */
import { settings_ACU } from '../runtime/state-manager';
import { stripMvuUpdateBlocks_ACU } from '../../shared/text-optimization';
import { DEFAULT_DECISION_MODEL_ACU, DEFAULT_DECISION_THRESHOLD_ACU } from '../../shared/decision-gate-defaults';

export { DEFAULT_DECISION_MODEL_ACU } from '../../shared/decision-gate-defaults';

export const DECISION_API_URL_ACU = 'https://openrouter.ai/api/alpha/decisions';
export const DECISION_MODELS_URL_ACU = 'https://openrouter.ai/api/v1/models?output_modalities=decisions';
export const DECISION_GOOD_LABEL_ACU = '好';
export const DECISION_BAD_LABEL_ACU = '不好';
export const DECISION_TIMEOUT_MS_ACU = 20000;
const DECISION_QUESTION_KEY_ACU = 'quality';

export interface DecisionGateSettings_ACU {
  enabled: boolean;
  apiKey: string;
  model: string;
  /** 「好」的概率达到多少（百分比）才替换。 */
  threshold: number;
}

export type DecisionVerdict_ACU =
  | { kind: 'decided'; replace: boolean; choice: string; goodProbability: number; model: string }
  | { kind: 'error'; message: string };

export type DecisionGateOutcome_ACU = DecisionVerdict_ACU | { kind: 'disabled' };

export interface DecisionModelOption_ACU {
  id: string;
  name: string;
  free: boolean;
}

interface DecisionFetchDeps_ACU {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 外部取消（正文优化的「取消」按钮）。 */
  signal?: AbortSignal;
}

export function normalizeDecisionGateSettings_ACU(raw: unknown): DecisionGateSettings_ACU {
  const source: Record<string, any> = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  // 清空输入框得到 '' / null：Number 会把它们当成 0，门槛 0% 等于判定形同虚设，回到默认值
  const rawThreshold = source.threshold;
  const threshold = rawThreshold === null || rawThreshold === undefined || String(rawThreshold).trim() === ''
    ? NaN
    : Number(rawThreshold);
  const model = typeof source.model === 'string' ? source.model.trim() : '';
  return {
    enabled: source.enabled === true,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    model: model || DEFAULT_DECISION_MODEL_ACU,
    threshold: Number.isFinite(threshold) ? Math.min(100, Math.max(0, Math.round(threshold))) : DEFAULT_DECISION_THRESHOLD_ACU,
  };
}

export function buildDecisionRequestBody_ACU(model: string, text: string) {
  return {
    model,
    state: text,
    questions: {
      [DECISION_QUESTION_KEY_ACU]: {
        type: 'choice' as const,
        instructions: '这篇文章写得好不好？',
        criteria: {
          [DECISION_GOOD_LABEL_ACU]: '这篇文章写得好',
          [DECISION_BAD_LABEL_ACU]: '这篇文章写得不好',
        },
      },
    },
  };
}

/** 概率可能是 { 选项: p } 或 [{ choice, probability }]；读不到返回 null。 */
function readOptionProbability_ACU(probabilities: unknown, label: string): number | null {
  if (Array.isArray(probabilities)) {
    const entry = probabilities.find((item: any) => (item?.choice ?? item?.label ?? item?.option) === label);
    const value = Number(entry?.probability ?? entry?.p);
    return entry && Number.isFinite(value) ? value : null;
  }
  if (probabilities && typeof probabilities === 'object') {
    const value = Number((probabilities as Record<string, unknown>)[label]);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function interpretDecisionResponse_ACU(payload: any, threshold: number): DecisionVerdict_ACU {
  const answer = payload?.answers?.[DECISION_QUESTION_KEY_ACU];
  const choice = String(answer?.choice ?? '');
  if (choice !== DECISION_GOOD_LABEL_ACU && choice !== DECISION_BAD_LABEL_ACU) {
    return { kind: 'error', message: '决策模型没有给出「好 / 不好」的判断' };
  }
  const goodProbability = readOptionProbability_ACU(answer.probabilities, DECISION_GOOD_LABEL_ACU)
    ?? (choice === DECISION_GOOD_LABEL_ACU ? 1 : 0);
  return {
    kind: 'decided',
    // 0.57 * 100 = 56.999…：容差比较，恰好达到门槛也算
    replace: goodProbability * 100 >= threshold - 1e-9,
    choice,
    goodProbability,
    model: String(payload?.model ?? ''),
  };
}

/** 带超时与外部取消的请求；超时与取消各自给出可读原因，供调用方区分。 */
async function fetchWithDeadline_ACU(
  url: string,
  init: RequestInit,
  deps: DecisionFetchDeps_ACU,
): Promise<{ response?: Response; failure?: string; error?: unknown }> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let reason = '';
  const abortWith = (text: string) => {
    if (!reason) reason = text;
    controller.abort();
  };
  const timer = setTimeout(() => abortWith('超时未响应'), deps.timeoutMs ?? DECISION_TIMEOUT_MS_ACU);
  const onExternalAbort = () => abortWith('已取消');
  if (deps.signal?.aborted) onExternalAbort();
  deps.signal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    return { response: await fetchImpl(url, { ...init, signal: controller.signal }) };
  } catch (error) {
    return { failure: reason, error };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function readErrorMessage_ACU(response: Response): Promise<string> {
  try {
    const body: any = await response.json();
    return String(body?.error?.message ?? body?.message ?? '').trim();
  } catch {
    return '';
  }
}

export async function requestContentDecision_ACU(
  text: string,
  settings: DecisionGateSettings_ACU,
  deps: DecisionFetchDeps_ACU = {},
): Promise<DecisionVerdict_ACU> {
  if (!settings.apiKey) return { kind: 'error', message: '未填写 OpenRouter Key' };
  const { response, failure, error } = await fetchWithDeadline_ACU(DECISION_API_URL_ACU, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildDecisionRequestBody_ACU(settings.model, text)),
  }, deps);
  if (!response) {
    if (failure) return { kind: 'error', message: `决策模型${failure}` };
    return { kind: 'error', message: `请求失败：${(error as any)?.message || error}` };
  }
  try {
    if (!response.ok) {
      const reason = await readErrorMessage_ACU(response);
      return { kind: 'error', message: `HTTP ${response.status}${reason ? `：${reason}` : ''}` };
    }
    return interpretDecisionResponse_ACU(await response.json(), settings.threshold);
  } catch (readError: any) {
    return { kind: 'error', message: `读取判定结果失败：${readError?.message || readError}` };
  }
}

/**
 * 自动替换入口：读设置，去掉 MVU 变量块后送去判定。
 * 开关关闭或还没填 key 时不发请求、视同未开启（页面上会提示缺 key），免得每楼都弹失败提示。
 */
export async function judgeContentForAutoReplace_ACU(
  text: string,
  deps: DecisionFetchDeps_ACU = {},
): Promise<DecisionGateOutcome_ACU> {
  const settings = normalizeDecisionGateSettings_ACU(settings_ACU?.contentOptimizationSettings?.decisionGate);
  if (!settings.enabled || !settings.apiKey) return { kind: 'disabled' };
  return requestContentDecision_ACU(stripMvuUpdateBlocks_ACU(text), settings, deps);
}

/** 价格字段都明确为 0 才算免费；缺失、空值或任何一项非 0（如按次收费）都不算。 */
function isFreePricing_ACU(pricing: unknown): boolean {
  if (!pricing || typeof pricing !== 'object') return false;
  const record = pricing as Record<string, unknown>;
  const isZero = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== '' && Number(value) === 0;
  return isZero(record.prompt) && Object.values(record).every(value => value === null || value === undefined || isZero(value));
}

/** OpenRouter 上当前可用的决策模型（公开列表，不需要 key）。失败或超时抛错，由调用方提示。 */
export async function fetchDecisionModels_ACU(deps: DecisionFetchDeps_ACU = {}): Promise<DecisionModelOption_ACU[]> {
  const { response, failure, error } = await fetchWithDeadline_ACU(DECISION_MODELS_URL_ACU, { method: 'GET' }, deps);
  if (!response) throw new Error(failure || (error as any)?.message || String(error));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: any = await response.json();
  const models = Array.isArray(body?.data) ? body.data : [];
  return models
    .filter((model: any) => typeof model?.id === 'string'
      && Array.isArray(model?.architecture?.output_modalities)
      && model.architecture.output_modalities.includes('decisions'))
    .map((model: any) => ({
      id: model.id,
      name: typeof model.name === 'string' && model.name ? model.name : model.id,
      free: isFreePricing_ACU(model?.pricing),
    }));
}
