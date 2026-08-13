import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import { SyncBridge } from '../../data/sqlite/sync-bridge';

export interface StrictHydrateOptions_ACU {
    /** 仅运行时导入允许将无法执行的显式 DDL 降级为 fallback schema。 */
    allowRuntimeDdlFallback?: boolean;
}

/**
 * 使用生产 SyncBridge 路径执行真实 SQLite hydrate。
 * 成功意味着 DDL 与全部 snapshot 行已经在临时 SQLite 中实际执行。
 */
export async function hydrateTableDataStrict_ACU(
    tableData: Record<string, any>,
    options: StrictHydrateOptions_ACU = {},
): Promise<void> {
    const engine = new SqliteEngine();
    const syncBridge = new SyncBridge(engine);
    try {
        await engine.init();
        syncBridge.loadFromTableData(tableData as any, {
            strict: true,
            allowRuntimeDdlFallback: options.allowRuntimeDdlFallback === true,
        });
    } finally {
        engine.dispose();
    }
}

export async function validateSqliteTemplateDataStrict_ACU(
    tableData: Record<string, any>,
    options: StrictHydrateOptions_ACU = {},
): Promise<{ success: boolean; error?: string }> {
    try {
        await hydrateTableDataStrict_ACU(tableData, options);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
    }
}
