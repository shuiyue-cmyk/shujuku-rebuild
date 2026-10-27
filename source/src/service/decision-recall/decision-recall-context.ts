/**
 * service/decision-recall/decision-recall-context.ts — 决策召回打分用的前文（纯函数）。
 *
 * 只取最近几楼 AI 回复（另由调用方带上最新的用户输入），不带世界书。
 * 去掉思考、状态栏、选项等与剧情无关的块（同时间召回预设的默认排除规则）和 MVU 变量更新块，再去掉残留的标签。
 */
import { DEFAULT_TIME_RECALL_PLOT_PRESET_ACU } from '../../shared/defaults-json.js';
import { stripMvuUpdateBlocks_ACU } from '../../shared/text-optimization';
import { applyContextTagFilters_ACU } from '../runtime/helpers-context-tags';
import { DECISION_RECALL_CONTEXT_AI_FLOORS_ACU } from '../../shared/decision-recall-defaults';
import { isAiFloor_ACU } from '../../shared/ai-floor';

/** 用时才读：在加载时读默认值会受循环引用与测试替身影响。 */
function readContextExcludeRules_ACU(): any[] {
  const rules = (DEFAULT_TIME_RECALL_PLOT_PRESET_ACU as any)?.contextExcludeRules;
  return Array.isArray(rules) ? rules : [];
}

export function cleanDecisionRecallFloorText_ACU(text: string): string {
  const filtered = applyContextTagFilters_ACU(String(text ?? ''), { excludeRules: readContextExcludeRules_ACU() });
  return stripMvuUpdateBlocks_ACU(filtered)
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 最近几楼 AI 回复（跳过用户楼、隐藏楼、工具楼与清洗后为空的楼），按时间先后返回。 */
export function collectDecisionRecallAiFloors_ACU(chat: readonly any[] | null | undefined, count = DECISION_RECALL_CONTEXT_AI_FLOORS_ACU): string[] {
  const floors: string[] = [];
  const list = Array.isArray(chat) ? chat : [];
  for (let index = list.length - 1; index >= 0 && floors.length < count; index--) {
    const message = list[index];
    if (!isAiFloor_ACU(message)) continue;
    const text = cleanDecisionRecallFloorText_ACU(message.mes);
    if (text) floors.unshift(text);
  }
  return floors;
}
