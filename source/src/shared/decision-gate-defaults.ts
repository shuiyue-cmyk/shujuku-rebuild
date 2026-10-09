/**
 * shared/decision-gate-defaults.ts — 正文替换「替换前判定」的默认值（叶子模块，无依赖）。
 * 设置默认值与 service/optimization/decision-gate.ts 的规整逻辑共用这一份，避免两处默认值漂移；
 * 放在叶子模块里，state-manager 引用它也不会形成循环依赖。
 */

/** 别名始终指向 Jev 最新版，用户只填 key 就能用。 */
export const DEFAULT_DECISION_MODEL_ACU = '~typesafe/jev-latest';
export const DEFAULT_DECISION_THRESHOLD_ACU = 50;

export function buildDefaultDecisionGateSettings_ACU() {
  return {
    enabled: false,
    apiKey: '',
    model: DEFAULT_DECISION_MODEL_ACU,
    threshold: DEFAULT_DECISION_THRESHOLD_ACU,
  };
}
