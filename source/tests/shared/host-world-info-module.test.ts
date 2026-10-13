/**
 * 宿主内部世界书模块加载器：只认宿主正在使用的那一份实例，取不到时安全降级为 null。
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/utils', () => ({ logWarn_ACU: vi.fn(), logDebug_ACU: vi.fn() }));

import {
  __setHostWorldInfoModuleImporterForTests_ACU,
  getVerifiedHostWorldInfoModule_ACU,
  loadVerifiedHostWorldInfoModule_ACU,
  resolveHostWorldInfoModuleUrl_ACU,
} from '../../src/shared/host-compat/host-world-info-module';

const loadWorldInfo = vi.fn();
function hostModule(overrides: Record<string, any> = {}) {
  return { world_info: { charLore: [] }, charUpdateAddAuxWorld: vi.fn(), loadWorldInfo, ...overrides };
}

beforeEach(() => {
  (window as any).SillyTavern = { getContext: () => ({ loadWorldInfo }) };
});

afterEach(() => {
  __setHostWorldInfoModuleImporterForTests_ACU(null);
  delete (window as any).SillyTavern;
});

describe('resolveHostWorldInfoModuleUrl_ACU', () => {
  it('优先用宿主实际加载过的资源地址（含查询串也原样保留）', () => {
    const win = {
      performance: { getEntriesByType: () => [{ name: 'http://tauri.localhost/script.js' }, { name: 'http://tauri.localhost/scripts/world-info.js?v=2' }] },
      document: { baseURI: 'http://tauri.localhost/' },
    };
    expect(resolveHostWorldInfoModuleUrl_ACU(win)).toBe('http://tauri.localhost/scripts/world-info.js?v=2');
  });

  it('资源记录里没有时按页面基址拼出地址', () => {
    const win = { performance: { getEntriesByType: () => [] }, document: { baseURI: 'http://tauri.localhost/index.html' } };
    expect(resolveHostWorldInfoModuleUrl_ACU(win)).toBe('http://tauri.localhost/scripts/world-info.js');
  });
});

describe('loadVerifiedHostWorldInfoModule_ACU', () => {
  it('加载到宿主同一份实例时返回并缓存，之后不再重复加载', async () => {
    const mod = hostModule();
    const importer = vi.fn(async () => mod);
    __setHostWorldInfoModuleImporterForTests_ACU(importer);

    expect(await loadVerifiedHostWorldInfoModule_ACU()).toBe(mod);
    expect(await loadVerifiedHostWorldInfoModule_ACU()).toBe(mod);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(getVerifiedHostWorldInfoModule_ACU()).toBe(mod);
  });

  it('不是宿主正在用的那一份（loadWorldInfo 不是同一个函数）时弃用', async () => {
    __setHostWorldInfoModuleImporterForTests_ACU(async () => hostModule({ loadWorldInfo: vi.fn() }));
    expect(await loadVerifiedHostWorldInfoModule_ACU()).toBeNull();
    expect(getVerifiedHostWorldInfoModule_ACU()).toBeNull();
  });

  it('缺少挂附加世界书的函数时弃用', async () => {
    __setHostWorldInfoModuleImporterForTests_ACU(async () => hostModule({ charUpdateAddAuxWorld: undefined }));
    expect(await loadVerifiedHostWorldInfoModule_ACU()).toBeNull();
  });

  it('加载失败返回 null，下次允许重试', async () => {
    const mod = hostModule();
    const importer = vi.fn()
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce(mod);
    __setHostWorldInfoModuleImporterForTests_ACU(importer);

    expect(await loadVerifiedHostWorldInfoModule_ACU()).toBeNull();
    expect(await loadVerifiedHostWorldInfoModule_ACU()).toBe(mod);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
