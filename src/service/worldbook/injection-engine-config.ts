/**
 * service/worldbook/injection-engine-config.ts — 放置配置常量与默认值
 * 从 injection-engine.ts 拆出
 */

export const DEFAULT_ENTRY_PLACEMENT_ACU = Object.freeze({ position: 'at_depth_as_system', depth: 2, order: 10000 });
export const DEFAULT_EXTRA_INDEX_PLACEMENT_ACU = Object.freeze({ position: 'at_depth_as_system', depth: 2, order: 10010 });
const DEFAULT_FIXED_PLACEMENT_ACU = Object.freeze({ position: 'at_depth_as_system', depth: 2, order: 99990 });
const DEFAULT_FIXED_INDEX_PLACEMENT_ACU = Object.freeze({ position: 'at_depth_as_system', depth: 2, order: 99991 });

export function normalizeLorebookPosition_ACU(position: any, fallback = 'at_depth_as_system') {
    const raw = String(position ?? '').trim().toLowerCase();
    if (raw === 'at_depth_as_system' || raw === 'system') return 'at_depth_as_system';
    // [修复] 返回 API 期望的正确值：before_character_definition / after_character_definition
    // 而不是内部简写 before_char / after_char
    if (raw === 'before_char' || raw === 'before_character' || raw === 'before_character_definition' || raw === '0') return 'before_character_definition';
    if (raw === 'after_char' || raw === 'after_character' || raw === 'after_character_definition' || raw === '1') return 'after_character_definition';
    return fallback;
}

export function normalizePlacementConfig_ACU(rawPlacement: any, fallbackPlacement: any) {
    const fallback = fallbackPlacement || DEFAULT_ENTRY_PLACEMENT_ACU;
    const source = (rawPlacement && typeof rawPlacement === 'object') ? rawPlacement : {};
    const depthRaw = parseInt(source.depth, 10);
    const orderRaw = parseInt(source.order, 10);
    return {
        position: normalizeLorebookPosition_ACU(source.position, fallback.position),
        depth: Number.isFinite(depthRaw) ? depthRaw : fallback.depth,
        order: Number.isFinite(orderRaw) ? orderRaw : fallback.order,
    };
}

export function isSummaryTableName_ACU(name: string) {
    return String(name || '').trim() === '总结表';
}

export function isOutlineTableName_ACU(name: string) {
    return String(name || '').trim() === '总体大纲';
}

export function isImportantPersonsTableName_ACU(name: string) {
    return String(name || '').trim() === '重要人物表';
}

function isGlobalDataTableName_ACU(name: string) {
    const n = String(name || '').trim();
    return n === '全局数据表' || n === '全局表';
}

export function getFixedPlacementDefaultsForTable_ACU(tableName: string) {
    const name = String(tableName || '').trim();
    if (isSummaryTableName_ACU(name)) {
        return {
            entry: { position: 'at_depth_as_system', depth: 9999, order: 99987 },
            index: { position: 'at_depth_as_system', depth: 9999, order: 99988 },
        };
    }
    if (isOutlineTableName_ACU(name)) {
        return {
            entry: { position: 'at_depth_as_system', depth: 9998, order: 99985 },
            index: { position: 'at_depth_as_system', depth: 9998, order: 99986 },
        };
    }
    if (isImportantPersonsTableName_ACU(name)) {
        return {
            entry: { position: 'at_depth_as_system', depth: 10000, order: 99983 },
            index: { position: 'at_depth_as_system', depth: 10000, order: 99984 },
        };
    }
    if (isGlobalDataTableName_ACU(name)) {
        return {
            // [修复] 使用 API 期望的正确值 before_character_definition
            entry: { position: 'before_character_definition', depth: 2, order: 99981 },
            index: { position: 'before_character_definition', depth: 2, order: 99982 },
        };
    }
    return {
        entry: { ...DEFAULT_FIXED_PLACEMENT_ACU },
        index: { ...DEFAULT_FIXED_INDEX_PLACEMENT_ACU },
    };
}

export function buildDefaultExportConfig_ACU(tableName = '') {
    const fixedDefaults = getFixedPlacementDefaultsForTable_ACU(tableName);
    return {
        enabled: false,
        splitByRow: false,
        entryName: tableName || '',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: `${tableName || '表格'}-索引`,
        extraIndexColumns: [] as string[],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        sqlInjectionTemplate: '',
        entryPlacement: { ...DEFAULT_ENTRY_PLACEMENT_ACU },
        extraIndexPlacement: { ...DEFAULT_EXTRA_INDEX_PLACEMENT_ACU },
        fixedEntryPlacement: { ...fixedDefaults.entry },
        fixedIndexPlacement: { ...fixedDefaults.index },
    };
}

export function buildDefaultGlobalInjectionConfig_ACU() {
    return {
        // [修复] 使用 API 期望的正确值 before_character_definition
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
    };
}

export function ensureGlobalInjectionConfigDefaults_ACU(rawConfig: any) {
    const base = buildDefaultGlobalInjectionConfig_ACU();
    const raw = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    return {
        readableEntryPlacement: normalizePlacementConfig_ACU(raw.readableEntryPlacement, base.readableEntryPlacement),
        wrapperPlacement: normalizePlacementConfig_ACU(raw.wrapperPlacement, base.wrapperPlacement),
    };
}

export function getGlobalInjectionConfigFromData_ACU(dataObj: any, { ensureWriteBack = false } = {}) {
    const defaults = buildDefaultGlobalInjectionConfig_ACU();
    const cfg = ensureGlobalInjectionConfigDefaults_ACU(dataObj?.mate?.globalInjectionConfig);
    if (ensureWriteBack && dataObj && typeof dataObj === 'object') {
        if (!dataObj.mate || typeof dataObj.mate !== 'object') dataObj.mate = { type: 'chatSheets', version: 1 };
        dataObj.mate.globalInjectionConfig = cfg;
        if (!dataObj.mate.type) dataObj.mate.type = 'chatSheets';
        if (!Number.isFinite(dataObj.mate.version)) dataObj.mate.version = 1;
    }
    return {
        readableEntryPlacement: normalizePlacementConfig_ACU(cfg.readableEntryPlacement, defaults.readableEntryPlacement),
        wrapperPlacement: normalizePlacementConfig_ACU(cfg.wrapperPlacement, defaults.wrapperPlacement),
    };
}

export function ensureExportConfigDefaults_ACU(exportConfig: any, tableName = '') {
    const base = buildDefaultExportConfig_ACU(tableName);
    const raw = (exportConfig && typeof exportConfig === 'object') ? exportConfig : {};
    const merged = { ...base, ...raw };
    merged.entryPlacement = normalizePlacementConfig_ACU(raw.entryPlacement, base.entryPlacement);
    merged.extraIndexPlacement = normalizePlacementConfig_ACU(raw.extraIndexPlacement, base.extraIndexPlacement);
    merged.fixedEntryPlacement = normalizePlacementConfig_ACU(raw.fixedEntryPlacement, base.fixedEntryPlacement);
    merged.fixedIndexPlacement = normalizePlacementConfig_ACU(raw.fixedIndexPlacement, base.fixedIndexPlacement);
    return merged;
}

export function ensureSheetExportConfigDefaults_ACU(sheet: any) {
    if (!sheet || typeof sheet !== 'object') return buildDefaultExportConfig_ACU('');
    sheet.exportConfig = ensureExportConfigDefaults_ACU(sheet.exportConfig, sheet.name || sheet.uid || '');
    return sheet.exportConfig;
}

export function applyPlacementToEntry_ACU(entry: any, placement: any) {
    if (!entry || typeof entry !== 'object') return entry;
    const p = normalizePlacementConfig_ACU(placement, DEFAULT_ENTRY_PLACEMENT_ACU);
    const out = { ...entry, position: p.position };
    if (p.position === 'at_depth_as_system') {
        out.depth = p.depth;
    } else {
        delete out.depth;
    }
    return out;
}

export function isEntryPlacementMatched_ACU(entry: any, placement: any) {
    const p = normalizePlacementConfig_ACU(placement, DEFAULT_ENTRY_PLACEMENT_ACU);
    const ep = normalizeLorebookPosition_ACU(entry?.position, p.position);
    if (ep !== p.position) return false;
    if (p.position === 'at_depth_as_system') {
        const d = typeof entry?.depth === 'number' ? entry.depth : parseInt(String(entry?.depth ?? ''), 10);
        return Number.isFinite(d) && d === p.depth;
    }
    return true;
}
