/**
 * R10A-11：SQL 控制台
 * - 执行中再次触发（Ctrl+Enter 连按/按住）不得排进第二次写入；
 * - 提交成功后才发现聊天已切换时，如实说明「已在原聊天提交」，而不是「已拒绝执行」（否则用户回去重做就重复写入）。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chatIdentity: 'chat-a',
  commit: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return h.chatIdentity; },
  currentJsonTableData_ACU: {},
  getCurrentIsolationKey_ACU: () => '',
}));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: () => true }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: vi.fn(async () => ({ executeQuery: vi.fn() })),
}));
vi.mock('../../../src/service/table/table-update-commit', () => ({
  runSqliteRuntimeMutationCommit_ACU: (...args: any[]) => h.commit(...args),
}));

beforeEach(async () => {
  h.chatIdentity = 'chat-a';
  h.commit.mockReset();
  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
});

describe('useSqlConsole（R10A-11）', () => {
  it('执行中再次触发不会重复提交写语句', async () => {
    const { useSqlConsole } = await import('../../../src/presentation-v2/composables/useSqlConsole');
    let release!: () => void;
    h.commit.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ success: true, mutationResult: { changes: 1, errors: [] } });
    }));
    const sqlConsole = useSqlConsole();
    sqlConsole.setSql("INSERT INTO t (a) VALUES ('x');");

    const first = sqlConsole.executeCurrent();
    await vi.waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
    await sqlConsole.executeCurrent();
    release();
    await first;

    expect(h.commit).toHaveBeenCalledOnce();
  });

  it('提交成功后才切换聊天时提示已在原聊天提交，不说已拒绝执行', async () => {
    const { useSqlConsole } = await import('../../../src/presentation-v2/composables/useSqlConsole');
    h.commit.mockImplementationOnce(async () => {
      h.chatIdentity = 'chat-b';
      return { success: true, mutationResult: { changes: 2, errors: [] } };
    });
    const sqlConsole = useSqlConsole();
    sqlConsole.setSql("UPDATE t SET a = 'y';");

    await sqlConsole.executeCurrent();

    const text = JSON.stringify(sqlConsole.result.value);
    expect(text).toContain('已在原聊天提交');
    expect(text).not.toContain('已拒绝执行');
  });
});
