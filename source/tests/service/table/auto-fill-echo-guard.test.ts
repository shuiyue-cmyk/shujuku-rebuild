/**
 * tests/service/table/auto-fill-echo-guard.test.ts
 * [W3] 自动填表回声防重：messageId 级判重 + 与正文替换链分集合互不污染
 *
 * 这里跑的是真实守卫 + 真实浏览器侧缓存适配器（window + localStorage 双层用替身），
 * 因为「两条链不得互相污染」只有在共用载体时才需要被证明。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTopLevelWindow, mockChatKey } = vi.hoisted(() => ({
  mockTopLevelWindow: {} as any,
  mockChatKey: { value: 'chat-A' },
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopLevelWindow,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mockChatKey.value; },
}));

import {
  resolveLatestAiFloor_ACU,
  resolveAiFloorSignature_ACU,
  shouldSkipDuplicateAutoTableFill_ACU,
  recordAutoTableFillProcessedForFloor_ACU,
} from '../../../src/service/table/auto-fill-echo-guard';
import {
  clearAutoTableFillProcessed_ACU,
  clearAutoOptimizationProcessed_ACU,
  loadAutoTableFillProcessedEntries_ACU,
  recordAutoTableFillProcessed_ACU,
  recordAutoOptimizationProcessed_ACU,
  findAutoOptimizationProcessedEntry_ACU,
  AUTO_TABLE_FILL_PROCESSED_LIMIT_ACU,
} from '../../../src/data/storage/optimization-cache-storage';

const localStorageStore: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageStore[key] ?? null,
    setItem: (key: string, value: string) => { localStorageStore[key] = value; },
    removeItem: (key: string) => { delete localStorageStore[key]; },
  },
  writable: true,
  configurable: true,
});

beforeEach(() => {
  clearAutoTableFillProcessed_ACU();
  clearAutoOptimizationProcessed_ACU();
  mockChatKey.value = 'chat-A';
});

describe('resolveLatestAiFloor_ACU', () => {
  it('取最新的 AI 楼层作为触发身份', () => {
    expect(resolveLatestAiFloor_ACU([
      { is_user: false, message_id: 3 },
      { is_user: true, message_id: 4 },
      { is_user: false, message_id: 5 },
    ])).toEqual({ messageIndex: 2, messageId: 5 });
  });

  it('末尾是用户消息时回退到最近的 AI 楼', () => {
    expect(resolveLatestAiFloor_ACU([
      { is_user: false, message_id: 3 },
      { is_user: true, message_id: 4 },
    ])).toEqual({ messageIndex: 0, messageId: 3 });
  });

  it('空聊天 / 非数组 / 没有 message_id 一律返回 null 或 messageId=null', () => {
    expect(resolveLatestAiFloor_ACU([])).toBeNull();
    expect(resolveLatestAiFloor_ACU(null as any)).toBeNull();
    expect(resolveLatestAiFloor_ACU([{ is_user: true }])).toBeNull();
    expect(resolveLatestAiFloor_ACU([{ is_user: false }])).toEqual({ messageIndex: 0, messageId: null });
  });
});

// [152 收紧] 无配对 GENERATION_ENDED 的「新 AI 楼证据」签名：门控拿它判「零产出假事件」。
describe('resolveAiFloorSignature_ACU', () => {
  it('AI 楼数按 !is_user 计数并含 narrator 系统楼，末楼身份与 resolveLatestAiFloor_ACU 同源', () => {
    const chat = [
      { is_user: false, message_id: 3 },
      { is_user: true, message_id: 4 },
      { is_user: false, extra: { type: 'narrator' }, message_id: 5 },
      { is_user: false, message_id: 7 },
    ];
    expect(resolveAiFloorSignature_ACU(chat)).toEqual({ aiFloorCount: 3, latestAiMessageId: 7 });
    // 同一份聊天里两套口径必须落在同一栋楼上——签名不许自带第二套 AI 楼判定。
    expect(resolveAiFloorSignature_ACU(chat).latestAiMessageId).toBe(resolveLatestAiFloor_ACU(chat)!.messageId);
  });

  it('推演④：查看器 send_if_empty 只写 user 楼 → 签名逐字不变（可判为零产出）', () => {
    const before = [{ is_user: false, message_id: 5 }];
    const beforeSignature = resolveAiFloorSignature_ACU(before);
    const after = [...before, { is_user: true, message_id: 6 }];
    expect(resolveAiFloorSignature_ACU(after)).toEqual(beforeSignature);
  });

  it('推演⑤⑥：真实产出必然改签名（新 AI 楼缺 message_id 也算；regenerate 同楼数换 message_id）', () => {
    const base = resolveAiFloorSignature_ACU([{ is_user: false, message_id: 5 }]);
    // 新楼还没拿到 message_id（宿主稍后补）——楼数变化本身就是证据，签名必须与上一轮不同。
    expect(resolveAiFloorSignature_ACU([{ is_user: false, message_id: 5 }, { is_user: false }]))
      .not.toEqual(base);
    expect(resolveAiFloorSignature_ACU([{ is_user: false, message_id: 5 }, { is_user: false }]))
      .toEqual({ aiFloorCount: 2, latestAiMessageId: null });
    // 同楼数、内容重生成 → message_id 变了就是新楼。
    expect(resolveAiFloorSignature_ACU([{ is_user: false, message_id: 9 }])).toEqual({ aiFloorCount: 1, latestAiMessageId: 9 });
  });

  it('空聊天 / 非数组 / 全是用户楼 → { 0, null }（签名永远可用，不返回 null）', () => {
    expect(resolveAiFloorSignature_ACU([])).toEqual({ aiFloorCount: 0, latestAiMessageId: null });
    expect(resolveAiFloorSignature_ACU(null as any)).toEqual({ aiFloorCount: 0, latestAiMessageId: null });
    expect(resolveAiFloorSignature_ACU([{ is_user: true, message_id: 1 }])).toEqual({ aiFloorCount: 0, latestAiMessageId: null });
  });

  it('脏数据（数组里的 null 元素）不计入楼数', () => {
    expect(resolveAiFloorSignature_ACU([null, { is_user: false, message_id: 2 }])).toEqual({ aiFloorCount: 1, latestAiMessageId: 2 });
  });
});

describe('shouldSkipDuplicateAutoTableFill_ACU / recordAutoTableFillProcessedForFloor_ACU', () => {
  it('①登记后同一 messageId 的回声触发被拦（填表链只看 messageId）', () => {
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 4, messageId: 44 })).toBe(false);
    recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 4, messageId: 44 });
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 4, messageId: 44 })).toBe(true);
  });

  it('②楼层内容变化不影响填表判重（不会被正文替换写回联动误发）', () => {
    recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 4, messageId: 44 });
    // 填表记录里根本没有内容指纹
    const [entry] = loadAutoTableFillProcessedEntries_ACU();
    expect(entry.contentHash).toBe('');
    expect(entry.chain).toBe('auto_table_fill');
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 4, messageId: 44 })).toBe(true);
  });

  it('③新 messageId 不被拦截', () => {
    recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 4, messageId: 44 });
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 6, messageId: 45 })).toBe(false);
  });

  it('拿不到 messageId / floor 时一律放行', () => {
    recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 4, messageId: 44 });
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 4, messageId: null })).toBe(false);
    expect(shouldSkipDuplicateAutoTableFill_ACU(null)).toBe(false);
    expect(recordAutoTableFillProcessedForFloor_ACU(null)).toBeNull();
    expect(recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 1, messageId: null })).toBeNull();
  });

  it('跨聊天 message_id 重号：chatKey 不同视为不命中', () => {
    recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 4, messageId: 44 });
    mockChatKey.value = 'chat-B';
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 4, messageId: 44 })).toBe(false);
    mockChatKey.value = 'chat-A';
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 4, messageId: 44 })).toBe(true);
  });

  it('④容量按 updatedAt 裁剪，不随聊天推进无界增长', () => {
    for (let i = 0; i < 30; i++) {
      recordAutoTableFillProcessed_ACU({ messageId: i, messageIndex: i, chatKey: 'chat-A', updatedAt: 1000 + i });
    }
    const entries = loadAutoTableFillProcessedEntries_ACU();
    expect(entries.length).toBe(AUTO_TABLE_FILL_PROCESSED_LIMIT_ACU);
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 29, messageId: 29 })).toBe(true);
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 0, messageId: 0 })).toBe(false);
  });

  it('两条链分集合：填表登记不会让正文替换链判重，反之亦然', () => {
    recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 4, messageId: 77 });
    expect(findAutoOptimizationProcessedEntry_ACU(77, 'chat-A')).toBeNull();

    recordAutoOptimizationProcessed_ACU({
      messageId: 78, messageIndex: 5, contentHash: 'hash-x', chatKey: 'chat-A', updatedAt: 1,
    });
    expect(loadAutoTableFillProcessedEntries_ACU().some((entry) => entry.messageId === '78')).toBe(false);
    expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 5, messageId: 78 })).toBe(false);
  });

  it('填表链允许没有内容指纹的记录，正文替换链缺指纹视为非法', () => {
    recordAutoTableFillProcessed_ACU({ messageId: 91, messageIndex: 2, chatKey: 'chat-A', updatedAt: 5 });
    expect(loadAutoTableFillProcessedEntries_ACU()).toHaveLength(1);
    expect(recordAutoOptimizationProcessed_ACU({ messageId: 91, messageIndex: 2, chatKey: 'chat-A', updatedAt: 5 })).toBeNull();
    expect(findAutoOptimizationProcessedEntry_ACU(91, 'chat-A')).toBeNull();
  });
});
