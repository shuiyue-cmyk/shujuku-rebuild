import { beforeEach, describe, expect, it, vi } from 'vitest';

const { entriesByBook, mockSetEntries } = vi.hoisted(() => ({
  entriesByBook: new Map<string, any[]>(),
  mockSetEntries: vi.fn(),
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getLorebookEntries_ACU: vi.fn(async (bookName: string) => entriesByBook.get(bookName) || []),
  setLorebookEntries_ACU: mockSetEntries,
}));

vi.mock('../../../src/shared/utils', () => ({
  hashUserInput_ACU: vi.fn((value: string) => `hash:${value}`),
  logWarn_ACU: vi.fn(),
}));

import {
  buildAgentWorldbookSelectionSignature_ACU,
  rollbackAgentWorldbookSnapshotRestore_ACU,
  restoreAgentWorldbookSnapshotEntries_ACU,
} from '../../../src/service/agent/agent-worldbook-snapshot-restore';

function activeSnapshot(entries: any[]) {
  return {
    active: true,
    selectionSignature: buildAgentWorldbookSelectionSignature_ACU(['世界书']),
    createdAt: 1,
    books: { 世界书: entries },
  } as any;
}

describe('restoreAgentWorldbookSnapshotEntries_ACU', () => {
  beforeEach(() => {
    entriesByBook.clear();
    mockSetEntries.mockReset();
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      entriesByBook.set(bookName, (entriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid))
        ? { ...entry, ...patchByUid.get(String(entry.uid)) }
        : entry));
    });
  });

  it('rejects an active snapshot whose signature belongs to another scope', async () => {
    const result = await restoreAgentWorldbookSnapshotEntries_ACU({ ...activeSnapshot([]), selectionSignature: 'other' }, ['世界书']);

    expect(result).toEqual({
      restored: 0,
      skipped: 0,
      failed: 0,
      signatureMatched: false,
      rollbackPatchesByBook: {},
      restoredPatchesByBook: {},
    });
    expect(mockSetEntries).not.toHaveBeenCalled();
  });

  // 已删除条目没有可恢复对象，不计 skipped，否则 scope 变更会永远被拒绝；无效 uid 仍计 skipped。
  it('skips invalid snapshot entries, ignores deleted ones, and patches nothing unrelated', async () => {
    entriesByBook.set('世界书', [{ uid: 'present', comment: '普通条目', enabled: false }]);

    const result = await restoreAgentWorldbookSnapshotEntries_ACU(activeSnapshot([
      { uid: '', previousEnabled: true },
      { uid: 'missing', previousEnabled: true },
    ]), ['世界书']);

    expect(result).toEqual({
      restored: 0,
      skipped: 1,
      failed: 0,
      signatureMatched: true,
      rollbackPatchesByBook: {},
      restoredPatchesByBook: {},
    });
    expect(mockSetEntries).not.toHaveBeenCalled();
  });

  // R4-07：与接管停用同口径——用户改过注释的条目整条跳过，连接管块也不剥（块里是之后恢复的依据），
  // 不再「先剥再靠整体回滚补救」。
  it('does not touch a user-edited entry at all (keeps takeover metadata, counts as skipped)', async () => {
    const comment = '用户修改后的正文\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    entriesByBook.set('世界书', [{ uid: 'entry-1', comment, enabled: false, keys: [] }]);

    const result = await restoreAgentWorldbookSnapshotEntries_ACU(activeSnapshot([
      { uid: 'entry-1', commentHash: 'hash:旧正文', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' },
    ]), ['世界书']);

    expect(result).toEqual({
      restored: 0,
      skipped: 1,
      failed: 0,
      signatureMatched: true,
      rollbackPatchesByBook: {},
      restoredPatchesByBook: {},
    });
    expect(mockSetEntries).not.toHaveBeenCalled();
  });

  it('R4-07：pending 条目从未被接管改动，不恢复也不覆盖其 keys/type', async () => {
    entriesByBook.set('世界书', [{ uid: 'entry-1', comment: '正文', enabled: true, keys: ['现关键词'], type: 'constant' }]);

    const result = await restoreAgentWorldbookSnapshotEntries_ACU(activeSnapshot([
      { uid: 'entry-1', takeoverStatus: 'pending', previousEnabled: true, previousKeys: ['快照关键词'], previousType: 'selective' },
    ]), ['世界书']);

    expect(result).toMatchObject({ restored: 0, skipped: 0, failed: 0, signatureMatched: true });
    expect(mockSetEntries).not.toHaveBeenCalled();
    expect(entriesByBook.get('世界书')![0]).toMatchObject({ keys: ['现关键词'], type: 'constant' });
  });

  it('captures only patches confirmed after a partial gateway write rejects', async () => {
    entriesByBook.set('世界书', [
      { uid: 'entry-1', comment: '正文一', enabled: false, keys: [] },
      { uid: 'entry-2', comment: '正文二', enabled: false, keys: [] },
    ]);
    mockSetEntries.mockImplementationOnce(async (bookName: string, patches: any[]) => {
      const firstPatch = patches[0];
      entriesByBook.set(bookName, (entriesByBook.get(bookName) || []).map(entry => String(entry.uid) === String(firstPatch.uid)
        ? { ...entry, ...firstPatch }
        : entry));
      throw new Error('partial gateway failure');
    });

    const result = await restoreAgentWorldbookSnapshotEntries_ACU(activeSnapshot([
      { uid: 'entry-1', previousEnabled: true, previousKeys: ['关键词一'], previousType: 'selective' },
      { uid: 'entry-2', previousEnabled: true, previousKeys: ['关键词二'], previousType: 'selective' },
    ]), ['世界书']);

    expect(result).toMatchObject({ restored: 0, failed: 2, signatureMatched: true });
    expect(result.rollbackPatchesByBook).toEqual({
      世界书: [{ uid: 'entry-1', comment: '正文一', enabled: false, keys: [], type: undefined }],
    });
    expect(result.restoredPatchesByBook).toEqual({
      世界书: [{ uid: 'entry-1', comment: '正文一', enabled: true, keys: ['关键词一'], type: 'selective' }],
    });
  });

  it('reports all entries in a book as failed when the gateway write fails', async () => {
    entriesByBook.set('世界书', [{ uid: 'entry-1', comment: '正文', enabled: false, keys: [] }]);
    mockSetEntries.mockRejectedValueOnce(new Error('gateway failure'));

    const result = await restoreAgentWorldbookSnapshotEntries_ACU(activeSnapshot([
      { uid: 'entry-1', previousEnabled: true, previousKeys: ['关键词'], previousType: 'selective' },
    ]), ['世界书']);

    expect(result).toEqual({
      restored: 0,
      skipped: 0,
      failed: 1,
      signatureMatched: true,
      rollbackPatchesByBook: {},
      restoredPatchesByBook: {},
    });
  });

  it('does not overwrite an entry edited after restore when rollback detects a conflict', async () => {
    entriesByBook.set('世界书', [{ uid: 'entry-1', comment: '恢复后的正文', enabled: true, keys: ['旧关键词'], type: 'selective' }]);

    const result = await rollbackAgentWorldbookSnapshotRestore_ACU(
      { 世界书: [{ uid: 'entry-1', comment: '接管正文', enabled: false, keys: [], type: 'constant' }] },
      { 世界书: [{ uid: 'entry-1', comment: '恢复后的正文', enabled: true, keys: ['旧关键词'], type: 'selective' }] },
    );
    const beforeEditCallCount = mockSetEntries.mock.calls.length;
    entriesByBook.set('世界书', [{ uid: 'entry-1', comment: '第三方编辑', enabled: true, keys: ['新关键词'], type: 'selective' }]);

    const conflicted = await rollbackAgentWorldbookSnapshotRestore_ACU(
      { 世界书: [{ uid: 'entry-1', comment: '接管正文', enabled: false, keys: [], type: 'constant' }] },
      { 世界书: [{ uid: 'entry-1', comment: '恢复后的正文', enabled: true, keys: ['旧关键词'], type: 'selective' }] },
    );

    expect(result).toBe(true);
    expect(conflicted).toBe(false);
    expect(mockSetEntries).toHaveBeenCalledTimes(beforeEditCallCount);
    expect(entriesByBook.get('世界书')).toEqual([
      { uid: 'entry-1', comment: '第三方编辑', enabled: true, keys: ['新关键词'], type: 'selective' },
    ]);
  });
});
