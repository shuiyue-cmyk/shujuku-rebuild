/**
 * useSqlConsole — SQL 控制台业务流编排
 *
 * v2 页面只依赖本 composable；SQLite provider / storage mode 调用集中在这里，
 * 避免页面直接接触 service 单例。
 */
import { computed, ref, shallowRef } from 'vue';
import type { SqlQueryResult } from '../../shared/table-storage-provider';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { ensureStorageProviderReady_ACU } from '../../service/table/table-storage-strategy';
import { isSqliteMode } from '../../service/table/storage-mode';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../../service/runtime/state-manager';
import { runSqliteRuntimeMutationCommit_ACU } from '../../service/table/table-update-commit';
import { isReadOnlySqlStatement_ACU } from '../../service/runtime/template-vars/read-only-sql-validation';
import { resolveCurrentRuntimeReadSql_ACU } from '../../service/runtime/read-query-resolver';
import { useToastStore } from '../stores/toast-store';

export type SqlConsoleMessageKind = 'info' | 'success' | 'warning' | 'error';
export type SqlResultKind = 'idle' | 'query' | 'mutation' | 'error';

export interface SqlConsoleMessage {
  kind: SqlConsoleMessageKind;
  text: string;
  at: number;
}

export interface SqlHistoryItem {
  sql: string;
  timestamp: number;
  success: boolean;
}

export interface SqlResultState {
  kind: SqlResultKind;
  columns: string[];
  values: SqlQueryResult['values'];
  rowCount: number;
  changes: number;
  elapsedMs: string;
  error: string;
}

export const SQL_CONSOLE_MAX_HISTORY = 50;

const sqlHistory = ref<SqlHistoryItem[]>([]);

export function isSqlConsoleQuery(sql: string): boolean {
  return isReadOnlySqlStatement_ACU(sql);
}

function emptyResult(): SqlResultState {
  return {
    kind: 'idle',
    columns: [],
    values: [],
    rowCount: 0,
    changes: 0,
    elapsedMs: '',
    error: '',
  };
}

function addHistory(sql: string, success: boolean): void {
  sqlHistory.value = [
    { sql, timestamp: Date.now(), success },
    ...sqlHistory.value,
  ].slice(0, SQL_CONSOLE_MAX_HISTORY);
}

export function __resetSqlConsoleHistoryForTests(): void {
  sqlHistory.value = [];
}

export function useSqlConsole() {
  const toast = useToastStore();
  const sqlText = ref('');
  const busyAction = ref('');
  const isSqliteAvailable = ref(false);
  const result = shallowRef<SqlResultState>(emptyResult());

  const history = computed(() => sqlHistory.value);
  const hasSqlText = computed(() => sqlText.value.trim().length > 0);
  const statusLabel = computed(() => {
    if (busyAction.value === 'execute') return '执行中...';
    if (result.value.kind === 'query') return `${result.value.rowCount} 行 · ${result.value.elapsedMs}ms`;
    if (result.value.kind === 'mutation') return `${result.value.changes} 行受影响 · ${result.value.elapsedMs}ms`;
    if (result.value.kind === 'error') return `失败 · ${result.value.elapsedMs}ms`;
    return '等待执行';
  });
  const statusKind = computed<SqlConsoleMessageKind>(() => {
    if (result.value.kind === 'error') return 'error';
    if (result.value.kind === 'query' || result.value.kind === 'mutation') return 'success';
    return isSqliteAvailable.value ? 'info' : 'warning';
  });

  function refresh(): void {
    isSqliteAvailable.value = isSqliteMode();
  }

  function setSql(sql: string): void {
    sqlText.value = sql;
  }

  function clearSql(): void {
    sqlText.value = '';
  }

  function showTables(): void {
    setSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_acu_%' ORDER BY name;");
    void executeCurrent();
  }

  function showSchema(): void {
    setSql("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_acu_%' ORDER BY name;");
    void executeCurrent();
  }

  function useHistoryItem(item: SqlHistoryItem): void {
    sqlText.value = item.sql;
    toast.info('已把历史 SQL 填入编辑器。');
  }

  async function executeCurrent(): Promise<void> {
    const sql = sqlText.value.trim();
    if (!sql) {
      toast.warning('SQL 语句不能为空。');
      return;
    }

    refresh();
    if (!isSqliteAvailable.value) {
      result.value = { ...emptyResult(), kind: 'error', error: 'SQL 控制台仅在 SQLite 模式下可用。' };
      toast.error('SQL 控制台仅在 SQLite 模式下可用。');
      return;
    }

    busyAction.value = 'execute';
    const startTime = performance.now();

    try {
      const provider = await ensureStorageProviderReady_ACU();
      if (isSqlConsoleQuery(sql)) {
        const queryResult = provider.executeQuery(resolveCurrentRuntimeReadSql_ACU(sql).sql);
        const elapsedMs = (performance.now() - startTime).toFixed(1);
        result.value = {
          ...emptyResult(),
          kind: 'query',
          columns: queryResult.columns,
          values: queryResult.values,
          rowCount: queryResult.rowCount,
          elapsedMs,
        };
        addHistory(sql, true);
        toast.success(queryResult.rowCount === 0 ? '查询成功，没有返回行。' : `查询成功，返回 ${queryResult.rowCount} 行。`);
        logDebug_ACU(`[ACU-V2 SQL Console] query ok: ${queryResult.rowCount} rows, ${elapsedMs}ms`);
        return;
      }

      const commitResult = await runSqliteRuntimeMutationCommit_ACU<null>({
        source: 'raw_sql_mutation',
        reason: 'sql_console_v2_mutation',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet: [{ kind: 'all' as const }],
        revisionWriteSet: [{ kind: 'all' as const }],
        initialData: currentJsonTableData_ACU as any,
        targetMessageIndex: -1,
        targetSheetKeys: null,
        updateGroupKeys: null,
        trackingSheetKeys: [],
        trackAsUpdate: false,
        sql,
        mapValue: () => null,
      });
      const mutationResult = commitResult.mutationResult || { changes: 0, errors: commitResult.error ? [commitResult.error] : [] };
      const elapsedMs = (performance.now() - startTime).toFixed(1);
      if (!commitResult.success || mutationResult.errors.length > 0) {
        const error = mutationResult.errors.join('\n') || commitResult.error || '执行失败';
        result.value = { ...emptyResult(), kind: 'error', elapsedMs, error };
        addHistory(sql, false);
        toast.error('执行失败，请检查结果区中的错误信息。');
        return;
      }

      result.value = {
        ...emptyResult(),
        kind: 'mutation',
        changes: mutationResult.changes,
        elapsedMs,
      };
      addHistory(sql, true);
      toast.success(`执行成功，${mutationResult.changes} 行受影响。`);
      logDebug_ACU(`[ACU-V2 SQL Console] mutation ok: ${mutationResult.changes} changes, ${elapsedMs}ms`);
    } catch (e: any) {
      const elapsedMs = (performance.now() - startTime).toFixed(1);
      const error = e?.message || String(e);
      result.value = { ...emptyResult(), kind: 'error', elapsedMs, error };
      addHistory(sql, false);
      toast.error('执行失败，请检查结果区中的错误信息。');
      logError_ACU(`[ACU-V2 SQL Console] execute failed: ${error}`);
    } finally {
      busyAction.value = '';
    }
  }

  return {
    sqlText,
    busyAction,
    isSqliteAvailable,
    result,
    history,
    hasSqlText,
    statusLabel,
    statusKind,
    refresh,
    setSql,
    clearSql,
    showTables,
    showSchema,
    useHistoryItem,
    executeCurrent,
  };
}
