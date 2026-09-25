import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU } from '../../shared/utils';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { getChatArray_ACU } from '../chat/chat-service';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { isSqliteMode } from './storage-mode';
import { sanitizeChatSheetsObject_ACU } from '../template/chat-scope';
import { getStorageProvider, reloadStorageProvider } from './table-storage-strategy';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import {
  auditTableDataForUpgrade_ACU,
  type UpgradeAuditIssue_ACU,
  type UpgradeAuditStatus_ACU,
} from './table-data-upgrade-audit';
import { repairTableDataFromAudit_ACU } from './table-data-repair';
import { runTableUpdateCommit_ACU } from './table-update-commit';
import { runTableWriteTransaction_ACU } from './table-write-transaction';
import { validateSqliteTemplateDataStrict_ACU } from './sqlite-template-validation';
import { isAiFloor_ACU } from '../../shared/ai-floor';

export type ImportTableJsonFailureStage_ACU = 'input' | 'runtime_restore' | 'preflight' | 'commit' | 'post_commit_runtime';
export type ImportTableJsonIssue_ACU = UpgradeAuditIssue_ACU | {
  code: 'import_invalid_json' | 'import_invalid_structure' | 'sqlite_preflight_failed';
  message: string;
};

export interface ImportTableJsonCommitResult_ACU {
  success: boolean;
  messageIndex?: number;
  tableData?: TableDataObject_ACU;
  sheetKeys?: string[];
  hasSummaryTables?: boolean;
  persisted?: boolean;
  error?: string;
  failureStage?: ImportTableJsonFailureStage_ACU;
  auditStatus?: UpgradeAuditStatus_ACU;
  issues?: ImportTableJsonIssue_ACU[];
}

export interface ImportTableJsonOptions_ACU {
  /** true: 外部导入并写入聊天持久化；false: 删除楼层/备份恢复后只恢复运行时，不制造新的 V2 持久化事件。 */
  persist?: boolean;
}

function resolveLatestAiMessageIndex_ACU(chat: any[] = getChatArray_ACU()): number {
  if (!Array.isArray(chat) || chat.length === 0) return -1;
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (isAiFloor_ACU(chat[i])) return i;
  }
  return -1;
}

function hasV2FullCheckpointAtOrBeforeTarget_ACU(targetMessageIndex: number, isolationKey: string, chat: any[] = getChatArray_ACU()): boolean {
  if (!Array.isArray(chat) || targetMessageIndex < 0) return false;
  return chat.slice(0, targetMessageIndex + 1).some(message => {
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    return isV2TagData_ACU(tagData) && tagData.storageFrame.checkpoint?.kind === 'full';
  });
}

type RuntimeRestoreResult_ACU =
  | { success: true; tableData: TableDataObject_ACU }
  | { success: false; error: string; scopeChanged: boolean };
type RuntimeRestoreFailure_ACU = Extract<RuntimeRestoreResult_ACU, { success: false }>;

function isRuntimeRestoreFailure_ACU(result: RuntimeRestoreResult_ACU): result is RuntimeRestoreFailure_ACU {
  return result.success === false;
}

/**
 * 所有导入 runtime replace 都必须经过同一把 runtime 写事务。
 * 旧实现直接 await provider.replaceAllData：切聊或并发提交可以在 await
 * 期间把旧聊天快照发布到当前 runtime，且不会推进 revision。现在锁、scope
 * 复检和 runCommit 都在同一事务边界内完成。
 */
async function restoreRuntimeDataInTransaction_ACU(input: {
  data: TableDataObject_ACU;
  chatKey: string;
  isolationKey: string;
  scopeStillCurrent: () => boolean;
}): Promise<RuntimeRestoreResult_ACU> {
  try {
    return await runTableWriteTransaction_ACU({
      source: 'system_reload',
      reason: 'importRuntimeRestore',
      chatKey: input.chatKey,
      isolationKey: input.isolationKey,
      writeSet: [{ kind: 'all' }],
      maintenanceMode: 'exclusive',
      workingDataMode: 'none',
    }, async (ctx): Promise<RuntimeRestoreResult_ACU> => {
      if (!input.scopeStillCurrent()) {
        return {
          success: false,
          error: 'import_scope_changed: runtime restore 开始前作用域已切换。',
          scopeChanged: true,
        };
      }

      let provider: any;
      try {
        provider = getStorageProvider();
      } catch (error: any) {
        return {
          success: false,
          error: error?.message || String(error),
          scopeChanged: false,
        };
      }
      if (!provider || typeof provider.replaceAllData !== 'function') {
        return {
          success: false,
          error: '当前存储 provider 不支持全量替换命令。',
          scopeChanged: false,
        };
      }

      let runtimeData: TableDataObject_ACU | null = null;
      try {
        await ctx.runCommit(async () => {
          if (!input.scopeStillCurrent()) {
            throw new Error('import_scope_changed: runtime replace 前作用域已切换。');
          }
          ctx.assertFresh('import runtime restore before provider replace');
          const replaceResult = await provider.replaceAllData(input.data);
          if (!replaceResult?.success) {
            throw new Error(replaceResult?.error || '运行时全量替换失败。');
          }
          if (!input.scopeStillCurrent()) {
            throw new Error('import_scope_changed: runtime replace 后作用域已切换。');
          }
          ctx.assertFresh('import runtime restore after provider replace');
          const currentData = typeof provider.getCurrentData === 'function'
            ? provider.getCurrentData()
            : null;
          runtimeData = (currentData || input.data) as TableDataObject_ACU;
        }, [{ kind: 'all' }]);
      } catch (error: any) {
        return {
          success: false,
          error: error?.message || String(error),
          scopeChanged: !input.scopeStillCurrent() || String(error?.message || error).includes('import_scope_changed'),
        };
      }

      return {
        success: true,
        tableData: runtimeData || input.data,
      };
    });
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error),
      scopeChanged: !input.scopeStillCurrent(),
    };
  }
}

export async function importTableJsonThroughCommit_ACU(
  jsonString: string,
  options: ImportTableJsonOptions_ACU = {},
): Promise<ImportTableJsonCommitResult_ACU> {
  const initialChat = getChatArray_ACU();
  const initialChatKey = String(currentChatFileIdentifier_ACU || '');
  const initialIsolationKey = String(getCurrentIsolationKey_ACU() || '');
  const scopeStillCurrent = () => getChatArray_ACU() === initialChat
    && String(currentChatFileIdentifier_ACU || '') === initialChatKey
    && String(getCurrentIsolationKey_ACU() || '') === initialIsolationKey;
  const scopeChangedResult = (): ImportTableJsonCommitResult_ACU => ({
    success: false,
    persisted: false,
    failureStage: 'preflight',
    error: 'import_scope_changed: 聊天或隔离作用域已切换，已取消导入。',
  });

  let newData: unknown;
  try {
    newData = JSON.parse(jsonString);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      persisted: false,
      failureStage: 'input',
      issues: [{ code: 'import_invalid_json', message }],
      error: `导入的JSON无法解析：${message}`,
    };
  }
  if (!newData || typeof newData !== 'object' || !('mate' in newData) || !Object.keys(newData).some(k => k.startsWith('sheet_'))) {
    return {
      success: false,
      persisted: false,
      failureStage: 'input',
      issues: [{ code: 'import_invalid_structure', message: '导入的JSON缺少关键结构 (mate, sheet_*)。' }],
      error: '导入的JSON缺少关键结构 (mate, sheet_*)。',
    };
  }

  const importedTableData = sanitizeChatSheetsObject_ACU(newData, { ensureMate: true }) as TableDataObject_ACU;
  const persist = options.persist !== false;

  if (!persist) {
    const restoreResult = await restoreRuntimeDataInTransaction_ACU({
      data: importedTableData,
      chatKey: initialChatKey,
      isolationKey: initialIsolationKey,
      scopeStillCurrent,
    });
    if (isRuntimeRestoreFailure_ACU(restoreResult)) {
      try {
        await reloadStorageProvider();
      } catch (_) {
        // 保留原始 replace/scope 错误；reload 失败不能掩盖首次失败。
      }
      return {
        success: false,
        persisted: false,
        failureStage: 'runtime_restore',
        error: restoreResult.error,
      };
    }
    const runtimeData = restoreResult.tableData;
    const sheetKeys = Object.keys(runtimeData).filter(k => k.startsWith('sheet_'));
    const hasSummaryTables = Object.keys(runtimeData)
      .filter(k => k.startsWith('sheet_'))
      .some(k => {
        const table = (runtimeData as any)?.[k];
        return Boolean(table?.name && isSummaryOrOutlineTable_ACU(table.name));
      });
    return {
      success: true,
      tableData: runtimeData,
      sheetKeys,
      hasSummaryTables,
      persisted: false,
    };
  }

  const audit = auditTableDataForUpgrade_ACU(importedTableData);
  const repair = repairTableDataFromAudit_ACU(audit);
  if (audit.status === 'unrecoverable' || repair.requiresConfirmation) {
    const diagnostics = audit.issues.map(issue => issue.code).join(', ') || audit.status;
    return {
      success: false,
      persisted: false,
      failureStage: 'preflight',
      auditStatus: audit.status,
      issues: audit.issues,
      error: `导入数据需要人工确认或无法修复：${diagnostics}`,
    };
  }
  const candidateData = repair.candidateData as TableDataObject_ACU;
  if (isSqliteMode()) {
    const sqlitePreflight = await validateSqliteTemplateDataStrict_ACU(candidateData, { allowRuntimeDdlFallback: true });
    if (!sqlitePreflight.success) {
      const message = sqlitePreflight.error || '候选数据无法通过 SQLite hydrate。';
      return {
        success: false,
        persisted: false,
        failureStage: 'preflight',
        auditStatus: audit.status,
        issues: [{ code: 'sqlite_preflight_failed', message }],
        error: `导入候选数据未通过 SQLite 预检：${message}`,
      };
    }
  } else {
    logDebug_ACU('[TableImport] 当前为 native 存储模式，跳过 SQLite hydrate 预检。');
  }
  if (!scopeStillCurrent()) return scopeChangedResult();
  const sheetKeys = Object.keys(candidateData).filter(k => k.startsWith('sheet_'));
  const targetMessageIndex = resolveLatestAiMessageIndex_ACU(initialChat);

  const commitResult = await runTableUpdateCommit_ACU<boolean>({
    source: 'import',
    reason: 'importTableAsJson',
    chatKey: initialChatKey,
    isolationKey: initialIsolationKey,
    writeSet: [{ kind: 'all' }],
    revisionWriteSet: [{ kind: 'all' }],
    initialData: currentJsonTableData_ACU,
    targetMessageIndex,
    targetSheetKeys: sheetKeys,
    updateGroupKeys: null,
    trackingSheetKeys: [],
    trackAsUpdate: false,
    strictSave: true,
  }, async () => {
    if (!scopeStillCurrent()) {
      return { success: false, error: 'import_scope_changed: 提交前作用域已切换。', errorCategory: 'precondition' as const };
    }
    const hasExistingAnchor = hasV2FullCheckpointAtOrBeforeTarget_ACU(
      targetMessageIndex,
      initialIsolationKey,
      initialChat,
    );
    return {
      success: true,
      value: true,
      tableData: candidateData,
      persist: {
        operations: hasExistingAnchor
          ? [{ kind: 'data_replace' as const, data: candidateData, reason: 'import' }]
          : [],
      },
    };
  });

  if (!commitResult.success || !commitResult.tableData) {
    return {
      success: false,
      persisted: false,
      failureStage: 'commit',
      error: commitResult.error || '导入数据提交失败。',
    };
  }

  const runtimeRestore = await restoreRuntimeDataInTransaction_ACU({
    data: commitResult.tableData,
    chatKey: initialChatKey,
    isolationKey: initialIsolationKey,
    scopeStillCurrent,
  });
  if (isRuntimeRestoreFailure_ACU(runtimeRestore)) {
    await reloadStorageProvider();
    return {
      success: false,
      persisted: true,
      failureStage: 'post_commit_runtime',
      error: runtimeRestore.scopeChanged
        ? runtimeRestore.error
        : `导入数据已保存，但运行时全量替换失败；已尝试重新加载运行时：${runtimeRestore.error}`,
    };
  }

  const hasSummaryTables = Object.keys(commitResult.tableData)
    .filter(k => k.startsWith('sheet_'))
    .some(k => {
      const table = (commitResult.tableData as any)?.[k];
      return Boolean(table?.name && isSummaryOrOutlineTable_ACU(table.name));
    });

  return {
    success: true,
    messageIndex: commitResult.messageIndex ?? targetMessageIndex,
    tableData: commitResult.tableData,
    sheetKeys,
    hasSummaryTables,
    persisted: true,
  };
}
