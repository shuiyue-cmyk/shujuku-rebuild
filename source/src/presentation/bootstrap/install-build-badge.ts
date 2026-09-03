/**
 * 全局构建水印（右下角固定小字）：任何截图都能辨别设备实际运行的构建。
 * 角标缺失 = 设备没有加载本插件代码（缓存/CDN 旧版本）；角标时间戳旧 = 加载了旧构建。
 * 曾随 biotracker 面板实现（af269aa），biotracker 整层删除时被连带移除，此处以独立模块还回。
 * 构建时间戳由 rollup 注入 globalThis.__ACU_BUILD_STAMP__（每次 build 唯一，免手动维护）。
 */
export const BUILD_BADGE_ELEMENT_ID_ACU = 'acu-build-stamp-badge';

export function readBuildStamp_ACU(): string {
    try {
        const stamp = (globalThis as any).__ACU_BUILD_STAMP__;
        return typeof stamp === 'string' && stamp ? stamp : 'dev';
    } catch {
        return 'dev';
    }
}

export function installGlobalBuildBadge_ACU(): boolean {
    try {
        const doc = (globalThis as any).document;
        if (!doc) return false;
        if (doc.getElementById(BUILD_BADGE_ELEMENT_ID_ACU)) return true;
        const badge = doc.createElement('div');
        badge.id = BUILD_BADGE_ELEMENT_ID_ACU;
        badge.textContent = `TTonly·${readBuildStamp_ACU()}`;
        badge.style.cssText = 'position:fixed;bottom:2px;right:6px;z-index:2147483600;font-size:10px;line-height:1;opacity:0.55;pointer-events:none;color:#9a9a9a;mix-blend-mode:difference;user-select:none;font-family:monospace;';
        (doc.body || doc.documentElement).appendChild(badge);
        return true;
    } catch {
        return false;
    }
}
