/**
 * service/worldbook/injection-engine-order.ts — 注入位置与Order分配工具
 * 从 injection-engine.ts 拆出
 */
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

// =========================
// [世界书] 注入位置：强制改为 @D 系统深度（避免默认"角色定义之前"）
// 说明：
// - 根据 TavernHelper 的 LorebookEntry 类型定义：
//   - `position` 使用枚举值（非 @D 符号）
//   - "@D 系统深度"对应 position='at_depth_as_system' 且 depth 为数字
// - 仅用于：OutlineTable、总结条目(含外部导入)、MemoryStart/MemoryEnd
// =========================
function buildSystemDepthInjection_ACU(depth: any) {
    const d = parseInt(depth, 10);
    return {
        // @D⚙：系统身份 + 固定深度
        position: 'at_depth_as_system',
        depth: Number.isFinite(d) ? d : 2,
    };
}

function applySystemDepthInjection_ACU(entry: any, depth: any) {
    if (!entry || typeof entry !== 'object') return entry;
    return { ...entry, ...buildSystemDepthInjection_ACU(depth) };
}

function isSystemDepthInjected_ACU(entry: any, expectedDepth: any = null) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.position !== 'at_depth_as_system') return false;
    const d = typeof entry.depth === 'number' ? entry.depth : parseInt(String(entry.depth ?? ''), 10);
    if (!Number.isFinite(d)) return false;
    if (expectedDepth === null || expectedDepth === undefined) return true;
    const exp = parseInt(expectedDepth, 10);
    return Number.isFinite(exp) ? d === exp : true;
}

// [说明] 全局可读数据库条目注入位置
// 原"@D 系统深度"已移除，改回"角色定义之前"（position: 0）
// 仅重要人物/总结/大纲/记忆包裹保留 @D 系统层注入

// =========================
// [世界书] order(插入深度) 分配工具
// 目标：
// - 本插件创建的条目之间不重复
// - 也不与世界书中"任何现有条目"的 order 重复
// =========================
export function getEntryOrderNumber_ACU(entry: any) {
    const v = entry?.order;
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : null;
}

export function buildUsedOrderSet_ACU(entries: any[]): Set<number> {
    const used = new Set<number>();
    if (!Array.isArray(entries)) return used;
    entries.forEach(e => {
        const n = getEntryOrderNumber_ACU(e);
        if (n !== null) used.add(n);
    });
    return used;
}

function findFirstFreeOrder_ACU(usedSet: Set<number>, preferred = 1, min = 1, max = 99999) {
    const used = usedSet instanceof Set ? usedSet : new Set<number>();
    let start = parseInt(String(preferred), 10);
    if (!Number.isFinite(start)) start = min;
    if (start < min) start = min;
    if (start > max) start = max;

    for (let o = start; o <= max; o++) {
        if (!used.has(o)) return o;
    }
    for (let o = min; o < start; o++) {
        if (!used.has(o)) return o;
    }
    return null;
}

export function allocOrder_ACU(usedSet: Set<number>, preferred = 1, min = 1, max = 99999) {
    const used = usedSet instanceof Set ? usedSet : new Set<number>();
    const o = findFirstFreeOrder_ACU(used, preferred, min, max);
    if (o === null) {
        logWarn_ACU(`[世界书Order] allocOrder 失败: 无可用 order, preferred=${preferred}, range=[${min},${max}]`);
        throw new Error('无法分配可用的世界书条目 order（插入深度）');
    }
    used.add(o);
    logDebug_ACU(`[世界书Order] allocOrder: preferred=${preferred} -> 分配=${o}`);
    return o;
}

export function allocConsecutiveOrderBlock_ACU(usedSet: Set<number>, blockSize: number, preferred = 1, min = 1, max = 99999) {
    const used = usedSet instanceof Set ? usedSet : new Set<number>();
    const size = Math.max(1, parseInt(String(blockSize), 10) || 1);
    const maxStart = max - size + 1;

    const tryFrom = (start: number) => {
        for (let s = start; s <= maxStart; s++) {
            let ok = true;
            for (let i = 0; i < size; i++) {
                if (used.has(s + i)) { ok = false; break; }
            }
            if (ok) return s;
        }
        return null;
    };

    let start = parseInt(String(preferred), 10);
    if (!Number.isFinite(start)) start = min;
    if (start < min) start = min;
    if (start > maxStart) start = maxStart;

    let s = tryFrom(start);
    if (s === null) s = tryFrom(min);
    if (s === null) throw new Error('无法分配连续的世界书条目 order 区间');

    for (let i = 0; i < size; i++) used.add(s + i);
    return s;
}
