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
