/**
 * service/template/guide-metadata-overlay.ts — guide 元数据投影纯函数
 *
 * Sheet Guide 对“已存在于权威 checkpoint 的表”只允许叠加非结构元数据，
 * 字段集与 V2 meta_update 白名单（storage-frame-v2-persist.ts:2709）一致，
 * 并同样排除 sourceData.ddl：ddl 与 content[0] 绑定，属于结构，须跟随权威数据。
 *
 * 本模块为纯函数：无 I/O、无宿主读写、无 UI 依赖。
 */

import { TABLE_ORDER_FIELD_ACU } from '../../shared/constants';

/**
 * 逐元素严格比较表头（长度 + 每个单元格 String(x ?? '')）。
 * 用于决定是否继承 guide 的 sourceData.ddl 以及是否记录结构不一致 warning。
 */
export function isSameSheetHeader_ACU(left: unknown, right: unknown): boolean {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (String(left[i] ?? '') !== String(right[i] ?? '')) return false;
    }
    return true;
}

export interface GuideMetadataOverlayResult_ACU {
    changed: boolean;
}

/**
 * 将 guide 的非结构元数据叠加到 target 副本上。
 *
 * 规则：
 * - name：guide 非空则覆盖。
 * - updateConfig / exportConfig：guide 为对象则深拷贝覆盖。
 * - orderNo（TABLE_ORDER_FIELD_ACU）：guide 为有限数则 Math.trunc 后覆盖。
 * - sourceData：以 guide 的 sourceData 深拷贝为基础，删除 ddl 键，再与 target
 *   现有 sourceData 合并（target 的 ddl 优先保留）；仅当 options.inheritDdl === true
 *   且 target 无 ddl 时，才采用 guide 的 ddl。
 * - 不触碰 content、不触碰 seedRows、不触碰 uid。
 *
 * 纯函数语义：只改传入的 target 副本，不读聊天、不写宿主、不调 UI。
 */
export function applyGuideMetadataToSheet_ACU(
    targetSheet: Record<string, any>,
    guideSheet: Record<string, any> | null | undefined,
    options: { inheritDdl: boolean },
): GuideMetadataOverlayResult_ACU {
    if (!targetSheet || typeof targetSheet !== 'object') {
        return { changed: false };
    }
    if (!guideSheet || typeof guideSheet !== 'object') {
        return { changed: false };
    }

    let changed = false;

    if (typeof guideSheet.name === 'string' && guideSheet.name.trim() !== '') {
        targetSheet.name = guideSheet.name;
        changed = true;
    }

    if (guideSheet.updateConfig && typeof guideSheet.updateConfig === 'object') {
        targetSheet.updateConfig = JSON.parse(JSON.stringify(guideSheet.updateConfig));
        changed = true;
    }

    if (guideSheet.exportConfig && typeof guideSheet.exportConfig === 'object') {
        targetSheet.exportConfig = JSON.parse(JSON.stringify(guideSheet.exportConfig));
        changed = true;
    }

    if (Number.isFinite(guideSheet[TABLE_ORDER_FIELD_ACU])) {
        targetSheet[TABLE_ORDER_FIELD_ACU] = Math.trunc(guideSheet[TABLE_ORDER_FIELD_ACU]);
        changed = true;
    }

    if (guideSheet.sourceData && typeof guideSheet.sourceData === 'object') {
        const targetSourceData = (targetSheet.sourceData && typeof targetSheet.sourceData === 'object')
            ? JSON.parse(JSON.stringify(targetSheet.sourceData))
            : {};
        const merged: Record<string, any> = { ...targetSourceData };
        // 非结构字段：以 guide 为准（覆盖 target）
        Object.entries(guideSheet.sourceData).forEach(([key, value]) => {
            if (key === 'ddl') return;
            merged[key] = JSON.parse(JSON.stringify(value));
        });
        // ddl 属于结构：inheritDdl=true 且 guide 提供 ddl 时采用 guide 的（用户最新编辑），否则保留 target（checkpoint）ddl。
        if (options.inheritDdl && guideSheet.sourceData.ddl !== undefined) {
            merged.ddl = JSON.parse(JSON.stringify(guideSheet.sourceData.ddl));
        } else if (targetSourceData.ddl !== undefined) {
            merged.ddl = targetSourceData.ddl;
        }
        targetSheet.sourceData = merged;
        changed = true;
    }

    return { changed };
}
