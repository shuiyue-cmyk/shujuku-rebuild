/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const STORAGE_KEY = 'acu_v2_ui_state';

function persistAdvancedMode(activePageId = 'dashboard'): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      uiMode: { mode: 'advanced' },
      router: { activePageId },
    }),
  );
}

async function resetMountedApp(): Promise<void> {
  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  mount.__resetAcuV2MountForTests();
}

function setParent(parent: any): void {
  Object.defineProperty(window, 'parent', {
    value: parent,
    writable: true,
    configurable: true,
  });
}

type SheetMap = Record<string, { name: string; content: any[][]; [key: string]: unknown }>;

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

const buttonByText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes(text));

const preview = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-ub-viz-field-preview]')).find(item => item.textContent?.trim() === text)!;

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 写入当前聊天表格数据后，从外部入口打开数据库编辑器。 */
async function openWith(sheets: SheetMap) {
  persistAdvancedMode();
  const state = await import('../../../src/service/runtime/state-manager');
  const data: Record<string, unknown> = { mate: { type: 'chatSheets', version: 1 } };
  Object.entries(sheets).forEach(([key, sheet], orderNo) => {
    data[key] = { uid: key, orderNo, ...sheet };
  });
  state._set_currentJsonTableData_ACU(data);
  const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
  await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
  await tick();
  const visualizer = useVisualizerStore(mount.getAcuV2PiniaForBridge()!);
  const surface = document.querySelector<HTMLElement>('[data-ub-viz]')!;
  return { mount, visualizer, surface };
}

// 每个用例都会 resetModules 后冷启动完整模块图；仅放宽本夹具的初始化预算。
beforeEach(async () => {
  vi.resetModules();
  setParent(window);
  delete (window as any).AutoCardUpdaterV2API;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
  bridge.installAutoCardUpdaterV2Api_ACU();
}, 60_000);

describe('openVisualizerSurface_ACU', () => {
  it('外部调用会打开面板并进入数据库编辑器，关闭后隐藏面板', async () => {
    persistAdvancedMode();
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');

    const result = await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await Promise.resolve();

    expect(result).toBe(true);
    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    const surface = document.querySelector('[data-ub-viz]');
    expect(surface).not.toBeNull();
    expect(surface?.textContent).toContain('数据库编辑器');
    expect(surface?.textContent).not.toContain('无法载入数据库');

    document.querySelector<HTMLButtonElement>('[data-ub-viz-close]')!.click();
    await tick();

    expect(document.getElementById('acu-app-v2')?.style.display).toBe('none');
    await resetMountedApp();
  });

  it('面板已打开时进入编辑器，关闭后回到进入前的页面', async () => {
    persistAdvancedMode('dashboard');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    await mount.openAcuV2App();
    await Promise.resolve();
    expect(document.querySelector('.ub-top__title')?.textContent).toContain('仪表盘');

    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await Promise.resolve();
    expect(document.querySelector('[data-ub-viz]')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-ub-viz-close]')!.click();
    await tick();

    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    expect(document.querySelector('.ub-top__title')?.textContent).toContain('仪表盘');
    mount.__resetAcuV2MountForTests();
  });

  it('R10B-06：面板已打开且当前页有未保存修改时，外部打开编辑器先过页面守卫，拒绝则不打开', async () => {
    persistAdvancedMode('dashboard');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    await mount.openAcuV2App();
    await Promise.resolve();
    const { registerUiCloseGuard } = await import('../../../src/presentation-v2/composables/useUiCloseGuard');
    const unregister = registerUiCloseGuard(() => false);

    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const result = await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await Promise.resolve();
    unregister();

    expect(result).toBe(false);
    expect(document.querySelector('[data-ub-viz]')).toBeNull();
    expect(document.querySelector('.ub-top__title')?.textContent).toContain('仪表盘');
    mount.__resetAcuV2MountForTests();
  });

  it('安装独立 v2 全局接口：未打开时忽略；打开后按数据源 revision 决定是否重载', async () => {
    persistAdvancedMode();
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const state = await import('../../../src/service/runtime/state-manager');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    expect(typeof (window as any).AutoCardUpdaterV2API?.open).toBe('function');
    expect(typeof (window as any).AutoCardUpdaterV2API?.openVisualizer).toBe('function');
    expect(typeof (window as any).AutoCardUpdaterV2API?.refreshVisualizer).toBe('function');

    // 未打开：请求被忽略。
    await (window as any).AutoCardUpdaterV2API.refreshVisualizer();
    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(resolve => setTimeout(resolve, 600));
    const pinia = mount.getAcuV2PiniaForBridge();
    expect(pinia).not.toBeNull();
    expect(useVisualizerStore(pinia!).externalRefreshTick).toBe(0);

    // 已打开但数据源没变（打开时已载入同一份）：请求被 revision 守卫跳过，不重载。
    await (window as any).AutoCardUpdaterV2API.refreshVisualizer();
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(useVisualizerStore(pinia!).externalRefreshTick).toBe(0);

    // 外部真的改了表数据：请求先进 500ms 合并窗口（同轮多条通知合并为一次重载），
    // 窗口末尾才结算成一次 ++externalRefreshTick。
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: '外部改动', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    });
    await (window as any).AutoCardUpdaterV2API.refreshVisualizer();
    expect(useVisualizerStore(pinia!).externalRefreshTick).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(useVisualizerStore(pinia!).externalRefreshTick).toBe(1);
    mount.__resetAcuV2MountForTests();
  });

  it('全局 open 接口只打开面板，不进入数据库编辑器', async () => {
    persistAdvancedMode('api');
    await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');

    const result = await (window as any).AutoCardUpdaterV2API.open();
    await Promise.resolve();

    expect(result).toBe(true);
    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    expect(document.querySelector('.ub-top__title')?.textContent).toContain('API');
    expect(document.querySelector('[data-ub-viz]')).toBeNull();
    await resetMountedApp();
  });

  it('全局 v2 接口会同步挂到宿主 window', async () => {
    const parentDom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    setParent(parentDom.window);
    vi.resetModules();
    try {
      const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
      bridge.installAutoCardUpdaterV2Api_ACU();

      expect(typeof (window as any).AutoCardUpdaterV2API?.open).toBe('function');
      expect(typeof (parentDom.window as any).AutoCardUpdaterV2API?.open).toBe('function');

      const result = await (parentDom.window as any).AutoCardUpdaterV2API.open();
      await Promise.resolve();

      expect(result).toBe(true);
      expect(parentDom.window.document.getElementById('acu-app-v2')?.style.display).toBe('');
      expect(document.getElementById('acu-app-v2')).toBeNull();
      await resetMountedApp();
    } finally {
      parentDom.window.close();
      delete (window as any).AutoCardUpdaterV2API;
      setParent(window);
    }
  });

  it('载入当前数据后可编辑卡片，有未保存修改时关闭会被拦下', async () => {
    const { mount, visualizer, surface } = await openWith({
      sheet_a: { name: '角色状态', content: [[null, '姓名', '状态'], [null, 'A', '平静']] },
    });
    expect(surface.querySelector('[data-ub-viz-nav]')!.textContent).toContain('1 行 · 2 列');
    const head = surface.querySelector<HTMLElement>('[data-ub-viz-head]')!;
    expect(head.textContent).toContain('模板');
    expect(head.textContent).toContain('角色状态');
    expect(head.textContent).not.toContain('已同步');
    const cards = surface.querySelector('.ub-vdata__cards')!;
    const addRow = buttonByText(surface, '新增一行')!;
    expect(Boolean(cards.compareDocumentPosition(addRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    preview(surface, '平静').click();
    await tick();
    const textarea = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea')).find(item => item.value === '平静')!;
    type(textarea, '紧张');
    await Promise.resolve();
    expect(visualizer.dirty).toBe(true);
    expect(visualizer.currentSheet.content[1][2]).toBe('紧张');

    document.querySelector<HTMLButtonElement>('[data-ub-viz-close]')!.click();
    await tick();
    expect(document.body.textContent).toContain('关闭数据库编辑器');
    buttonByText(document, '取消关闭')!.click();
    await tick();
    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    expect(document.querySelector('[data-ub-viz]')).not.toBeNull();
    mount.__resetAcuV2MountForTests();
  });

  it('新增行后跳到最后一页并把新卡片滚入视野', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const rows = Array.from({ length: 30 }, (_, index) => [null, `角色 ${index + 1}`]);
    const { mount, visualizer, surface } = await openWith({ sheet_a: { name: '滚动验证', content: [[null, '姓名'], ...rows] } });
    scrollIntoView.mockClear();

    buttonByText(surface, '新增一行')!.click();
    await tick();

    expect(visualizer.currentSheet.content).toHaveLength(32);
    const cards = surface.querySelectorAll<HTMLElement>('[data-ub-viz-card]');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('#31');
    expect(scrollIntoView).toHaveBeenCalled();
    mount.__resetAcuV2MountForTests();
  });

  it('删除行的确认框挂在编辑器外的浮层里，确认后才修改草稿', async () => {
    const { mount, visualizer, surface } = await openWith({
      sheet_a: { name: '角色状态', content: [[null, '姓名'], [null, 'A'], [null, 'B']] },
    });
    const firstDelete = surface.querySelector<HTMLButtonElement>('button[title="删除这一行"]')!;
    firstDelete.click();
    await tick();

    let layer = document.querySelector<HTMLElement>('.ub-dialog-layer')!;
    expect(layer).not.toBeNull();
    expect(layer.closest('#ub-portal')).not.toBeNull();
    expect(surface.contains(layer)).toBe(false);
    expect(layer.textContent).toContain('删除数据行');
    expect(layer.textContent).toContain('确定要删除第 1 行吗？');
    buttonByText(layer, '取消')!.click();
    await tick(250);
    expect(visualizer.currentSheet.content).toHaveLength(3);

    firstDelete.click();
    await tick();
    layer = document.querySelector<HTMLElement>('.ub-dialog-layer')!;
    buttonByText(layer, '删除这一行')!.click();
    await tick();
    expect(visualizer.currentSheet.content).toEqual([[null, '姓名'], [null, 'B']]);
    mount.__resetAcuV2MountForTests();
  });

  it('R10B-14：确认删除期间数据被外部重载时，不删掉重载后同一下标的另一行', async () => {
    const { mount, visualizer, surface } = await openWith({
      sheet_a: { name: '角色状态', content: [[null, '姓名'], ['r1', 'A'], ['r2', 'B']] },
    });
    surface.querySelector<HTMLButtonElement>('button[title="删除这一行"]')!.click();
    await tick();

    // 确认框打开期间，后台填表提交触发外部重载：第一行换成了新数据
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', orderNo: 0, name: '角色状态', content: [[null, '姓名'], ['r9', '新来的'], ['r1', 'A'], ['r2', 'B']] },
    }, ['sheet_a']);
    visualizer.selectSheet('sheet_a');
    await tick();

    const layer = document.querySelector<HTMLElement>('.ub-dialog-layer')!;
    buttonByText(layer, '删除这一行')!.click();
    await tick();
    expect(visualizer.currentSheet.content.map((row: any[]) => row[0])).toEqual([null, 'r9', 'r2']);
    mount.__resetAcuV2MountForTests();
  });

  it('R10B-15：保存进行中编辑控件禁用，关闭编辑器被拦下且不复位保存状态', async () => {
    const { mount, visualizer, surface } = await openWith({
      sheet_a: { name: '角色状态', content: [[null, '姓名'], ['r1', 'A']] },
    });
    visualizer.setDirty(true);
    visualizer.setSaving(true);
    await tick();

    const deleteButton = surface.querySelector<HTMLButtonElement>('button[title="删除这一行"]')!;
    expect(deleteButton.matches(':disabled')).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-ub-viz-close]')!.click();
    await tick();
    expect(document.querySelector('.ub-dialog-layer')).toBeNull();
    expect(visualizer.isActive).toBe(true);
    expect(visualizer.isSaving).toBe(true);
    visualizer.setSaving(false);
    mount.__resetAcuV2MountForTests();
  });

  it('单元格输入跨过长短布局阈值时编辑框保持焦点', async () => {
    const { mount, surface } = await openWith({
      sheet_a: { name: '角色状态', content: [[null, '姓名', '状态'], [null, 'A', '平静']] },
    });
    preview(surface, '平静').click();
    await tick();
    const textarea = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea')).find(item => item.value === '平静')!;
    expect(document.activeElement).toBe(textarea);

    type(textarea, '这是一段超过二十四个字符的状态描述，用来触发布局切换');
    await Promise.resolve();
    expect(document.activeElement).toBe(textarea);
    expect(surface.contains(textarea)).toBe(true);
    mount.__resetAcuV2MountForTests();
  });

  it('大表只渲染当前页；可翻页、跳页，点单元格后才挂载编辑框', async () => {
    const pageSize = 30;
    const total = 120;
    const rows = Array.from({ length: total }, (_, index) => [null, `A${index + 1}`, `状态 ${index + 1}`]);
    const { mount, visualizer, surface } = await openWith({ sheet_a: { name: '大表验证', content: [[null, '姓名', '状态'], ...rows] } });
    const cards = () => Array.from(surface.querySelectorAll<HTMLElement>('[data-ub-viz-card]'));

    expect(cards()).toHaveLength(pageSize);
    expect(cards()[0].textContent).toContain('#1');
    expect(cards()[pageSize - 1].textContent).toContain(`#${pageSize}`);
    expect(surface.querySelectorAll('textarea')).toHaveLength(0);
    expect(surface.textContent).toContain(`第 1–${pageSize} 行 · 共 ${total} 行`);

    surface.querySelector<HTMLButtonElement>('button[title="下一页"]')!.click();
    await tick();
    expect(cards()[0].textContent).toContain(`#${pageSize + 1}`);
    expect(surface.textContent).toContain(`第 ${pageSize + 1}–${pageSize * 2} 行 · 共 ${total} 行`);

    const jump = surface.querySelector<HTMLInputElement>('input[aria-label="跳转到页码"]')!;
    jump.value = '3';
    jump.dispatchEvent(new Event('input', { bubbles: true }));
    jump.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(cards()).toHaveLength(pageSize);
    expect(cards()[0].textContent).toContain(`#${pageSize * 2 + 1}`);

    surface.querySelector<HTMLButtonElement>('button[title="上一页"]')!.click();
    await tick();
    preview(surface, '状态 51').click();
    await tick();
    const textarea = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea')).find(item => item.value === '状态 51')!;
    expect(document.activeElement).toBe(textarea);
    type(textarea, '已更新');
    await Promise.resolve();
    expect(visualizer.currentSheet.content[51][2]).toBe('已更新');
    mount.__resetAcuV2MountForTests();
  });

  it('字段按表格列顺序排布，只有相邻两个短字段才并排', async () => {
    const { mount, surface } = await openWith({
      sheet_a: {
        name: '布局验证表',
        content: [
          [null, '短A', '短B', '长C', '短D', '短E', '短F'],
          [null, 'A', 'B', 'C', 'D', 'E', 'F'],
          [null, 'AA', 'BB', '这是一段超过二十四个字符的长内容，用来验证整列会独占整行。', 'DD', 'EE', 'FF'],
        ],
      },
    });
    const card = surface.querySelector<HTMLElement>('[data-ub-viz-card]')!;
    const fields = Array.from(card.querySelectorAll<HTMLElement>('[data-ub-viz-field]'));
    expect(fields.map(field => field.querySelector('.ub-vfield__name')?.textContent?.trim()))
      .toEqual(['短A', '短B', '长C', '短D', '短E', '短F']);
    expect(fields.map(field => field.dataset.ubVizFieldLayout)).toEqual(['half', 'half', 'wide', 'half', 'half', 'wide']);
    expect(Array.from(card.querySelectorAll<HTMLElement>('[data-ub-viz-line]')).map(line => line.dataset.ubVizLine))
      .toEqual(['half', 'wide', 'half', 'wide']);
    mount.__resetAcuV2MountForTests();
  });

  it('结构视图可改参数、开独立导出、改列名不丢焦点；数据库管理可见表格与全局注入', async () => {
    const { mount, visualizer, surface } = await openWith({
      sheet_a: {
        name: '角色状态',
        content: [[null, '姓名', '状态'], [null, 'A', '平静']],
        sourceData: { note: '角色状态说明' },
        updateConfig: {},
        exportConfig: {},
      },
    });
    buttonByText(surface.querySelector('[data-ub-viz-modes]')!, '结构')!.click();
    await tick();
    const config = surface.querySelector<HTMLElement>('[data-ub-viz-config]')!;
    expect(config.textContent).toContain('自动更新参数');
    expect(config.textContent).toContain('世界书注入');
    expect(config.textContent).toContain('启用独立导出');
    expect(config.textContent).not.toContain('条目名称');
    expect(config.textContent).not.toContain('主条目位置');

    type(config.querySelector<HTMLInputElement>('input[aria-label="上下文层数"]')!, '9');
    await Promise.resolve();
    config.querySelector<HTMLButtonElement>('[role="switch"][aria-label="启用独立导出"]')!.click();
    await tick();
    expect(config.textContent).toContain('条目名称');
    expect(config.textContent).toContain('条目类型');
    expect(config.textContent).toContain('主条目位置');

    type(config.querySelector<HTMLInputElement>('input[aria-label="主条目位置：深度"]')!, '7');
    type(config.querySelector<HTMLInputElement>('input[aria-label="主条目位置：顺序"]')!, '12345');
    await tick();
    expect(visualizer.currentSheet.updateConfig.contextDepth).toBe(9);
    expect(visualizer.currentSheet.exportConfig.entryPlacement).toEqual({ position: 'at_depth_as_system', depth: 7, order: 12345 });

    const headerInput = config.querySelector<HTMLInputElement>('.ub-vconf__col input')!;
    headerInput.focus();
    type(headerInput, '姓');
    await Promise.resolve();
    expect(visualizer.currentSheet.content[0][1]).toBe('姓');
    expect(document.activeElement).toBe(headerInput);
    expect(config.querySelector<HTMLInputElement>('.ub-vconf__col input')).toBe(headerInput);

    buttonByText(surface.querySelector('[data-ub-viz-nav]')!, '数据库管理')!.click();
    await tick();
    const manage = surface.querySelector<HTMLElement>('[data-ub-viz-manage]')!;
    expect(manage.textContent).toContain('可读数据条目位置');
    expect(manage.textContent).toContain('角色状态');
    expect(buttonByText(manage, '新增表格')).not.toBeUndefined();
    expect(surface.querySelector('[data-ub-viz-modes]')).toBeNull();
    mount.__resetAcuV2MountForTests();
  });

  it('手机上点顶部表名打开表格列表，选表后自动收起', async () => {
    const { mount, visualizer, surface } = await openWith({
      sheet_a: { name: '角色状态', content: [[null, '姓名'], [null, 'A']] },
      sheet_b: { name: '事件记录', content: [[null, '事件'], [null, '初遇']] },
    });
    surface.querySelector<HTMLButtonElement>('.ub-viz__switcher')!.click();
    await tick();
    const sheet = document.querySelector<HTMLElement>('#ub-portal .ub-sheet')!;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('选择表格');
    buttonByText(sheet, '事件记录')!.click();
    await tick();
    expect(visualizer.currentSheetKey).toBe('sheet_b');
    await tick(400);
    expect(document.querySelector('#ub-portal .ub-sheet')).toBeNull();
    mount.__resetAcuV2MountForTests();
  });

  it('可进入 AI 助手视图，不展示额外常驻提示', async () => {
    const { mount, surface } = await openWith({
      sheet_a: {
        name: '角色状态',
        content: [[null, '姓名', '状态'], [null, 'A', '平静']],
        sourceData: { note: '说明' },
        updateConfig: {},
        exportConfig: {},
      },
    });
    buttonByText(surface.querySelector('[data-ub-viz-modes]')!, 'AI 助手')!.click();
    await tick();
    const panel = surface.querySelector<HTMLElement>('[data-ub-viz-assistant]')!;
    expect(panel.querySelector('[data-ub-viz-composer] textarea')).not.toBeNull();
    expect(panel.textContent).not.toContain('当前锚点表：角色状态 (sheet_a)');
    expect(panel.textContent).not.toContain('确认前不会应用到编辑器草稿');
    mount.__resetAcuV2MountForTests();
  });

  it('编码索引显示"自动编号"但仍可手动编辑；结构视图里自动重排开关默认打开', async () => {
    const { mount, surface } = await openWith({
      sheet_summary: {
        name: '总结表',
        content: [[null, '事件', '编码索引'], [null, '初遇', 'AM0001']],
        sourceData: { note: '总结表说明' },
        updateConfig: {},
        exportConfig: {},
      },
    });
    expect(surface.textContent).toContain('自动编号');
    preview(surface, 'AM0001').click();
    await tick();
    const textarea = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea')).find(item => item.value === 'AM0001');
    expect(textarea?.disabled).toBe(false);

    buttonByText(surface.querySelector('[data-ub-viz-modes]')!, '结构')!.click();
    await tick();
    const toggle = surface.querySelector<HTMLButtonElement>('[role="switch"][aria-label="保存和 AI 更新时自动重排编码"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    mount.__resetAcuV2MountForTests();
  });

  it('切换表格时把当前列表项滚入可见区域', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const { mount, surface } = await openWith({
      sheet_a: { name: '角色状态', content: [[null, '姓名'], [null, 'A']] },
      sheet_b: { name: '事件记录', content: [[null, '事项'], [null, '旧值']] },
    });
    scrollIntoView.mockClear();
    buttonByText(surface.querySelector('[data-ub-viz-nav]')!, '事件记录')!.click();
    await tick();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    mount.__resetAcuV2MountForTests();
  });

  it('结构视图的 AI 触发提示词输入框随内容自动长高、不设上限', () => {
    const source = readFileSync(join(process.cwd(), 'src/presentation-v3/surfaces/visualizer/VizConfigView.vue'), 'utf8');
    const prompts = source.slice(source.indexOf('title="AI 触发提示词"'), source.indexOf('title="世界书注入"'));
    expect(prompts).toContain('auto-resize');
    expect(prompts).not.toContain('max-rows');
  });
});
