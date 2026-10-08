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

  // R10A-01/R10A-04：确认框绑定弹出时的聊天；切到别的聊天后一律按取消处理，避免在新聊天上执行旧聊天的危险操作。
  it('切换到其他聊天时取消当前与排队中的弹窗，同一聊天不受影响', async () => {
    const { _set_currentChatFileIdentifier_ACU } = await import('../../../src/service/runtime/state-manager');
    _set_currentChatFileIdentifier_ACU('chat-a');
    const dialog = useDialogStore();
    const confirmA = dialog.confirm({ title: '删除', message: '删除 A 的数据？' });
    const promptA = dialog.prompt({ title: '楼层', message: '输入', label: '楼层' });

    dialog.cancelForChatChange('chat-a');
    expect(dialog.active?.kind).toBe('confirm');

    dialog.cancelForChatChange('chat-b');
    await expect(confirmA).resolves.toBe(false);
    await expect(promptA).resolves.toBeNull();
    expect(dialog.active).toBeNull();
    expect(dialog.queue).toHaveLength(0);
    _set_currentChatFileIdentifier_ACU('');
  });
});
