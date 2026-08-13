import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  data: { sheet_summary: { name: '纪要表', content: [['row_id', '纪要'], ['1', '内容']] } } as any,
  load: vi.fn(),
  commit: vi.fn(),
  archive: vi.fn(),
  clearFlush: vi.fn(),
  updateLorebook: vi.fn(),
  isolationKey: 'iso-a',
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.data; },
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/service/chat/chat-service', () => ({ getLastMessageIndex_ACU: () => 3 }));
vi.mock('../../../src/service/table/table-service', () => ({ loadOrCreateJsonTableFromChatHistory_ACU: h.load }));
vi.mock('../../../src/service/table/table-update-commit', () => ({ runTableUpdateCommit_ACU: h.commit }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ updateReadableLorebookEntry_ACU: h.updateLorebook }));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: () => h.data?.sheet_summary ? { summaryKey: 'sheet_summary', table: h.data.sheet_summary } : null,
  archiveSummaryVectorIndexNow_ACU: h.archive,
}));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  clearSummaryVectorIndexFlushQueueForCurrentScope_ACU: (...args: any[]) => h.clearFlush(...args),
  clearSummaryVectorIndexCredentialCooldowns_ACU: vi.fn(),
}));

import { rebuildCurrentSummaryVectorIndexNow_ACU } from '../../../src/service/vector/summary-vector-index-rebuild-service';

describe('rebuildCurrentSummaryVectorIndexNow_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.data = { sheet_summary: { name: '纪要表', content: [['row_id', '纪要'], ['1', '内容']] } };
    h.commit.mockImplementation(async (_options: any, apply: any) => {
      const applied = await apply();
      return { success: applied.success, saved: true };
    });
    h.isolationKey = 'iso-a';
    h.clearFlush.mockResolvedValue(1);
    h.archive.mockResolvedValue({ success: true, skipped: false, indexedRowCount: 1, chunkCount: 1, errors: [] });
    h.updateLorebook.mockResolvedValue(true);
  });

  it('复用按钮普通路径：提交纪要快照后同步归档并刷新世界书', async () => {
    const result = await rebuildCurrentSummaryVectorIndexNow_ACU();

    expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'vector_index_rebuild_snapshot',
      targetMessageIndex: 3,
      targetSheetKeys: ['sheet_summary'],
    }), expect.any(Function));
    expect(h.clearFlush).toHaveBeenCalledWith({
      isolationKey: 'iso-a',
      sourceTableKey: 'sheet_summary',
    });
    expect(h.archive).toHaveBeenCalledWith({ mode: 'sync' });
    expect(h.updateLorebook).toHaveBeenCalledWith(true);
    expect(result).toMatchObject({ success: true, skipped: false });
  });

  it('快照提交返回 saved:false 时不继续生成向量文件', async () => {
    h.commit.mockResolvedValue({ success: true, saved: false, error: 'commit not saved' });

    await expect(rebuildCurrentSummaryVectorIndexNow_ACU()).rejects.toThrow('commit not saved');
    expect(h.clearFlush).not.toHaveBeenCalled();
    expect(h.archive).not.toHaveBeenCalled();
    expect(h.updateLorebook).not.toHaveBeenCalled();
  });

  it('快照提交明确失败时不继续生成向量文件', async () => {
    h.commit.mockResolvedValue({ success: false, saved: false, error: 'commit failed' });

    await expect(rebuildCurrentSummaryVectorIndexNow_ACU()).rejects.toThrow('commit failed');
    expect(h.clearFlush).not.toHaveBeenCalled();
    expect(h.archive).not.toHaveBeenCalled();
  });

  it('flush 失效墓碑写入失败时不启动可能与旧 runner 竞争的同步归档', async () => {
    h.clearFlush.mockRejectedValue(new Error('invalidate failed'));

    await expect(rebuildCurrentSummaryVectorIndexNow_ACU()).rejects.toThrow('invalidate failed');

    expect(h.archive).not.toHaveBeenCalled();
    expect(h.updateLorebook).not.toHaveBeenCalled();
  });
});
