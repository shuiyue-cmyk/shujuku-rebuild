/**
 * tests/service/runtime/version-update-check.test.ts
 * 启动版本校验：静默失败语义 + 仅新版提示 + 同版本不重复打扰 + 节流
 */
import { describe, it, expect, vi } from 'vitest';
import { compareVersions_ACU, checkDatabaseUpdateOnStartup_ACU, type VersionCheckDeps_ACU } from '../../../src/service/runtime/version-update-check';

function makeDeps_ACU(overrides: Partial<VersionCheckDeps_ACU> = {}) {
  const state: { current: any } = { current: null };
  const deps: VersionCheckDeps_ACU = {
    fetchLatest: vi.fn(async () => null),
    notify: vi.fn(),
    now: vi.fn(() => 1_000_000),
    readState: vi.fn(() => state.current),
    // 与真实 defaultWriteState 同语义：整块覆盖（实现方负责传完整对象）。
    writeState: vi.fn((next: any) => { state.current = next; }),
    localVersion: vi.fn(() => '9.0.0'),
    ...overrides,
  };
  return { deps, state };
}

describe('compareVersions_ACU', () => {
  it('逐段数值比较，缺段补 0', () => {
    expect(compareVersions_ACU('9.0.1', '9.0.0')).toBe(1);
    expect(compareVersions_ACU('9.10.0', '9.9.0')).toBe(1);
    expect(compareVersions_ACU('10.0.0', '9.9.9')).toBe(1);
    expect(compareVersions_ACU('9.0', '9.0.0')).toBe(0);
    expect(compareVersions_ACU('9.0.0', '9.0.1')).toBe(-1);
  });

  it('容忍 v 前缀与后缀标记；不可解析返回 null', () => {
    expect(compareVersions_ACU('v9.1.0', '9.0.9')).toBe(1);
    expect(compareVersions_ACU('9.0.0-beta', '9.0.0')).toBe(0);
    expect(compareVersions_ACU('latest', '9.0.0')).toBeNull();
    expect(compareVersions_ACU('', '9.0.0')).toBeNull();
  });
});

describe('checkDatabaseUpdateOnStartup_ACU', () => {
  it('远端更新时提示一次并记忆 lastNotifiedVersion（同版本不再打扰）', async () => {
    const { deps, state } = makeDeps_ACU({ fetchLatest: vi.fn(async () => '9.1.0') });
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.notify).toHaveBeenCalledWith('9.1.0', '9.0.0');
    expect(state.current.lastNotifiedVersion).toBe('9.1.0');

    // 模拟下次启动（节流窗口已过 1h+）：仍是 9.1.0 → 不再提示。
    (deps.fetchLatest as any).mockResolvedValue('9.1.0');
    (deps.now as any).mockReturnValue(1_000_000 + 3_700_000);
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.notify).toHaveBeenCalledTimes(1);

    // 又出了 9.2.0 → 提示新版本。
    (deps.fetchLatest as any).mockResolvedValue('9.2.0');
    (deps.now as any).mockReturnValue(1_000_000 + 7_400_000);
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenLastCalledWith('9.2.0', '9.0.0');
  });

  it('网络失败静默：不提示、只推进节流时间戳', async () => {
    const { deps, state } = makeDeps_ACU({ fetchLatest: vi.fn(async () => null) });
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(state.current.lastCheckAt).toBe(1_000_000);
    expect(state.current.latestVersion).toBeUndefined();
  });

  it('远端等于或旧于本地时不提示', async () => {
    const same = makeDeps_ACU({ fetchLatest: vi.fn(async () => '9.0.0') });
    await checkDatabaseUpdateOnStartup_ACU(same.deps);
    expect(same.deps.notify).not.toHaveBeenCalled();

    const older = makeDeps_ACU({ fetchLatest: vi.fn(async () => '8.9.9') });
    await checkDatabaseUpdateOnStartup_ACU(older.deps);
    expect(older.deps.notify).not.toHaveBeenCalled();
  });

  it('节流窗口内不重新请求，但缓存的新版本仍未通知过时照常提示', async () => {
    // 上次检查刚发生（now - lastCheckAt < 1h），latestVersion 已缓存且未提示。
    const { deps } = makeDeps_ACU({
      readState: vi.fn(() => ({ lastCheckAt: 1_000_000 - 60_000, latestVersion: '9.5.0' })),
    });
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.fetchLatest).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith('9.5.0', '9.0.0');
  });

  it('本地版本缺失（unknown/空）时完全静默', async () => {    const { deps } = makeDeps_ACU({ localVersion: vi.fn(() => 'unknown') });
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.fetchLatest).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('校验链异常被吞掉，不外溢到启动流程', async () => {
    const { deps } = makeDeps_ACU({ fetchLatest: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(checkDatabaseUpdateOnStartup_ACU(deps)).resolves.toBeUndefined();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('远端版本不可比（非数字版本）时端到端静默', async () => {
    const { deps, state } = makeDeps_ACU({ fetchLatest: vi.fn(async () => 'nightly-latest') });
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.notify).not.toHaveBeenCalled();
    // 不可比也要推进节流，避免每轮启动重打网络。
    expect(state.current.lastCheckAt).toBe(1_000_000);
  });

  it('节流窗口内提示缓存新版时，lastNotifiedVersion 同步落库（防重启重复弹）', async () => {
    const { deps, state } = makeDeps_ACU({
      readState: vi.fn(() => ({ lastCheckAt: 1_000_000 - 60_000, latestVersion: '9.5.0' })),
    });
    await checkDatabaseUpdateOnStartup_ACU(deps);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(state.current.lastNotifiedVersion).toBe('9.5.0');
  });
});
