/**
 * shared/decision-recall-defaults.ts — 决策召回的默认值与固定规则（叶子模块，无依赖）。
 *
 * 决策召回：发送前把候选纪要分组交给决策模型，按「与接下来剧情发展的相关性」五档打分，
 * 取分数最高的若干条，连同固定带上的最新几条，按表号顺序写进本轮输入（走剧情推进的注入通道）。
 * 总开关在仪表盘进阶开关里（关着时侧栏不显示决策召回页），开启后在决策召回页选用法，两种用法共用这一份设置：
 * - 单独召回（默认）：发送前由决策召回占用剧情推进的规划位，剧情推进暂停（剧情推进页灰掉，它自己的开关不动）；
 * - 替换剧情推进的任务：剧情推进照常运行，剧情推进页的「由决策召回执行 recall 任务」开着时，多任务预设里标签恰好是 recall 的任务改由决策召回执行。
 * 交火开着时从交火筛过的纪要索引里选，否则从全部纪要里选。
 */
import { DEFAULT_DECISION_MODEL_ACU, DEFAULT_SILICONFLOW_DECISION_MODEL_ACU } from './decision-gate-defaults';

/** 最新几条纪要固定带上，不参与打分。 */
export const DECISION_RECALL_FIXED_RECENT_COUNT_ACU = 5;
/** 每次请求带几条纪要（每条一个问题，前文只发一次）。 */
export const DECISION_RECALL_BATCH_SIZE_ACU = 20;
/** 固定 + 打分选出的合计上限。 */
export const DECISION_RECALL_MAX_TOTAL_ACU = 50;
/** 用户可填的召回条数上限（合计上限减去固定条数）。 */
export const DECISION_RECALL_MAX_COUNT_ACU = DECISION_RECALL_MAX_TOTAL_ACU - DECISION_RECALL_FIXED_RECENT_COUNT_ACU;
/** 默认召回 20 条，加固定 5 条合计 25 条，与时间召回的默认条数一致。 */
export const DEFAULT_DECISION_RECALL_COUNT_ACU = 20;
/** 打分时参考最近几楼 AI 回复（另带最新的用户输入）。 */
export const DECISION_RECALL_CONTEXT_AI_FLOORS_ACU = 2;
/** 同时在途的打分请求上限：硅基流动按每分钟 token 数限流，一次全发容易撞 429。 */
export const DECISION_RECALL_CONCURRENCY_ACU = 3;
export const DEFAULT_DECISION_RECALL_MAX_RETRIES_ACU = 2;
export const DECISION_RECALL_MAX_RETRIES_LIMIT_ACU = 5;
/** 一组 20 个问题比替换前判定的单个问题慢得多，超时放宽到 60 秒。 */
export const DECISION_RECALL_TIMEOUT_MS_ACU = 60000;

/** AIHubMix 的决策接口（与硅基流动同格式，允许网页直连）。 */
export const AIHUBMIX_DECISION_API_URL_ACU = 'https://aihubmix.com/v1/systemone';
export const DEFAULT_AIHUBMIX_DECISION_MODEL_ACU = 'jev-latest';
/** AIHubMix 的模型列表接口不区分决策模型，按模型页内置。 */
export const AIHUBMIX_DECISION_MODELS_ACU: readonly { id: string; name: string; free: boolean }[] = [
  { id: 'jev-latest', name: 'Jev（最新版）', free: false },
  { id: 'jev-1.14', name: 'Jev 1.14', free: false },
  { id: 'jev-1.13', name: 'Jev 1.13', free: false },
  { id: 'decision-model-preview', name: 'Decision Model Preview', free: false },
];

export type DecisionRecallProvider_ACU = 'siliconflow' | 'openrouter' | 'aihubmix';

/** 用法：单独召回（剧情推进暂停）/ 替换剧情推进的任务（剧情推进照常运行）。 */
export type DecisionRecallMode_ACU = 'standalone' | 'plot_task';

/** 服务商名称。放在叶子模块里：设置模块在加载时就要用它，不能依赖可能处在循环引用中的判定模块。 */
export const DECISION_RECALL_PROVIDER_LABELS_ACU: Record<DecisionRecallProvider_ACU, string> = {
  siliconflow: '硅基流动（中国）',
  openrouter: 'OpenRouter',
  aihubmix: 'AIHubMix',
};

/** 打分时每条纪要给模型看的内容：只看概要，或概要加纪要正文。 */
export type DecisionRecallScoringContent_ACU = 'summary' | 'full';

/** 单独召回时注入指令里用户本轮输入的占位符（与剧情推进最终注入指令一致）。替换剧情推进任务时用预设自己的最终注入指令。 */
export const DECISION_RECALL_INPUT_PLACEHOLDER_ACU = '$8';
/** 注入指令里召回编码块的占位符；指令里没有它时编码块追加在末尾。 */
export const DECISION_RECALL_CODES_PLACEHOLDER_ACU = '{{recall}}';

export const DEFAULT_DECISION_RECALL_DIRECTIVE_ACU = [
  '以下是用户的本轮输入：',
  '<本轮用户输入>',
  DECISION_RECALL_INPUT_PLACEHOLDER_ACU,
  '</本轮用户输入>',
  '',
  '以下编码是与本轮剧情相关的既定事实记忆的索引编码，按时间先后排列。请参考这些过去的记忆保持剧情连续性，不要在正文里直接引用编码：',
  DECISION_RECALL_CODES_PLACEHOLDER_ACU,
].join('\n');

export function buildDefaultDecisionRecallSettings_ACU() {
  return {
    enabled: false,
    mode: 'standalone' as DecisionRecallMode_ACU,
    // 剧情推进页的开关：「替换剧情推进的任务」用法下，打开后才把多任务预设里标签只有 recall 的任务交给决策召回
    replacePlotRecallTasks: false,
    // 硅基流动 SemIf 响应快、目前免费，一组 20 个问题也不至于拖慢发送
    provider: 'siliconflow' as DecisionRecallProvider_ACU,
    openrouterApiKey: '',
    openrouterModel: DEFAULT_DECISION_MODEL_ACU,
    siliconflowApiKey: '',
    siliconflowModel: DEFAULT_SILICONFLOW_DECISION_MODEL_ACU,
    aihubmixApiKey: '',
    aihubmixModel: DEFAULT_AIHUBMIX_DECISION_MODEL_ACU,
    recallCount: DEFAULT_DECISION_RECALL_COUNT_ACU,
    scoringContent: 'full' as DecisionRecallScoringContent_ACU,
    maxRetries: DEFAULT_DECISION_RECALL_MAX_RETRIES_ACU,
    directive: DEFAULT_DECISION_RECALL_DIRECTIVE_ACU,
  };
}
