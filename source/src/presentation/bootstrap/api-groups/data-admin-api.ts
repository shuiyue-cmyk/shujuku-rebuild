/**
 * presentation/bootstrap/api-groups/data-admin-api.ts
 * 数据管理 API — 模板导入导出 + 合并总结
 */

import { logError_ACU } from '../../../shared/utils';
import { getUiSurface_ACU } from '../../../shared/ui-surface-registry';
import { exportCurrentJsonData_ACU, exportTableTemplate_ACU, importTableTemplate_ACU, migrateLegacySummaryVectorIndex_ACU, overrideLatestLayerWithTemplate_ACU, resetAllToDefaults_ACU, resetTableTemplate_ACU } from '../../triggers/data-admin-ui';
import { importCombinedSettings_ACU } from '../../triggers/data-admin-ui';
import { exportCombinedSettings_ACU, handleManualMergeSummary_ACU } from '../../triggers/update-trigger';
import { commitPreparedV2Recovery_ACU, prepareV2Recovery_ACU } from '../../../service/table/table-v2-recovery-service';
import { scanSeedPollution_ACU } from '../../../service/template/template-seed-pollution-diagnostics';
import { commitSeedMigration_ACU, prepareSeedMigration_ACU, rollbackSeedMigration_ACU } from '../../../service/template/template-seed-pollution-migration';
import type { ApiGroupContext } from './callback-api';

function dataAdminApiError_ACU(error: unknown, fallback: string): { success: false; error: string } {
    return { success: false, error: error instanceof Error ? error.message : fallback };
}

export function createDataAdminApi(_ctx: ApiGroupContext): Record<string, Function> {
    return {
        // 模板/数据管理
        importTemplate: async function(options: any = {}) { try { return await importTableTemplate_ACU(options); } catch (e) { logError_ACU('importTemplate failed:', e); return dataAdminApiError_ACU(e, '模板导入失败。'); } },
        exportTemplate: async function(options: any = {}) { try { return await exportTableTemplate_ACU(options); } catch (e) { logError_ACU('exportTemplate failed:', e); return dataAdminApiError_ACU(e, '模板导出失败。'); } },
        resetTemplate: async function(options: any = {}) { try { return await resetTableTemplate_ACU(options); } catch (e) { logError_ACU('resetTemplate failed:', e); return dataAdminApiError_ACU(e, '模板重置失败。'); } },
        resetAllDefaults: async function() { try { return await resetAllToDefaults_ACU(); } catch (e) { logError_ACU('resetAllDefaults failed:', e); return dataAdminApiError_ACU(e, '恢复默认配置失败。'); } },
        exportJsonData: async function() { try { return await exportCurrentJsonData_ACU(); } catch (e) { logError_ACU('exportJsonData failed:', e); return dataAdminApiError_ACU(e, '表格数据导出失败。'); } },
        importCombinedSettings: async function() { try { return await importCombinedSettings_ACU(); } catch (e) { logError_ACU('importCombinedSettings failed:', e); return dataAdminApiError_ACU(e, '组合设置导入失败。'); } },
        exportCombinedSettings: async function() { try { return await exportCombinedSettings_ACU(); } catch (e) { logError_ACU('exportCombinedSettings failed:', e); return dataAdminApiError_ACU(e, '组合设置导出失败。'); } },
        overrideWithTemplate: async function() { try { return await overrideLatestLayerWithTemplate_ACU(); } catch (e) { logError_ACU('overrideWithTemplate failed:', e); return dataAdminApiError_ACU(e, '模板覆盖失败。'); } },
        migrateLegacyVectorIndex: async function() { try { return await migrateLegacySummaryVectorIndex_ACU(); } catch (e) { logError_ACU('migrateLegacyVectorIndex failed:', e); return dataAdminApiError_ACU(e, '旧版向量索引迁移失败。'); } },
        openVisualizer: async function() {
            const surface = getUiSurface_ACU();
            if (!surface) {
                logError_ACU('openVisualizer failed: V2 UI surface is not registered.');
                return false;
            }
            try {
                return await surface.openVisualizer();
            } catch (error) {
                logError_ACU('openVisualizer failed:', error);
                return false;
            }
        },

        // 导入TXT链路（外部导入功能已剥离，保留占位注释说明 API 已移除）
        scanSeedPollution: async function() { try { return scanSeedPollution_ACU(); } catch (e) { logError_ACU('scanSeedPollution failed:', e); return dataAdminApiError_ACU(e, 'seed 污染只读诊断失败。'); } },

        prepareSeedMigration: async function(options: any = {}) { try { if (options === null || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'seed 迁移准备选项必须是对象。' }; return prepareSeedMigration_ACU({ isolationKey: typeof options.isolationKey === 'string' ? options.isolationKey : undefined }); } catch (e) { logError_ACU('prepareSeedMigration failed:', e); return dataAdminApiError_ACU(e, 'seed 迁移准备失败。'); } },
        commitSeedMigration: async function(planId: any, options: any = {}) { try { if (typeof planId !== 'string' || !planId.trim()) return { success: false, error: 'planId 必须是非空字符串。' }; if (options === null || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'seed 迁移确认选项必须是对象。' }; return await commitSeedMigration_ACU(planId.trim(), { confirm: options.confirm === true }); } catch (e) { logError_ACU('commitSeedMigration failed:', e); return dataAdminApiError_ACU(e, 'seed 迁移提交失败。'); } },
        rollbackSeedMigration: async function(planId: any) { try { if (typeof planId !== 'string' || !planId.trim()) return { success: false, error: 'planId 必须是非空字符串。' }; return await rollbackSeedMigration_ACU(planId.trim()); } catch (e) { logError_ACU('rollbackSeedMigration failed:', e); return dataAdminApiError_ACU(e, 'seed 迁移回滚失败。'); } },

        prepareV2Recovery: async function() { try { return prepareV2Recovery_ACU(); } catch (e) { logError_ACU('prepareV2Recovery failed:', e); return dataAdminApiError_ACU(e, 'V2 恢复诊断失败。'); } },
        commitV2Recovery: async function(planId: any, options: any = {}) { try { if (typeof planId !== 'string' || !planId.trim()) return { success: false, error: 'planId 必须是非空字符串。' }; if (options === null || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'V2 恢复确认选项必须是对象。' }; return await commitPreparedV2Recovery_ACU(planId.trim(), { confirmOrphanDataReplace: options.confirmOrphanDataReplace === true }); } catch (e) { logError_ACU('commitV2Recovery failed:', e); return dataAdminApiError_ACU(e, 'V2 恢复提交失败。'); } },

        // 合并总结
        mergeSummaryNow: async function() { try { return await handleManualMergeSummary_ACU(); } catch (e) { logError_ACU('mergeSummaryNow failed:', e); return dataAdminApiError_ACU(e, '手动合并总结失败。'); } },
    };
}
