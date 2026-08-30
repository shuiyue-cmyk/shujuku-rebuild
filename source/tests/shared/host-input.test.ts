import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ jquery: vi.fn() }));

vi.mock('../../src/shared/host-api', () => ({
  get jQuery_API_ACU() { return h.jquery; },
}));

import {
  clickSendButton_ACU,
  getSendTextareaValue_ACU,
  setSendTextareaValue_ACU,
} from '../../src/shared/host-input';

describe('host input helpers', () => {
  // length:1 模拟 jQuery 命中集；真实 jQuery 空集是 length:0 且方法为 no-op（V17 二轮审查 B1 教训）。
  const textarea = { val: vi.fn(), trigger: vi.fn(), length: 1 };
  const sendButton = { click: vi.fn(), length: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
    h.jquery.mockImplementation((selector: string) => selector === '#send_textarea' ? textarea : sendButton);
  });

  it('读取、写入宿主发送框并触发 input', () => {
    textarea.val.mockReturnValue('原始输入');

    expect(getSendTextareaValue_ACU()).toBe('原始输入');
    expect(setSendTextareaValue_ACU('下一条消息')).toBe(true);

    expect(textarea.val).toHaveBeenCalledWith('下一条消息');
    expect(textarea.trigger).toHaveBeenCalledWith('input');
  });

  it('点击宿主发送按钮', () => {
    expect(clickSendButton_ACU()).toBe(true);

    expect(h.jquery).toHaveBeenCalledWith('#send_but');
    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('选择器命中空集（length:0）时报不可用且不执行副作用', () => {
    const emptyTextarea = { val: vi.fn(), trigger: vi.fn(), length: 0 };
    const emptyButton = { click: vi.fn(), length: 0 };
    h.jquery.mockImplementation((selector: string) => selector === '#send_textarea' ? emptyTextarea : emptyButton);

    // jQuery 空集上 val/click 依然存在且为 no-op——必须靠 length 判定识破，否则假成功。
    expect(setSendTextareaValue_ACU('消息')).toBe(false);
    expect(emptyTextarea.val).not.toHaveBeenCalled();
    expect(emptyTextarea.trigger).not.toHaveBeenCalled();
    expect(clickSendButton_ACU()).toBe(false);
    expect(emptyButton.click).not.toHaveBeenCalled();
  });

  it('宿主 jQuery 不可用时安全降级', () => {
    h.jquery.mockImplementation(() => { throw new Error('host unavailable'); });

    expect(getSendTextareaValue_ACU()).toBe('');
    expect(() => setSendTextareaValue_ACU('ignored')).not.toThrow();
    expect(() => clickSendButton_ACU()).not.toThrow();
  });
});
