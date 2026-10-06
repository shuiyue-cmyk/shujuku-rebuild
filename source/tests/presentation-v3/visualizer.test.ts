/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { byText, flush, mountV3 } from './v3-harness';

function tableData() {
  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_a: {
      uid: 'sheet_a',
      name: '角色状态',
      orderNo: 0,
      content: [[null, '姓名', '状态'], [null, 'A', '平静']],
    },
    sheet_b: {
      uid: 'sheet_b',
      name: '物品清单',
      orderNo: 1,
      content: [[null, '物品'], [null, '钥匙'], [null, '地图']],
    },
  };
}

async function openViz() {
  const ctx = await mountV3({ tableData: tableData() });
  const bridge = await import('../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
  const { useVisualizerStore } = await import('../../src/presentation-v2/stores/visualizer-store');
  await bridge.openVisualizerSurface_ACU({ source: 'v2-shell' });
  await flush(6);
  const visualizer = useVisualizerStore(ctx.mount.getAcuV2PiniaForBridge()!);
  const root = () => document.querySelector<HTMLElement>('[data-ub-viz]')!;
  return { ...ctx, visualizer, root };
}

let resetMount: (() => void) | null = null;
afterEach(() => {
  resetMount?.();
  resetMount = null;
});

describe('新版数据库编辑器（v3）', () => {
  it('打开后显示新版编辑器：表格列表、当前表数据卡片、保存栏', { timeout: 90_000 }, async () => {
    const { root, errors, mount } = await openViz();
    resetMount = mount.__resetAcuV2MountForTests;

    expect(root()).not.toBeNull();
    expect(document.querySelector('[data-acu-visualizer-surface]')).toBeNull();
    const nav = root().querySelector('[data-ub-viz-nav]')!;
    expect(nav.textContent).toContain('角色状态');
    expect(nav.textContent).toContain('1 行 · 2 列');
    expect(nav.textContent).toContain('物品清单');
    expect(root().querySelector('[data-ub-viz-head]')!.textContent).toContain('角色状态');

    const cards = root().querySelectorAll('[data-ub-viz-card]');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('姓名');
    expect(cards[0].textContent).toContain('平静');

    const footer = root().querySelector('[data-ub-viz-footer]')!;
    expect(footer.textContent).toContain('保存数据到当前消息');
    expect(footer.textContent).toContain('保存模板到当前聊天');
    expect(footer.textContent).toContain('保存模板到全局');
    expect(errors).toEqual([]);
  });

  it('点字段进入编辑，改动写进草稿并提示未保存；可切表、增行', { timeout: 90_000 }, async () => {
    const { root, errors, visualizer, mount } = await openViz();
    resetMount = mount.__resetAcuV2MountForTests;

    const preview = byText<HTMLElement>('[data-ub-viz-field-preview]', '平静', root())!;
    preview.click();
    await flush();
    const textarea = root().querySelector<HTMLTextAreaElement>('[data-ub-viz-card] textarea')!;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('平静');
    textarea.value = '紧张';
    textarea.dispatchEvent(new Event('input'));
    await flush();
    expect(visualizer.currentSheet.content[1][2]).toBe('紧张');
    expect(visualizer.dirty).toBe(true);
    expect(root().querySelector('[data-ub-viz-head]')!.textContent).toContain('未保存');

    byText<HTMLButtonElement>('[data-ub-viz-sheet]', '物品清单', root())!.click();
    await flush();
    expect(visualizer.currentSheetKey).toBe('sheet_b');
    expect(root().querySelectorAll('[data-ub-viz-card]')).toHaveLength(2);

    byText<HTMLButtonElement>('button', '新增一行', root())!.click();
    await flush();
    expect(visualizer.currentSheet.content).toHaveLength(4);
    expect(root().querySelectorAll('[data-ub-viz-card]')).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it('行锁、列锁、单元格锁都能切换', { timeout: 90_000 }, async () => {
    const { root, errors, visualizer, mount } = await openViz();
    resetMount = mount.__resetAcuV2MountForTests;

    root().querySelector<HTMLButtonElement>('[data-ub-viz-row-lock]')!.click();
    await flush();
    expect(visualizer.isRowLocked('sheet_a', 0)).toBe(true);

    const field = byText<HTMLElement>('[data-ub-viz-field]', '状态', root())!;
    field.dispatchEvent(new Event('focusin', { bubbles: true }));
    await flush();
    field.querySelector<HTMLButtonElement>('[data-ub-viz-col-lock]')!.click();
    await flush();
    expect(visualizer.isColumnLocked('sheet_a', 1)).toBe(true);
    field.querySelector<HTMLButtonElement>('[data-ub-viz-cell-lock]')!.click();
    await flush();
    expect(visualizer.isCellLocked('sheet_a', 0, 1)).toBe(true);
    expect(errors).toEqual([]);
  });

  it('结构 / AI 助手 / 数据库管理三个视图都能打开', { timeout: 90_000 }, async () => {
    const { root, errors, visualizer, mount } = await openViz();
    resetMount = mount.__resetAcuV2MountForTests;

    byText<HTMLButtonElement>('[data-ub-viz-modes] button', '结构', root())!.click();
    await flush();
    expect(visualizer.mode).toBe('config');
    const text = root().textContent!;
    for (const title of ['基本信息', '列定义', '自动更新参数', 'AI 触发提示词', '世界书注入']) {
      expect(text).toContain(title);
    }
    const nameInput = root().querySelector<HTMLInputElement>('[data-ub-row="表格名称"] input')!;
    nameInput.value = '角色状态改';
    nameInput.dispatchEvent(new Event('input'));
    await flush();
    expect(visualizer.currentSheet.name).toBe('角色状态改');

    byText<HTMLButtonElement>('[data-ub-viz-modes] button', 'AI 助手', root())!.click();
    await flush();
    expect(visualizer.mode).toBe('assistant');
    expect(root().querySelector('[data-ub-viz-composer] textarea')).not.toBeNull();

    byText<HTMLButtonElement>('[data-ub-viz-nav] button', '数据库管理', root())!.click();
    await flush();
    expect(visualizer.mode).toBe('table-management');
    expect(root().textContent).toContain('表格顺序');
    expect(root().textContent).toContain('全局注入位置');
    expect(root().querySelectorAll('[data-ub-viz-manage-item]')).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it('有未保存修改时关闭会先询问', { timeout: 90_000 }, async () => {
    const { root, errors, visualizer, mount } = await openViz();
    resetMount = mount.__resetAcuV2MountForTests;

    visualizer.updateCell(0, 0, 'B');
    await flush();
    root().querySelector<HTMLButtonElement>('[data-ub-viz-close]')!.click();
    await flush();
    expect(document.body.textContent).toContain('关闭数据库编辑器');
    expect(visualizer.isActive).toBe(true);
    byText<HTMLButtonElement>('button', '取消关闭')!.click();
    await flush();
    expect(visualizer.isActive).toBe(true);
    expect(errors).toEqual([]);
  });
});
