/**
 * service/template/chat-scope/chat-scope-base.ts — 共享基础函数
 * 被 chat-scope-plot.ts、chat-scope-template.ts、chat-scope-guide.ts、chat-scope-sheet.ts 共同依赖的函数
 */
import { CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU, CHAT_SHEET_GUIDE_VERSION_ACU } from '../../../data/storage/chat-history';
import { TABLE_ORDER_FIELD_ACU } from '../../../shared/constants';
import { ensureExportConfigDefaults_ACU } from '../../worldbook/injection-engine';

/**
 * 规范化聊天作用域配置来源字符串
 * @param source 原始来源字符串
 * @param fallback 默认值，默认 'inherit'
 * @returns 规范化后的来源字符串
 */
export function normalizeChatScopedConfigSource_ACU(source: any, fallback = 'inherit') {
    if (typeof source !== 'string') return fallback;
    const normalized = source.trim();
    return normalized || fallback;
}

/**
 * 规范化 sheet guide 数据对象——只保留表头行、sourceData、updateConfig、exportConfig、seedRows
 * 被 B、D、E 三组广泛使用，提取到 base 层避免循环依赖
 */
export function normalizeGuideData_ACU(dataObj: any) {
    if (!dataObj || typeof dataObj !== 'object') return null;
    const out: any = { mate: { type: 'chatSheets', version: CHAT_SHEET_GUIDE_VERSION_ACU } };
    if (dataObj.mate && typeof dataObj.mate === 'object') {
        out.mate = dataObj.mate;
    }
    if (!out.mate || typeof out.mate !== 'object') out.mate = { type: 'chatSheets', version: CHAT_SHEET_GUIDE_VERSION_ACU };
    if (!out.mate.type) out.mate.type = 'chatSheets';
    if (!Number.isFinite(out.mate.version) || Math.trunc(out.mate.version) < CHAT_SHEET_GUIDE_VERSION_ACU) out.mate.version = CHAT_SHEET_GUIDE_VERSION_ACU;
    Object.keys(dataObj).forEach(k => {
        if (!k.startsWith('sheet_')) return;
        const s = dataObj[k];
        if (!s || typeof s !== 'object') return;
        const headerRow = Array.isArray(s.content) && Array.isArray(s.content[0]) ? s.content[0] : [null];
        const keep: Record<string, any> = {
            uid: s.uid || k,
            name: s.name || k,
            sourceData: s.sourceData || { note: '', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
            content: [headerRow],
            updateConfig: s.updateConfig || { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
            exportConfig: ensureExportConfigDefaults_ACU(s.exportConfig, s.name || k),
        };
        // `_seedRows` 是早期聊天级 guide 的历史字段；读取时收敛为当前
        // `seedRows`，避免它在身份列健全化前被静默丢弃。
        const seedRows = Array.isArray(s[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU])
            ? s[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU]
            : s._seedRows;
        if (Array.isArray(seedRows)) {
            try {
                keep[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = JSON.parse(JSON.stringify(seedRows));
            } catch (e) {
                keep[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = [];
            }
        }
        if (s[TABLE_ORDER_FIELD_ACU] !== undefined) keep[TABLE_ORDER_FIELD_ACU] = s[TABLE_ORDER_FIELD_ACU];
        out[k] = keep;
    });
    return out;
}
