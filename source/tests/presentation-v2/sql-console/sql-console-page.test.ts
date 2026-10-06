/**
 * AdvancedToolsPage SQL 面板集成 — SQL 控制台布局、执行与历史
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

async function mountAdvancedToolsSqlPanel(opts: {
  queryResult?: { columns: string[]; values: any[][]; rowCount: number };
  mutationResult?: { changes: number; errors: string[] };
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ router: { activePageId: 'advanced-tools' } }));

  const executeQuery = vi.fn(() => opts.queryResult ?? {
    columns: ['name'],
    values: [['背包物品表']],
    rowCount: 1,
  });
  const executeMutation = vi.fn(() => opts.mutationResult ?? { changes: 1, errors: [] });
  const provider = {
    executeQuery,
    executeMutation,
  };
  const getStorageProvider = vi.fn(() => provider);
  const ensureStorageProviderReady = vi.fn(async () => provider);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: {
      storageMode: 'sqlite',
      plotSettings: { enabled: false },
      summaryVectorIndexModeDefault: false,
    },
    currentJsonTableData_ACU: {},
    currentChatFileIdentifier_ACU: 'chat-sql',
    coreApisAreReady_ACU: true,
    isAutoUpdatingCard_ACU: false,
    getCurrentIsolationKey_ACU: () => '',
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    isSqliteMode: () => true,
    getCurrentStorageMode: () => 'sqlite',
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    isStorageRuntimeReadyForSyncRead_ACU: () => true,
    getStorageProvider,
    ensureStorageProviderReady_ACU: ensureStorageProviderReady,
  }));

  const sqlConsole = await import('../../../src/presentation-v2/composables/useSqlConsole');
  sqlConsole.__resetSqlConsoleHistoryForTests();

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));

  return {
    mount,
    executeQuery,
    executeMutation,
    getStorageProvider,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const page = () => document.querySelector<HTMLElement>('[data-ub-main]')!;
const sqlSection = () => page().querySelector<HTMLElement>('#at-sql')!;
const tick = () => new Promise(r => setTimeout(r, 0));
const buttonByText = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.trim() === text || button.textContent?.includes(text));

async function openHistory(): Promise<void> {
  const head = Array.from(sqlSection().querySelectorAll<HTMLButtonElement>('.ub-disc__head'))
    .find(button => button.textContent?.includes('执行历史'))!;
  if (head.getAttribute('aria-expanded') !== 'true') head.click();
  await tick();
}

describe('AdvancedToolsPage SQL panel', () => {
  it('高级工具页渲染 SQL 控制台、运行日志、Debug 三个分节，顶部标题为高级工具', async () => {
    const { mount } = await mountAdvancedToolsSqlPanel();

    const text = page().textContent || '';
    expect(text).toContain('SQL 控制台');
    expect(text).toContain('运行日志');
    expect(text).toContain('执行历史');
    expect(text).toContain('SQLite 模式');
    expect(sqlSection()).not.toBeNull();
    expect(page().querySelector('#at-logs')).not.toBeNull();
    expect(document.querySelector('.ub-top__title')?.textContent?.trim()).toBe('高级工具');

    mount.__resetAcuV2MountForTests();
  });

  it('输入 SELECT 后执行，展示查询表格并记录历史；点历史回填编辑器', async () => {
    const { mount, executeQuery } = await mountAdvancedToolsSqlPanel({
      queryResult: {
        columns: ['id', 'name'],
        values: [[1, '药水']],
        rowCount: 1,
      },
    });

    const textarea = sqlSection().querySelector<HTMLTextAreaElement>('textarea[aria-label="SQL 语句"]');
    expect(textarea).not.toBeNull();
    textarea!.value = 'SELECT id, name FROM item;';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    buttonByText(sqlSection(), '执行')!.click();
    await tick();

    expect(executeQuery).toHaveBeenCalledWith('SELECT id, name FROM item;');
    const result = sqlSection().querySelector('[aria-label="SQL 执行结果"]')!;
    expect(result.textContent).toContain('药水');
    expect(result.textContent).toContain('1 行');

    buttonByText(sqlSection(), '清空')!.click();
    await tick();
    expect(textarea!.value).toBe('');

    await openHistory();
    const historyItem = sqlSection().querySelector<HTMLButtonElement>('.ub-at__history');
    expect(historyItem).not.toBeNull();
    expect(historyItem!.tagName).toBe('BUTTON');
    expect(historyItem!.classList.contains('is-ok')).toBe(true);
    expect(historyItem!.textContent).toContain('成功');
    expect(historyItem!.querySelector('code')?.textContent).toBe('SELECT id, name FROM item;');
    historyItem!.click();
    await tick();
    expect(textarea!.value).toBe('SELECT id, name FROM item;');

    mount.__resetAcuV2MountForTests();
  });

  it('快捷查看所有表会填入 SQL 并立即执行', async () => {
    const { mount, executeQuery } = await mountAdvancedToolsSqlPanel();

    buttonByText(sqlSection(), '查看所有表')!.click();
    await tick();

    expect(executeQuery).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'));
    const textarea = sqlSection().querySelector<HTMLTextAreaElement>('textarea[aria-label="SQL 语句"]');
    expect(textarea?.value).toContain('sqlite_master');
    expect(sqlSection().textContent || '').toContain('背包物品表');

    mount.__resetAcuV2MountForTests();
  });

  it('执行变更失败时展示错误结果，历史记为失败', async () => {
    const { mount, executeMutation } = await mountAdvancedToolsSqlPanel({
      mutationResult: { changes: 0, errors: ['no such table: item'] },
    });

    const textarea = sqlSection().querySelector<HTMLTextAreaElement>('textarea[aria-label="SQL 语句"]')!;
    textarea.value = "UPDATE item SET name = 'x';";
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    buttonByText(sqlSection(), '执行')!.click();
    await tick();

    expect(executeMutation).toHaveBeenCalledWith("UPDATE item SET name = 'x';", undefined);
    expect(sqlSection().querySelector('.ub-at__error')?.textContent).toContain('no such table: item');
    await openHistory();
    expect(sqlSection().querySelector('.ub-at__history.is-fail')?.textContent).toContain('失败');

    mount.__resetAcuV2MountForTests();
  });
});
