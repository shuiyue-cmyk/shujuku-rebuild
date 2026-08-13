import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  blobs: new Map<string, any>(),
  read: vi.fn(),
  upload: vi.fn(),
  register: vi.fn(),
  remove: vi.fn(),
  unregister: vi.fn(),
  getHot: vi.fn(),
  putHot: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  config: { value: {} as any },
  isolationKey: 'iso-a',
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getAllSummaryVectorIndexSnapshotLayers_ACU: () => [],
}));
vi.mock('../../../src/shared/utils', () => ({
  hashUserInput_ACU: (value: string) => `hash-${value}`,
  logDebug_ACU: (...args: any[]) => h.logDebug(...args),
  logWarn_ACU: (...args: any[]) => h.logWarn(...args),
}));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/vector-index-st-files-storage')>();
  return {
    ...actual,
    readVectorIndexJsonFile_ACU: (...args: any[]) => h.read(...args),
    uploadVectorIndexJsonFile_ACU: (...args: any[]) => h.upload(...args),
    registerVectorIndexFiles_ACU: (...args: any[]) => h.register(...args),
    deleteVectorIndexFile_ACU: (...args: any[]) => h.remove(...args),
    unregisterVectorIndexFiles_ACU: (...args: any[]) => h.unregister(...args),
    sha256Text_ACU: vi.fn(async (value: string) => `sha:${value.length}`),
  };
});
vi.mock('../../../src/data/storage/vector-index-hot-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/vector-index-hot-cache')>();
  return {
    ...actual,
    getSummaryVectorHotCacheChunks_ACU: (...args: any[]) => h.getHot(...args),
    putSummaryVectorHotCacheChunks_ACU: (...args: any[]) => h.putHot(...args),
  };
});
vi.mock('../../../src/data/storage/vector-index-temp-cache', () => ({
  deleteVectorIndexCacheByIndex_ACU: vi.fn(),
  estimateVectorIndexTempCache_ACU: vi.fn(),
  getVectorIndexCachedShard_ACU: vi.fn(),
  putVectorIndexCachedShard_ACU: vi.fn(),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => h.config.value,
}));

import { persistSummaryVectorIndexSnapshot_ACU } from '../../../src/service/vector/summary-vector-index-storage-service';

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    chatKey: 'chat-a',
    isolationKey: 'iso-a',
    sourceTableKey: 'summary',
    sourceTableName: '纪要表',
    snapshotMessageId: 'message-1',
    indexedAt: '2025-01-01T00:00:00.000Z',
    skippedRowCount: 0,
    embeddingModel: 'model-a',
    rows: [
      { rowKey: 'row-1', rowId: 'r1', rowOrder: 0, timeSpan: '', location: '', summary: 's1', indexCode: '', vectorSourceText: 'v1', chunkIds: ['c1'] },
      { rowKey: 'row-2', rowId: 'r2', rowOrder: 1, timeSpan: '', location: '', summary: 's2', indexCode: '', vectorSourceText: 'v2', chunkIds: ['c2'] },
    ],
    chunks: [
      { chunkId: 'c1', rowKey: 'row-1', text: 'text1', vector: [0.1, 0.2], sequence: 0 },
      { chunkId: 'c2', rowKey: 'row-2', text: 'text2', vector: [0.3, 0.4], sequence: 1 },
    ],
    activeRowKeys: ['row-1', 'row-2'],
    activeChunkIds: ['c1', 'c2'],
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.blobs.clear();
  h.config.value = {
    summaryIndexV2WriteEnabled: true,
    summaryIndexRollingDeltaEnabled: false,
    summaryIndexContentPackWriteEnabled: false,
    summaryIndexContentPackWriteScopeAllowlist: [],
  };
  h.getHot.mockResolvedValue(null);
  h.upload.mockImplementation(async (params: any) => { h.blobs.set(params.path, params.data); return { ok: true, ref: {
    role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', status: 'ready',
  } }; });
  h.register.mockResolvedValue(undefined);
  h.remove.mockResolvedValue({ ok: true });
  h.unregister.mockResolvedValue(undefined);
  h.read.mockImplementation(async (path: string) => {
    const data = h.blobs.get(path);
    return data ? { ok: true, data } : { ok: false };
  });
});

describe('T12: content pack writer', () => {
  it('开关关闭时上传对象数 = 1（snapshot），snapshot 内联 chunks 非空', async () => {
    const result = await persistSummaryVectorIndexSnapshot_ACU(makeOptions());
    expect(result.uploadedFiles.length).toBe(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
    const snapshotData = h.upload.mock.calls[0][0].data;
    expect(snapshotData.chunks.length).toBe(2);
    expect(result.manifest.contentAddressed).toBeUndefined();
  });
});

  function packOptions(overrides: Record<string, unknown> = {}) {
    return makeOptions({
      summaryIndexContentPackWriteEnabled: true,
      ...overrides,
    });
  }

  it('开关开启首次：上传 = N pack + 1 snapshot，snapshot chunks 为空，packRefs 与 activeChunkKeys 对应', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    const result = await persistSummaryVectorIndexSnapshot_ACU(packOptions());
    // 2 chunks < MIN_CHUNKS(16) -> 1 个 pack + 1 snapshot
    expect(h.upload).toHaveBeenCalledTimes(2);
    expect(result.uploadedFiles.length).toBe(2);
    const packUploads = h.upload.mock.calls.filter((call) => call[0].role === 'vector_pack');
    const snapshotUploads = h.upload.mock.calls.filter((call) => call[0].role === 'manifest');
    expect(packUploads.length).toBe(1);
    expect(snapshotUploads.length).toBe(1);
    const snapshotData = snapshotUploads[0][0].data;
    expect(snapshotData.chunks).toEqual([]);
    const ca = result.manifest.contentAddressed;
    expect(ca.mode).toBe('content_addressed_packs');
    expect(ca.packRefs.length).toBe(1);
    expect(ca.chunkRefs).toEqual([]);
    expect(ca.activeChunkKeys.length).toBe(2);
    expect(ca.activeChunkKeys).toEqual(snapshotUploads[0][0].data.manifest.snapshot.activeChunkIds.map((id: string) => packUploads[0][0].data.chunks.find((c: any) => c.chunkId === id)?.chunkKey));
  });

  it('开关开启：previousManifest 完全一致时全部 pack 复用，仅上传 snapshot', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    const first = await persistSummaryVectorIndexSnapshot_ACU(packOptions());
    const beforeUploads = h.upload.mock.calls.length;
    h.blobs.clear();
    const second = await persistSummaryVectorIndexSnapshot_ACU(packOptions({ previousManifest: first.manifest }));
    const newCalls = h.upload.mock.calls.slice(beforeUploads);
    expect(newCalls.filter((call) => call[0].role === 'vector_pack').length).toBe(0); // 复用命中，不重复上传 pack
    expect(newCalls.length).toBe(1); // 仅 snapshot
    expect(second.manifest.contentAddressed.packRefs.length).toBe(1);
  });

  it('尾部追加 1 chunk：pack 内容变化时重传 1 个 pack，snapshot 仍为单对象', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    const first = await persistSummaryVectorIndexSnapshot_ACU(packOptions());
    const beforeUploads = h.upload.mock.calls.length;
    const third = {
      chunkId: 'c3', rowKey: 'row-3', text: 'text3', vector: [0.5, 0.6], sequence: 2,
    };
    const appended = packOptions({
      rows: [
        { rowKey: 'row-1', rowId: 'r1', rowOrder: 0, timeSpan: '', location: '', summary: 's1', indexCode: '', vectorSourceText: 'v1', chunkIds: ['c1'] },
        { rowKey: 'row-2', rowId: 'r2', rowOrder: 1, timeSpan: '', location: '', summary: 's2', indexCode: '', vectorSourceText: 'v2', chunkIds: ['c2'] },
        { rowKey: 'row-3', rowId: 'r3', rowOrder: 2, timeSpan: '', location: '', summary: 's3', indexCode: '', vectorSourceText: 'v3', chunkIds: ['c3'] },
      ],
      chunks: [
        { chunkId: 'c1', rowKey: 'row-1', text: 'text1', vector: [0.1, 0.2], sequence: 0 },
        { chunkId: 'c2', rowKey: 'row-2', text: 'text2', vector: [0.3, 0.4], sequence: 1 },
        third,
      ],
      activeRowKeys: ['row-1', 'row-2', 'row-3'],
      activeChunkIds: ['c1', 'c2', 'c3'],
      previousManifest: first.manifest,
    });
    const second = await persistSummaryVectorIndexSnapshot_ACU(appended);
    // 尾部追加改变了 pack 内容 -> packKey 变化 -> 重传 1 个 pack + snapshot
    const packUploads = h.upload.mock.calls.slice(beforeUploads).filter((call) => call[0].role === 'vector_pack');
    expect(packUploads.length).toBe(1);
    expect(h.upload.mock.calls.slice(beforeUploads).filter((call) => call[0].role === 'manifest').length).toBe(1);
    expect(second.manifest.contentAddressed.packRefs.length).toBe(1);
    expect(second.manifest.externalTotalBytes).toBeGreaterThan(0);
  });

  it('previous packRef 的 packScope 被改坏 -> 不复用，重新上传', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    const first = await persistSummaryVectorIndexSnapshot_ACU(packOptions());
    const beforeUploads = h.upload.mock.calls.length;
    const broken = {
      ...first.manifest,
      contentAddressed: {
        ...first.manifest.contentAddressed,
        packRefs: first.manifest.contentAddressed.packRefs.map((ref: any) => ({ ...ref, packScope: 'tampered-scope' })),
      },
    };
    h.blobs.clear();
    await persistSummaryVectorIndexSnapshot_ACU(packOptions({ previousManifest: broken }));
    const newPackUploads = h.upload.mock.calls.slice(beforeUploads).filter((call) => call[0].role === 'vector_pack');
    expect(newPackUploads.length).toBe(1); // 不复用，重新上传
  });

  it('pack 上传返回 checksum 不一致 -> 抛错且回滚只覆盖本次新建对象', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    h.upload.mockImplementation(async (params: any) => {
      h.blobs.set(params.path, params.data);
      const checksum = params.role === 'vector_pack' ? 'wrong-pack-checksum' : `sha:${JSON.stringify(params.data).length}`;
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    await expect(persistSummaryVectorIndexSnapshot_ACU(packOptions()))
      .rejects.toThrow('内容寻址 pack 上传后 checksum 不一致');
    // 回滚只删除本次新建的 pack（snapshot 还没上传，pack 先失败）
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.remove.mock.calls[0][0]).toMatch(/v2pack_/);
    expect(h.register).not.toHaveBeenCalled();
  });

  it('目标 path 已存在且内容一致 -> 不重复上传，不进回滚集合', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    const first = await persistSummaryVectorIndexSnapshot_ACU(packOptions());
    const beforeUploads = h.upload.mock.calls.length;
    // 把第一次的 pack 直接预置到存储：第二次写入相同内容时，目标 path 已存在且一致
    h.blobs.clear();
    const packPath = first.manifest.contentAddressed.packRefs[0].path;
    const packBlob = first.manifest.contentAddressed.packRefs[0];
    h.blobs.set(packPath, packBlob);
    await persistSummaryVectorIndexSnapshot_ACU(packOptions({ previousManifest: first.manifest }));
    const newPackUploads = h.upload.mock.calls.slice(beforeUploads).filter((call) => call[0].role === 'vector_pack');
    expect(newPackUploads.length).toBe(0); // 复用命中，不重复上传
  });

  it('目标 path 已存在但内容不一致 -> 抛 collision，未写 snapshot', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    h.upload.mockImplementation(async (params: any) => {
      h.blobs.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    // 先算一次拿到真实 packPath，然后清空存储，预置一个内容不同但路径相同的 pack
    const first = await persistSummaryVectorIndexSnapshot_ACU(packOptions());
    h.blobs.clear();
    const collidingPath = first.manifest.contentAddressed.packRefs[0].path;
    h.blobs.set(collidingPath, { schema: 'content_addressed_vector_pack', packKey: 'pack_tampered', version: 1, packScope: 'x', embeddingModel: 'm', dimension: 2, chunks: [] });
    // 不传 previousManifest：首次写入路径，幂等检查必须读到 tampered blob 并抛 collision
    await expect(persistSummaryVectorIndexSnapshot_ACU(packOptions()))
      .rejects.toThrow('pack 路径冲突');
    // snapshot 未上传（pack 冲突在 snapshot 之前抛出；只有第一次 persist 的 snapshot）
    expect(h.upload.mock.calls.filter((call) => call[0].role === 'manifest').length).toBe(1);
  });

  it('重复 chunkId / 同 chunkKey 不同 chunkId -> 写入前拒绝', async () => {
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true, summaryIndexContentPackWriteScopeAllowlist: [] };
    await expect(persistSummaryVectorIndexSnapshot_ACU(packOptions({
      chunks: [
        { chunkId: 'c1', rowKey: 'row-1', text: 'text1', vector: [0.1, 0.2], sequence: 0 },
        { chunkId: 'c1', rowKey: 'row-2', text: 'text2', vector: [0.3, 0.4], sequence: 1 },
      ],
    }))).rejects.toThrow('chunkId 重复');
    expect(h.upload).not.toHaveBeenCalled();
  });

