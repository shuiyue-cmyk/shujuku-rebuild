/**
 * service/runtime/helpers-table-lock.ts — 表格锁定与索引
 * 从 helpers-remaining.ts 拆出
 */
import { settings_ACU, currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from './state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { isSummaryOrOutlineTable_ACU } from '../../shared/utils';

  function getTableLockScopeKey_ACU() {
      const chatKey = (currentChatFileIdentifier_ACU || 'default').trim() || 'default';
      const isolationKey = getCurrentIsolationKey_ACU() || '';
      return `${chatKey}::${isolationKey}`;
  }

  function ensureTableLockStore_ACU() {
      if (!settings_ACU.tableUpdateLocks || typeof settings_ACU.tableUpdateLocks !== 'object') {
          settings_ACU.tableUpdateLocks = {};
      }
      if (!settings_ACU.specialIndexLocks || typeof settings_ACU.specialIndexLocks !== 'object') {
          settings_ACU.specialIndexLocks = {};
      }
  }

  export function getTableLocksForSheet_ACU(sheetKey: string) {
      const scopeKey = getTableLockScopeKey_ACU();
      const bucket = settings_ACU?.tableUpdateLocks?.[scopeKey]?.[sheetKey] || {};
      return {
          rows: new Set(Array.isArray(bucket.rows) ? bucket.rows : []),
          cols: new Set(Array.isArray(bucket.cols) ? bucket.cols : []),
          cells: new Set(Array.isArray(bucket.cells) ? bucket.cells : []),
      };
  }

  export function saveTableLocksForSheet_ACU(sheetKey: string, lockState: any) {
      if (!sheetKey) return;
      ensureTableLockStore_ACU();
      const scopeKey = getTableLockScopeKey_ACU();
      if (!settings_ACU.tableUpdateLocks[scopeKey]) settings_ACU.tableUpdateLocks[scopeKey] = {};
      settings_ACU.tableUpdateLocks[scopeKey][sheetKey] = {
          rows: Array.from(lockState.rows || []),
          cols: Array.from(lockState.cols || []),
          cells: Array.from(lockState.cells || []),
      };
      saveSettings_ACU();
  }

  export function deleteTableLocksForSheet_ACU(sheetKey: string, { save = true } = {}) {
      const normalizedSheetKey = String(sheetKey || '').trim();
      if (!normalizedSheetKey) return false;
      const scopeKey = getTableLockScopeKey_ACU();
      let changed = false;

      const tableLocks = settings_ACU?.tableUpdateLocks?.[scopeKey];
      if (tableLocks && typeof tableLocks === 'object' && !Array.isArray(tableLocks)
          && Object.prototype.hasOwnProperty.call(tableLocks, normalizedSheetKey)) {
          delete tableLocks[normalizedSheetKey];
          changed = true;
      }

      const specialIndexLocks = settings_ACU?.specialIndexLocks?.[scopeKey];
      if (specialIndexLocks && typeof specialIndexLocks === 'object' && !Array.isArray(specialIndexLocks)
          && Object.prototype.hasOwnProperty.call(specialIndexLocks, normalizedSheetKey)) {
          delete specialIndexLocks[normalizedSheetKey];
          changed = true;
      }

      if (save && changed) saveSettings_ACU();
      return changed;
  }

  export function toggleRowLock_ACU(sheetKey: string, rowIndex: number) {
      const lockState = getTableLocksForSheet_ACU(sheetKey);
      if (lockState.rows.has(rowIndex)) lockState.rows.delete(rowIndex);
      else lockState.rows.add(rowIndex);
      saveTableLocksForSheet_ACU(sheetKey, lockState);
  }

  export function toggleColLock_ACU(sheetKey: string, colIndex: number) {
      const lockState = getTableLocksForSheet_ACU(sheetKey);
      if (lockState.cols.has(colIndex)) lockState.cols.delete(colIndex);
      else lockState.cols.add(colIndex);
      saveTableLocksForSheet_ACU(sheetKey, lockState);
  }

  export function toggleCellLock_ACU(sheetKey: string, rowIndex: number, colIndex: number) {
      const lockState = getTableLocksForSheet_ACU(sheetKey);
      const key = `${rowIndex}:${colIndex}`;
      if (lockState.cells.has(key)) lockState.cells.delete(key);
      else lockState.cells.add(key);
      saveTableLocksForSheet_ACU(sheetKey, lockState);
  }

  export function isSpecialIndexLockEnabled_ACU(sheetKey: string) {
      const scopeKey = getTableLockScopeKey_ACU();
      const bucket = settings_ACU?.specialIndexLocks?.[scopeKey] || {};
      if (typeof bucket[sheetKey] === 'boolean') return bucket[sheetKey];
      return true; // 默认锁定
  }

  export function setSpecialIndexLockEnabled_ACU(sheetKey: string, enabled: boolean) {
      if (!sheetKey) return;
      ensureTableLockStore_ACU();
      const scopeKey = getTableLockScopeKey_ACU();
      if (!settings_ACU.specialIndexLocks[scopeKey]) settings_ACU.specialIndexLocks[scopeKey] = {};
      settings_ACU.specialIndexLocks[scopeKey][sheetKey] = !!enabled;
      saveSettings_ACU();
  }

  export function clearCurrentTableLocks_ACU({ save = true } = {}) {
      const scopeKey = getTableLockScopeKey_ACU();
      const result = {
          scopeKey,
          removedTableLocks: false,
          removedSpecialIndexLocks: false,
          changed: false,
      };

      if (settings_ACU.tableUpdateLocks && typeof settings_ACU.tableUpdateLocks === 'object' && !Array.isArray(settings_ACU.tableUpdateLocks)) {
          if (Object.prototype.hasOwnProperty.call(settings_ACU.tableUpdateLocks, scopeKey)) {
              delete settings_ACU.tableUpdateLocks[scopeKey];
              result.removedTableLocks = true;
              result.changed = true;
          }
      } else if (settings_ACU.tableUpdateLocks !== undefined) {
          settings_ACU.tableUpdateLocks = {};
          result.changed = true;
      }

      if (settings_ACU.specialIndexLocks && typeof settings_ACU.specialIndexLocks === 'object' && !Array.isArray(settings_ACU.specialIndexLocks)) {
          if (Object.prototype.hasOwnProperty.call(settings_ACU.specialIndexLocks, scopeKey)) {
              delete settings_ACU.specialIndexLocks[scopeKey];
              result.removedSpecialIndexLocks = true;
              result.changed = true;
          }
      } else if (settings_ACU.specialIndexLocks !== undefined) {
          settings_ACU.specialIndexLocks = {};
          result.changed = true;
      }

      if (save && result.changed) {
          saveSettings_ACU();
      }

      return result;
  }

  export function getSummaryIndexColumnIndex_ACU(table: any) {
      try {
          if (!table || !Array.isArray(table.content) || !Array.isArray(table.content[0])) return -1;
          const headers = table.content[0].slice(1);
          if (!headers.length) return -1;
          let idx = headers.findIndex(h => {
              if (typeof h !== 'string') return false;
              return /编码|索引/.test(h);
          });
          if (idx === -1) idx = headers.length - 1;
          return idx;
      } catch (e) {
          return -1;
      }
  }

  export function formatSummaryIndexCode_ACU(num: any) {
      const n = Math.max(1, parseInt(num, 10) || 1);
      return `AM${String(n).padStart(4, '0')}`;
  }

  export function applySummaryIndexSequenceToTable_ACU(table: any, colIndex: number) {
      if (!table || !Array.isArray(table.content) || colIndex < 0) return;
      for (let i = 1; i < table.content.length; i++) {
          const row = table.content[i];
          if (!Array.isArray(row)) continue;
          row[colIndex + 1] = formatSummaryIndexCode_ACU(i);
      }
  }

  export function applySpecialIndexSequenceToSummaryTables_ACU(dataObj: Record<string, any>) {
      if (!dataObj || typeof dataObj !== 'object') return;
      Object.keys(dataObj).forEach(sheetKey => {
          if (!sheetKey.startsWith('sheet_')) return;
          const table = dataObj[sheetKey];
          if (!table || !isSummaryOrOutlineTable_ACU(table.name)) return;
          if (!isSpecialIndexLockEnabled_ACU(sheetKey)) return;
          const colIndex = getSummaryIndexColumnIndex_ACU(table);
          if (colIndex < 0) return;
          applySummaryIndexSequenceToTable_ACU(table, colIndex);
      });
  }
