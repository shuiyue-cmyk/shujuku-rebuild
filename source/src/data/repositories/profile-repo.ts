/**
 * Profile 与 GlobalMeta 管理
 *
 * 全局元信息（跨标识共享）+ Profile 化存储（按标识代码分组的设置/模板）
 */

import { safeJsonParse_ACU, safeJsonStringify_ACU } from '../../shared/json-helpers';
import { logWarn_ACU } from '../../shared/utils';
import { STORAGE_KEY_GLOBAL_META_ACU, normalizeIsolationCode_ACU, getProfileSettingsKey_ACU, getProfileTemplateKey_ACU } from '../../shared/data-constants';
import { getConfigStorage_ACU } from '../storage/tavern-storage';
import { TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';

export let globalMeta_ACU: any = {
    version: 1,
    activeIsolationCode: '',
    isolationCodeList: [] as string[],
    migratedLegacySingleStore: false,
    zeroTkOccupyModeGlobal: false,
    summaryVectorIndexModeGlobal: false,
    plotEnabledGlobal: true,
    vectorMemoryConfigGlobal: null,
};

export function buildDefaultGlobalMeta_ACU(): any {
    return {
        version: 1,
        activeIsolationCode: '',
        isolationCodeList: [],
        migratedLegacySingleStore: false,
        zeroTkOccupyModeGlobal: false,
        summaryVectorIndexModeGlobal: false,
        plotEnabledGlobal: true,
        vectorMemoryConfigGlobal: null,
    };
}

export function loadGlobalMeta_ACU(): any {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(STORAGE_KEY_GLOBAL_META_ACU);
    if (!raw) {
        globalMeta_ACU = buildDefaultGlobalMeta_ACU();
        return globalMeta_ACU;
    }
    const parsed = safeJsonParse_ACU(raw, null);
    if (!parsed || typeof parsed !== 'object') {
        globalMeta_ACU = buildDefaultGlobalMeta_ACU();
        return globalMeta_ACU;
    }
    globalMeta_ACU = { ...buildDefaultGlobalMeta_ACU(), ...parsed };
    globalMeta_ACU.activeIsolationCode = normalizeIsolationCode_ACU(globalMeta_ACU.activeIsolationCode);
    if (!Array.isArray(globalMeta_ACU.isolationCodeList)) globalMeta_ACU.isolationCodeList = [];
    return globalMeta_ACU;
}

export function saveGlobalMeta_ACU(): boolean {
    try {
        const store = getConfigStorage_ACU();
        const payload = safeJsonStringify_ACU(globalMeta_ACU, '{}');
        store.setItem(STORAGE_KEY_GLOBAL_META_ACU, payload);
        return true;
    } catch (e) {
        logWarn_ACU('[GlobalMeta] Failed to save:', e);
        return false;
    }
}

export function readProfileSettingsFromStorage_ACU(code: string): any {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(getProfileSettingsKey_ACU(code));
    if (!raw) return null;
    const parsed = safeJsonParse_ACU(raw, null);
    return (parsed && typeof parsed === 'object') ? parsed : null;
}

export function writeProfileSettingsToStorage_ACU(code: string, settingsObj: any): void {
    const store = getConfigStorage_ACU();
    store.setItem(getProfileSettingsKey_ACU(code), safeJsonStringify_ACU(settingsObj, '{}'));
}

export function readProfileTemplateFromStorage_ACU(code: string): string | null {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(getProfileTemplateKey_ACU(code));
    return (typeof raw === 'string' && raw.trim()) ? raw : null;
}

export function writeProfileTemplateToStorage_ACU(code: string, templateStr: string): void {
    const store = getConfigStorage_ACU();
    store.setItem(getProfileTemplateKey_ACU(code), String(templateStr || ''));
}

export function saveCurrentProfileTemplate_ACU(templateStr?: string, settings?: any): void {
    const tpl = templateStr !== undefined ? templateStr : TABLE_TEMPLATE_ACU;
    const code = normalizeIsolationCode_ACU(settings?.dataIsolationCode || '');
    writeProfileTemplateToStorage_ACU(code, String(tpl || ''));
}

export function sanitizeSettingsForProfileSave_ACU(settingsObj: any): any {
    const cloned = safeJsonParse_ACU(safeJsonStringify_ACU(settingsObj, '{}'), {});
    delete cloned.dataIsolationHistory;
    delete cloned.dataIsolationEnabled;
    // 交火/向量模型 API 配置是全局配置，权威副本存放在 globalMeta.vectorMemoryConfigGlobal。
    // profile payload 中继续保存会导致切换隔离标识后旧值反向污染全局配置。
    delete cloned.vectorMemoryConfig;
    return cloned;
}
