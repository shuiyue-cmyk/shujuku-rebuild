/**
 * useSqlConsole.test — SQL 控制台 composable
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function mockSqlConsoleDeps(opts: {
  sqlite?: boolean;
  queryResult?: { columns: string[]; values: any[][]; rowCount: number };
  mutationResult?: { changes: number; errors: string[] };
  queryError?: Error;
  deferProviderReady?: boolean;
}) {
  const executeQuery = vi.fn(() => {
    if (opts.queryError) throw opts.queryError;
    return opts.queryResult ?? { columns: ['name'], values: [['items']], rowCount: 1 };
  });
  let currentChatIdentity = 'chat-a';
  const executeMutation = vi.fn(() => opts.mutationResult ?? { changes: 2, errors: [] });
  const provider = {
    executeQuery,
    executeMutation,
    getCurrentData: vi.fn(() => ({ mate: { type: 'acu', version: 1 }, sheet_0: { name: 'T', content: [['row_id'], ['1']] } })),
  };
  const getStorageProvider = vi.fn(() => provider);
  const resolveCurrentRuntimeReadSql = vi.fn((sql: string) => ({ sql, tableRebindCount: 0, columnRebindCount: 0 }));
  let releaseProviderReady: (() => void) | null = null;
  const providerReadyPromise = opts.deferProviderReady
    ? new Promise<void>((resolve) => { releaseProviderReady = resolve; })
    : Promise.resolve();
  const ensureStorageProviderReady = vi.fn(async () => {
    await providerReadyPromise;
    return provider;
  });

  vi.doMock('../../../src/service/table/storage-mode', () => ({
    isSqliteMode: () => opts.sqlite !== false,
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    isStorageRuntimeReadyForSyncRead_ACU: () => true,
    getStorageProvider,
    ensureStorageProviderReady_ACU: ensureStorageProviderReady,
  }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: { toastMuteEnabled: false },
    currentJsonTableData_ACU: { mate: { type: 'acu', version: 1 }, sheet_0: { name: 'T', content: [['row_id'], ['1']] } },
    get currentChatFileIdentifier_ACU() { return currentChatIdentity; },
    isAutoUpdatingCard_ACU: false,
    getCurrentIsolationKey_ACU: vi.fn(() => 'iso-a'),
    _set_currentJsonTableData_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/table/table-service', () => ({
    ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn().mockResolvedValue({ success: true, migrated: false }),
    persistTablesToChatMessage_ACU: vi.fn().mockResolvedValue({ saved: true, messageIndex: 1 }),
  }));
  vi.doMock('../../../src/service/table/table-write-transaction', () => ({
    runTableWriteTransaction_ACU: vi.fn(async (_options: any, task: any) => task({
      transactionId: 'tx-test',
      chatKey: 'chat-a',
      isolationKey: 'iso-a',
      source: _options.source,
      baseRevision: null,
      writeSet: _options.writeSet,
      runCommit: async (commitTask: any) => commitTask(),
    }, _options.initialData || null)),
  }));
  vi.doMock('../../../src/service/runtime/read-query-resolver', () => ({
    resolveCurrentRuntimeReadSql_ACU: resolveCurrentRuntimeReadSql,
  }));

  return {
    executeQuery,
    executeMutation,
    getStorageProvider,
    resolveCurrentRuntimeReadSql,
    ensureStorageProviderReady,
    setChatIdentity: (value: string) => { currentChatIdentity = value; },
    releaseProviderReady: () => releaseProviderReady?.(),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('useSqlConsole', () => {
  async function freshFlow() {
    const [{ createPinia, setActivePinia }, { useSqlConsole, __resetSqlConsoleHistoryForTests }, { useToastStore }] =
      await Promise.all([
        import('pinia'),
        import('../../../src/presentation-v2/composables/useSqlConsole'),
        import('../../../src/presentation-v2/stores/toast-store'),
      ]);
    setActivePinia(createPinia());
    __resetSqlConsoleHistoryForTests();
    return { flow: useSqlConsole(), toast: useToastStore() };
  }

  it('空 SQL 不调用 provider，并提示 warning', async () => {
    const deps = mockSqlConsoleDeps({});
    const { flow, toast } = await freshFlow();
    await flow.executeCurrent();

    expect(deps.getStorageProvider).not.toHaveBeenCalled();
    expect(toast.items.at(-1)).toMatchObject({ kind: 'warning' });
    expect(flow.history.value).toHaveLength(0);
  });

  it('执行 SELECT 查询后写入查询结果和成功历史', async () => {
    const deps = mockSqlConsoleDeps({
      queryResult: {
        columns: ['id', 'name'],
        values: [[1, 'Potion']],
        rowCount: 1,
      },
    });
    const { flow } = await freshFlow();
    flow.sqlText.value = 'SELECT id, name FROM item;';
    await flow.executeCurrent();

    expect(deps.resolveCurrentRuntimeReadSql).toHaveBeenCalledWith('SELECT id, name FROM item;');
    expect(deps.executeQuery).toHaveBeenCalledWith('SELECT id, name FROM item;');
    expect(flow.result.value.kind).toBe('query');
    expect(flow.result.value.columns).toEqual(['id', 'name']);
    expect(flow.result.value.values).toEqual([[1, 'Potion']]);
    expect(flow.history.value[0]).toMatchObject({ sql: 'SELECT id, name FROM item;', success: true });
    expect(flow.statusKind.value).toBe('success');
  });

  it('执行变更语句失败时写入错误结果和失败历史', async () => {
    const deps = mockSqlConsoleDeps({
      mutationResult: { changes: 0, errors: ['no such table: item'] },
    });
    const { flow, toast } = await freshFlow();
    flow.sqlText.value = "UPDATE item SET name = 'x';";
    await flow.executeCurrent();

    expect(deps.executeMutation).toHaveBeenCalledWith("UPDATE item SET name = 'x';", undefined);
    expect(flow.result.value.kind).toBe('error');
    expect(flow.result.value.error).toContain('no such table');
    expect(flow.history.value[0]).toMatchObject({ success: false });
    expect(toast.items.at(-1)).toMatchObject({ kind: 'error' });
  });

  it('聊天切换会清空 SQL 历史，历史项不能被当作当前聊天执行', async () => {
    const deps = mockSqlConsoleDeps({});
    const { flow } = await freshFlow();
    flow.sqlText.value = "UPDATE item SET name = 'A';";
    await flow.executeCurrent();
    expect(flow.history.value).toHaveLength(1);

    deps.setChatIdentity('chat-b');
    flow.clearResult();
    flow.clearHistory();

    expect(flow.history.value).toHaveLength(0);
  });

  it('provider 等待期间切换聊天会拒绝旧 SQL 执行', async () => {
    const deps = mockSqlConsoleDeps({ deferProviderReady: true });
    const { flow } = await freshFlow();
    flow.sqlText.value = "UPDATE item SET name = 'A';";
    const pending = flow.executeCurrent();
    await Promise.resolve();
    deps.setChatIdentity('chat-b');
    deps.releaseProviderReady();
    await pending;

    expect(deps.executeMutation).not.toHaveBeenCalled();
    expect(flow.history.value).toHaveLength(0);
    expect(flow.result.value.kind).toBe('error');
  });

  it('非 SQLite 模式下拒绝执行', async () => {
    const deps = mockSqlConsoleDeps({ sqlite: false });
    const { flow } = await freshFlow();
    flow.sqlText.value = 'SELECT 1;';
    await flow.executeCurrent();

    expect(deps.getStorageProvider).not.toHaveBeenCalled();
    expect(flow.result.value.kind).toBe('error');
    expect(flow.result.value.error).toContain('SQLite 模式');
    expect(flow.history.value).toHaveLength(0);
  });
});
