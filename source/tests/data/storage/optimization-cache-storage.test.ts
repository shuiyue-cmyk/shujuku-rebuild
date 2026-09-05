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
  recordAutoOptimizationProcessed_ACU,
  findAutoOptimizationProcessedEntry_ACU,
  loadAutoOptimizationProcessedEntries_ACU,
  trimAutoOptimizationProcessedEntries_ACU,
  clearAutoOptimizationProcessed_ACU,
  removeChainProcessedByMessageId_ACU,
  removeAutoChainProcessedForMessage_ACU,
  recordAutoTableFillProcessed_ACU,
  findAutoTableFillProcessedEntry_ACU,
  loadAutoTableFillProcessedEntries_ACU,
  clearAutoTableFillProcessed_ACU,
  AUTO_OPTIMIZATION_PROCESSED_LIMIT_ACU,
} from '../../../src/data/storage/optimization-cache-storage';

// 模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
    // 直读底层 store：供 beforeEach 恢复默认读取实现
    // （历史用例用 mockImplementation 抛错后不会自动回滚，会泄漏到后续用例）
    peek: (key: string) => store[key] ?? null,
    _store: store,
  };
})();

beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
  // mockClear 不会回滚 mockImplementation，这里显式恢复默认读取行为，避免用例间串味
  localStorageMock.getItem.mockImplementation((key: string) => localStorageMock.peek(key));
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

// ═══ [自动正文替换] 已处理集合（按 messageId 判重）═══
describe('自动替换已处理集合（optimization-cache-storage）', () => {
  const WINDOW_KEY = '__ACU_CONTENT_OPTIMIZATION_PROCESSED__';
  const LS_KEY = 'ACU_CONTENT_OPTIMIZATION_PROCESSED';

  beforeEach(() => {
    delete mockTopLevelWindow[WINDOW_KEY];
    clearAutoOptimizationProcessed_ACU();
  });

  it('记录后可按 messageId 查回，并同时落 window + localStorage 两层', () => {
    const entry = recordAutoOptimizationProcessed_ACU({
      messageIndex: 5,
      messageId: 42,
      contentHash: 'hash-a',
      chatKey: 'chatA',
      updatedAt: 1000,
    });

    expect(entry).toMatchObject({ messageId: '42', contentHash: 'hash-a', chatKey: 'chatA', updatedAt: 1000 });
    expect(mockTopLevelWindow[WINDOW_KEY].entries[0].contentHash).toBe('hash-a');
    const persisted = JSON.parse(localStorageMock.getItem(LS_KEY) as string);
    expect(persisted.entries).toEqual([entry]);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(LS_KEY, expect.any(String));
    expect(findAutoOptimizationProcessedEntry_ACU(42, 'chatA')).toMatchObject({ contentHash: 'hash-a' });
  });

  it('同一 messageId 再次记录 → 覆盖为最新指纹，集合不增长', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 7, contentHash: 'old', chatKey: 'c', updatedAt: 100 });
    recordAutoOptimizationProcessed_ACU({ messageId: 7, contentHash: 'new', chatKey: 'c', updatedAt: 200 });

    const entries = loadAutoOptimizationProcessedEntries_ACU();
    expect(entries).toHaveLength(1);
    expect(entries[0].contentHash).toBe('new');
    expect(findAutoOptimizationProcessedEntry_ACU(7, 'c')).toMatchObject({ contentHash: 'new' });
  });

  it('内容变化 → 记录更新为写回后的新指纹（下次同内容才判重）', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 9, contentHash: 'v1', chatKey: 'c', updatedAt: 100 });
    expect(findAutoOptimizationProcessedEntry_ACU(9, 'c')!.contentHash).toBe('v1');
    recordAutoOptimizationProcessed_ACU({ messageId: 9, contentHash: 'v2', chatKey: 'c', updatedAt: 300 });
    expect(findAutoOptimizationProcessedEntry_ACU(9, 'c')!.contentHash).toBe('v2');
  });

  it('容量上限生效：超过 20 条按 updatedAt 裁剪，最旧记录被淘汰', () => {
    for (let i = 0; i < 25; i++) {
      recordAutoOptimizationProcessed_ACU({
        messageId: i,
        contentHash: `hash-${i}`,
        chatKey: 'c',
        updatedAt: 1000 + i,
      });
    }

    const entries = loadAutoOptimizationProcessedEntries_ACU();
    expect(entries.length).toBe(AUTO_OPTIMIZATION_PROCESSED_LIMIT_ACU);
    expect(entries.length).toBe(20);
    // 最新的 5 条一定在，最旧的 5 条一定被裁掉
    expect(entries.some((entry) => entry.messageId === '24')).toBe(true);
    expect(entries.some((entry) => entry.messageId === '20')).toBe(true);
    expect(entries.some((entry) => entry.messageId === '4')).toBe(false);
    expect(entries.some((entry) => entry.messageId === '0')).toBe(false);
    expect(findAutoOptimizationProcessedEntry_ACU(3, 'c')).toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(24, 'c')).not.toBeNull();
    // 落盘集合本身也有界（不会无界写入 localStorage）
    const persisted = JSON.parse(localStorageMock.getItem(LS_KEY)!);
    expect(persisted.entries.length).toBeLessThanOrEqual(20);
  });

  it('trimAutoOptimizationProcessedEntries_ACU 去重 + 排序 + 自定义上限', () => {
    const trimmed = trimAutoOptimizationProcessedEntries_ACU([
      { messageId: 1, contentHash: 'a', updatedAt: 10 },
      { messageId: 1, contentHash: 'b', updatedAt: 30 },
      { messageId: 2, contentHash: 'c', updatedAt: 20 },
      { messageId: 3, contentHash: 'd', updatedAt: 40 },
    ], 2);

    expect(trimmed.map((entry) => entry.messageId)).toEqual(['3', '1']);
    expect(trimmed[1].contentHash).toBe('b');
  });

  it('chatKey 不同视为不命中（跨聊天 message_id 重号保护），任一侧为空则放行匹配', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 11, contentHash: 'h', chatKey: 'chatA', updatedAt: 1 });

    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chatB')).toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chatA')).not.toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(11)).not.toBeNull();

    recordAutoOptimizationProcessed_ACU({ messageId: 12, contentHash: 'h2', chatKey: '', updatedAt: 2 });
    expect(findAutoOptimizationProcessedEntry_ACU(12, 'anyChat')).not.toBeNull();
  });

  it('messageId 缺失 / 指纹缺失的脏记录被过滤，不进入集合', () => {
    mockTopLevelWindow[WINDOW_KEY] = {
      entries: [
        { messageId: 1 },
        { contentHash: 'x' },
        null,
        42,
        { messageId: 2, contentHash: 'ok', updatedAt: 5 },
      ],
    };

    const entries = loadAutoOptimizationProcessedEntries_ACU();
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe('2');
  });

  it('window 层为空时降级读 localStorage', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 3, contentHash: 'ls', chatKey: 'c', updatedAt: 7 });
    delete mockTopLevelWindow[WINDOW_KEY];

    expect(loadAutoOptimizationProcessedEntries_ACU().map((e) => e.contentHash)).toEqual(['ls']);
    expect(findAutoOptimizationProcessedEntry_ACU(3, 'c')).toMatchObject({ contentHash: 'ls' });
  });

  it('localStorage JSON 损坏 / 两层皆空时返回空集合（不抛错）', () => {
    localStorageMock.setItem(LS_KEY, 'not-json{{{');
    expect(loadAutoOptimizationProcessedEntries_ACU()).toEqual([]);
    expect(findAutoOptimizationProcessedEntry_ACU(1, 'c')).toBeNull();

    localStorageMock.removeItem(LS_KEY);
    expect(loadAutoOptimizationProcessedEntries_ACU()).toEqual([]);
  });

  it('clearAutoOptimizationProcessed_ACU 清两层，清完判重集合为空', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 8, contentHash: 'h', chatKey: 'c', updatedAt: 1 });
    clearAutoOptimizationProcessed_ACU();

    expect(mockTopLevelWindow[WINDOW_KEY]).toBeUndefined();
    expect(localStorageMock.getItem(LS_KEY)).toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(8, 'c')).toBeNull();
  });

  it('既有基础缓存不受影响：写判重集合不会污染 baseContent 缓存', () => {
    saveOptimizationBaseToCache_ACU({ messageIndex: 1, messageId: 1, baseContent: '原文', updatedAt: 1 });
    recordAutoOptimizationProcessed_ACU({ messageId: 1, contentHash: 'h', chatKey: 'c', updatedAt: 2 });

    expect(loadOptimizationBaseFromCache_ACU()).toMatchObject({ baseContent: '原文' });
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ACU_LAST_OPTIMIZATION_BASE',
      expect.any(String),
    );
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
      'ACU_LAST_OPTIMIZATION_BASE',
      expect.stringContaining('contentHash'),
    );
  });
});

// ═══ [W5] 按 messageId 删除已处理记录（MVU 解析完成联动重跑用）═══
describe('removeChainProcessedByMessageId_ACU / removeAutoChainProcessedForMessage_ACU', () => {
  // 文件级 beforeEach 只清基础缓存键；两链的已处理集合键会跨用例残留（window 层不会被 localStorage.clear 带走），
  // 删除类断言必须自带干净起点，否则测的是上一条用例的遗留集合。
  beforeEach(() => {
    clearAutoOptimizationProcessed_ACU();
    clearAutoTableFillProcessed_ACU();
  });

  it('命中即删：删完该楼查不到，其它楼不受影响，且两层同步落盘', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 11, contentHash: 'a', chatKey: 'chatA', updatedAt: 1 });
    recordAutoOptimizationProcessed_ACU({ messageId: 12, contentHash: 'b', chatKey: 'chatA', updatedAt: 2 });

    expect(removeChainProcessedByMessageId_ACU('content_replacement', 11, 'chatA')).toBe(1);
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chatA')).toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(12, 'chatA')).not.toBeNull();
    expect(loadAutoOptimizationProcessedEntries_ACU().map((entry) => entry.messageId)).toEqual(['12']);
    // window 与 localStorage 都必须是删完后的集合（否则刷新后旧记录复活，重跑又被判重拦掉）
    expect(mockTopLevelWindow.__ACU_CONTENT_OPTIMIZATION_PROCESSED__).toMatchObject({ entries: [{ messageId: '12' }] });
    expect(JSON.parse(localStorageMock.peek('ACU_CONTENT_OPTIMIZATION_PROCESSED')).entries.map((e: any) => e.messageId)).toEqual(['12']);
  });

  it('两链分集合各删各的：删填表不会动正文替换的记录', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 11, contentHash: 'a', chatKey: 'chatA', updatedAt: 1 });
    recordAutoTableFillProcessed_ACU({ messageId: 11, chatKey: 'chatA', updatedAt: 1 });

    expect(removeChainProcessedByMessageId_ACU('auto_table_fill', 11, 'chatA')).toBe(1);
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chatA')).toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chatA')).not.toBeNull();
  });

  it('removeAutoChainProcessedForMessage_ACU 一次清两链并回报各链删除数', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 11, contentHash: 'a', chatKey: 'chatA', updatedAt: 1 });
    recordAutoTableFillProcessed_ACU({ messageId: 11, chatKey: 'chatA', updatedAt: 1 });
    recordAutoTableFillProcessed_ACU({ messageId: 12, chatKey: 'chatA', updatedAt: 2 });

    const removed = removeAutoChainProcessedForMessage_ACU(11, 'chatA');
    expect(removed).toEqual({ content_replacement: 1, auto_table_fill: 1 });
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chatA')).toBeNull();
    expect(findAutoTableFillProcessedEntry_ACU(11, 'chatA')).toBeNull();
    expect(loadAutoTableFillProcessedEntries_ACU().map((entry) => entry.messageId)).toEqual(['12']);
  });

  it('未命中 / messageId 缺失 → 返回 0 且不写存储（幂等，重复调用安全）', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 11, contentHash: 'a', chatKey: 'chatA', updatedAt: 1 });
    vi.clearAllMocks();

    expect(removeChainProcessedByMessageId_ACU('content_replacement', 99, 'chatA')).toBe(0);
    expect(removeChainProcessedByMessageId_ACU('content_replacement', null, 'chatA')).toBe(0);
    expect(removeChainProcessedByMessageId_ACU('content_replacement', undefined, 'chatA')).toBe(0);
    expect(removeChainProcessedByMessageId_ACU('content_replacement', '', 'chatA')).toBe(0);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(mockTopLevelWindow.__ACU_CONTENT_OPTIMIZATION_PROCESSED__).toMatchObject({ entries: [{ messageId: '11' }] });
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chatA')).not.toBeNull();
  });

  it('chatKey 两侧都有值且不同 → 不删（跨聊天 message_id 重号保护）；任一侧为空则删', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 11, contentHash: 'a', chatKey: 'chatA', updatedAt: 1 });
    expect(removeChainProcessedByMessageId_ACU('content_replacement', 11, 'chatB')).toBe(0);
    expect(findAutoOptimizationProcessedEntry_ACU(11, 'chatA')).not.toBeNull();

    expect(removeChainProcessedByMessageId_ACU('content_replacement', 11, '')).toBe(1);
    recordAutoOptimizationProcessed_ACU({ messageId: 12, contentHash: 'b', chatKey: '', updatedAt: 2 });
    expect(removeChainProcessedByMessageId_ACU('content_replacement', 12, 'chatA')).toBe(1);
  });

  it('删空后集合读回为空数组（不残留旧 payload）', () => {
    recordAutoOptimizationProcessed_ACU({ messageId: 11, contentHash: 'a', chatKey: 'chatA', updatedAt: 1 });
    expect(removeChainProcessedByMessageId_ACU('content_replacement', 11, 'chatA')).toBe(1);
    expect(loadAutoOptimizationProcessedEntries_ACU()).toEqual([]);
    expect(removeChainProcessedByMessageId_ACU('content_replacement', 11, 'chatA')).toBe(0);
  });
});
