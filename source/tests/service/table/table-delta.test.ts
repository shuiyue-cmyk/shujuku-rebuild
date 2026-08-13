/**
 * tests/service/table/table-delta.test.ts
 * 表格增量纯函数单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Sheet_ACU } from '../../../src/shared/models/table-data';
import type { TableIncrementalUpdate_ACU, IsolationTagData_ACU } from '../../../src/data/models/chat-message-data';

// mock 日志函数避免副作用
vi.mock('../../../src/shared/utils', () => ({
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
}));

import {
    hasStableRowIds_ACU,
    buildTableDelta_ACU,
    applyTableDelta_ACU,
    isDeltaTagData_ACU,
    isCheckpointTagData_ACU,
    BuildDeltaResult_ACU,
} from '../../../src/service/table/table-delta';

// ── 测试辅助 ──

function makeSheet(overrides: Partial<Sheet_ACU> = {}): Sheet_ACU {
    return {
        uid: 'sheet_test',
        name: '测试表',
        sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
        content: [
            ['id1', 'Alice', '30'],
            ['id2', 'Bob', '25'],
        ],
        updateConfig: {} as any,
        exportConfig: {} as any,
        orderNo: 1,
        ...overrides,
    };
}

describe('hasStableRowIds_ACU', () => {
    it('空数组返回 true', () => {
        expect(hasStableRowIds_ACU([])).toBe(true);
    });

    it('正常 row_id 返回 true', () => {
        expect(hasStableRowIds_ACU([['id1', 'a'], ['id2', 'b']])).toBe(true);
    });

    it('row_id 为 null 返回 false', () => {
        expect(hasStableRowIds_ACU([[null, 'a'], ['id2', 'b']])).toBe(false);
    });

    it('row_id 为空字符串返回 false', () => {
        expect(hasStableRowIds_ACU([['', 'a'], ['id2', 'b']])).toBe(false);
    });

    it('row_id 重复返回 false', () => {
        expect(hasStableRowIds_ACU([['id1', 'a'], ['id1', 'b']])).toBe(false);
    });

    it('空行返回 false', () => {
        expect(hasStableRowIds_ACU([[]])).toBe(false);
    });
});


describe('buildTableDelta_ACU', () => {
    it('无基底时退化为 checkpoint', () => {
        const next = makeSheet();
        const result = buildTableDelta_ACU(undefined, next, 'sheet_test');
        expect(result.degraded).toBe(true);
        expect(result.degradeReason).toBe('no_base');
    });

    it('列结构变化时退化', () => {
        const base = makeSheet({ content: [['id1', 'a', 'b']] });
        const next = makeSheet({ content: [['id1', 'a', 'b', 'c']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(true);
        expect(result.degradeReason).toBe('structure_changed');
    });

    it('base 缺少稳定 row_id 时退化', () => {
        const base = makeSheet({ content: [[null, 'a'], ['id2', 'b']] });
        const next = makeSheet({ content: [['id1', 'a'], ['id2', 'b']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(true);
        expect(result.degradeReason).toBe('base_no_stable_row_id');
    });

    it('next 缺少稳定 row_id 时退化', () => {
        const base = makeSheet({ content: [['id1', 'a'], ['id2', 'b']] });
        const next = makeSheet({ content: [['id1', 'a'], [null, 'b']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(true);
        expect(result.degradeReason).toBe('next_no_stable_row_id');
    });

    it('row_id 重复时退化', () => {
        const base = makeSheet({ content: [['id1', 'a'], ['id2', 'b']] });
        const next = makeSheet({ content: [['id1', 'a'], ['id1', 'c']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(true);
        expect(result.degradeReason).toBe('next_no_stable_row_id');
    });

    it('无变化时返回空 delta（noop）', () => {
        const base = makeSheet();
        const next = makeSheet();
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(false);
        expect(result.delta!.rowDeltas).toHaveLength(0);
        expect(result.delta!.metaChanged).toBeUndefined();
    });

    it('检测新增行', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30']] });
        const next = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(false);
        expect(result.delta!.rowDeltas).toHaveLength(1);
        expect(result.delta!.rowDeltas[0]).toEqual({ row_id: 'id2', op: 'upsert', cells: ['id2', 'Bob', '25'] });
    });

    it('检测修改行', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25']] });
        const next = makeSheet({ content: [['id1', 'Alice', '31'], ['id2', 'Bob', '25']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(false);
        expect(result.delta!.rowDeltas).toHaveLength(1);
        expect(result.delta!.rowDeltas[0]).toEqual({ row_id: 'id1', op: 'upsert', cells: ['id1', 'Alice', '31'] });
    });

    it('检测删除行', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25']] });
        const next = makeSheet({ content: [['id1', 'Alice', '30']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(false);
        expect(result.delta!.rowDeltas).toHaveLength(1);
        expect(result.delta!.rowDeltas[0]).toEqual({ row_id: 'id2', op: 'delete' });
    });

    it('检测混合操作（新增+修改+删除）', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25'], ['id3', 'Carol', '28']] });
        const next = makeSheet({ content: [['id1', 'Alice', '31'], ['id3', 'Carol', '28'], ['id4', 'Dave', '22']] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(false);
        const deltas = result.delta!.rowDeltas;
        // id1 修改
        expect(deltas.find(d => d.row_id === 'id1')).toEqual({ row_id: 'id1', op: 'upsert', cells: ['id1', 'Alice', '31'] });
        // id2 删除
        expect(deltas.find(d => d.row_id === 'id2')).toEqual({ row_id: 'id2', op: 'delete' });
        // id4 新增
        expect(deltas.find(d => d.row_id === 'id4')).toEqual({ row_id: 'id4', op: 'upsert', cells: ['id4', 'Dave', '22'] });
    });

    it('检测元数据变更', () => {
        const base = makeSheet({ name: '旧名' });
        const next = makeSheet({ name: '新名' });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(false);
        expect(result.delta!.metaChanged).toEqual({ name: '新名' });
    });

    it('空表对空表返回 noop', () => {
        const base = makeSheet({ content: [] });
        const next = makeSheet({ content: [] });
        const result = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(result.degraded).toBe(false);
        expect(result.delta!.rowDeltas).toHaveLength(0);
    });
});


describe('applyTableDelta_ACU', () => {
    it('应用 upsert 新增行', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30']] });
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [{ row_id: 'id2', op: 'upsert', cells: ['id2', 'Bob', '25'] }],
        };
        const result = applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(result.content).toHaveLength(2);
        expect(result.content[1]).toEqual(['id2', 'Bob', '25']);
    });

    it('应用 upsert 修改已有行', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25']] });
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [{ row_id: 'id1', op: 'upsert', cells: ['id1', 'Alice', '31'] }],
        };
        const result = applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(result.content[0]).toEqual(['id1', 'Alice', '31']);
        expect(result.content[1]).toEqual(['id2', 'Bob', '25']);
    });

    it('应用 delete 删除行', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25']] });
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [{ row_id: 'id2', op: 'delete' }],
        };
        const result = applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toEqual(['id1', 'Alice', '30']);
    });

    it('删除不存在的 row_id 不报错', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30']] });
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [{ row_id: 'id_nonexist', op: 'delete' }],
        };
        const result = applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(result.content).toHaveLength(1);
    });

    it('应用混合操作（新增+修改+删除）', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25'], ['id3', 'Carol', '28']] });
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [
                { row_id: 'id1', op: 'upsert', cells: ['id1', 'Alice', '31'] },
                { row_id: 'id2', op: 'delete' },
                { row_id: 'id4', op: 'upsert', cells: ['id4', 'Dave', '22'] },
            ],
        };
        const result = applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(result.content).toHaveLength(3);
        expect(result.content.find(r => r[0] === 'id1')).toEqual(['id1', 'Alice', '31']);
        expect(result.content.find(r => r[0] === 'id2')).toBeUndefined();
        expect(result.content.find(r => r[0] === 'id3')).toEqual(['id3', 'Carol', '28']);
        expect(result.content.find(r => r[0] === 'id4')).toEqual(['id4', 'Dave', '22']);
    });

    it('应用元数据变更', () => {
        const base = makeSheet({ name: '旧名', orderNo: 1 });
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [],
            metaChanged: { name: '新名', orderNo: 5 },
        };
        const result = applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(result.name).toBe('新名');
        expect(result.orderNo).toBe(5);
    });

    it('不修改原始 base 对象', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30']] });
        const originalContent = JSON.stringify(base.content);
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [{ row_id: 'id1', op: 'upsert', cells: ['id1', 'Alice', '99'] }],
        };
        applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(JSON.stringify(base.content)).toBe(originalContent);
    });

    it('空 delta 返回与 base 相同的副本', () => {
        const base = makeSheet();
        const delta: TableIncrementalUpdate_ACU = {
            sheetUid: 'sheet_test',
            rowDeltas: [],
        };
        const result = applyTableDelta_ACU(base, delta, 'sheet_test');
        expect(result).toEqual(base);
        expect(result).not.toBe(base);
    });
});

describe('buildTableDelta_ACU + applyTableDelta_ACU 往返一致性', () => {
    it('build 后 apply 能还原 next', () => {
        const base = makeSheet({ content: [['id1', 'Alice', '30'], ['id2', 'Bob', '25']] });
        const next = makeSheet({
            content: [['id1', 'Alice', '31'], ['id3', 'Carol', '28']],
            name: '改名表',
        });
        const buildResult = buildTableDelta_ACU(base, next, 'sheet_test');
        expect(buildResult.degraded).toBe(false);
        const rebuilt = applyTableDelta_ACU(base, buildResult.delta!, 'sheet_test');
        expect(rebuilt.content).toEqual(next.content);
        expect(rebuilt.name).toBe(next.name);
    });
});

describe('isDeltaTagData_ACU / isCheckpointTagData_ACU', () => {
    it('delta 模式判定', () => {
        const tagData = { independentData: {}, modifiedKeys: [], updateGroupKeys: [], _acu_storage_mode: 'delta' } as IsolationTagData_ACU;
        expect(isDeltaTagData_ACU(tagData)).toBe(true);
        expect(isCheckpointTagData_ACU(tagData)).toBe(false);
    });

    it('checkpoint 模式判定', () => {
        const tagData = { independentData: {}, modifiedKeys: [], updateGroupKeys: [], _acu_storage_mode: 'checkpoint' } as IsolationTagData_ACU;
        expect(isDeltaTagData_ACU(tagData)).toBe(false);
        expect(isCheckpointTagData_ACU(tagData)).toBe(true);
    });

    it('legacy 模式（无标记）视为 checkpoint', () => {
        const tagData = { independentData: {}, modifiedKeys: [], updateGroupKeys: [] } as IsolationTagData_ACU;
        expect(isDeltaTagData_ACU(tagData)).toBe(false);
        expect(isCheckpointTagData_ACU(tagData)).toBe(true);
    });

    it('legacy 模式（显式标记）视为 checkpoint', () => {
        const tagData = { independentData: {}, modifiedKeys: [], updateGroupKeys: [], _acu_storage_mode: 'legacy' } as IsolationTagData_ACU;
        expect(isDeltaTagData_ACU(tagData)).toBe(false);
        expect(isCheckpointTagData_ACU(tagData)).toBe(true);
    });
});
