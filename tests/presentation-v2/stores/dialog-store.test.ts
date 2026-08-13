/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDialogStore } from '../../../src/presentation-v2/stores/dialog-store';

describe('useDialogStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('按确认弹窗语义解析确认与取消', async () => {
    const dialog = useDialogStore();
    const confirmed = dialog.confirm({
      title: '删除',
      message: '确定删除？',
    });

    expect(dialog.active?.kind).toBe('confirm');
    dialog.cancelActive();

    await expect(confirmed).resolves.toBe(false);
  });

  it('队列中的 prompt 激活时保留自己的默认值', async () => {
    const dialog = useDialogStore();
    const first = dialog.confirm({
      title: '先确认',
      message: '先处理确认。',
    });
    const second = dialog.prompt({
      title: '再输入',
      message: '请输入名称。',
      label: '名称',
      defaultValue: '默认名称',
    });

    expect(dialog.active?.kind).toBe('confirm');
    expect(dialog.queue).toHaveLength(1);

    dialog.submitActive();
    await expect(first).resolves.toBe(true);

    expect(dialog.active?.kind).toBe('prompt');
    expect(dialog.inputValue).toBe('默认名称');

    dialog.submitActive();
    await expect(second).resolves.toBe('默认名称');
  });

  it('多选弹窗返回已勾选项目并要求至少选择一项', async () => {
    const dialog = useDialogStore();
    const selected = dialog.selectMany({
      title: '选择清理项目',
      message: '请选择本次要清理的项目。',
      options: [
        { value: 'template', label: '模板快照', defaultChecked: true },
        { value: 'plot', label: '剧情快照', defaultChecked: true },
        { value: 'locks', label: '表格锁', defaultChecked: false },
      ],
    });

    expect(dialog.active?.kind).toBe('multiselect');
    expect(dialog.checkedValues).toEqual({
      template: true,
      plot: true,
      locks: false,
    });

    dialog.setCheckedValue('template', false);
    dialog.setCheckedValue('plot', false);
    expect(dialog.confirmDisabled).toBe(true);

    dialog.submitActive();
    expect(dialog.active?.kind).toBe('multiselect');

    dialog.setCheckedValue('locks', true);
    expect(dialog.confirmDisabled).toBe(false);
    dialog.submitActive();

    await expect(selected).resolves.toEqual(['locks']);
  });
});
