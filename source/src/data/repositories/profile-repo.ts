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

export let globalMeta_ACU: any = buildDefaultGlobalMeta_ACU();

export function buildDefaultGlobalMeta_ACU(): any {
    return {
        version: 1,
        activeIsolationCode: '',
        isolationCodeList: [],
        migratedLegacySingleStore: false,
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
        const payload = safeJsonStringify_ACU(globalMeta_ACU);
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
    if (parsed && typeof parsed === 'object') return parsed;
    // [H1] 原始串存在但解析失败：先把原串备份到旁路键，再返回 null 走默认值分支。
    // 否则后续加载期默认配置补齐会覆盖写回同一分桶键，且无任何备份，配置永久丢失。
    backupProfileSettingsRawBeforeDegradation_ACU(code, 'json_parse_failed');
    return null;
}

/** [H1] Profile 设置原始串旁路备份键（仅降级路径写入，正常保存路径不写备份以避免写放大） */
export function getProfileSettingsBackupKey_ACU(code: string): string {
    return `${getProfileSettingsKey_ACU(code)}.bak`;
}

/**
 * [H1] 配置损坏防丢备份：把当前 profile settings 的原始存储串复制到旁路 .bak 键。
 * 仅在「原串存在但解析失败 / 加载处理异常」、即将降级为默认配置并可能覆盖写回同一分桶键之前调用；
 * 内容相同时跳过重复写（避免每次重载都触发持久化）。不做自动恢复 UI，加载成功时忽略 .bak。
 */
export function backupProfileSettingsRawBeforeDegradation_ACU(code: string, reason: string): void {
    try {
        const store = getConfigStorage_ACU();
        const key = getProfileSettingsKey_ACU(code);
        const raw = store?.getItem?.(key);
        if (typeof raw !== 'string' || !raw.trim()) return;
        const backupKey = getProfileSettingsBackupKey_ACU(code);
        if (store.getItem(backupKey) === raw) return;
        store.setItem(backupKey, raw);
        logWarn_ACU(`[Profile] 设置数据无法可信读取（${reason}），已把原始内容备份到旁路键后再降级默认配置：${backupKey}`);
    } catch (e) {
        logWarn_ACU('[Profile] 设置原始串旁路备份失败（继续按默认配置降级）:', e);
    }
}

export function writeProfileSettingsToStorage_ACU(code: string, settingsObj: any): void {
    const store = getConfigStorage_ACU();
    store.setItem(getProfileSettingsKey_ACU(code), safeJsonStringify_ACU(settingsObj));
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
    const cloned = safeJsonParse_ACU(safeJsonStringify_ACU(settingsObj), {});
    delete cloned.dataIsolationHistory;
    delete cloned.dataIsolationEnabled;
    // 交火/向量模型 API 配置是全局配置，权威副本存放在 globalMeta.vectorMemoryConfigGlobal。
    // profile payload 中继续保存会导致切换隔离标识后旧值反向污染全局配置。
    delete cloned.vectorMemoryConfig;
    return cloned;
}
