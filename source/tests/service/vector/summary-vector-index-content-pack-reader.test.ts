import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  read: vi.fn(),
  blobs: new Map<string, any>(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
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
    sha256Text_ACU: vi.fn(async (value: string) => `sha:${value.length}`),
    buildVectorIndexSingleSnapshotV2ScopeToken_ACU: () => 'scope-a',
    buildVectorIndexSingleSnapshotV2FilePath_ACU: () => SNAPSHOT_PATH,
  };
});
vi.mock('../../../src/data/storage/vector-index-hot-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/vector-index-hot-cache')>();
  return {
    ...actual,
    getSummaryVectorHotCacheChunks_ACU: vi.fn(async () => null),
    putSummaryVectorHotCacheChunks_ACU: vi.fn(async () => undefined),
  };
});
vi.mock('../../../src/data/storage/vector-index-temp-cache', () => ({
  deleteVectorIndexCacheByIndex_ACU: vi.fn(),
  estimateVectorIndexTempCache_ACU: vi.fn(),
  getVectorIndexCachedShard_ACU: vi.fn(),
  putVectorIndexCachedShard_ACU: vi.fn(),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({ summaryIndexV2WriteEnabled: true }),
}));

import { loadSummaryVectorIndexChunksFromManifest_ACU } from '../../../src/service/vector/summary-vector-index-storage-service';

// 与源码 encodeVectorToF32B64_ACU 语义一致：Float32LE -> base64
function encodeF32B64(values: number[]): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const SNAPSHOT_PATH = 'TavernDB_ACU_vector_v2_scope_snap-a_snapshot';

function makeManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, backend: 'st-files', status: 'ready', indexId: 'snap-a',
    chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表',
    snapshotMessageId: 'message-a', indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    rowCount: 2, chunkCount: 2, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
    rowsFile: SNAPSHOT_PATH, tombstoneFile: SNAPSHOT_PATH, manifestFile: SNAPSHOT_PATH, files: [],
    baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
    snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-1', 'row-2'], activeChunkIds: ['c1', 'c2'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
    storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-a', writeGeneration: 'write-a', revision: 1 },
    ...overrides,
  } as any;
}

function makeBlob(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, schema: 'single_file_snapshot', indexId: 'snap-a', chatKey: 'chat-a',
    isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表',
    snapshotMessageId: 'message-a', embeddingModel: 'model-a', dimension: 2,
    indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-a', writeGeneration: 'write-a', revision: 1 },
    manifest: { ...makeManifest() },
    rows: [
      { rowKey: 'row-1', rowId: 'r1', rowOrder: 0, timeSpan: '', location: '', summary: 's1', indexCode: '', vectorSourceText: 'v1', chunkIds: ['c1'] },
      { rowKey: 'row-2', rowId: 'r2', rowOrder: 1, timeSpan: '', location: '', summary: 's2', indexCode: '', vectorSourceText: 'v2', chunkIds: ['c2'] },
    ],
    chunks: [],
    tombstone: { indexId: 'snap-a', removedRows: {} },
    ...overrides,
  } as any;
}

function makePack(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_sha:100', packScope: 'scope-a',
    embeddingModel: 'model-a', dimension: 2,
    chunks: [
      { chunkKey: 'key-c1', chunkId: 'c1', rowKey: 'row-1', text: 'text1', vector: encodeF32B64([0.1, 0.2]), vectorEncoding: 'f32b64' },
      { chunkKey: 'key-c2', chunkId: 'c2', rowKey: 'row-2', text: 'text2', vector: encodeF32B64([0.3, 0.4]), vectorEncoding: 'f32b64' },
    ],
    ...overrides,
  } as any;
}

function packRef(pack: any) {
  return {
    packKey: pack.packKey, packScope: pack.packScope, schemaVersion: 1, path: `pack_${pack.packKey}`, checksum: `sha:${JSON.stringify(pack).length}`,
    byteSize: JSON.stringify(pack).length, chunkKeys: pack.chunks.map((c: any) => c.chunkKey), chunkCount: pack.chunks.length, rowCount: pack.chunks.length,
    embeddingModel: pack.embeddingModel, dimension: pack.dimension, createdAt: '', updatedAt: '', status: 'ready',
  };
}

function makePackManifest(pack: any) {
  return makeManifest({
    contentAddressed: {
      version: 1, mode: 'content_addressed_packs', chunkRefs: [],
      activeChunkKeys: pack.chunks.map((c: any) => c.chunkKey),
      packRefs: [packRef(pack)],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.blobs.clear();
  h.read.mockImplementation(async (path: string) => {
    const data = h.blobs.get(path);
    return data ? { ok: true, data } : { ok: false };
  });
});

describe('T13: content pack reader', () => {
  it('pack 模式正常读取：逐 chunk 等价于内联格式（vector/sequence/rowOrder）', async () => {
    const pack = makePack();
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    const chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(makePackManifest(pack));
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toMatchObject({ chunkId: 'c1', rowKey: 'row-1', rowOrder: 0, sequence: 0, text: 'text1' });
    expect(chunks[0].vector.length).toBe(2);
    expect(chunks[0].vector[0]).toBeCloseTo(0.1, 5);
    expect(chunks[0].vector[1]).toBeCloseTo(0.2, 5);
    expect(chunks[1]).toMatchObject({ chunkId: 'c2', rowKey: 'row-2', rowOrder: 1, sequence: 1, text: 'text2' });
    expect(chunks[1].vector[0]).toBeCloseTo(0.3, 5);
    expect(chunks[1].vector[1]).toBeCloseTo(0.4, 5);
  });

  it('pack 缺失 -> 抛错且不返回部分结果', async () => {
    const pack = makePack();
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(makePackManifest(pack)))
      .rejects.toThrow('pack 读取失败');
  });

  it('packScope 不符 -> 抛错', async () => {
    const pack = makePack({ packScope: 'wrong-scope' });
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(makePackManifest(pack)))
      .rejects.toThrow('scope 不匹配');
  });

  it('packKey 不符 -> 抛错', async () => {
    // pack 内容自报 pack_wrong，但 manifest 的 ref 声明 pack_sha:100 -> 不一致
    const pack = makePack({ packKey: 'pack_wrong' });
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    const manifest = makeManifest({
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: pack.chunks.map((c: any) => c.chunkKey), packRefs: [{ ...packRef(pack), packKey: 'pack_sha:100' }] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('packKey 不匹配');
  });

  it('checksum 不符 -> 抛错', async () => {
    const pack = makePack();
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    const ref = { ...packRef(pack), checksum: 'sha:999' };
    h.blobs.set(ref.path, pack);
    const manifest = makeManifest({
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: pack.chunks.map((c: any) => c.chunkKey), packRefs: [ref] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('checksum 不匹配');
  });

  it('缺少 activeChunkIds 中的 chunk -> 抛错', async () => {
    const pack = makePack();
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    const manifest = makeManifest({
      snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-1', 'row-2'], activeChunkIds: ['c1', 'c2', 'c3'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      chunkCount: 3, rowCount: 2,
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: pack.chunks.map((c: any) => c.chunkKey), packRefs: [packRef(pack)] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('缺少 activeChunkIds');
  });

  it('重复 chunkId -> 抛错', async () => {
    const pack = makePack();
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    const ref1 = packRef(pack);
    const pack2 = makePack({ packKey: 'pack_sha:200', chunks: [pack.chunks[0]] });
    const ref2 = { ...packRef(pack2), checksum: `sha:${JSON.stringify(pack2).length}` };
    h.blobs.set(ref1.path, pack);
    h.blobs.set(ref2.path, pack2);
    const manifest = makeManifest({
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: ['key-c1', 'key-c2'], packRefs: [ref1, ref2] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('chunkId 重复');
  });

  it('多余 chunk（activeChunkIds 之外）-> 抛错', async () => {
    const pack = makePack();
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    const manifest = makeManifest({
      snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-1'], activeChunkIds: ['c1'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      chunkCount: 1, rowCount: 1,
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: ['key-c1'], packRefs: [packRef(pack)] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('activeChunkIds 之外');
  });

  it('维度不符 -> 抛错', async () => {
    // pack 声明 dimension=2，但 chunk vector 是 3 维 -> 触发 chunk 级维度校验
    const pack = makePack({ chunks: [{ chunkKey: 'key-c1', chunkId: 'c1', rowKey: 'row-1', text: 'text1', vector: encodeF32B64([0.1, 0.2, 0.3]), vectorEncoding: 'f32b64' }] });
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    const manifest = makeManifest({
      snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-1'], activeChunkIds: ['c1'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      chunkCount: 1, rowCount: 1,
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: ['key-c1'], packRefs: [packRef(pack)] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('维度不符');
  });

  it('rowKey 悬挂（不在 snapshot rows）-> 抛错', async () => {
    const pack = makePack({ chunks: [{ chunkKey: 'key-c1', chunkId: 'c1', rowKey: 'ghost-row', text: 'text1', vector: encodeF32B64([0.1, 0.2]), vectorEncoding: 'f32b64' }] });
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    const manifest = makeManifest({
      snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-1'], activeChunkIds: ['c1'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      chunkCount: 1, rowCount: 1,
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: ['key-c1'], packRefs: [packRef(pack)] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('rowKey 不存在于快照 rows');
  });

  it('缺少 activeChunkIds -> incompatible', async () => {
    const pack = makePack();
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack).path, pack);
    const manifest = makeManifest({
      snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-1', 'row-2'], activeChunkIds: [], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: [], packRefs: [packRef(pack)] },
    });
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .rejects.toThrow('activeChunkIds');
  });

  it('shardReadConcurrency 生效：并发读取 pack（断言并发峰值）', async () => {
    const pack1 = makePack({ packKey: 'pack_sha:100' });
    const pack2 = makePack({ packKey: 'pack_sha:200', chunks: [{ chunkKey: 'key-c3', chunkId: 'c3', rowKey: 'row-1', text: 'text3', vector: encodeF32B64([0.5, 0.6]), vectorEncoding: 'f32b64' }] });
    h.blobs.set(SNAPSHOT_PATH, makeBlob());
    h.blobs.set(packRef(pack1).path, pack1);
    h.blobs.set(packRef(pack2).path, pack2);
    let inFlight = 0;
    let peak = 0;
    h.read.mockImplementation(async (path: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const data = h.blobs.get(path);
      inFlight -= 1;
      return data ? { ok: true, data } : { ok: false };
    });
    const manifest = makeManifest({
      snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-1', 'row-2'], activeChunkIds: ['c1', 'c2', 'c3'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      chunkCount: 3, rowCount: 2,
      contentAddressed: { version: 1, mode: 'content_addressed_packs', chunkRefs: [], activeChunkKeys: ['key-c1', 'key-c2', 'key-c3'], packRefs: [packRef(pack1), packRef(pack2)] },
    });
    const chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { shardReadConcurrency: 4 });
    expect(chunks.length).toBe(3);
    expect(peak).toBe(2); // 两个 pack 并发读取
  });
});
