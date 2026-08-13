/**
 * tests/data/storage/optimization-cache-storage.test.ts
 * 正文优化基础缓存存储适配器 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockTopLevelWindow,
  mockLogDebug,
} = vi.hoisted(() => ({
  mockTopLevelWindow: {} as any,
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopLevelWindow,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
}));

import {
  saveOptimizationBaseToCache_ACU,
  loadOptimizationBaseFromCache_ACU,
} from '../../../src/data/storage/optimization-cache-storage';

// 模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
    _store: store,
  };
})();

beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
  // 清理 window 上的缓存键
  delete mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__;
  // 挂载 localStorage mock
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
});

// ═══ saveOptimizationBaseToCache_ACU ═══
describe('saveOptimizationBaseToCache_ACU', () => {
  it('写入 window 对象', () => {
    const cache = { baseContent: '测试内容', timestamp: 123 };
    saveOptimizationBaseToCache_ACU(cache);
    expect(mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__).toEqual(cache);
  });

  it('写入 localStorage', () => {
    const cache = { baseContent: '测试内容', timestamp: 123 };
    saveOptimizationBaseToCache_ACU(cache);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ACU_LAST_OPTIMIZATION_BASE',
      JSON.stringify(cache),
    );
  });

  it('window 写入失败时不影响 localStorage 写入', () => {
    // 让 window 写入抛错
    const originalWindow = mockTopLevelWindow;
    Object.defineProperty(mockTopLevelWindow, '__ACU_LAST_OPTIMIZATION_BASE__', {
      set() { throw new Error('window write error'); },
      get() { return undefined; },
      configurable: true,
    });

    const cache = { baseContent: '测试内容' };
    saveOptimizationBaseToCache_ACU(cache);

    // localStorage 仍然应该被写入
    expect(localStorageMock.setItem).toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalled();

    // 恢复
    Object.defineProperty(mockTopLevelWindow, '__ACU_LAST_OPTIMIZATION_BASE__', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it('localStorage 写入失败时记录日志', () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('localStorage write error');
    });

    const cache = { baseContent: '测试内容' };
    saveOptimizationBaseToCache_ACU(cache);

    // window 应该成功写入
    expect(mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__).toEqual(cache);
    // 日志应该被记录
    expect(mockLogDebug).toHaveBeenCalled();
  });

  it('null 值也能写入', () => {
    saveOptimizationBaseToCache_ACU(null);
    expect(mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__).toBeNull();
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ACU_LAST_OPTIMIZATION_BASE',
      'null',
    );
  });
});

// ═══ loadOptimizationBaseFromCache_ACU ═══
describe('loadOptimizationBaseFromCache_ACU', () => {
  it('window 有缓存且有 baseContent 时返回', () => {
    const cache = { baseContent: '测试内容', timestamp: 123 };
    mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__ = cache;
    const result = loadOptimizationBaseFromCache_ACU();
    expect(result).toEqual(cache);
  });

  it('window 缓存无 baseContent 时降级到 localStorage', () => {
    mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__ = { noBaseContent: true };
    const lsCache = { baseContent: 'localStorage内容' };
    localStorageMock.getItem.mockReturnValue(JSON.stringify(lsCache));

    const result = loadOptimizationBaseFromCache_ACU();
    expect(result).toEqual(lsCache);
  });

  it('window 无缓存时降级到 localStorage', () => {
    delete mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__;
    const lsCache = { baseContent: 'localStorage内容' };
    localStorageMock.getItem.mockReturnValue(JSON.stringify(lsCache));

    const result = loadOptimizationBaseFromCache_ACU();
    expect(result).toEqual(lsCache);
  });

  it('localStorage 无缓存时返回 null', () => {
    delete mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__;
    localStorageMock.getItem.mockReturnValue(null);

    const result = loadOptimizationBaseFromCache_ACU();
    expect(result).toBeNull();
  });

  it('localStorage 内容无 baseContent 时返回 null', () => {
    delete mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__;
    localStorageMock.getItem.mockReturnValue(JSON.stringify({ noBaseContent: true }));

    const result = loadOptimizationBaseFromCache_ACU();
    expect(result).toBeNull();
  });

  it('localStorage JSON 解析失败时返回 null', () => {
    delete mockTopLevelWindow.__ACU_LAST_OPTIMIZATION_BASE__;
    localStorageMock.getItem.mockReturnValue('invalid json{{{');

    const result = loadOptimizationBaseFromCache_ACU();
    expect(result).toBeNull();
    expect(mockLogDebug).toHaveBeenCalled();
  });

  it('两层都失败时返回 null', () => {
    // window 层抛错
    Object.defineProperty(mockTopLevelWindow, '__ACU_LAST_OPTIMIZATION_BASE__', {
      get() { throw new Error('window read error'); },
      configurable: true,
    });
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error('localStorage read error');
    });

    const result = loadOptimizationBaseFromCache_ACU();
    expect(result).toBeNull();

    // 恢复
    Object.defineProperty(mockTopLevelWindow, '__ACU_LAST_OPTIMIZATION_BASE__', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });
});
