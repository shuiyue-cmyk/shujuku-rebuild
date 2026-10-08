/**
 * shared/runtime-env.ts — 运行时环境
 *
 * 本项目只以酒馆插件形态运行（入口在酒馆主窗口中加载）。早期的油猴脚本（iframe）形态
 * 已移除（R1-06）：其模式探测与各处分支都是永不执行的死代码。
 */

/** 互斥检测全局标记键名 */
export const ACU_INSTANCE_FLAG = '__ACU_STAR_DB_III_LOADED__';

/** 获取酒馆主窗口引用：插件运行在主窗口中，即 window 自身。 */
export function getHostWindow(): Window {
    if (typeof window === 'undefined') {
        return globalThis as any as Window;
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
            console.warn('[UnbirthDB] 检测到历史实例标记，但其 UI 根节点(#acu-app-v2)已不在文档中，判定旧实例已卸载，允许本实例接管。');
            hostWin[ACU_INSTANCE_FLAG] = true;
            return false;
        }
        console.warn('[UnbirthDB] 检测到另一个实例已在运行，跳过初始化。请勿重复安装本插件。');
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
