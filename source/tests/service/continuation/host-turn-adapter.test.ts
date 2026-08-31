import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  setTextarea: vi.fn(() => true),
  clickSend: vi.fn(() => true),
  clickRegenerate: vi.fn(() => true),
  triggerGenerate: vi.fn(() => true),
  host: { deleteLastMessage: vi.fn(async () => undefined) } as any,
}));

vi.mock('../../../src/shared/host-input', () => ({
  setSendTextareaValue_ACU: (...args: any[]) => h.setTextarea(...args),
  clickSendButton_ACU: (...args: any[]) => h.clickSend(...args),
  clickRegenerateButton_ACU: (...args: any[]) => h.clickRegenerate(...args),
  triggerHostGenerate_ACU: (...args: any[]) => h.triggerGenerate(...args),
}));
vi.mock('../../../src/shared/host-api', () => ({
  get SillyTavern_API_ACU() { return h.host; },
}));

import { SillyTavernHostTurnAdapter_ACU } from '../../../src/service/continuation/host-turn-adapter';

describe('SillyTavernHostTurnAdapter_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.host = { deleteLastMessage: vi.fn(async () => undefined) };
    h.setTextarea.mockReturnValue(true);
    h.clickSend.mockReturnValue(true);
    h.clickRegenerate.mockReturnValue(true);
    h.triggerGenerate.mockReturnValue(true);
  });

  it('only reports deletion success after the native host deletion resolves', async () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();

    await expect(adapter.removeLastMessage()).resolves.toBe(true);

    expect(h.host.deleteLastMessage).toHaveBeenCalledOnce();
  });

  it('fails closed when native host deletion is unavailable or rejects', async () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();
    h.host = {};
    await expect(adapter.removeLastMessage()).resolves.toBe(false);

    h.host = { deleteLastMessage: vi.fn(async () => { throw new Error('host failure'); }) };
    await expect(adapter.removeLastMessage()).resolves.toBe(false);
  });

  it('routes regenerate and generate retries to the corresponding host primitives', () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();
    expect(adapter.retryGeneration('regenerate')).toBe(true);
    expect(h.clickRegenerate).toHaveBeenCalledOnce();
    expect(adapter.retryGeneration('generate')).toBe(true);
    expect(h.triggerGenerate).toHaveBeenCalledWith('normal');
  });

  it('stops in-flight host generation when the native API exists, and skips when it does not', () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();
    h.host = { stopGeneration: vi.fn() };
    adapter.stopGeneration();
    expect(h.host.stopGeneration).toHaveBeenCalledOnce();

    h.host = {};
    expect(() => adapter.stopGeneration()).not.toThrow();
  });
});
