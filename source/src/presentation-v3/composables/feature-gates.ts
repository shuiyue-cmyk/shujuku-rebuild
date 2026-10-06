/**
 * 功能页入口（剧情推进 / 智能续写 / 交火模式 / 正文替换）的显隐同步。
 * gate 必须读 settings 权威源：开关列表带渲染降级（读失败返回空表），
 * 从它派生会把"读不到"误判成"关了"而隐藏入口。
 */
import {
  FEATURE_GATE_CONTENT_REPLACE,
  FEATURE_GATE_CONTINUATION,
  FEATURE_GATE_PLOT,
  FEATURE_GATE_VECTOR_INDEX,
} from '../../presentation-v2/router/page-registry';
import type { useRouterStore } from '../../presentation-v2/stores/router-store';
import { settings_ACU } from '../../service/runtime/state-manager';

export function syncFeaturePageGates_UB(
  router: ReturnType<typeof useRouterStore>,
  contentReplaceEnabled: boolean,
  plotEnabled: boolean,
): void {
  router.syncFeatureGate(FEATURE_GATE_CONTENT_REPLACE, contentReplaceEnabled);
  router.syncFeatureGate(FEATURE_GATE_PLOT, plotEnabled);
  router.syncFeatureGate(FEATURE_GATE_CONTINUATION, settings_ACU.continuationPageEnabled !== false);
  router.syncFeatureGate(FEATURE_GATE_VECTOR_INDEX, settings_ACU.summaryVectorIndexModeDefault === true);
}
