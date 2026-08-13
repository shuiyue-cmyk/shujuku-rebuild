import { describe, it, vi } from 'vitest';

// 运行方式：ACU_RUN_PERF=1 npx vitest run tests/service/vector/summary-vector-index-content-pack-perf.test.ts
// 未设置 ACU_RUN_PERF 时整体跳过，不进常规门禁。
// T16 性能基准（手动运行，不进常规门禁）：npx vitest run tests/service/vector/summary-vector-index-content-pack-perf.test.ts
// 对比「开关关闭（V2 内联）」vs「开关开启（V2 pack）」在 1000/2000 chunk 下：
//   首次归档、仅尾加、头部折叠三种场景的主线程耗时、上传字节、对象数；读取冷启动耗时与下载字节。
// 使用真实 sha256Text_ACU（WebCrypto），upload mock 记录真实 JSON 字节数。

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
    // 保留真实 sha256（WebCrypto），保证 packKey/checksum 与字节数真实
    readVectorIndexJsonFile_ACU: (...args: any[]) => h.read(...args),
    uploadVectorIndexJsonFile_ACU: (...args: any[]) => h.upload(...args),
    registerVectorIndexFiles_ACU: (...args: any[]) => h.register(...args),
    deleteVectorIndexFile_ACU: (...args: any[]) => h.remove(...args),
    unregisterVectorIndexFiles_ACU: (...args: any[]) => h.unregister(...args),
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

import {
  loadSummaryVectorIndexChunksFromManifest_ACU,
  persistSummaryVectorIndexSnapshot_ACU,
} from '../../../src/service/vector/summary-vector-index-storage-service';

import { beforeEach } from 'vitest';

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
  h.upload.mockImplementation(async (params: any) => {
    h.blobs.set(params.path, params.data);
    // 写后校验会重新计算真实 sha256 并与 ref.checksum 比对，这里必须返回真实 checksum
    const actual = await import('../../../src/data/storage/vector-index-st-files-storage');
    const checksum = await actual.sha256Text_ACU(JSON.stringify(params.data));
    return { ok: true, ref: {
      role: params.role, path: params.path, byteSize: JSON.stringify(params.data).length, checksum,
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', status: 'ready',
    } };
  });
  h.register.mockResolvedValue(undefined);
  h.remove.mockResolvedValue({ ok: true });
  h.unregister.mockResolvedValue(undefined);
  h.read.mockImplementation(async (path: string) => {
    const data = h.blobs.get(path);
    return data ? { ok: true, data } : { ok: false };
  });
});

// 构造 N 个 chunk 的输入（固定维度 8，避免维度差异干扰）
function buildOptions(chunkCount: number, overrides: Record<string, unknown> = {}) {
  const rows = [];
  const chunks = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const rowKey = `row-${i}`;
    const chunkId = `c-${i}`;
    rows.push({ rowKey, rowId: String(i), rowOrder: i, timeSpan: '', location: '', summary: `summary-${i}`, indexCode: '', vectorSourceText: `text-${i}`, chunkIds: [chunkId] });
    chunks.push({ chunkId, rowKey, text: `text-${i}`, vector: [i % 7, (i + 1) % 7, (i + 2) % 7, (i + 3) % 7, (i + 4) % 7, (i + 5) % 7, (i + 6) % 7, (i + 7) % 7], sequence: i });
  }
  return {
    chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表',
    snapshotMessageId: 'message-perf', indexedAt: '2025-01-01T00:00:00.000Z', skippedRowCount: 0,
    embeddingModel: 'model-a', rows, chunks,
    activeRowKeys: rows.map((r: any) => r.rowKey),
    activeChunkIds: chunks.map((c: any) => c.chunkId),
    ...overrides,
  } as any;
}

function totalUploadBytes() {
  return h.upload.mock.calls.reduce((sum: number, call: any) => sum + (call[0]?.data ? JSON.stringify(call[0].data).length : 0), 0);
}

function countUploadsByRole(role: string) {
  return h.upload.mock.calls.filter((call: any) => call[0]?.role === role).length;
}

async function measurePersist(options: any) {
  const start = performance.now();
  const result = await persistSummaryVectorIndexSnapshot_ACU(options);
  const elapsed = performance.now() - start;
  const bytes = totalUploadBytes();
  const packUploads = countUploadsByRole('vector_pack');
  const manifestUploads = countUploadsByRole('manifest');
  const reusedPacks = result.manifest?.contentAddressed?.packRefs?.length - packUploads;
  return { elapsedMs: elapsed, uploadBytes: bytes, packUploads, manifestUploads, reusedPacks, externalTotalBytes: result.manifest?.externalTotalBytes ?? 0 };
}

const runPerf = process.env.ACU_RUN_PERF === '1';

describe.skipIf(!runPerf)('T16: content pack 性能基准（手动运行）', () => {
  it('1000/2000 chunk 首次归档：开关关闭 vs 开启', async () => {
    h.config.value = { summaryIndexV2WriteEnabled: true, summaryIndexRollingDeltaEnabled: false, summaryIndexContentPackWriteEnabled: false, summaryIndexContentPackWriteScopeAllowlist: [] };
    const results: Record<string, any> = {};
    for (const count of [1000, 2000]) {
      h.blobs.clear();
      h.upload.mockClear();
      results[`inline_${count}`] = await measurePersist(buildOptions(count));
    }
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true };
    for (const count of [1000, 2000]) {
      h.blobs.clear();
      h.upload.mockClear();
      results[`pack_${count}`] = await measurePersist(buildOptions(count));
    }
    // eslint-disable-next-line no-console
    console.table(results);
  });

  it('1000 chunk 仅尾加 10 chunk：开关关闭 vs 开启', async () => {
    h.config.value = { summaryIndexV2WriteEnabled: true, summaryIndexRollingDeltaEnabled: false, summaryIndexContentPackWriteEnabled: false, summaryIndexContentPackWriteScopeAllowlist: [] };
    const base = buildOptions(1000);
    const firstInline = await persistSummaryVectorIndexSnapshot_ACU(base);
    h.upload.mockClear();
    const tailInline = buildOptions(1010, { previousManifest: firstInline.manifest });
    const inlineTail = await measurePersist(tailInline);

    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true };
    h.blobs.clear();
    h.upload.mockClear();
    const firstPack = await persistSummaryVectorIndexSnapshot_ACU(buildOptions(1000));
    h.upload.mockClear();
    const tailPack = buildOptions(1010, { previousManifest: firstPack.manifest });
    const packTail = await measurePersist(tailPack);
    // eslint-disable-next-line no-console
    console.table({ inlineTail, packTail });
  });

  it('1000 chunk 头部折叠 20 chunk：开关关闭 vs 开启', async () => {
    h.config.value = { summaryIndexV2WriteEnabled: true, summaryIndexRollingDeltaEnabled: false, summaryIndexContentPackWriteEnabled: false, summaryIndexContentPackWriteScopeAllowlist: [] };
    const base = buildOptions(1000);
    const firstInline = await persistSummaryVectorIndexSnapshot_ACU(base);
    h.upload.mockClear();
    const foldedInline = buildOptions(980, { previousManifest: firstInline.manifest, activeRowKeys: Array.from({ length: 980 }, (_, i) => `row-${i + 20}`), activeChunkIds: Array.from({ length: 980 }, (_, i) => `c-${i + 20}`) });
    const inlineFold = await measurePersist(foldedInline);

    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true };
    h.blobs.clear();
    h.upload.mockClear();
    const firstPack = await persistSummaryVectorIndexSnapshot_ACU(buildOptions(1000));
    h.upload.mockClear();
    const foldedPack = buildOptions(980, { previousManifest: firstPack.manifest, activeRowKeys: Array.from({ length: 980 }, (_, i) => `row-${i + 20}`), activeChunkIds: Array.from({ length: 980 }, (_, i) => `c-${i + 20}`) });
    const packFold = await measurePersist(foldedPack);
    // eslint-disable-next-line no-console
    console.table({ inlineFold, packFold });
  });

  it('1000/2000 chunk 读取冷启动：开关关闭 vs 开启（下载字节与耗时）', async () => {
    h.config.value = { summaryIndexV2WriteEnabled: true, summaryIndexRollingDeltaEnabled: false, summaryIndexContentPackWriteEnabled: false, summaryIndexContentPackWriteScopeAllowlist: [] };
    const results: Record<string, any> = {};
    for (const count of [1000, 2000]) {
      h.blobs.clear();
      h.upload.mockClear();
      const written = await persistSummaryVectorIndexSnapshot_ACU(buildOptions(count));
      h.read.mockClear();
      const start = performance.now();
      const chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(written.manifest, { preferExternalFiles: true });
      const elapsed = performance.now() - start;
      results[`read_inline_${count}`] = { elapsedMs: elapsed, chunkCount: chunks.length, readCalls: h.read.mock.calls.length };
    }
    h.config.value = { ...h.config.value, summaryIndexContentPackWriteEnabled: true };
    for (const count of [1000, 2000]) {
      h.blobs.clear();
      h.upload.mockClear();
      const written = await persistSummaryVectorIndexSnapshot_ACU(buildOptions(count));
      h.read.mockClear();
      const start = performance.now();
      const chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(written.manifest, { preferExternalFiles: true });
      const elapsed = performance.now() - start;
      const packReads = h.read.mock.calls.filter((call: any) => String(call[0] || '').includes('v2pack_')).length;
      results[`read_pack_${count}`] = { elapsedMs: elapsed, chunkCount: chunks.length, readCalls: h.read.mock.calls.length, packReads };
    }
    // eslint-disable-next-line no-console
    console.table(results);
  });
});
