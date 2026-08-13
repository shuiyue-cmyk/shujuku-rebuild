import { describe, expect, it } from 'vitest';
import { buildTableUpdateApplyScopeKey_ACU, runTableUpdateApplyWithScopeLock_ACU } from '../../../src/service/table/table-update-queue';

function deferred_ACU<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('table-update-queue', () => {
  it('buildTableUpdateApplyScopeKey_ACU 使用 chat、isolation 与目标楼层构造稳定 scope', () => {
    expect(buildTableUpdateApplyScopeKey_ACU({ chatKey: ' chat ', isolationKey: ' tag ', targetMessageIndex: 3 })).toBe('chat::tag::3');
    expect(buildTableUpdateApplyScopeKey_ACU({ chatKey: '', isolationKey: '', targetMessageIndex: null })).toBe('current-chat::default::latest-ai');
  });

  it('同一 scope 串行执行，后序任务不会穿透未释放的前序任务', async () => {
    const gate = deferred_ACU();
    const events: string[] = [];

    const first = runTableUpdateApplyWithScopeLock_ACU('same-scope-serial', async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
    });
    const second = runTableUpdateApplyWithScopeLock_ACU('same-scope-serial', async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('前序任务 reject 后释放同 scope，后序任务仍继续执行', async () => {
    const events: string[] = [];
    const first = runTableUpdateApplyWithScopeLock_ACU('same-scope-reject', async () => {
      events.push('first:start');
      throw new Error('boom');
    });
    const second = runTableUpdateApplyWithScopeLock_ACU('same-scope-reject', async () => {
      events.push('second:start');
      return 'ok';
    });

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
    expect(events).toEqual(['first:start', 'second:start']);
  });

  it('不同 scope 不互相串行', async () => {
    const gate = deferred_ACU();
    const events: string[] = [];

    const slow = runTableUpdateApplyWithScopeLock_ACU('scope-a', async () => {
      events.push('a:start');
      await gate.promise;
      events.push('a:end');
    });
    const fast = runTableUpdateApplyWithScopeLock_ACU('scope-b', async () => {
      events.push('b:start');
    });

    await fast;
    expect(events).toEqual(['a:start', 'b:start']);
    gate.resolve();
    await slow;
    expect(events).toEqual(['a:start', 'b:start', 'a:end']);
  });

  it('多个 waiter 竞争同一 scope 时按提交顺序逐个进入', async () => {
    const gate = deferred_ACU();
    const events: string[] = [];

    const first = runTableUpdateApplyWithScopeLock_ACU('same-scope-many-waiters', async () => {
      events.push('first');
      await gate.promise;
    });
    const second = runTableUpdateApplyWithScopeLock_ACU('same-scope-many-waiters', async () => events.push('second'));
    const third = runTableUpdateApplyWithScopeLock_ACU('same-scope-many-waiters', async () => events.push('third'));

    await Promise.resolve();
    expect(events).toEqual(['first']);
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(events).toEqual(['first', 'second', 'third']);
  });
});
