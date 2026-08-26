import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('preset-rate-limiter · 公益站兼容限速', () => {
  let acquire: typeof import('../../../src/service/ai/preset-rate-limiter').acquirePresetRateLimitSlot_ACU;
  let reset: typeof import('../../../src/service/ai/preset-rate-limiter').resetPresetRateLimiter_ACU;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    const mod = await import('../../../src/service/ai/preset-rate-limiter');
    acquire = mod.acquirePresetRateLimitSlot_ACU;
    reset = mod.resetPresetRateLimiter_ACU;
    reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口内前 3 次请求立即放行', async () => {
    await acquire('preset-a');
    await acquire('preset-a');
    await acquire('preset-a');
  });

  it('第 4 次请求挂起，直到最早一条滑出 60 秒窗口', async () => {
    await acquire('preset-a');
    await acquire('preset-a');
    await acquire('preset-a');

    let resolved = false;
    const fourth = acquire('preset-a').then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    // 最早一条在 t=0 记录，60s 窗口到期后放行
    await vi.advanceTimersByTimeAsync(60_500);
    await fourth;
    expect(resolved).toBe(true);
  });

  it('不同预设各自独立计数', async () => {
    await acquire('preset-a');
    await acquire('preset-a');
    await acquire('preset-a');
    // preset-b 未受 preset-a 影响，窗口内 3 次立即放行
    await acquire('preset-b');
    await acquire('preset-b');
    await acquire('preset-b');
  });

  it('窗口滑出后槽位回收，可继续请求', async () => {
    await acquire('preset-a');
    vi.advanceTimersByTime(61_000);
    // 旧记录已滑出窗口，新一轮 3 次立即可用
    await acquire('preset-a');
    await acquire('preset-a');
    await acquire('preset-a');
  });

  it('reset 清空全部计数', async () => {
    await acquire('preset-a');
    await acquire('preset-a');
    await acquire('preset-a');
    reset();
    await acquire('preset-a');
  });
});
