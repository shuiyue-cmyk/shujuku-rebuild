/**
 * service/settings/settings-readers.ts — 设置读取器（纯读取，无持久化副作用）
 *
 * 从 settings-service.ts 提取。这些函数只读取/规范化 settings 中的数据，
 * 不执行保存操作。其他子模块应优先从此文件 import，而非 settings-service.ts。
 */

import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, settings_ACU } from '../runtime/state-manager';
import { globalMeta_ACU } from '../../data/repositories/profile-repo';
import { defaultWorldbookConfig_ACU } from '../../shared/defaults';
import { deepMerge_ACU, logDebug_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { getSortedSheetKeys_ACU } from '../template/chat-scope';

/**
 * 获取当前角色的专属设置。
 * 业务逻辑：读 settings → deep merge 默认值 → 写回（确保字段完整）。
 * 注意：此函数有"规范化写回"的副作用（补全缺失字段），但不触发持久化。
 */
export function getCurrentCharSettings_ACU() {
    const charId = currentChatFileIdentifier_ACU || 'default';
    if (!settings_ACU.characterSettings) {
        settings_ACU.characterSettings = {};
    }
    // 0TK 占用模式恒开启（开关已剥离）：大纲/纪要索引条目不占用上下文
    const zeroTkOccupyMode = true;
    if (!settings_ACU.characterSettings[charId]) {
        const worldbookConfigForNewChat = JSON.parse(JSON.stringify(defaultWorldbookConfig_ACU));
        worldbookConfigForNewChat.zeroTkOccupyMode = zeroTkOccupyMode;
        worldbookConfigForNewChat.outlineEntryEnabled = !zeroTkOccupyMode;
        worldbookConfigForNewChat.summaryVectorIndexModeEnabled = globalMeta_ACU?.summaryVectorIndexModeGlobal === true;
        settings_ACU.characterSettings[charId] = {
            worldbookConfig: worldbookConfigForNewChat,
        };
        logDebug_ACU(`Created new character settings for: ${charId}`);
    }
    try {
        const existingCfg = settings_ACU.characterSettings[charId].worldbookConfig || {};
        const mergedCfg = deepMerge_ACU(
            JSON.parse(JSON.stringify(defaultWorldbookConfig_ACU)),
            existingCfg,
        );
        const globalSummaryVectorIndexEnabled = globalMeta_ACU?.summaryVectorIndexModeGlobal === true;
        mergedCfg.summaryVectorIndexModeEnabled = globalSummaryVectorIndexEnabled;
        mergedCfg.zeroTkOccupyMode = zeroTkOccupyMode;
        mergedCfg.outlineEntryEnabled = !mergedCfg.zeroTkOccupyMode;
        settings_ACU.characterSettings[charId].worldbookConfig = mergedCfg;
    } catch (e) {
        // ignore
    }
    return settings_ACU.characterSettings[charId];
}

/** 获取当前角色的世界书配置 */
export function getCurrentWorldbookConfig_ACU() {
    return getCurrentCharSettings_ACU().worldbookConfig;
}

/**
 * 读取手动填表的持久化选择。未曾显式选择时默认返回当前全部表；显式选择后
 * 严格返回仍然存在的交集，避免新增表格被意外纳入破坏性手动重填。
 */
export function getSelectedManualTableKeys_ACU(): string[] {
    if (!currentJsonTableData_ACU) return [];
    const availableKeys = getSortedSheetKeys_ACU(currentJsonTableData_ACU);
    if (!settings_ACU.hasManualSelection) return availableKeys;

    const saved = Array.isArray(settings_ACU.manualSelectedTables)
        ? settings_ACU.manualSelectedTables
        : [];
    return saved.filter((key: string) => availableKeys.includes(key));
}

function getImportTableBaseData_ACU(): Record<string, any> | null {
    try {
        const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true });
        if (templateData && typeof templateData === 'object') return templateData;
    } catch {
        // 模板无法解析时回退到当前聊天表格，保持旧选择器的语义。
    }
    return currentJsonTableData_ACU || null;
}

/**
 * 读取导入流程的持久化表选择，完全不依赖 V1 checkbox DOM。
 */
export function getSelectedImportTableKeys_ACU(): string[] {
    const baseData = getImportTableBaseData_ACU();
    if (!baseData) return [];
    const availableKeys = getSortedSheetKeys_ACU(baseData);
    if (!settings_ACU.hasImportTableSelection) return availableKeys;

    const saved = Array.isArray(settings_ACU.importSelectedTables)
        ? settings_ACU.importSelectedTables
        : [];
    return saved.filter((key: string) => availableKeys.includes(key));
}

/**
 * 获取当前表格展示数据（presentation fallback）。
 *
 * 语义：这是 **只读展示** 数据源，不是 runtime 就绪判据。
 * - 若 currentJsonTableData_ACU 为对象且含有效 sheet_*，直接返回 runtime；
 * - 否则（硬清空后 runtime 为 null，或尚未加载）回退到当前生效全局模板的
 *   去除 seed rows 结构，供 FormFill/Dashboard 显示表名与配置；
 * - 模板解析失败或无有效 sheet 时返回 null，页面维持空态。
 *
 * 约束：本函数不修改 state-manager，不保存 settings，不触发 provider、
 * 世界书或聊天加载；不得把返回值当作 runtime ready 或持久化成功依据。
 */
export function getCurrentTableDisplayData_ACU(): Record<string, any> | null {
  if (currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object') {
    const hasSheet = Object.keys(currentJsonTableData_ACU).some(key => key.startsWith('sheet_'));
    if (hasSheet) return currentJsonTableData_ACU;
  }
  try {
    const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true });
    if (
      templateData
      && typeof templateData === 'object'
      && Object.keys(templateData).some(key => key.startsWith('sheet_'))
    ) return templateData;
  } catch {
    // 模板无法解析时返回 null，页面维持空态，不抛出破坏页面。
  }
  return null;
}
/**
 * runtime 是否已持有真实数据（含有效 sheet_*）。
 *
 * 语义：这是 **执行就绪判据**，与展示回退严格区分。
 * - 仅当 currentJsonTableData_ACU 为对象且含 sheet_* 时返回 true；
 * - purge 硬清空后 runtime 为 null / 空对象时返回 false；
 * - 不读取模板，不解析，无任何副作用。
 *
 * 用途：手动填表 / 追平等破坏性执行必须以此判据守卫，避免把展示用
 * 模板表当作真实 runtime 表传给 orchestrator。
 */
export function hasRuntimeTableData_ACU(): boolean {
  return !!(
    currentJsonTableData_ACU
    && typeof currentJsonTableData_ACU === 'object'
    && Object.keys(currentJsonTableData_ACU).some((key) => key.startsWith('sheet_'))
  );
}
