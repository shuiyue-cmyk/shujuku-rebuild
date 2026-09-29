/**
 * tests/shared/host-bridge-version.test.ts
 * 宿主版本读取与比较（版本闸门的判据层）。
 *
 * 判据要点：`get_client_version` 与 `__TAURITAVERN__.invoke.safeInvoke` 自 TT v1.6.5 起就存在，
 * 因此「读不到版本」属异常而非「版本过旧」⇒ isAcuTauriVersionOutdated 必须 fail-open。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACU_REQUIRED_TAURITAVERN_VERSION,
  compareAcuVersions,
  isAcuTauriVersionOutdated,
  parseAcuVersionParts,
  readAcuTauriVersion,
} from '../../src/shared/host-bridge';

const g = globalThis as any;

function installFakeWindow(value: any): void {
  g.window = value;
}

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
});

describe('ACU_REQUIRED_TAURITAVERN_VERSION', () => {
  it('要求基线为 2.3.0', () => {
    expect(ACU_REQUIRED_TAURITAVERN_VERSION).toBe('2.3.0');
  });
});

describe('parseAcuVersionParts', () => {
  it('解析标准 SemVer', () => {
    expect(parseAcuVersionParts('2.3.0')).toEqual([2, 3, 0]);
    expect(parseAcuVersionParts('v2.3.0')).toEqual([2, 3, 0]);
    expect(parseAcuVersionParts(' 2.2.0 ')).toEqual([2, 2, 0]);
  });
  it('忽略预发布/构建后缀', () => {
    expect(parseAcuVersionParts('2.3.0-canary.1')).toEqual([2, 3, 0]);
  });
  it('不可解析返回 null（不猜）', () => {
    expect(parseAcuVersionParts('2.3')).toBeNull();
    expect(parseAcuVersionParts('dev')).toBeNull();
    expect(parseAcuVersionParts('')).toBeNull();
    expect(parseAcuVersionParts(null)).toBeNull();
    expect(parseAcuVersionParts(undefined)).toBeNull();
  });
});

describe('compareAcuVersions', () => {
  it('按数值比较而非字符串比较', () => {
    expect(compareAcuVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareAcuVersions('2.9.0', '2.10.0')).toBe(-1);
  });
  it('相等 / 小于 / 大于', () => {
    expect(compareAcuVersions('2.3.0', '2.3.0')).toBe(0);
    expect(compareAcuVersions('2.2.0', '2.3.0')).toBe(-1);
    expect(compareAcuVersions('3.0.0', '2.3.0')).toBe(1);
  });
  it('任一不可解析返回 null', () => {
    expect(compareAcuVersions('dev', '2.3.0')).toBeNull();
    expect(compareAcuVersions('2.3.0', null)).toBeNull();
  });
});

describe('isAcuTauriVersionOutdated', () => {
  it('低于基线为真', () => {
    expect(isAcuTauriVersionOutdated('2.2.0')).toBe(true);
    expect(isAcuTauriVersionOutdated('1.6.5')).toBe(true);
  });
  it('等于或高于基线为假', () => {
    expect(isAcuTauriVersionOutdated('2.3.0')).toBe(false);
    expect(isAcuTauriVersionOutdated('2.4.0')).toBe(false);
    expect(isAcuTauriVersionOutdated('3.0.0')).toBe(false);
  });
  it('读不到 / 不可解析一律 fail-open（不打扰用户）', () => {
    expect(isAcuTauriVersionOutdated(null)).toBe(false);
    expect(isAcuTauriVersionOutdated(undefined)).toBe(false);
    expect(isAcuTauriVersionOutdated('')).toBe(false);
    expect(isAcuTauriVersionOutdated('dev')).toBe(false);
  });
  it('可传入自定义基线', () => {
    expect(isAcuTauriVersionOutdated('2.3.0', '2.5.0')).toBe(true);
  });
});

describe('readAcuTauriVersion', () => {
  it('非 TT 宿主返回 null', async () => {
    installFakeWindow({});
    await expect(readAcuTauriVersion()).resolves.toBeNull();
  });

  it('TT 宿主经 safeInvoke 读 tauriVersion', async () => {
    const safeInvoke = vi.fn().mockResolvedValue({ tauriVersion: '2.3.0', pkgVersion: '1.18.0', agent: 'x' });
    installFakeWindow({ __TAURITAVERN__: { invoke: { safeInvoke } } });

    await expect(readAcuTauriVersion()).resolves.toBe('2.3.0');
    expect(safeInvoke).toHaveBeenCalledWith('get_client_version');
  });

  it('ABI 缺失 / safeInvoke 非函数时返回 null，且不抛错', async () => {
    installFakeWindow({ __TAURITAVERN__: {} });
    await expect(readAcuTauriVersion()).resolves.toBeNull();
    installFakeWindow({ __TAURITAVERN__: { invoke: { safeInvoke: 'nope' } } });
    await expect(readAcuTauriVersion()).resolves.toBeNull();
  });

  it('返回体缺 tauriVersion 或调用失败时返回 null（不猜）', async () => {
    installFakeWindow({ __TAURITAVERN__: { invoke: { safeInvoke: vi.fn().mockResolvedValue({}) } } });
    await expect(readAcuTauriVersion()).resolves.toBeNull();

    installFakeWindow({ __TAURITAVERN__: { invoke: { safeInvoke: vi.fn().mockRejectedValue(new Error('boom')) } } });
    await expect(readAcuTauriVersion()).resolves.toBeNull();
  });

  it('成功读取后缓存宿主版本供同步读取（Debug meta 用）', async () => {
    const safeInvoke = vi.fn().mockResolvedValue({ tauriVersion: '2.3.0' });
    installFakeWindow({ __TAURITAVERN__: { invoke: { safeInvoke } } });
    delete (globalThis as any).__ACU_TAURI_VERSION__;
    await expect(readAcuTauriVersion()).resolves.toBe('2.3.0');
    const mod = await import('../../src/shared/host-bridge') as any;
    expect(typeof mod.readCachedAcuTauriVersion_ACU).toBe('function');
    expect(mod.readCachedAcuTauriVersion_ACU()).toBe('2.3.0');
  });
});

describe('readAcuTauriVersion 经 GET /version（T3 首选，invoke 只当回退）', () => {
  it('无 invoke 时走同源 fetch，只取 tauriVersion（pkgVersion 是 ST 兼容号，误用则闸门错乱）', async () => {
    installFakeWindow({ __TAURITAVERN__: {} });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tauriVersion: '2.2.0', pkgVersion: '2.3.0', agent: 'x' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(readAcuTauriVersion()).resolves.toBe('2.2.0');
      expect(fetchMock).toHaveBeenCalledWith('/version');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetch 成功同样写入运行时缓存（T4 stash 不因换通道丢失）', async () => {
    installFakeWindow({ __TAURITAVERN__: {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tauriVersion: '2.3.0' }) }));
    try {
      delete (globalThis as any).__ACU_TAURI_VERSION__;
      await expect(readAcuTauriVersion()).resolves.toBe('2.3.0');
      expect((globalThis as any).__ACU_TAURI_VERSION__).toBe('2.3.0');
    } finally {
      vi.unstubAllGlobals();
      delete (globalThis as any).__ACU_TAURI_VERSION__;
    }
  });

  it('fetch 失败时回退 safeInvoke（旧链路不断）', async () => {
    const safeInvoke = vi.fn().mockResolvedValue({ tauriVersion: '2.1.0' });
    installFakeWindow({ __TAURITAVERN__: { invoke: { safeInvoke } } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net down')));
    try {
      await expect(readAcuTauriVersion()).resolves.toBe('2.1.0');
      expect(safeInvoke).toHaveBeenCalledWith('get_client_version');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetch 与 invoke 双失败时返回 null（fail-open 不变）', async () => {
    installFakeWindow({ __TAURITAVERN__: { invoke: { safeInvoke: vi.fn().mockRejectedValue(new Error('boom')) } } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net down')));
    try {
      await expect(readAcuTauriVersion()).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('非 TT 不 fetch（ST/Luker 零影响）', async () => {
    installFakeWindow({ SillyTavern: { getContext: () => ({}) } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(readAcuTauriVersion()).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
