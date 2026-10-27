import { afterEach, describe, expect, it } from 'vitest';
import {
  abortTableFillRequestsWithStaleTarget_ACU,
  watchTableFillTarget_ACU,
} from '../../../src/service/table/table-fill-target-watch';

function guard(current: { value: boolean }) {
  return { isCurrent: () => current.value };
}

const unwatchers: Array<() => void> = [];
afterEach(() => {
  while (unwatchers.length) unwatchers.pop()!();
});

describe('在途填表请求的目标楼层登记', () => {
  it('目标楼层已换成另一条回复的请求当场中止，仍有效的不动', async () => {
    const staleFlag = { value: true };
    const liveFlag = { value: true };
    const stale = new AbortController();
    const live = new AbortController();
    unwatchers.push(watchTableFillTarget_ACU(guard(staleFlag), 3, stale));
    unwatchers.push(watchTableFillTarget_ACU(guard(liveFlag), 1, live));

    staleFlag.value = false;

    expect(abortTableFillRequestsWithStaleTarget_ACU()).toBe(1);
    expect(stale.signal.aborted).toBe(true);
    expect(live.signal.aborted).toBe(false);
  });

  it('按登记时的目标楼层判定', () => {
    const seen: Array<number | null | undefined> = [];
    const controller = new AbortController();
    unwatchers.push(watchTableFillTarget_ACU({ isCurrent: index => { seen.push(index); return true; } }, 7, controller));

    abortTableFillRequestsWithStaleTarget_ACU();

    expect(seen).toEqual([7]);
  });

  it('请求结束注销后不再被中止；已中止的不重复计数', () => {
    const flag = { value: true };
    const finished = new AbortController();
    const alreadyAborted = new AbortController();
    const unwatch = watchTableFillTarget_ACU(guard(flag), 0, finished);
    unwatchers.push(watchTableFillTarget_ACU(guard(flag), 0, alreadyAborted));
    alreadyAborted.abort();
    unwatch();

    flag.value = false;

    expect(abortTableFillRequestsWithStaleTarget_ACU()).toBe(0);
    expect(finished.signal.aborted).toBe(false);
  });

  it('同一个中止信号被多组共用时只中止一次', () => {
    const flag = { value: true };
    const shared = new AbortController();
    unwatchers.push(watchTableFillTarget_ACU(guard(flag), 2, shared));
    unwatchers.push(watchTableFillTarget_ACU(guard(flag), 2, shared));

    flag.value = false;

    expect(abortTableFillRequestsWithStaleTarget_ACU()).toBe(1);
  });

  it('判定抛错时按仍有效处理，不误杀', () => {
    const controller = new AbortController();
    unwatchers.push(watchTableFillTarget_ACU({ isCurrent: () => { throw new Error('boom'); } }, 0, controller));

    expect(abortTableFillRequestsWithStaleTarget_ACU()).toBe(0);
    expect(controller.signal.aborted).toBe(false);
  });
});
