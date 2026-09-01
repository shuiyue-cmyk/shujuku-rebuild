/**
 * shared/runtime-env.ts — 运行时环境检测
 *
 * 检测当前脚本运行在哪种环境中：
 * - 油猴脚本模式（Userscript）：运行在酒馆助手创建的 iframe 中，window.parent 指向酒馆主窗口
 * - 酒馆插件模式（Extension）：运行在酒馆主窗口中，window 就是酒馆主窗口
 *
 * 所有需要区分环境的代码都应通过此模块的函数来判断，而非自行检测。
 */

/** 互斥检测全局标记键名 */
export const ACU_INSTANCE_FLAG = '__ACU_STAR_DB_III_LOADED__';

/**
 * 运行模式枚举
 */
export const enum RuntimeMode {
    /** 油猴脚本模式：运行在 iframe 中 */
    Userscript = 'userscript',
    /** 酒馆插件模式：运行在主窗口中 */
    Extension = 'extension',
}

/** 缓存检测结果，避免重复计算 */
let _cachedMode: RuntimeMode | null = null;

/**
 * 由插件入口在启动时调用，强制设置为插件模式。
 * 必须在任何其他模块访问 runtime-env 之前调用。
 */
export function _forceExtensionMode(): void {
    _cachedMode = RuntimeMode.Extension;
}

/**
 * 检测当前运行模式。
 *
 * 检测逻辑：
 * 1. 如果已被 _forceExtensionMode() 强制设置，直接返回 Extension
 * 2. 如果 window !== window.parent 且 window.parent 可访问，说明在 iframe 中 → Userscript
 * 3. 否则 → Extension（主窗口环境）
 */
export function detectRuntimeMode(): RuntimeMode {
    if (_cachedMode !== null) return _cachedMode;

    try {
        // 如果 window.parent 存在且不等于 window，说明在 iframe 中
        if (typeof window.parent !== 'undefined' && window.parent !== window) {
            // 尝试访问 parent 的属性，确认不是跨域 iframe
            void window.parent.document;
            _cachedMode = RuntimeMode.Userscript;
        } else {
            _cachedMode = RuntimeMode.Extension;
        }
    } catch (e) {
        // 跨域 iframe 访问 parent.document 会抛错，这种情况不太可能出现在酒馆环境
        // 保守地认为是油猴脚本模式
        _cachedMode = RuntimeMode.Userscript;
    }

    return _cachedMode;
}

/** 是否为油猴脚本模式 */
export function isUserscriptMode(): boolean {
    return detectRuntimeMode() === RuntimeMode.Userscript;
}

/** 是否为酒馆插件模式 */
export function isExtensionMode(): boolean {
    return detectRuntimeMode() === RuntimeMode.Extension;
}

/**
 * 获取酒馆主窗口引用。
 *
 * - 油猴脚本模式：返回 window.parent（酒馆主窗口）
 * - 插件模式：返回 window（自身就是主窗口）
 */
export function getHostWindow(): Window {
    if (typeof window === 'undefined') {
        return globalThis as any as Window;
    }
    if (isUserscriptMode()) {
        try {
            return window.parent || window;
        } catch (e) {
            return window;
        }
    }
    return window;
}

/**
 * 检查是否已有另一个实例在运行（互斥检测）。
 * 如果已有实例，返回 true（应跳过初始化）。
 * 如果没有，标记当前实例并返回 false。
 *
 * [M2] 接管判定：命中已有标记时，检测旧实例的 V2 UI DOM 根（#acu-app-v2）是否仍存在于
 * 宿主文档中——扩展「禁用再启用」等场景下旧实例已被卸载（其挂载的 UI 根随之移除），
 * 但 window 上的布尔标记只写不清会永久占位；此时视为旧实例已死，允许新实例接管并 logWarn 说明。
 * 旧实例 DOM 根仍在则认为它确实在运行，维持拦截。
 */
export function checkAndMarkInstance(): boolean {
    const hostWin = getHostWindow() as any;
    if (hostWin[ACU_INSTANCE_FLAG]) {
        if (!isPreviousInstanceDomRootAlive()) {
            console.warn('[TTonly·数据库] 检测到历史实例标记，但其 UI 根节点(#acu-app-v2)已不在文档中，判定旧实例已卸载，允许本实例接管。');
            hostWin[ACU_INSTANCE_FLAG] = true;
            return false;
        }
        console.warn('[TTonly·数据库] 检测到另一个实例已在运行，跳过初始化。请勿同时安装油猴脚本和酒馆插件。');
        return true; // 已有实例
    }
    hostWin[ACU_INSTANCE_FLAG] = true;
    return false; // 首个实例
}

/**
 * [M2] 旧实例 DOM 根是否仍存活：在宿主窗口文档里找 #acu-app-v2（presentation-v2 的应用根 id，
 * 与 presentation-v2/bootstrap/mount.ts、theme/theme-injector.ts 的 APP_ROOT_ID 保持一致）。
 * 探测失败（跨域等）一律按「仍在」处理，保守维持拦截。
 */
function isPreviousInstanceDomRootAlive(): boolean {
    try {
        const doc = (getHostWindow() as any)?.document;
        if (!doc) return true; // 无法探测时保守视为仍在
        return !!doc.getElementById('acu-app-v2');
    } catch (e) {
        return true; // 探测异常时保守视为仍在
    }
}

/**
 * [M5] 释放互斥标记。仅供启动早期（waitForHostApi 超时中止、尚未做任何实质初始化）
 * 回滚 checkAndMarkInstance 的置位使用，避免超时后标记永久占位拦死后续启动。
 */
export function releaseInstanceMark(): void {
    const hostWin = getHostWindow() as any;
    try {
        delete hostWin[ACU_INSTANCE_FLAG];
    } catch (e) {
        hostWin[ACU_INSTANCE_FLAG] = false;
    }
}
