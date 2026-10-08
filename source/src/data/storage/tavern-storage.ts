/**
 * 酒馆设置存储桥接（Tavern Settings Bridge）
 *
 * 负责在 SillyTavern 的 extensionSettings 中读写脚本设置。
 */

import { topLevelWindow_ACU, FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU, ALLOW_LEGACY_LOCALSTORAGE_MIGRATION_ACU, legacyLocalStorage_ACU, storage_ACU } from '../../shared/env';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';

// ── 常量 ──
import { idbRequestToPromise_ACU, isIndexedDbAvailable_ACU } from '../../shared/idb-import-temp';

export const USE_TAVERN_SETTINGS_STORAGE_ACU = true;
// 命名空间与下方 __userscripts 容器名沿用历史（油猴时代）键名：这是用户已落盘设置的存储位置，不能改。
export const TAVERN_SETTINGS_NAMESPACE_ACU = `${SCRIPT_ID_PREFIX_ACU}__userscript_settings_v1`;
export let tavernSaveSettingsFn_ACU: any = null;
export let tavernExtensionSettingsRoot_ACU: any = null;
/** 是否已报告过「根对象不可用」（防止重复刷屏） */
let tavernRootUnavailableWarnReported_ACU = false;

// ── 初始化 ──
// 只有酒馆插件一种运行形态（入口恒为插件模式，R1-06 已删除油猴 iframe 桥接的死代码）。
// 插件运行在酒馆主窗口中。主窗口的 window.SillyTavern 只有 {libs, getContext}，
// 所有真正的 API 都必须通过 SillyTavern.getContext() 这个函数调用来获取。
// 酒馆源码证实：extensionSettings 和 saveSettingsDebounced 都在 getContext() 返回值中。
export async function initTavernSettingsBridge_ACU(): Promise<boolean> {
    if (!USE_TAVERN_SETTINGS_STORAGE_ACU) return false;
    logDebug_ACU('[TavernStorage] 通过 SillyTavern.getContext() 获取设置对象...');

    try {
        const st = (window as any).SillyTavern;
        if (st && typeof st.getContext === 'function') {
            const ctx = st.getContext();
            if (ctx) {
                if (ctx.extensionSettings) {
                    tavernExtensionSettingsRoot_ACU = ctx.extensionSettings;
                    logDebug_ACU('[TavernStorage] extensionSettings 获取成功');
                } else {
                    logWarn_ACU('[TavernStorage] getContext().extensionSettings 为空');
                }
                if (typeof ctx.saveSettingsDebounced === 'function') {
                    tavernSaveSettingsFn_ACU = ctx.saveSettingsDebounced;
                    logDebug_ACU('[TavernStorage] saveSettingsDebounced 获取成功');
                } else {
                    logWarn_ACU('[TavernStorage] getContext().saveSettingsDebounced 不是函数');
                }
            } else {
                logWarn_ACU('[TavernStorage] getContext() 返回空值');
            }
        } else {
            logWarn_ACU('[TavernStorage] SillyTavern.getContext 不可用');
        }
    } catch (e) {
        logError_ACU('[TavernStorage] 调用 getContext() 失败:', e);
    }

    logDebug_ACU(`[TavernStorage] 初始化完成: settings=${!!tavernExtensionSettingsRoot_ACU}, save=${!!tavernSaveSettingsFn_ACU}`);
    return !!tavernExtensionSettingsRoot_ACU;
}

export function getTavernSettingsNamespace_ACU(): any {
    const root = tavernExtensionSettingsRoot_ACU;
    if (!root) {
        // 扩展加载时 extensionSettings 已就绪；未拿到则告警一次，调用方走 IndexedDB/localStorage 回退。
        if (!tavernRootUnavailableWarnReported_ACU) {
            tavernRootUnavailableWarnReported_ACU = true;
            logWarn_ACU('[TavernStorage] 酒馆设置根对象不可用, 返回 null');
        }
        return null;
    }
    // root 可用 → 如果之前标记过不可用，清除标记以便后续状态变化能重新报告
    if (tavernRootUnavailableWarnReported_ACU) {
        tavernRootUnavailableWarnReported_ACU = false;
        logDebug_ACU('[TavernStorage] 酒馆设置根对象已恢复可用');
    }
    if (!root.__userscripts) root.__userscripts = {};
    if (!root.__userscripts[TAVERN_SETTINGS_NAMESPACE_ACU]) root.__userscripts[TAVERN_SETTINGS_NAMESPACE_ACU] = {};
    return root.__userscripts[TAVERN_SETTINGS_NAMESPACE_ACU];
}

export type TavernSettingsPersistStatus_ACU = 'saved' | 'memory' | 'failed';

/**
 * 触发酒馆设置保存。同步宿主函数明确返回 false 或抛错时返回 failed；
 * 没有宿主保存函数时保留内存值但返回 memory，调用方不得把它当成已落盘。
 * 宿主异步 debounce 的 Promise 不能同步确认，按已调度保存处理。
 */
export function persistTavernSettings_ACU(): TavernSettingsPersistStatus_ACU {
    try {
        const hostWindow = typeof window !== 'undefined' ? (window as any) : null;
        if (typeof tavernSaveSettingsFn_ACU === 'function') {
            return tavernSaveSettingsFn_ACU() === false ? 'failed' : 'saved';
        }
        if (typeof (topLevelWindow_ACU as any).saveSettingsDebounced === 'function') {
            return (topLevelWindow_ACU as any).saveSettingsDebounced() === false ? 'failed' : 'saved';
        }
        if (typeof hostWindow?.saveSettingsDebounced === 'function') {
            return hostWindow.saveSettingsDebounced() === false ? 'failed' : 'saved';
        }
        if (typeof (topLevelWindow_ACU as any).saveSettings === 'function') {
            return (topLevelWindow_ACU as any).saveSettings() === false ? 'failed' : 'saved';
        }
        if (typeof hostWindow?.saveSettings === 'function') {
            return hostWindow.saveSettings() === false ? 'failed' : 'saved';
        }
        logWarn_ACU('[TavernStorage] 找不到任何可用的 saveSettings 函数');
        return 'memory';
    } catch (e) {
        logWarn_ACU('[TavernStorage] 持久化到酒馆设置失败, 回退到内存模式:', e);
        return 'failed';
    }
}

// ── IndexedDB 配置缓存 ──
export const CONFIG_IDB_DB_NAME_ACU = `${SCRIPT_ID_PREFIX_ACU}_config_v1`;
export const CONFIG_IDB_STORE_NAME_ACU = 'kv';
export let configIdbPromise_ACU: Promise<any> | null = null;
export const configIdbCache_ACU = new Map<string, any>();
export const configIdbDeletedKeys_ACU = new Set<string>();
let lastConfigPersistenceStatus_ACU: TavernSettingsPersistStatus_ACU | 'other' = 'other';
export let configIdbCacheLoaded_ACU = false;
export let configIdbCacheLoadingPromise_ACU: Promise<void> | null = null;
export let configIdbCacheLoadFailed_ACU = false;
export let pendingSettingsReloadFromIdb_ACU = false;

export function openConfigDb_ACU(): Promise<any> {
    if (!isIndexedDbAvailable_ACU()) return Promise.resolve(null);
    if (configIdbPromise_ACU) return configIdbPromise_ACU;
    configIdbPromise_ACU = new Promise((resolve, reject) => {
        try {
            const req = (topLevelWindow_ACU as any).indexedDB.open(CONFIG_IDB_DB_NAME_ACU, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(CONFIG_IDB_STORE_NAME_ACU)) {
                    db.createObjectStore(CONFIG_IDB_STORE_NAME_ACU);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        } catch (e) {
            reject(e);
        }
    });
    return configIdbPromise_ACU;
}

export function loadConfigIdbCache_ACU(): Promise<void> {
    if (configIdbCacheLoaded_ACU || configIdbCacheLoadFailed_ACU) return Promise.resolve();
    if (configIdbCacheLoadingPromise_ACU) return configIdbCacheLoadingPromise_ACU;
    if (!isIndexedDbAvailable_ACU()) {
        configIdbCacheLoaded_ACU = true;
        return Promise.resolve();
    }
    // R1-07：不用 new Promise(async …)——执行器里的异常不会进 reject；改为 async IIFE，游标遍历单独包一层 Promise。
    const markLoadFailed = (error: unknown) => {
        logWarn_ACU('[TavernStorage] IndexedDB 配置缓存加载失败:', error);
        configIdbCacheLoadFailed_ACU = true;
        configIdbCacheLoaded_ACU = true;
    };
    configIdbCacheLoadingPromise_ACU = (async () => {
        try {
            const db = await openConfigDb_ACU();
            if (!db) {
                configIdbCacheLoaded_ACU = true;
                return;
            }
            await new Promise<void>((resolve) => {
                const tx = db.transaction(CONFIG_IDB_STORE_NAME_ACU, 'readonly');
                const store = tx.objectStore(CONFIG_IDB_STORE_NAME_ACU);
                const req = store.openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (cursor) {
                        const key = cursor.key as string;
                        if (!configIdbDeletedKeys_ACU.has(key) && !configIdbCache_ACU.has(key)) {
                            configIdbCache_ACU.set(key, cursor.value);
                        }
                        cursor.continue();
                    } else {
                        configIdbCacheLoaded_ACU = true;
                        resolve();
                    }
                };
                req.onerror = () => {
                    markLoadFailed(req.error);
                    resolve();
                };
            });
        } catch (e) {
            markLoadFailed(e);
        }
    })();
    return configIdbCacheLoadingPromise_ACU;
}

export function ensureConfigIdbCacheLoaded_ACU(): Promise<void> {
    return loadConfigIdbCache_ACU();
}

export function configIdbGetCached_ACU(key: string): any {
    return configIdbCache_ACU.has(key) ? configIdbCache_ACU.get(key) : null;
}

export async function configIdbSetCached_ACU(key: string, value: any): Promise<void> {
    configIdbCache_ACU.set(key, value);
    configIdbDeletedKeys_ACU.delete(key);
    try {
        if (!isIndexedDbAvailable_ACU()) return;
        const db = await openConfigDb_ACU();
        if (!db) return;
        const tx = db.transaction(CONFIG_IDB_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(CONFIG_IDB_STORE_NAME_ACU);
        await idbRequestToPromise_ACU(store.put(value, key));
    } catch (e) {
        logWarn_ACU('[TavernStorage] IndexedDB 配置 set 失败:', e);
    }
}

export async function configIdbRemoveCached_ACU(key: string): Promise<void> {
    configIdbCache_ACU.delete(key);
    configIdbDeletedKeys_ACU.add(key);
    try {
        if (!isIndexedDbAvailable_ACU()) return;
        const db = await openConfigDb_ACU();
        if (!db) return;
        const tx = db.transaction(CONFIG_IDB_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(CONFIG_IDB_STORE_NAME_ACU);
        await idbRequestToPromise_ACU(store.delete(key));
    } catch (e) {
        logWarn_ACU('[TavernStorage] IndexedDB 配置 delete 失败:', e);
    }
}

export function getConfigStorage_ACU(): any {
    const ns = USE_TAVERN_SETTINGS_STORAGE_ACU ? getTavernSettingsNamespace_ACU() : null;
    const hasTavern = !!ns;
    return {
        getItem: (key: string) => {
            if (hasTavern && Object.prototype.hasOwnProperty.call(ns, key)) return ns[key];
            const cached = configIdbGetCached_ACU(key);
            if (cached !== null && typeof cached !== 'undefined') return cached;
            if (!FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU && storage_ACU?.getItem) return storage_ACU.getItem(key);
            return null;
        },
        setItem: (key: string, value: any): boolean => {
            const v = String(value);
            if (!hasTavern) lastConfigPersistenceStatus_ACU = 'other';
            let status: TavernSettingsPersistStatus_ACU = 'saved';
            const hadPrevious = hasTavern && Object.prototype.hasOwnProperty.call(ns, key);
            const previous = hadPrevious ? ns[key] : undefined;
            if (hasTavern) {
                ns[key] = v;
                status = persistTavernSettings_ACU();
                lastConfigPersistenceStatus_ACU = status;
                if (status === 'failed') {
                    if (hadPrevious) ns[key] = previous;
                    else delete ns[key];
                }
            } else if (!FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU && storage_ACU?.setItem) {
                storage_ACU.setItem(key, v);
            }
            if (hasTavern && status === 'failed') {
                if (hadPrevious) void configIdbSetCached_ACU(key, previous);
                else void configIdbRemoveCached_ACU(key);
            } else {
                void configIdbSetCached_ACU(key, v);
            }
            return !hasTavern || status !== 'failed';
        },
        removeItem: (key: string): boolean => {
            if (!hasTavern) lastConfigPersistenceStatus_ACU = 'other';
            let status: TavernSettingsPersistStatus_ACU = 'saved';
            const hadPrevious = hasTavern && Object.prototype.hasOwnProperty.call(ns, key);
            const previous = hadPrevious ? ns[key] : undefined;
            if (hasTavern) {
                delete ns[key];
                status = persistTavernSettings_ACU();
                lastConfigPersistenceStatus_ACU = status;
                if (status === 'failed' && hadPrevious) ns[key] = previous;
            } else if (!FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU && storage_ACU?.removeItem) {
                storage_ACU.removeItem(key);
            }
            if (hasTavern && status === 'failed') {
                if (hadPrevious) void configIdbSetCached_ACU(key, previous);
            } else {
                void configIdbRemoveCached_ACU(key);
            }
            return !hasTavern || status !== 'failed';
        },
        _isTavern: hasTavern,
        get _lastPersistenceStatus() {
            return lastConfigPersistenceStatus_ACU;
        },
    };
}

export function migrateKeyToTavernStorageIfNeeded_ACU(key: string): boolean {
    const store = getConfigStorage_ACU();
    if (!store || !store._isTavern) return false;
    const cur = store.getItem(key);
    if (cur !== null && typeof cur !== 'undefined') return false;
    if (!ALLOW_LEGACY_LOCALSTORAGE_MIGRATION_ACU || !legacyLocalStorage_ACU) return false;
    const legacy = legacyLocalStorage_ACU.getItem(key);
    if (legacy !== null && typeof legacy !== 'undefined') {
        store.setItem(key, legacy);
        try { legacyLocalStorage_ACU.removeItem(key); } catch (e) { /* ignore */ }
        return true;
    }
    return false;
}

export function _set_pendingSettingsReloadFromIdb_ACU(v: any) { pendingSettingsReloadFromIdb_ACU = v; }

/** 测试用：重置模块级状态变量 */
export function _resetTavernStorageState_ACU(): void {
    tavernExtensionSettingsRoot_ACU = null;
    tavernSaveSettingsFn_ACU = null;
    lastConfigPersistenceStatus_ACU = 'other';
    tavernRootUnavailableWarnReported_ACU = false;
}