import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTemplateRuntimeChangeSubscriberCountForTests_ACU,
  notifyTemplateRuntimeCommitted_ACU,
  subscribeTemplateRuntimeChanges_ACU,
} from '../../src/shared/template-runtime-change';

describe('template runtime change bridge', () => {
  beforeEach(() => {
    expect(getTemplateRuntimeChangeSubscriberCountForTests_ACU()).toBe(0);
  });

  it('通知所有订阅者，并隔离单个订阅者故障', () => {
    const broken = vi.fn(() => { throw new Error('consumer failed'); });
    const received = vi.fn();
    const stopBroken = subscribeTemplateRuntimeChanges_ACU(broken);
    const stopReceived = subscribeTemplateRuntimeChanges_ACU(received);

    try {
      expect(() => notifyTemplateRuntimeCommitted_ACU()).not.toThrow();
      expect(broken).toHaveBeenCalledOnce();
      expect(received).toHaveBeenCalledOnce();
    } finally {
      stopBroken();
      stopReceived();
    }
  });

  it('取消订阅后不再收到后续提交通知', () => {
    const received = vi.fn();
    const stop = subscribeTemplateRuntimeChanges_ACU(received);
    stop();

    notifyTemplateRuntimeCommitted_ACU();

    expect(received).not.toHaveBeenCalled();
  });
});
