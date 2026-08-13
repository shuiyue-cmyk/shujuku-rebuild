/**
 * service/runtime/plot-runtime/index.ts
 * 剧情推进运行时入口 — re-export 所有公共 API
 * 保持与原 helpers-plot-runtime.ts 完全相同的公共接口
 */

// 数据格式化
export {
    formatOutlineTableForPlot_ACU,
    formatSummaryIndexForPlot_ACU,
} from './plot-data-format';

// 预设加载 + 历史读写
export {
    loadPresetAndCleanCharacterData_ACU,
    getPlotFromHistory_ACU,
} from './plot-history-preset';

// 规划入口
export {
    runOptimizationLogic_ACU,
} from './plot-entry';

// 世界书内容获取
export {
    getWorldbookContentForPlot_ACU,
    getAgentControlledWorldbookEntriesForFinalPrompt_ACU,
    getAgentGreenlightWorldbookEntriesForPlot_ACU,
    getAgentGreenlightWorldbookContentForPlot_ACU,
} from './plot-task-engine';
