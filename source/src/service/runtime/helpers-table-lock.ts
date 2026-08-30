/**
 * service/runtime/helpers-table-lock.ts — 表格锁定与索引
 * 从 helpers-remaining.ts 拆出
 *
 * 锁存储 v2（身份键）：
 * - 旧格式（legacy）以位置索引存储 { rows:number[], cols:number[], cells:'r:c'[] }，
 *   插行/删行后索引错位，锁会漂移到错误的行列。
 * - v2 以稳定身份存储 { v:2, rowIds:string[], colNames:string[], cells:[rowId,colName][] }：
 *   行锁定挂 row_id、列锁定挂表头显示名、单元格锁定挂 [row_id, 列名] 元组。
 * - 对外 index 契约全部保留（解析器/编辑器/开放 API 仍用行列下标交互），
 *   本模块在读写边界用表内容（content）做 index↔identity 双向解析；
 *   读到 legacy 桶且有内容上下文时惰性迁移为 v2 并持久化。
 */
import { settings_ACU, currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from './state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { isSummaryOrOutlineTable_ACU, logWarn_ACU } from '../../shared/utils';

export interface TableLockBucketV2_ACU {
    v: 2;
    rowIds: string[];
    colNames: string[];
    cells: [string, string][];
}

export interface TableLockIdentities_ACU {
    rowIds: Set<string>;
    colNames: Set<string>;
    cellPairs: [string, string][];
    hasAny: boolean;
}

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

  /** 单元格锁的内部集合键。\u0000 不会出现在 row_id 或表头名中。 */
  export function makeCellLockKey_ACU(rowId: string, colName: string): string {
      return `${rowId}\u0000${colName}`;
  }

  function isV2Bucket_ACU(bucket: any): bucket is TableLockBucketV2_ACU {
      return !!bucket && bucket.v === 2;
  }

  function emptyV2Bucket_ACU(): TableLockBucketV2_ACU {
      return { v: 2, rowIds: [], colNames: [], cells: [] };
  }

  function isBucketEmpty_ACU(bucket: TableLockBucketV2_ACU): boolean {
      return bucket.rowIds.length === 0 && bucket.colNames.length === 0 && bucket.cells.length === 0;
  }

  /** 解析锁定操作的内容上下文：显式传入优先，否则用当前运行时表格。 */
  function resolveLockContent_ACU(sheetKey: string, content?: any[][] | null): any[][] | null {
      const resolved = Array.isArray(content) ? content : (currentJsonTableData_ACU as any)?.[sheetKey]?.content;
      if (!Array.isArray(resolved) || !Array.isArray(resolved[0])) return null;
      return resolved as any[][];
  }

  /** 数据行下标（0 基，content[rowIndex+1]）→ row_id。 */
  function rowIdAtIndex_ACU(content: any[][], rowIndex: number): string | null {
      const row = content[rowIndex + 1];
      if (!Array.isArray(row)) return null;
      const rowId = String(row[0] ?? '').trim();
      return rowId || null;
  }

  /** 数据列下标（0 基，不含 row_id 列）→ 表头显示名。 */
  function colNameAtIndex_ACU(content: any[][], colIndex: number): string | null {
      const header = content[0]?.[colIndex + 1];
      if (header === undefined || header === null) return null;
      const name = String(header);
      return name || null;
  }

  function rowIndexOfId_ACU(content: any[][], rowId: string): number {
      for (let i = 1; i < content.length; i += 1) {
          const row = content[i];
          if (Array.isArray(row) && String(row[0] ?? '').trim() === rowId) return i - 1;
      }
      return -1;
  }

  function colIndexOfName_ACU(content: any[][], colName: string): number {
      const headers = content[0] || [];
      for (let i = 1; i < headers.length; i += 1) {
          if (String(headers[i]) === colName) return i - 1;
      }
      return -1;
  }

  /** legacy 位置索引桶 → v2 身份桶。越界/无 row_id 的项丢弃（本就指向不存在的目标）。 */
  function migrateLegacyBucket_ACU(bucket: any, content: any[][]): TableLockBucketV2_ACU {
      const next = emptyV2Bucket_ACU();
      const rowIdSeen = new Set<string>();
      for (const rawIndex of (Array.isArray(bucket?.rows) ? bucket.rows : [])) {
          const rowIndex = Number(rawIndex);
          if (!Number.isInteger(rowIndex)) continue;
          const rowId = rowIdAtIndex_ACU(content, rowIndex);
          if (rowId && !rowIdSeen.has(rowId)) {
              rowIdSeen.add(rowId);
              next.rowIds.push(rowId);
          }
      }
      const colNameSeen = new Set<string>();
      for (const rawIndex of (Array.isArray(bucket?.cols) ? bucket.cols : [])) {
          const colIndex = Number(rawIndex);
          if (!Number.isInteger(colIndex)) continue;
          const colName = colNameAtIndex_ACU(content, colIndex);
          if (colName && !colNameSeen.has(colName)) {
              colNameSeen.add(colName);
              next.colNames.push(colName);
          }
      }
      const cellSeen = new Set<string>();
      for (const rawKey of (Array.isArray(bucket?.cells) ? bucket.cells : [])) {
          const match = /^(\d+):(\d+)$/.exec(String(rawKey ?? ''));
          if (!match) continue;
          const rowId = rowIdAtIndex_ACU(content, Number(match[1]));
          const colName = colNameAtIndex_ACU(content, Number(match[2]));
          if (!rowId || !colName) continue;
          const key = makeCellLockKey_ACU(rowId, colName);
          if (cellSeen.has(key)) continue;
          cellSeen.add(key);
          next.cells.push([rowId, colName]);
      }
      return next;
  }

  function writeBucket_ACU(sheetKey: string, bucket: TableLockBucketV2_ACU, { save = true } = {}): void {
      ensureTableLockStore_ACU();
      const scopeKey = getTableLockScopeKey_ACU();
      if (!settings_ACU.tableUpdateLocks[scopeKey]) settings_ACU.tableUpdateLocks[scopeKey] = {};
      settings_ACU.tableUpdateLocks[scopeKey][sheetKey] = {
          v: 2,
          rowIds: [...bucket.rowIds],
          colNames: [...bucket.colNames],
          cells: bucket.cells.map(pair => [pair[0], pair[1]] as [string, string]),
      };
      if (save) saveSettings_ACU();
  }

  /**
   * 读取 sheet 的 v2 身份桶。
   * legacy 桶在内容上下文可用时惰性迁移并持久化；不可用时返回 null（调用方回退 legacy 语义）。
   */
  function readIdentityBucket_ACU(sheetKey: string, content?: any[][] | null): TableLockBucketV2_ACU | null {
      const scopeKey = getTableLockScopeKey_ACU();
      const stored = settings_ACU?.tableUpdateLocks?.[scopeKey]?.[sheetKey];
      if (!stored) return emptyV2Bucket_ACU();
      if (isV2Bucket_ACU(stored)) {
          return {
              v: 2,
              rowIds: Array.isArray(stored.rowIds) ? stored.rowIds.map(String) : [],
              colNames: Array.isArray(stored.colNames) ? stored.colNames.map(String) : [],
              cells: Array.isArray(stored.cells)
                  ? stored.cells
                      .filter((pair: any) => Array.isArray(pair) && pair.length >= 2)
                      .map((pair: any) => [String(pair[0]), String(pair[1])] as [string, string])
                  : [],
          };
      }
      const resolvedContent = resolveLockContent_ACU(sheetKey, content);
      if (!resolvedContent) return null;
      const migrated = migrateLegacyBucket_ACU(stored, resolvedContent);
      writeBucket_ACU(sheetKey, migrated);
      return migrated;
  }

  /** 身份锁查询：SQL 差异回滚、CRUD 查锁与提示词注入的统一入口。 */
  export function getTableLockIdentitiesForSheet_ACU(sheetKey: string, content?: any[][] | null): TableLockIdentities_ACU {
      const bucket = readIdentityBucket_ACU(sheetKey, content);
      if (!bucket) {
          // legacy 桶且无内容上下文：无法解析身份，按无锁处理（旧行为在此场景同样无法正确定位）。
          return { rowIds: new Set(), colNames: new Set(), cellPairs: [], hasAny: false };
      }
      return {
          rowIds: new Set(bucket.rowIds),
          colNames: new Set(bucket.colNames),
          cellPairs: bucket.cells,
          hasAny: !isBucketEmpty_ACU(bucket),
      };
  }

  /**
   * index 视图（对外契约不变）：身份锁按给定内容解析回行列下标。
   * 身份指向的行/列在当前内容中不存在时不出现在视图里（数据不在场即无格可锁）。
   */
  export function getTableLocksForSheet_ACU(sheetKey: string, content?: any[][] | null) {
      const scopeKey = getTableLockScopeKey_ACU();
      const stored = settings_ACU?.tableUpdateLocks?.[scopeKey]?.[sheetKey];
      const resolvedContent = resolveLockContent_ACU(sheetKey, content);
      if (stored && !isV2Bucket_ACU(stored) && !resolvedContent) {
          // legacy 桶且无内容上下文：按旧格式原样返回，保持完整向后兼容。
          return {
              rows: new Set(Array.isArray(stored.rows) ? stored.rows : []),
              cols: new Set(Array.isArray(stored.cols) ? stored.cols : []),
              cells: new Set(Array.isArray(stored.cells) ? stored.cells : []),
          };
      }
      const bucket = readIdentityBucket_ACU(sheetKey, resolvedContent);
      const rows = new Set<number>();
      const cols = new Set<number>();
      const cells = new Set<string>();
      if (bucket && resolvedContent) {
          for (const rowId of bucket.rowIds) {
              const rowIndex = rowIndexOfId_ACU(resolvedContent, rowId);
              if (rowIndex >= 0) rows.add(rowIndex);
          }
          for (const colName of bucket.colNames) {
              const colIndex = colIndexOfName_ACU(resolvedContent, colName);
              if (colIndex >= 0) cols.add(colIndex);
          }
          for (const [rowId, colName] of bucket.cells) {
              const rowIndex = rowIndexOfId_ACU(resolvedContent, rowId);
              const colIndex = colIndexOfName_ACU(resolvedContent, colName);
              if (rowIndex >= 0 && colIndex >= 0) cells.add(`${rowIndex}:${colIndex}`);
          }
      }
      return { rows, cols, cells };
  }

  /** index 锁状态写入（对外契约不变）：经内容解析为身份后落 v2。 */
  export function saveTableLocksForSheet_ACU(sheetKey: string, lockState: any, content?: any[][] | null) {
      if (!sheetKey) return;
      const resolvedContent = resolveLockContent_ACU(sheetKey, content);
      if (!resolvedContent) {
          // 无内容上下文无法解析身份：按旧格式存储，等待下次可解析时机迁移。
          ensureTableLockStore_ACU();
          const scopeKey = getTableLockScopeKey_ACU();
          if (!settings_ACU.tableUpdateLocks[scopeKey]) settings_ACU.tableUpdateLocks[scopeKey] = {};
          settings_ACU.tableUpdateLocks[scopeKey][sheetKey] = {
              rows: Array.from(lockState.rows || []),
              cols: Array.from(lockState.cols || []),
              cells: Array.from(lockState.cells || []),
          };
          saveSettings_ACU();
          return;
      }
      const bucket = emptyV2Bucket_ACU();
      const rowIdSeen = new Set<string>();
      for (const rawIndex of Array.from<any>(lockState?.rows || [])) {
          const rowIndex = Number(rawIndex);
          if (!Number.isInteger(rowIndex)) continue;
          const rowId = rowIdAtIndex_ACU(resolvedContent, rowIndex);
          if (rowId && !rowIdSeen.has(rowId)) {
              rowIdSeen.add(rowId);
              bucket.rowIds.push(rowId);
          }
      }
      const colNameSeen = new Set<string>();
      for (const rawIndex of Array.from<any>(lockState?.cols || [])) {
          const colIndex = Number(rawIndex);
          if (!Number.isInteger(colIndex)) continue;
          const colName = colNameAtIndex_ACU(resolvedContent, colIndex);
          if (colName && !colNameSeen.has(colName)) {
              colNameSeen.add(colName);
              bucket.colNames.push(colName);
          }
      }
      const cellSeen = new Set<string>();
      for (const rawKey of Array.from<any>(lockState?.cells || [])) {
          const match = /^(\d+):(\d+)$/.exec(String(rawKey ?? ''));
          if (!match) continue;
          const rowId = rowIdAtIndex_ACU(resolvedContent, Number(match[1]));
          const colName = colNameAtIndex_ACU(resolvedContent, Number(match[2]));
          if (!rowId || !colName) continue;
          const key = makeCellLockKey_ACU(rowId, colName);
          if (cellSeen.has(key)) continue;
          cellSeen.add(key);
          bucket.cells.push([rowId, colName]);
      }
      writeBucket_ACU(sheetKey, bucket);
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

  export function toggleRowLock_ACU(sheetKey: string, rowIndex: number, content?: any[][] | null) {
      const resolvedContent = resolveLockContent_ACU(sheetKey, content);
      if (!resolvedContent) {
          logWarn_ACU(`[TableLock] toggleRowLock 无法解析表 ${sheetKey} 的内容上下文，已忽略。`);
          return;
      }
      const rowId = rowIdAtIndex_ACU(resolvedContent, rowIndex);
      if (!rowId) {
          logWarn_ACU(`[TableLock] toggleRowLock 行下标 ${rowIndex} 在表 ${sheetKey} 中不存在或缺少 row_id，已忽略。`);
          return;
      }
      const bucket = readIdentityBucket_ACU(sheetKey, resolvedContent) || emptyV2Bucket_ACU();
      const existing = bucket.rowIds.indexOf(rowId);
      if (existing >= 0) bucket.rowIds.splice(existing, 1);
      else bucket.rowIds.push(rowId);
      writeBucket_ACU(sheetKey, bucket);
  }

  export function toggleColLock_ACU(sheetKey: string, colIndex: number, content?: any[][] | null) {
      const resolvedContent = resolveLockContent_ACU(sheetKey, content);
      if (!resolvedContent) {
          logWarn_ACU(`[TableLock] toggleColLock 无法解析表 ${sheetKey} 的内容上下文，已忽略。`);
          return;
      }
      const colName = colNameAtIndex_ACU(resolvedContent, colIndex);
      if (!colName) {
          logWarn_ACU(`[TableLock] toggleColLock 列下标 ${colIndex} 在表 ${sheetKey} 中不存在，已忽略。`);
          return;
      }
      const bucket = readIdentityBucket_ACU(sheetKey, resolvedContent) || emptyV2Bucket_ACU();
      const existing = bucket.colNames.indexOf(colName);
      if (existing >= 0) bucket.colNames.splice(existing, 1);
      else bucket.colNames.push(colName);
      writeBucket_ACU(sheetKey, bucket);
  }

  export function toggleCellLock_ACU(sheetKey: string, rowIndex: number, colIndex: number, content?: any[][] | null) {
      const resolvedContent = resolveLockContent_ACU(sheetKey, content);
      if (!resolvedContent) {
          logWarn_ACU(`[TableLock] toggleCellLock 无法解析表 ${sheetKey} 的内容上下文，已忽略。`);
          return;
      }
      const rowId = rowIdAtIndex_ACU(resolvedContent, rowIndex);
      const colName = colNameAtIndex_ACU(resolvedContent, colIndex);
      if (!rowId || !colName) {
          logWarn_ACU(`[TableLock] toggleCellLock 目标 (${rowIndex}, ${colIndex}) 在表 ${sheetKey} 中不存在，已忽略。`);
          return;
      }
      const bucket = readIdentityBucket_ACU(sheetKey, resolvedContent) || emptyV2Bucket_ACU();
      const existing = bucket.cells.findIndex(pair => pair[0] === rowId && pair[1] === colName);
      if (existing >= 0) bucket.cells.splice(existing, 1);
      else bucket.cells.push([rowId, colName]);
      writeBucket_ACU(sheetKey, bucket);
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
