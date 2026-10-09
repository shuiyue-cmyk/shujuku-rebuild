/**
 * AdvancedToolsPage 日志面板集成 — 运行日志布局、筛选与实时订阅
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

async function waitForUi(ms = 0) {
  await new Promise(r => setTimeout(r, ms));
}

async function mountAdvancedToolsLogPanel(seedLogs = true, warnLogEnabled = seedLogs) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    router: { activePageId: 'advanced-tools' },
    devOptions: { warnLogEnabled },
  }));

  const logBuffer = await import('../../../src/shared/log-buffer');
  if (seedLogs) {
    logBuffer.setDebugLogEnabled(true);
    logBuffer.pushLog('debug', ['[ACU]', '[调试] Debug 初始化日志']);
    logBuffer.pushLog('warn', ['[ACU]', '[SQL] 警告日志']);
    logBuffer.pushLog('error', ['[ACU]', '[导入] 错误日志']);
    logBuffer.setDebugLogEnabled(false);
  }

  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:acu-log-test'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await waitForUi();

  return {
    mount,
    logBuffer,
  };
}

function getPage(): HTMLElement {
  const page = document.querySelector<HTMLElement>('[data-ub-main]');
  expect(page).not.toBeNull();
  return page!;
}

function logSection(): HTMLElement {
  return getPage().querySelector<HTMLElement>('#at-logs')!;
}

function logList(): HTMLElement {
  return logSection().querySelector<HTMLElement>('.ub-at__loglist')!;
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(logSection().querySelectorAll<HTMLButtonElement>('button'))
    .find(el => el.textContent?.includes(label));
  expect(button).not.toBeUndefined();
  return button!;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AdvancedToolsPage log panel', () => {

  it('按级别和关键词筛选日志列表', async () => {
    const { mount } = await mountAdvancedToolsLogPanel();

    const levelSelect = logSection().querySelector<HTMLSelectElement>('select[aria-label="日志级别"]');
    expect(levelSelect).not.toBeNull();
    levelSelect!.value = 'error';
    levelSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForUi();

    let text = logList().textContent || '';
    expect(text).toContain('错误日志');
    expect(text).not.toContain('警告日志');

    const search = logSection().querySelector<HTMLInputElement>('input[aria-label="搜索日志内容"]')!;
    search.value = '不存在的关键词';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForUi();

    text = logList().textContent || '';
    expect(text).toContain('暂无匹配日志');

    mount.__resetAcuV2MountForTests();
  });

  it('Debug 分节「开始 Debug」开启全部采集（debug+warn），日志进入缓冲区', async () => {
    const { mount, logBuffer } = await mountAdvancedToolsLogPanel(false, false);

    expect(logBuffer.isDebugLogEnabled()).toBe(false);
    logBuffer.pushLog('debug', ['[ACU]', '[调试] 未开启不应出现']);
    await waitForUi(30);
    expect(getPage().textContent || '').not.toContain('未开启不应出现');

    const debugStartButton = Array.from(getPage().querySelectorAll<HTMLButtonElement>('button'))
      .find(el => el.textContent?.includes('开始 Debug'));
    expect(debugStartButton).not.toBeUndefined();
    debugStartButton!.click();
    await waitForUi();

    expect(logBuffer.isDebugLogEnabled()).toBe(true);
    expect(logBuffer.isWarnLogEnabled()).toBe(true);

    logBuffer.pushLog('debug', ['[ACU]', '[调试] Debug 已采集']);
    logBuffer.pushLog('warn', ['[ACU]', '[SQL] Warn 已采集']);
    await waitForUi(30);

    const text = logList().textContent || '';
    expect(text).toContain('Debug 已采集');
    expect(text).toContain('Warn 已采集');

    mount.__resetAcuV2MountForTests();
  });

  it('暂停时新日志进入积压，恢复后刷新显示', async () => {
    const { mount, logBuffer } = await mountAdvancedToolsLogPanel(false, true);

    findButton('暂停').click();
    await waitForUi();
    logBuffer.pushLog('warn', ['[ACU]', '[暂停测试] 暂停期间新增']);
    await waitForUi(30);

    expect(logSection().textContent || '').toContain('1 条暂停期间新增日志等待显示');
    expect(logList().textContent || '').not.toContain('暂停期间新增');

    findButton('继续').click();
    await waitForUi();

    expect(logList().textContent || '').toContain('暂停期间新增');
    expect(logSection().textContent || '').toContain('实时更新中');

    mount.__resetAcuV2MountForTests();
  });
});
