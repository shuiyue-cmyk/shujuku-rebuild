/**
 * 块 5 复审 R5-06：「迁移旧交火索引」必须产出召回链路实际读取的新版镜像。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  rebuildNow: vi.fn(),
  legacyMigrate: vi.fn(),
}));

vi.mock('../../../src/service/vector/summary-vector-index-rebuild-service', () => ({
  rebuildCurrentSummaryVectorIndexNow_ACU: h.rebuildNow,
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  migrateLegacySummaryVectorIndexToContentAddressed_ACU: h.legacyMigrate,
}));
vi.mock('../../../src/service/chat/chat-service', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getChatArray_ACU: () => h.chat,
}));

import { migrateLegacySummaryVectorIndex_ACU } from '../../../src/presentation/triggers/data-admin-ui';

describe('块 5 复审 R5-06：迁移旧交火索引', () => {
  beforeEach(() => {
    h.rebuildNow.mockReset();
    h.legacyMigrate.mockReset();
    h.chat = [{ is_user: false, TavernDB_ACU_IsolatedData: { '': { summaryVectorIndexState: { version: 1 } } } }];
  });

  it('有旧版字段时改走新版镜像重建，不再写只有旧链路认的指针', async () => {
    h.rebuildNow.mockResolvedValue({ success: true, skipped: false, indexedRowCount: 3, chunkCount: 3, skippedRowCount: 0, errors: [] });
    const result: any = await migrateLegacySummaryVectorIndex_ACU();
    expect(h.rebuildNow).toHaveBeenCalledWith({ reason: 'initial' });
    expect(h.legacyMigrate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, skipped: false });
  });

  it('没有旧版字段时不重建', async () => {
    h.chat = [{ is_user: false, TavernDB_ACU_IsolatedData: { '': {} } }];
    const result: any = await migrateLegacySummaryVectorIndex_ACU();
    expect(h.rebuildNow).not.toHaveBeenCalled();
    expect(h.legacyMigrate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, skipped: true });
  });
});
