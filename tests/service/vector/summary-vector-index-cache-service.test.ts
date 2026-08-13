import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  clearLayer: vi.fn(),
  deleteTemp: vi.fn(),
  deleteHot: vi.fn(),
  clearFlush: vi.fn(),
  loadChunks: vi.fn(),
  snapshot: null as any,
  buildScope: vi.fn(),
  runExclusive: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/data/storage/vector-index-temp-cache', () => ({
  clearVectorIndexTempCache_ACU: vi.fn(),
  deleteVectorIndexCacheByIndex_ACU: (...args: any[]) => h.deleteTemp(...args),
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  clearSummaryVectorHotCache_ACU: vi.fn(),
  deleteSummaryVectorHotCacheByIndex_ACU: (...args: any[]) => h.deleteHot(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  clearSummaryVectorIndexFlushQueueForCurrentScopeUnlocked_ACU: (...args: any[]) => h.clearFlush(...args),
  resolveCurrentSummaryVectorFlushScope_ACU: (params: any) => ({
    scopeKey: JSON.stringify({ chatKey: 'chat-a', isolationKey: params.isolationKey, sourceTableKey: params.sourceTableKey }),
    chatKey: 'chat-a',
    isolationKey: params.isolationKey,
    sourceTableKey: params.sourceTableKey,
  }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: () => h.snapshot,
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  loadSummaryVectorIndexChunksFromManifest_ACU: (...args: any[]) => h.loadChunks(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-chat-service', () => ({
  clearSummaryVectorIndexLayerFromChat_ACU: (...args: any[]) => h.clearLayer(...args),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({ currentChatFileIdentifier_ACU: 'chat-a' }));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  buildSummaryVectorIndexArchiveScopeKey_ACU: (...args: any[]) => h.buildScope(...args),
  runSummaryVectorIndexArchiveScopeMutationExclusive_ACU: (...args: any[]) => h.runExclusive(...args),
}));

import {
  clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU,
  clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU,
  isMissingExternalVectorFileError_ACU,
  preloadSummaryVectorIndexCacheForCurrentChat_ACU,
} from '../../../src/service/vector/summary-vector-index-cache-service';


describe('summary vector missing external file recovery helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.clearLayer.mockResolvedValue(true);
    h.deleteTemp.mockResolvedValue(undefined);
    h.deleteHot.mockResolvedValue(undefined);
    h.clearFlush.mockResolvedValue(2);
    h.loadChunks.mockResolvedValue([]);
    h.snapshot = null;
    h.buildScope.mockImplementation((scope: any) => JSON.stringify(scope));
    h.runExclusive.mockImplementation(async (_scope: string, task: () => Promise<any>) => task());
  });

  it.each([
    '交火向量单文件快照读取失败: file 读取失败 404: Not Found',
    '交火向量索引分片读取失败: file 读取失败 404: Not Found',
    '交火向量索引内容块读取失败: file 读取失败 404: Not Found',
  ])('只识别 reader 明确返回的 404: %s', (message) => {
    expect(isMissingExternalVectorFileError_ACU(message)).toBe(true);
  });

  it.each([
    '交火向量单文件快照读取失败: file404 Failed to fetch',
    '交火向量单文件快照读取失败: file 读取失败 500: Internal Server Error',
    '交火向量单文件快照读取失败: file Not Found',
    '普通业务 not found',
  ])('拒绝非明确 404 的删除判定: %s', (message) => {
    expect(isMissingExternalVectorFileError_ACU(message)).toBe(false);
  });

  it('指针提交成功后缓存清理失败仍返回已安全删除', async () => {
    h.deleteTemp.mockRejectedValue(new Error('temp cache down'));
    h.deleteHot.mockRejectedValue(new Error('hot cache down'));

    await expect(clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU({
      messageIndex: 2,
      isolationKey: 'alpha',
      indexId: 'idx-missing',
      sourceTableKey: 'summary-source',
    })).resolves.toEqual({ chatStateCleared: true, cacheCleared: false, flushTaskCountCleared: 2 });

    expect(h.clearLayer).toHaveBeenCalledWith({ messageIndex: 2, isolationKey: 'alpha', indexId: 'idx-missing' });
    expect(h.clearFlush).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'alpha',
      sourceTableKey: 'summary-source',
    }));
    expect(h.deleteTemp).toHaveBeenCalledWith('idx-missing');
    expect(h.deleteHot).toHaveBeenCalledWith('idx-missing');
    expect(h.runExclusive).toHaveBeenCalledWith(
      JSON.stringify({ chatKey: 'chat-a', isolationKey: 'alpha', sourceTableKey: 'summary-source' }),
      expect.any(Function),
    );
  });

  it('预热时严格删除抛错会返回稳定原因且不入队', async () => {
    const manifest = { status: 'ready', indexId: 'idx', sourceTableKey: 'summary-source' };
    h.snapshot = {
      summaryVectorIndexState: { manifest },
      layers: [{ messageIndex: 1, isolationKey: 'iso-source' }],
    };
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照读取失败: file 读取失败 404: Not Found'));
    h.clearLayer.mockRejectedValue(new Error('save failed'));

    await expect(preloadSummaryVectorIndexCacheForCurrentChat_ACU()).resolves.toMatchObject({
      success: false,
      skipped: true,
      reason: 'external_files_missing_state_clear_save_failed',
      cacheCleared: false,
      chatStateCleared: false,
    });
  });

  it('预热删除失效指针后不走 flush 队列，并准确报告等待普通即时重建', async () => {
    const manifest = { status: 'ready', indexId: 'idx', sourceTableKey: 'summary-source' };
    h.snapshot = {
      summaryVectorIndexState: { manifest },
      layers: [{ messageIndex: 1, isolationKey: 'iso-source' }],
    };
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照读取失败: file 读取失败 404: Not Found'));
    h.deleteTemp.mockRejectedValue(new Error('temp cache down'));

    await expect(preloadSummaryVectorIndexCacheForCurrentChat_ACU()).resolves.toMatchObject({
      reason: 'external_files_missing_state_cleared_rebuild_required',
      cacheCleared: false,
      chatStateCleared: true,
    });
    expect(h.clearFlush).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'iso-source',
      sourceTableKey: 'summary-source',
    }));
  });
});
describe('summary vector invalid external file recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.clearLayer.mockResolvedValue(true);
    h.deleteTemp.mockResolvedValue(undefined);
    h.deleteHot.mockResolvedValue(undefined);
    h.clearFlush.mockResolvedValue(1);
    h.loadChunks.mockResolvedValue([]);
    h.snapshot = null;
  });

  it('身份校验失败也必须先删除 pointer，再清理缓存', async () => {
    await expect(clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU({
      messageIndex: 2,
      isolationKey: 'alpha',
      indexId: 'idx-invalid',
      sourceTableKey: 'summary-source',
    })).resolves.toEqual({ chatStateCleared: true, cacheCleared: true, flushTaskCountCleared: 1 });

    expect(h.clearFlush).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'alpha',
      sourceTableKey: 'summary-source',
    }));
    expect(h.clearLayer).toHaveBeenCalledWith({ messageIndex: 2, isolationKey: 'alpha', indexId: 'idx-invalid' });
    expect(h.deleteTemp).toHaveBeenCalledWith('idx-invalid');
    expect(h.deleteHot).toHaveBeenCalledWith('idx-invalid');
  });

  it('预热发现 identity mismatch 后返回普通重建原因', async () => {
    const manifest = { status: 'ready', indexId: 'idx-invalid', sourceTableKey: 'summary-source' };
    h.snapshot = {
      summaryVectorIndexState: { manifest },
      layers: [{ messageIndex: 1, isolationKey: 'iso-source' }],
    };
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照身份不匹配: snapshot field=isolationKey expected=default actual='));

    await expect(preloadSummaryVectorIndexCacheForCurrentChat_ACU()).resolves.toMatchObject({
      success: true,
      skipped: true,
      reason: 'external_files_identity_invalid_rebuild_required',
      chatStateCleared: true,
    });
  });
});
