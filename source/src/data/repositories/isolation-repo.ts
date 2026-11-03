/**
 * 数据隔离（Isolation）相关函数
 *
 * 管理数据隔离标识的历史记录（Profile 创建/切换编排已随隔离码 UI 下线删除）。
 */

import { globalMeta_ACU, saveGlobalMeta_ACU } from './profile-repo';


export const MAX_DATA_ISOLATION_HISTORY = 20;

export function normalizeDataIsolationHistory_ACU(list?: any[]): string[] {
    const seen = new Set<string>();
    const cleaned: string[] = [];
    const sourceList = list !== undefined ? list : globalMeta_ACU.isolationCodeList;
    if (Array.isArray(sourceList)) {
        sourceList.forEach((code: any) => {
            if (typeof code !== 'string') return;
            const trimmed = code.trim();
            if (!trimmed || seen.has(trimmed)) return;
            seen.add(trimmed);
            cleaned.push(trimmed);
        });
    }
    globalMeta_ACU.isolationCodeList = cleaned.slice(0, MAX_DATA_ISOLATION_HISTORY);
    return globalMeta_ACU.isolationCodeList;
}

export function addDataIsolationHistory_ACU(code: string, { save = true } = {}): void {
    if (typeof code !== 'string') return;
    const trimmed = code.trim();
    if (!trimmed) return;
    const history = normalizeDataIsolationHistory_ACU();
    globalMeta_ACU.isolationCodeList = [trimmed, ...history.filter((item: string) => item !== trimmed)].slice(
        0,
        MAX_DATA_ISOLATION_HISTORY,
    );
    if (save) saveGlobalMeta_ACU();
}

// ensureProfileExists_ACU、switchIsolationProfile_ACU（业务编排）与只供隔离码管理 UI 用的
// getDataIsolationHistory_ACU / removeDataIsolationHistory_ACU 已一并删除：隔离码切换 UI 已下线，
// 全库无任何调用方（第二轮复审 G11 跨组线索 1）。历史列表仍由设置加载时 add/normalize 维护。
