/**
 * 数据隔离（Isolation）相关函数
 *
 * 管理数据隔离标识的历史记录、Profile 创建和切换。
 */

import { logWarn_ACU } from '../../shared/utils';
import { normalizeIsolationCode_ACU } from '../../shared/data-constants';
import { globalMeta_ACU, saveGlobalMeta_ACU, readProfileSettingsFromStorage_ACU, writeProfileSettingsToStorage_ACU, readProfileTemplateFromStorage_ACU, writeProfileTemplateToStorage_ACU, sanitizeSettingsForProfileSave_ACU } from './profile-repo';
import { TABLE_TEMPLATE_ACU, DEFAULT_TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';


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

export function getDataIsolationHistory_ACU(): string[] {
    return normalizeDataIsolationHistory_ACU();
}

export function addDataIsolationHistory_ACU(code: string, { save = true } = {}): void {
    if (typeof code !== 'string') return;
    const trimmed = code.trim();
    if (!trimmed) return;
    const history = getDataIsolationHistory_ACU();
    globalMeta_ACU.isolationCodeList = [trimmed, ...history.filter((item: string) => item !== trimmed)].slice(
        0,
        MAX_DATA_ISOLATION_HISTORY,
    );
    if (save) saveGlobalMeta_ACU();
}

export function removeDataIsolationHistory_ACU(code: string, { save = true } = {}): void {
    if (typeof code !== 'string') return;
    const history = getDataIsolationHistory_ACU();
    globalMeta_ACU.isolationCodeList = history.filter((item: string) => item !== code);
    if (save) saveGlobalMeta_ACU();
}

export function ensureProfileExists_ACU(code: string, { seedFromCurrent = true, settings = {} as any } = {}): void {
    const c = normalizeIsolationCode_ACU(code);
    const hasSettings = !!readProfileSettingsFromStorage_ACU(c);
    const hasTemplate = !!readProfileTemplateFromStorage_ACU(c);

    if (!hasSettings) {
        const seed = seedFromCurrent ? sanitizeSettingsForProfileSave_ACU(settings) : {};
        seed.dataIsolationCode = c;
        try { writeProfileSettingsToStorage_ACU(c, seed); } catch (e) { logWarn_ACU('[Profile] seed settings failed:', e); }
    }
    if (!hasTemplate) {
        const seedTemplate = seedFromCurrent ? (TABLE_TEMPLATE_ACU || DEFAULT_TABLE_TEMPLATE_ACU) : DEFAULT_TABLE_TEMPLATE_ACU;
        try { writeProfileTemplateToStorage_ACU(c, seedTemplate); } catch (e) { logWarn_ACU('[Profile] seed template failed:', e); }
    }
}

// [已移到 service/settings/settings-service.ts] switchIsolationProfile_ACU（业务编排）
