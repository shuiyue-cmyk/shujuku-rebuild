/**
 * data/storage/optimization-cache-storage.ts — 正文优化基础缓存存储适配器
 *
 * 封装正文优化的浏览器侧缓存操作（window 对象 + localStorage 两层）。
 * 这是运行时缓存，不是持久化数据，丢失不影响功能正确性。
 *
 * 写入顺序：window 对象 → localStorage
 * 读取优先级：window 对象 → localStorage（与原 service 层逻辑一致）
 */

import { topLevelWindow_ACU } from '../../shared/env';
import { logDebug_ACU } from '../../shared/utils';

const WINDOW_CACHE_KEY = '__ACU_LAST_OPTIMIZATION_BASE__';
const LOCAL_STORAGE_KEY = 'ACU_LAST_OPTIMIZATION_BASE';

/**
 * 将正文优化基础缓存写入浏览器侧存储（window + localStorage）
 * @param cache 要缓存的数据对象
 */
export function saveOptimizationBaseToCache_ACU(cache: unknown): void {
    // 第一层：写入 window 对象（跨 iframe 可访问）
    try {
        const targetWindow = topLevelWindow_ACU || window;
        (targetWindow as any)[WINDOW_CACHE_KEY] = cache;
    } catch (error) {
        logDebug_ACU('[正文优化] 写入浏览器侧正文优化基础缓存失败（window）:', error);
    }

    // 第二层：写入 localStorage（持久化到浏览器）
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cache));
    } catch (error) {
        logDebug_ACU('[正文优化] 写入浏览器侧正文优化基础缓存失败（localStorage）:', error);
    }
}

/**
 * 从浏览器侧存储读取正文优化基础缓存
 * 优先级：window 对象 → localStorage
 * @returns 缓存数据对象，不存在或解析失败返回 null
 */
export function loadOptimizationBaseFromCache_ACU(): any | null {
    // 第一层：尝试从 window 对象读取
    try {
        const targetWindow = topLevelWindow_ACU || window;
        const windowCache = (targetWindow as any)[WINDOW_CACHE_KEY];
        if (windowCache?.baseContent) {
            return windowCache;
        }
    } catch (error) {
        logDebug_ACU('[正文优化] 读取浏览器侧正文优化基础缓存失败（window）:', error);
    }

    // 第二层：尝试从 localStorage 读取
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.baseContent) {
                return parsed;
            }
        }
    } catch (error) {
        logDebug_ACU('[正文优化] 读取浏览器侧正文优化基础缓存失败（localStorage）:', error);
    }

    return null;
}
