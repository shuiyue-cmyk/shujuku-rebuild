/**
 * service/table/native-table-service-adapter.ts — 原生模式适配器
 *
 * 将现有的 table-service.ts 中的函数包装为 ITableStorageProvider 接口。
 * 不修改 table-service.ts 的任何代码，只做适配委托。
 * 原生模式下系统行为与当前完全一致。
 */

import type {
  ITableStorageProvider,
  SqlQueryResult,
  SqlMutationResult,
  ApplyEditsResult,
  SqlQueryExecutionOptions_ACU,
} from '../../shared/table-storage-provider';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import {
  loadOrCreateJsonTableFromChatHistory_ACU,
} from './table-service';
import { parseAndApplyTableEdits_ACU } from '../ai/prompt-builder/table-edit-parser';
import { currentJsonTableData_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';

export class NativeTableServiceAdapter implements ITableStorageProvider {
  readonly mode = 'native' as const;

  /**
   * 从聊天消息加载表格数据
   * 委托给 loadOrCreateJsonTableFromChatHistory_ACU
   */
  async loadFromChat(): Promise<{
    loaded: boolean;
    source: 'merged' | 'initialized' | 'empty';
    error?: string;
  }> {
    logDebug_ACU('[原生适配器] loadFromChat: 开始加载表格数据');
    const result = await loadOrCreateJsonTableFromChatHistory_ACU();
    logDebug_ACU(`[原生适配器] loadFromChat: 结果=${result.source}, loaded=${result.loaded}`);
    return result;
  }

  isReady(): boolean {
    return true;
  }

  /**
   * 禁止 provider 自行保存聊天记录。
   * 所有写入必须通过 table-update-commit 公共提交模型完成。
   */
  async saveToChat(
    _targetSheetKeys?: string[] | null,
    _updateGroupKeys?: string[] | null,
    _trackingSheetKeys?: string[] | null,
    _options?: { source?: string; requestId?: string; batchId?: string; operations?: unknown[]; transactionContext?: unknown },
  ): Promise<{ saved: boolean; messageIndex?: number; error?: string }> {
    const message = 'NativeTableServiceAdapter.saveToChat is disabled; use table update commit model.';
    logError_ACU(`[原生适配器] ${message}`);
    return { saved: false, error: message };
  }

  /**
   * 获取当前运行时的完整表格数据
   * 直接返回 currentJsonTableData_ACU 全局变量
   */
  getCurrentData(): TableDataObject_ACU | null {
    return currentJsonTableData_ACU;
  }

  replaceAllData(data: TableDataObject_ACU): ApplyEditsResult {
    const cloned = JSON.parse(JSON.stringify(data || {}));
    _set_currentJsonTableData_ACU(cloned);
    const modifiedKeys = Object.keys(cloned).filter(key => key.startsWith('sheet_'));
    return { success: true, modifiedKeys, appliedEdits: modifiedKeys.length };
  }

  clearRuntimeData(): void {
    _set_currentJsonTableData_ACU(null);
  }

  /**
   * 应用 AI 返回的编辑指令（DSL 格式）
   * 委托给 parseAndApplyTableEdits_ACU
   */
  applyEdits(edits: string, updateMode?: string): ApplyEditsResult {
    logDebug_ACU(`[原生适配器] applyEdits: 模式=${updateMode || 'standard'}, 编辑指令长度=${edits.length}`);
    const success = parseAndApplyTableEdits_ACU(edits, updateMode || 'standard');
    // parseAndApplyTableEdits_ACU 返回 boolean：
    // true = 成功或无编辑，false = 失败
    return {
      success: !!success,
      modifiedKeys: [], // 原生模式下不追踪具体修改了哪些 sheet
      appliedEdits: success ? 1 : 0,
    };
  }

  /**
   * SQL 查询 — 原生模式不支持
   */
  executeQuery(
    _sql: string,
    _params?: (string | number | null)[],
    _options?: SqlQueryExecutionOptions_ACU,
  ): SqlQueryResult {
    throw new Error('SQL 查询仅在 SQLite 模式下可用。请在设置中切换到 SQLite 模式。');
  }

  /**
   * SQL 变更 — 原生模式不支持
   */
  executeMutation(_sql: string, _params?: (string | number | null)[]): SqlMutationResult {
    throw new Error('SQL 变更仅在 SQLite 模式下可用。请在设置中切换到 SQLite 模式。');
  }

  /**
   * 销毁/清理 — 原生模式无需清理
   */
  dispose(): void {
    // 原生模式没有需要清理的资源
  }
}
