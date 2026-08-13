/**
 * presentation/bootstrap/api-groups/table-lock-api.ts
 * 表格锁定 API — 行/列/单元格锁定与特殊索引锁定
 */

import { logError_ACU } from '../../../shared/utils';
import {
    getTableLocksForSheet_ACU,
    saveTableLocksForSheet_ACU,
    toggleRowLock_ACU,
    toggleColLock_ACU,
    toggleCellLock_ACU,
    isSpecialIndexLockEnabled_ACU,
    setSpecialIndexLockEnabled_ACU,
} from '../../../service/runtime/helpers-remaining';
import type { ApiGroupContext } from './callback-api';

export function createTableLockApi(_ctx: ApiGroupContext): Record<string, Function> {
    return {
        getTableLockState: function(sheetKey: string) {
            try {
                if (!sheetKey) return null;
                const lockState = getTableLocksForSheet_ACU(sheetKey);
                return {
                    rows: Array.from(lockState.rows || []),
                    cols: Array.from(lockState.cols || []),
                    cells: Array.from(lockState.cells || []),
                };
            } catch (e) {
                logError_ACU('getTableLockState failed:', e);
                return null;
            }
        },
        setTableLockState: function(sheetKey: string, lockState: any = {}, { merge = false } = {}) {
            try {
                if (!sheetKey) return false;
                const base = merge ? getTableLocksForSheet_ACU(sheetKey) : { rows: new Set(), cols: new Set(), cells: new Set() };
                const rows = Array.isArray(lockState.rows) ? lockState.rows : [];
                const cols = Array.isArray(lockState.cols) ? lockState.cols : [];
                const cells = Array.isArray(lockState.cells) ? lockState.cells : [];

                rows.forEach((v: any) => { if (Number.isFinite(v)) base.rows.add(v); });
                cols.forEach((v: any) => { if (Number.isFinite(v)) base.cols.add(v); });
                cells.forEach((v: any) => {
                    if (typeof v === 'string') base.cells.add(v);
                    else if (Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
                        base.cells.add(`${v[0]}:${v[1]}`);
                    }
                });

                saveTableLocksForSheet_ACU(sheetKey, base);
                return true;
            } catch (e) {
                logError_ACU('setTableLockState failed:', e);
                return false;
            }
        },
        clearTableLocks: function(sheetKey: string) {
            try {
                if (!sheetKey) return false;
                saveTableLocksForSheet_ACU(sheetKey, { rows: new Set(), cols: new Set(), cells: new Set() });
                return true;
            } catch (e) {
                logError_ACU('clearTableLocks failed:', e);
                return false;
            }
        },
        lockTableRow: function(sheetKey: string, rowIndex: number, locked = true) {
            try {
                if (!sheetKey || !Number.isFinite(rowIndex)) return false;
                const lockState = getTableLocksForSheet_ACU(sheetKey);
                if (locked) lockState.rows.add(rowIndex);
                else lockState.rows.delete(rowIndex);
                saveTableLocksForSheet_ACU(sheetKey, lockState);
                return true;
            } catch (e) {
                logError_ACU('lockTableRow failed:', e);
                return false;
            }
        },
        lockTableCol: function(sheetKey: string, colIndex: number, locked = true) {
            try {
                if (!sheetKey || !Number.isFinite(colIndex)) return false;
                const lockState = getTableLocksForSheet_ACU(sheetKey);
                if (locked) lockState.cols.add(colIndex);
                else lockState.cols.delete(colIndex);
                saveTableLocksForSheet_ACU(sheetKey, lockState);
                return true;
            } catch (e) {
                logError_ACU('lockTableCol failed:', e);
                return false;
            }
        },
        lockTableCell: function(sheetKey: string, rowIndex: number, colIndex: number, locked = true) {
            try {
                if (!sheetKey || !Number.isFinite(rowIndex) || !Number.isFinite(colIndex)) return false;
                const lockState = getTableLocksForSheet_ACU(sheetKey);
                const key = `${rowIndex}:${colIndex}`;
                if (locked) lockState.cells.add(key);
                else lockState.cells.delete(key);
                saveTableLocksForSheet_ACU(sheetKey, lockState);
                return true;
            } catch (e) {
                logError_ACU('lockTableCell failed:', e);
                return false;
            }
        },
        toggleTableRowLock: function(sheetKey: string, rowIndex: number) {
            try {
                if (!sheetKey || !Number.isFinite(rowIndex)) return false;
                toggleRowLock_ACU(sheetKey, rowIndex);
                return true;
            } catch (e) {
                logError_ACU('toggleTableRowLock failed:', e);
                return false;
            }
        },
        toggleTableColLock: function(sheetKey: string, colIndex: number) {
            try {
                if (!sheetKey || !Number.isFinite(colIndex)) return false;
                toggleColLock_ACU(sheetKey, colIndex);
                return true;
            } catch (e) {
                logError_ACU('toggleTableColLock failed:', e);
                return false;
            }
        },
        toggleTableCellLock: function(sheetKey: string, rowIndex: number, colIndex: number) {
            try {
                if (!sheetKey || !Number.isFinite(rowIndex) || !Number.isFinite(colIndex)) return false;
                toggleCellLock_ACU(sheetKey, rowIndex, colIndex);
                return true;
            } catch (e) {
                logError_ACU('toggleTableCellLock failed:', e);
                return false;
            }
        },
        getSpecialIndexLockEnabled: function(sheetKey: string) {
            try {
                if (!sheetKey) return null;
                return isSpecialIndexLockEnabled_ACU(sheetKey);
            } catch (e) {
                logError_ACU('getSpecialIndexLockEnabled failed:', e);
                return null;
            }
        },
        setSpecialIndexLockEnabled: function(sheetKey: string, enabled: boolean) {
            try {
                if (!sheetKey) return false;
                setSpecialIndexLockEnabled_ACU(sheetKey, !!enabled);
                return true;
            } catch (e) {
                logError_ACU('setSpecialIndexLockEnabled failed:', e);
                return false;
            }
        },
    };
}
