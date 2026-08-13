/**
 * shared/env.ts — 运行时环境检测与存储策略
 *
 * 从 src/core/01_header_and_env.js 迁移而来。
 * 提供顶层窗口引用、存储策略常量和 NO-OP 存储后端。
 */

import { getHostWindow } from './runtime-env';

/** 顶层窗口引用（油猴模式下为 window.parent，插件模式下为 window） */

export const topLevelWindow_ACU = getHostWindow();

/** 是否禁止使用浏览器 localStorage/sessionStorage 存储配置 */
export const FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU = true;

/** 是否允许从旧 localStorage 迁移设置到酒馆设置（迁移后仍不再写 localStorage） */
export const ALLOW_LEGACY_LOCALSTORAGE_MIGRATION_ACU = false;

/** 仅用于"可选迁移"读取旧 localStorage，不是配置持久化后端 */
export let legacyLocalStorage_ACU: Storage | null = null;
try { legacyLocalStorage_ACU = topLevelWindow_ACU.localStorage; } catch (e) { legacyLocalStorage_ACU = null; }

/**
 * storage_ACU：旧代码里大量把它当作"配置存储"。
 * 现在默认是一个 NO-OP 存储，避免任何本地持久化。
 * 真实持久化后端请走 getConfigStorage_ACU()。
 */
export let storage_ACU: Storage | { getItem: () => null; setItem: () => void; removeItem: () => void } = {
    getItem: (): null => null,
    setItem: (): void => {},
    removeItem: (): void => {}
};

if (!FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU) {
    try {
        storage_ACU = topLevelWindow_ACU.localStorage;
    } catch (e) {
        console.error('[AutoCardUpdater] localStorage is not available. Settings will not be saved.', e);
        storage_ACU = { getItem: (): null => null, setItem: (): void => {}, removeItem: (): void => {} };
    }
}
