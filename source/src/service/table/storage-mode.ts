/**
 * service/table/storage-mode.ts — 存储模式工具函数
 *
 * 原生存储模式已移除，表格数据只通过 SQLite（sql.js）持久化。
 * 保留本模块的目的是兼容既有 239+ 处调用点（isSqliteMode() 等），
 * 全部恒为 SQLite 语义。
 */

import type { StorageMode } from '../../shared/table-storage-provider';

/** 当前存储模式：恒为 sqlite。 */
export function getCurrentStorageMode(): StorageMode {
  return 'sqlite';
}

/** 判断当前是否为 SQLite 模式：恒为 true。 */
export function isSqliteMode(): boolean {
  return true;
}
