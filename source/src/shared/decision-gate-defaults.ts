/**
 * shared/decision-gate-defaults.ts — 正文替换「替换前判定」的默认值（叶子模块，无依赖）。
 * 设置默认值与 service/optimization/decision-gate.ts 的规整逻辑共用这一份，避免两处默认值漂移；
 * 放在叶子模块里，state-manager 引用它也不会形成循环依赖。
 */

/** 别名始终指向 Jev 最新版，用户只填 key 就能用。 */
export const DEFAULT_DECISION_MODEL_ACU = '~typesafe/jev-latest';
/** 硅基流动默认 SemIf：实测响应快（<1s）且给出分级概率，门槛才有意义。 */
export const DEFAULT_SILICONFLOW_DECISION_MODEL_ACU = 'SemIf';
export const DEFAULT_DECISION_THRESHOLD_ACU = 50;

/** apiKey / model 是 OpenRouter 的（沿用老字段名），硅基流动单独存一份，切换服务不丢另一家的设置。 */
export function buildDefaultDecisionGateSettings_ACU() {
  return {
    enabled: false,
    provider: 'openrouter' as const,
    apiKey: '',
    model: DEFAULT_DECISION_MODEL_ACU,
    siliconflowApiKey: '',
    siliconflowModel: DEFAULT_SILICONFLOW_DECISION_MODEL_ACU,
    threshold: DEFAULT_DECISION_THRESHOLD_ACU,
  };
}
