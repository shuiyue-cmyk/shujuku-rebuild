/**
 * 表级 API 预设覆盖（settings.tableApiPresetOverridesByName，按表名存）。
 * 返回空串表示该表没有覆盖、使用全局 tableApiPreset。
 */
export function resolveTableApiPresetOverride_ACU(overrides: unknown, tableName: unknown): string {
    const normalizedName = String(tableName ?? '').trim();
    if (!normalizedName || !overrides || typeof overrides !== 'object') return '';
    const preset = (overrides as Record<string, unknown>)[normalizedName];
    return typeof preset === 'string' ? preset.trim() : '';
}
