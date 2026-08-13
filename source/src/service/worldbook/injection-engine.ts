/**
 * service/worldbook/injection-engine.ts — 世界书注入/导出/清理引擎（入口文件）
 * 原 2,281 行代码已按阶段拆分为以下子模块：
 *   - injection-engine-config.ts   — 放置配置常量与默认值
 *   - injection-engine-order.ts    — 注入位置与Order分配工具
 *   - injection-engine-state.ts    — 状态重置、目标获取、隔离前缀、条目清理、聊天历史清理
 *   - injection-engine-entries.ts  — 大纲表、总结表、重要人物表注入
 *   - injection-engine-custom.ts   — 自定义表格导出
 *
 * 本文件仅作为统一入口，re-export 所有子模块的公开 API。
 * 外部文件的 import 路径无需修改。
 */

// ═══ 放置配置常量与默认值 ═══
export {
    DEFAULT_ENTRY_PLACEMENT_ACU,
    DEFAULT_EXTRA_INDEX_PLACEMENT_ACU,
    normalizeLorebookPosition_ACU,
    normalizePlacementConfig_ACU,
    isSummaryTableName_ACU,
    isOutlineTableName_ACU,
    isImportantPersonsTableName_ACU,
    getFixedPlacementDefaultsForTable_ACU,
    buildDefaultExportConfig_ACU,
    buildDefaultGlobalInjectionConfig_ACU,
    ensureGlobalInjectionConfigDefaults_ACU,
    getGlobalInjectionConfigFromData_ACU,
    ensureExportConfigDefaults_ACU,
    ensureSheetExportConfigDefaults_ACU,
    applyPlacementToEntry_ACU,
    isEntryPlacementMatched_ACU,
} from './injection-engine-config';

// ═══ 注入位置与Order分配工具 ═══
export {
    getEntryOrderNumber_ACU,
    buildUsedOrderSet_ACU,
    allocOrder_ACU,
    allocConsecutiveOrderBlock_ACU,
} from './injection-engine-order';

// ═══ 状态重置、目标获取、隔离前缀、条目清理、聊天历史清理 ═══
export {
    resetScriptStateForNewChat_ACU,
    getInjectionTargetLorebook_ACU,
    getIsolationPrefix_ACU,
    purgeSheetKeysFromChatHistoryHard_ACU,
} from './injection-engine-state';

// ═══ 大纲表、总结表、重要人物表注入 ═══
export {
    updateOutlineTableEntry_ACU,
    updateSummaryTableEntries_ACU,
    updateImportantPersonsRelatedEntries_ACU,
} from './injection-engine-entries';

// ═══ 自定义表格导出 ═══
export {
    updateCustomTableExports_ACU,
} from './injection-engine-custom';
