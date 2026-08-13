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
  const textarea = { val: vi.fn(), trigger: vi.fn() };
  const sendButton = { click: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    h.jquery.mockImplementation((selector: string) => selector === '#send_textarea' ? textarea : sendButton);
  });

  it('读取、写入宿主发送框并触发 input', () => {
    textarea.val.mockReturnValue('原始输入');

    expect(getSendTextareaValue_ACU()).toBe('原始输入');
    setSendTextareaValue_ACU('下一条消息');

    expect(textarea.val).toHaveBeenCalledWith('下一条消息');
    expect(textarea.trigger).toHaveBeenCalledWith('input');
  });

  it('点击宿主发送按钮', () => {
    clickSendButton_ACU();

    expect(h.jquery).toHaveBeenCalledWith('#send_but');
    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('宿主 jQuery 不可用时安全降级', () => {
    h.jquery.mockImplementation(() => { throw new Error('host unavailable'); });

    expect(getSendTextareaValue_ACU()).toBe('');
    expect(() => setSendTextareaValue_ACU('ignored')).not.toThrow();
    expect(() => clickSendButton_ACU()).not.toThrow();
  });
});
