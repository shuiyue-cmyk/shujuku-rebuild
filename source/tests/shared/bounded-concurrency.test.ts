import { describe, expect, it } from 'vitest';
import { mapWithBoundedConcurrency_ACU } from '../../src/shared/bounded-concurrency';

describe('mapWithBoundedConcurrency_ACU', () => {
  it('结果按输入顺序返回，与完成先后无关', async () => {
    const delays = [30, 5, 20, 1, 10];
    const result = await mapWithBoundedConcurrency_ACU(delays, 3, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${index}:${ms}`;
    });
    expect(result).toEqual(['0:30', '1:5', '2:20', '3:1', '4:10']);
  });

  it('同时运行的任务数不超过上限', async () => {
    let running = 0;
    let peak = 0;
    await mapWithBoundedConcurrency_ACU(Array.from({ length: 10 }, (_, i) => i), 4, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
    });
    expect(peak).toBe(4);
  });

  it('任一任务抛错时整体 reject；空输入返回空数组', async () => {
    await expect(mapWithBoundedConcurrency_ACU([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    })).rejects.toThrow('boom');
    await expect(mapWithBoundedConcurrency_ACU([], 4, async () => 1)).resolves.toEqual([]);
  });
});
