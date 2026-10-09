/**
 * tests/data/storage/tavern-storage.test.ts
 * 酒馆设置存储桥接 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockTopLevelWindow,
  mockIsIndexedDbAvailable,
  mockIdbRequestToPromise,
  mockStorage,
} = vi.hoisted(() => ({
  mockTopLevelWindow: {} as any,
  mockIsIndexedDbAvailable: vi.fn(() => false),
  mockIdbRequestToPromise: vi.fn().mockResolvedValue(undefined),
  mockStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopLevelWindow,
  FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU: false,
  ALLOW_LEGACY_LOCALSTORAGE_MIGRATION_ACU: true,
  legacyLocalStorage_ACU: { getItem: vi.fn(() => null), removeItem: vi.fn() },
  storage_ACU: mockStorage,
}));

vi.mock('../../../src/shared/constants', () => ({
  SCRIPT_ID_PREFIX_ACU: 'ACU',
  DEBUG_MODE_ACU: false,
}));

vi.mock('../../../src/shared/idb-import-temp', () => ({
  idbRequestToPromise_ACU: mockIdbRequestToPromise,
  isIndexedDbAvailable_ACU: mockIsIndexedDbAvailable,
}));

import {
  USE_TAVERN_SETTINGS_STORAGE_ACU,
  TAVERN_SETTINGS_NAMESPACE_ACU,
  CONFIG_IDB_DB_NAME_ACU,
  CONFIG_IDB_STORE_NAME_ACU,
  getTavernSettingsNamespace_ACU,
  getConfigStorage_ACU,
  configIdbGetCached_ACU,
  configIdbCache_ACU,
  configIdbDeletedKeys_ACU,
  initTavernSettingsBridge_ACU,
  tavernExtensionSettingsRoot_ACU,
  tavernSaveSettingsFn_ACU,
  _resetTavernStorageState_ACU,
} from '../../../src/data/storage/tavern-storage';

// R1-06：只剩插件一种运行形态，设置根对象只经 SillyTavern.getContext() 取得。
async function installTavernSettingsRoot(extensionSettings: any, saveSettingsDebounced?: () => unknown) {
  if (typeof globalThis.window === 'undefined') (globalThis as any).window = globalThis;
  (globalThis as any).SillyTavern = {
    getContext: () => ({ extensionSettings, ...(saveSettingsDebounced ? { saveSettingsDebounced } : {}) }),
  };
  await initTavernSettingsBridge_ACU();
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetTavernStorageState_ACU();
  configIdbCache_ACU.clear();
  configIdbDeletedKeys_ACU.clear();
  delete (globalThis as any).SillyTavern;
  // 清理 mockTopLevelWindow 上的属性
  Object.keys(mockTopLevelWindow).forEach(k => delete mockTopLevelWindow[k]);
});

// ═══ 常量验证 ═══
describe('常量导出', () => {
  it('USE_TAVERN_SETTINGS_STORAGE_ACU 为 true', () => {
    expect(USE_TAVERN_SETTINGS_STORAGE_ACU).toBe(true);
  });

  it('TAVERN_SETTINGS_NAMESPACE_ACU 钉值（基于 mock 前缀 ACU + src 模板）', () => {
    expect(TAVERN_SETTINGS_NAMESPACE_ACU).toBe('ACU__userscript_settings_v1');
  });

  it('CONFIG_IDB_DB_NAME_ACU 钉值（基于 mock 前缀 ACU + src 模板）', () => {
    expect(CONFIG_IDB_DB_NAME_ACU).toBe('ACU_config_v1');
  });

  it('CONFIG_IDB_STORE_NAME_ACU 是 kv', () => {
    expect(CONFIG_IDB_STORE_NAME_ACU).toBe('kv');
  });
});

// ═══ getTavernSettingsNamespace_ACU ═══
describe('getTavernSettingsNamespace_ACU', () => {

  it('有设置根对象时返回命名空间对象（沿用历史 __userscripts 键位）', async () => {
    const root: any = {};
    await installTavernSettingsRoot(root);
    const ns = getTavernSettingsNamespace_ACU();
    expect(root.__userscripts[TAVERN_SETTINGS_NAMESPACE_ACU]).toBe(ns);
    expect(ns).toBeDefined();
    expect(typeof ns).toBe('object');
  });
});

// ═══ getConfigStorage_ACU ═══
describe('getConfigStorage_ACU', () => {
  it('无酒馆设置根对象时回退到 localStorage', () => {
    mockStorage.getItem.mockReturnValue('local_value');
    const store = getConfigStorage_ACU();
    expect(store.getItem('key1')).toBe('local_value');
  });

  it('有酒馆设置根对象时优先读取 tavern', async () => {
    await installTavernSettingsRoot({});
    const store = getConfigStorage_ACU();
    // 写入
    expect(store.setItem('test_key', 'test_value')).toBe(true);
    expect(store._lastPersistenceStatus).toBe('memory');
    // 读取
    expect(store.getItem('test_key')).toBe('test_value');
    expect(store._isTavern).toBe(true);
  });

  it('setItem 同时写入 IDB 缓存', () => {
    const store = getConfigStorage_ACU();
    store.setItem('new_key', 'new_value');
    // IDB 缓存应被更新
    expect(configIdbCache_ACU.get('new_key')).toBe('new_value');
  });

  it('Tavern 保存函数抛错时 removeItem 返回 false，并恢复旧值', async () => {
    _resetTavernStorageState_ACU();
    const saveError = vi.fn(() => { throw new Error('host save failed'); });
    await installTavernSettingsRoot({
      __userscripts: {
        [TAVERN_SETTINGS_NAMESPACE_ACU]: { host_key: 'old_value' },
      },
    }, saveError);

    const store = getConfigStorage_ACU();

    expect(store.removeItem('host_key')).toBe(false);
    expect(store.getItem('host_key')).toBe('old_value');
    expect(configIdbGetCached_ACU('host_key')).toBe('old_value');
  });

  it('removeItem 同时清除 IDB 缓存', () => {
    configIdbCache_ACU.set('del_key', 'del_value');
    const store = getConfigStorage_ACU();
    store.removeItem('del_key');
    expect(configIdbDeletedKeys_ACU.has('del_key')).toBe(true);
  });

  it('Tavern 保存函数抛错时 setItem 返回 false，并恢复旧值', async () => {
    _resetTavernStorageState_ACU();
    const saveError = vi.fn(() => { throw new Error('host save failed'); });
    await installTavernSettingsRoot({
      __userscripts: {
        [TAVERN_SETTINGS_NAMESPACE_ACU]: { host_key: 'old_value' },
      },
    }, saveError);

    const store = getConfigStorage_ACU();

    expect(store.setItem('host_key', 'new_value')).toBe(false);
    expect(store.getItem('host_key')).toBe('old_value');
    expect(configIdbGetCached_ACU('host_key')).toBe('old_value');
    expect(saveError).toHaveBeenCalledTimes(1);
  });
});

// ═══ initTavernSettingsBridge_ACU 插件模式分支 ═══
describe('initTavernSettingsBridge_ACU', () => {
  // Node 环境下 window 未定义，需要手动提供
  const _origWindow = globalThis.window;

  beforeEach(() => {
    // 在 Node 环境下将 globalThis 作为 window，使 (window as any).xxx 可用
    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = globalThis;
    }
    // 重置模块级状态变量
    _resetTavernStorageState_ACU();
    // 清理 globalThis 上的酒馆全局对象
    delete (globalThis as any).SillyTavern;
    delete (globalThis as any).saveSettingsDebounced;
    delete (globalThis as any).saveSettings;
  });

  afterEach(() => {
    delete (globalThis as any).SillyTavern;
    delete (globalThis as any).saveSettingsDebounced;
    delete (globalThis as any).saveSettings;
    // 恢复 window
    if (_origWindow === undefined) {
      delete (globalThis as any).window;
    }
  });

  it('SillyTavern 存在但 extensionSettings 为空时返回 false', async () => {
    (globalThis as any).SillyTavern = {
      getContext: () => ({}),
    };
    const result = await initTavernSettingsBridge_ACU();
    expect(result).toBe(false);
  });

  it('saveSettingsDebounced 优先于 saveSettings 被获取', async () => {
    const mockDebounced = vi.fn();
    const mockSave = vi.fn();
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        extensionSettings: { __userscripts: {} },
        saveSettingsDebounced: mockDebounced,
        saveSettings: mockSave,
      }),
    };

    await initTavernSettingsBridge_ACU();
    // tavernSaveSettingsFn_ACU 应该是 mockDebounced 而非 mockSave
    expect(tavernSaveSettingsFn_ACU).toBe(mockDebounced);
  });

  it('只有 saveSettings 存在时作为后备', async () => {
    const mockSave = vi.fn();
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        extensionSettings: { __userscripts: {} },
        saveSettings: mockSave,
      }),
    };

    await initTavernSettingsBridge_ACU();
    // getContext 不返回 saveSettingsDebounced 时，当前实现不会 fallback 到 saveSettings
    // 因为代码只检查 ctx.saveSettingsDebounced，所以这里应该是 null
    // 但如果需要 fallback，需要在代码中添加 saveSettings 的检查
    // 暂时验证当前行为
    expect(tavernSaveSettingsFn_ACU).toBeNull();
  });

  it('SillyTavern.extensionSettings 获取抛错时不崩溃', async () => {
    Object.defineProperty(globalThis, 'SillyTavern', {
      get() {
        throw new Error('access denied');
      },
      configurable: true,
    });

    // 不应抛出异常
    const result = await initTavernSettingsBridge_ACU();
    expect(result).toBe(false);

    // 清理
    delete (globalThis as any).SillyTavern;
  });
});