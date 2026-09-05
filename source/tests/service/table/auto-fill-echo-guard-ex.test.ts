/**
 * tests/service/table/auto-fill-echo-guard-ex.test.ts
 * resolveAiFloorSignatureEx_ACU（配对零产出证据）单元测试。
 *
 * 约束：前两字段必须与既有 resolveAiFloorSignature_ACU 同口径（复用 isAiFloor_ACU 谓词，
 * AI 楼 = !is_user，含 narrator）；latestContentHash 为最新 AI 楼 mes 的同步 sha256，
 * mes 缺失/非字符串时为 null。纯函数。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
}));

vi.mock('../../../src/data/storage/optimization-cache-storage', () => ({
  findAutoTableFillProcessedEntry_ACU: vi.fn(() => null),
  recordAutoTableFillProcessed_ACU: vi.fn((entry: any) => entry),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

import {
  resolveAiFloorSignature_ACU,
  resolveAiFloorSignatureEx_ACU,
} from '../../../src/service/table/auto-fill-echo-guard';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';

const user = (id: number) => ({ is_user: true, message_id: id, mes: 'user' });
const ai = (id: number, mes: any) => ({ is_user: false, message_id: id, mes });
const narrator = (id: number, mes: any) => ({ is_user: false, message_id: id, mes, extra: { type: 'narrator' } });

describe('resolveAiFloorSignatureEx_ACU', () => {
  it('前两字段与 resolveAiFloorSignature_ACU 同口径（含 narrator）', () => {
    const chat = [user(1), ai(2, 'a'), user(3), narrator(4, 'n')];
    const base = resolveAiFloorSignature_ACU(chat);
    const ex = resolveAiFloorSignatureEx_ACU(chat);
    expect(ex.aiFloorCount).toBe(base.aiFloorCount);
    expect(ex.latestAiMessageId).toBe(base.latestAiMessageId);
    expect(base).toEqual({ aiFloorCount: 2, latestAiMessageId: 4 });
  });

  it('latestContentHash 为最新 AI 楼 mes 的 sha256 同步哈希', () => {
    const chat = [user(1), ai(2, 'first'), ai(3, 'latest body')];
    const ex = resolveAiFloorSignatureEx_ACU(chat);
    expect(ex.latestContentHash).toBe(sha256HexSync_ACU('latest body'));
  });

  it('narrator 为末楼时同样纳入哈希（与既有口径一致）', () => {
    const chat = [user(1), ai(2, 'a'), narrator(3, 'sys')];
    const ex = resolveAiFloorSignatureEx_ACU(chat);
    expect(ex.aiFloorCount).toBe(2);
    expect(ex.latestAiMessageId).toBe(3);
    expect(ex.latestContentHash).toBe(sha256HexSync_ACU('sys'));
  });

  it('最新 AI 楼 mes 缺失/非字符串时 hash 为 null', () => {
    expect(resolveAiFloorSignatureEx_ACU([user(1), { is_user: false, message_id: 2 }]).latestContentHash).toBeNull();
    expect(resolveAiFloorSignatureEx_ACU([user(1), ai(2, 42 as any)]).latestContentHash).toBeNull();
    expect(resolveAiFloorSignatureEx_ACU([user(1), ai(2, null as any)]).latestContentHash).toBeNull();
  });

  it('空聊天/非数组/无 AI 楼时返回 { 0, null, null }', () => {
    expect(resolveAiFloorSignatureEx_ACU([])).toEqual({ aiFloorCount: 0, latestAiMessageId: null, latestContentHash: null });
    expect(resolveAiFloorSignatureEx_ACU(null)).toEqual({ aiFloorCount: 0, latestAiMessageId: null, latestContentHash: null });
    expect(resolveAiFloorSignatureEx_ACU([user(1), user(2)])).toEqual({ aiFloorCount: 0, latestAiMessageId: null, latestContentHash: null });
  });

  it('swipe/同楼换内容：id 相同但 hash 变化（推演③的单元证据）', () => {
    const before = resolveAiFloorSignatureEx_ACU([user(1), ai(2, 'old')]);
    const after = resolveAiFloorSignatureEx_ACU([user(1), ai(2, 'new')]);
    expect(after.aiFloorCount).toBe(before.aiFloorCount);
    expect(after.latestAiMessageId).toBe(before.latestAiMessageId);
    expect(after.latestContentHash).not.toBe(before.latestContentHash);
  });

  it('不改变输入聊天数组（纯函数）', () => {
    const chat = [user(1), ai(2, 'a')];
    const snapshot = JSON.parse(JSON.stringify(chat));
    resolveAiFloorSignatureEx_ACU(chat);
    expect(chat).toEqual(snapshot);
  });
});
