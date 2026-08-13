/**
 * service/table/table-delta.ts — 表格增量(delta)纯函数
 *
 * 职责：
 * 1. buildTableDelta_ACU — 对比 base/next 两版 Sheet_ACU，生成行级增量
 * 2. applyTableDelta_ACU — 将增量应用到 base Sheet_ACU，重建 next
 * 3. isDeltaTagData_ACU / isCheckpointTagData_ACU — 存储模式判定
 *
 * 约定：content[i][0] 为 row_id；缺失/重复/列结构变化时退化为 checkpoint。
 */

import type { Sheet_ACU } from '../../shared/models/table-data';
import type {
    TableIncrementalUpdate_ACU,
    TableRowDelta_ACU,
    TableStorageMode_ACU,
    IsolationTagData_ACU,
} from '../../data/models/chat-message-data';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

// ── 常量 ──

const LOG_TAG_DELTA = '[表格增量]';
const LOG_TAG_CHECKPOINT = '[表格Checkpoint]';
const LOG_TAG_REBUILD = '[表格重建]';

// ── 退化判定 ──

/**
 * 检查一张表的 content 是否具备稳定 row_id（content[i][0] 非空且无重复）。
 * 返回 true 表示可以安全做行级 delta；false 表示必须退化为 checkpoint。
 */
export function hasStableRowIds_ACU(content: (string | null)[][]): boolean {
    if (!content || content.length === 0) return true; // 空表视为可 delta（delta 为空）
    const ids = new Set<string>();
    for (let i = 0; i < content.length; i++) {
        const row = content[i];
        if (!row || row.length === 0) return false;
        const id = row[0];
        if (id == null || id === '') return false;
        if (ids.has(id)) return false;
        ids.add(id);
    }
    return true;
}

/**
 * 检查两张表的列结构是否一致（以第一行列数为准）。
 * 列数变化意味着结构变更，必须退化。
 */
function hasStructureChanged_ACU(
    baseContent: (string | null)[][],
    nextContent: (string | null)[][],
): boolean {
    const baseColCount = baseContent.length > 0 ? (baseContent[0]?.length ?? 0) : 0;
    const nextColCount = nextContent.length > 0 ? (nextContent[0]?.length ?? 0) : 0;
    return baseColCount !== nextColCount;
}


// ── 元数据变更检测 ──

/** 需要追踪的元数据字段 */
const META_KEYS: (keyof Pick<Sheet_ACU, 'name' | 'orderNo' | 'updateConfig' | 'exportConfig' | 'sourceData'>)[] = [
    'name', 'orderNo', 'updateConfig', 'exportConfig', 'sourceData',
];

function detectMetaChanges_ACU(
    base: Sheet_ACU,
    next: Sheet_ACU,
): Partial<Pick<Sheet_ACU, 'name' | 'orderNo' | 'updateConfig' | 'exportConfig' | 'sourceData'>> | undefined {
    const changes: Record<string, unknown> = {};
    let hasChange = false;
    for (const key of META_KEYS) {
        if (JSON.stringify(base[key]) !== JSON.stringify(next[key])) {
            changes[key] = next[key];
            hasChange = true;
        }
    }
    return hasChange ? (changes as any) : undefined;
}

// ── 核心纯函数 ──

export interface BuildDeltaResult_ACU {
    /** 是否退化为 checkpoint（true 时 delta 无意义，应存完整快照） */
    degraded: boolean;
    /** 退化原因（仅 degraded=true 时有值） */
    degradeReason?: string;
    /** 增量描述（仅 degraded=false 时有意义） */
    delta?: TableIncrementalUpdate_ACU;
}

/**
 * 对比 base 和 next 两版 Sheet_ACU，生成行级增量。
 * 如果无法安全生成增量（row_id 缺失/重复/列结构变化），返回 degraded=true。
 *
 * @param base 上一版快照（undefined 表示首次写入，直接退化为 checkpoint）
 * @param next 当前版本
 * @param sheetKey 表键名（用于日志）
 */
export function buildTableDelta_ACU(
    base: Sheet_ACU | undefined,
    next: Sheet_ACU,
    sheetKey: string,
): BuildDeltaResult_ACU {
    // 首次写入 → checkpoint
    if (!base) {
        logDebug_ACU(`${LOG_TAG_DELTA} ${sheetKey}: 无基底，退化为 checkpoint`);
        return { degraded: true, degradeReason: 'no_base' };
    }

    const baseContent = base.content ?? [];
    const nextContent = next.content ?? [];

    // 列结构变化 → checkpoint
    if (hasStructureChanged_ACU(baseContent, nextContent)) {
        logWarn_ACU(`${LOG_TAG_DELTA} ${sheetKey}: 列结构变化，退化为 checkpoint`);
        return { degraded: true, degradeReason: 'structure_changed' };
    }

    // row_id 稳定性检查
    if (!hasStableRowIds_ACU(baseContent)) {
        logWarn_ACU(`${LOG_TAG_DELTA} ${sheetKey}: base 缺少稳定 row_id，退化为 checkpoint`);
        return { degraded: true, degradeReason: 'base_no_stable_row_id' };
    }
    if (!hasStableRowIds_ACU(nextContent)) {
        logWarn_ACU(`${LOG_TAG_DELTA} ${sheetKey}: next 缺少稳定 row_id，退化为 checkpoint`);
        return { degraded: true, degradeReason: 'next_no_stable_row_id' };
    }

    // 构建 base 行索引 map: row_id → 完整行
    const baseMap = new Map<string, (string | null)[]>();
    for (const row of baseContent) {
        baseMap.set(row[0]!, row);
    }

    // 构建 next 行索引 map
    const nextMap = new Map<string, (string | null)[]>();
    for (const row of nextContent) {
        nextMap.set(row[0]!, row);
    }

    const rowDeltas: TableRowDelta_ACU[] = [];

    // 检测 upsert（新增或修改的行）
    for (const [rowId, nextRow] of nextMap) {
        const baseRow = baseMap.get(rowId);
        if (!baseRow) {
            // 新增行
            rowDeltas.push({ row_id: rowId, op: 'upsert', cells: nextRow });
        } else if (JSON.stringify(baseRow) !== JSON.stringify(nextRow)) {
            // 修改行
           rowDeltas.push({ row_id: rowId, op: 'upsert', cells: nextRow });
        }
    }

    // 检测 delete（base 中有但 next 中没有的行）
    for (const rowId of baseMap.keys()) {
        if (!nextMap.has(rowId)) {
            rowDeltas.push({ row_id: rowId, op: 'delete' });
        }
    }

    // 元数据变更
    const metaChanged = detectMetaChanges_ACU(base, next);

    // 判断是否为 noop
    if (rowDeltas.length === 0 && !metaChanged) {
        logDebug_ACU(`${LOG_TAG_DELTA} ${sheetKey}: 无变化，noop`);
    } else {
        logDebug_ACU(`${LOG_TAG_DELTA} ${sheetKey}: ${rowDeltas.length} 行变更, meta=${metaChanged ? 'changed' : 'unchanged'}`);
    }

    return {
        degraded: false,
        delta: {
            sheetUid: next.uid,
            rowDeltas,
            metaChanged,
            structureChanged: false,
        },
    };
}


/**
 * 将增量应用到 base Sheet_ACU，重建出 next 版本。
 * 纯函数，不修改 base。
 *
 * @param base 基底快照
 * @param delta 增量描述
 * @param sheetKey 表键名（用于日志）
 * @returns 重建后的 Sheet_ACU
 */
export function applyTableDelta_ACU(
    base: Sheet_ACU,
    delta: TableIncrementalUpdate_ACU,
    sheetKey: string,
): Sheet_ACU {
    logDebug_ACU(`${LOG_TAG_REBUILD} ${sheetKey}: 应用 ${delta.rowDeltas.length} 行变更`);

    // 深拷贝 base 避免副作用
    const result: Sheet_ACU = JSON.parse(JSON.stringify(base));

    // 应用元数据变更
    if (delta.metaChanged) {
        if (delta.metaChanged.name !== undefined) result.name = delta.metaChanged.name;
        if (delta.metaChanged.orderNo !== undefined) result.orderNo = delta.metaChanged.orderNo;
        if (delta.metaChanged.updateConfig !== undefined) result.updateConfig = delta.metaChanged.updateConfig;
        if (delta.metaChanged.exportConfig !== undefined) result.exportConfig = delta.metaChanged.exportConfig;
        if (delta.metaChanged.sourceData !== undefined) result.sourceData = delta.metaChanged.sourceData;
    }

    // 构建当前行索引 map: row_id → index
    const rowIndexMap = new Map<string, number>();
    for (let i = 0; i < result.content.length; i++) {
        const row = result.content[i];
        if (row && row[0]) {
            rowIndexMap.set(row[0], i);
        }
    }

    // 应用行级变更
    const toDelete = new Set<number>();
    for (const rd of delta.rowDeltas) {
        if (rd.op === 'delete') {
            const idx = rowIndexMap.get(rd.row_id);
            if (idx !== undefined) {
                toDelete.add(idx);
            } else {
                logWarn_ACU(`${LOG_TAG_REBUILD} ${sheetKey}: 删除目标 row_id=${rd.row_id} 不存在，跳过`);
            }
        } else if (rd.op === 'upsert') {
            const idx = rowIndexMap.get(rd.row_id);
            if (idx !== undefined) {
                // 更新已有行
                result.content[idx] = rd.cells!;
            } else {
                // 新增行追加到末尾
                result.content.push(rd.cells!);
                // 更新索引以处理同批次多次 upsert 同一新 row_id 的情况
                rowIndexMap.set(rd.row_id, result.content.length - 1);
            }
        }
    }

    // 执行删除（从后往前删避免索引偏移）
    if (toDelete.size > 0) {
        const sortedIndices = [...toDelete].sort((a, b) => b - a);
        for (const idx of sortedIndices) {
            result.content.splice(idx, 1);
        }
    }

    return result;
}

// ── 存储模式判定 ──

/**
 * 判断一个 IsolationTagData_ACU 是否为 delta 模式存储。
 */
export function isDeltaTagData_ACU(tagData: IsolationTagData_ACU): boolean {
    return tagData._acu_storage_mode === 'delta';
}

/**
 * 判断一个 IsolationTagData_ACU 是否为 checkpoint 模式存储。
 * checkpoint 包含完整 independentData 快照。
 * legacy（无标记）也视为 checkpoint（旧版完整快照）。
 */
export function isCheckpointTagData_ACU(tagData: IsolationTagData_ACU): boolean {
    return tagData._acu_storage_mode === 'checkpoint'
        || tagData._acu_storage_mode === 'legacy'
        || !tagData._acu_storage_mode;
}
