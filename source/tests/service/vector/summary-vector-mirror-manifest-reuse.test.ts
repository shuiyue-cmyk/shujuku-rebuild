import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  table: null as any,
  disk: new Map<string, string>(),
  registry: new Map<string, any>(),
  deleted: [] as string[],
  saveStrict: vi.fn(async () => undefined),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'probe-chat',
  getCurrentIsolationKey_ACU: () => 'iso',
  get currentJsonTableData_ACU() { return { sheet_summary: h.table }; },
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHostStrict_ACU: (...args: any[]) => (h.saveStrict as any)(...args),
}));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({
  createEmbeddings_ACU: async () => { throw new Error('should not embed: all rows reusable'); },
  isVectorEmbeddingError_ACU: () => false,
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({
    embeddingEndpoint: 'https://embedding.test', embeddingApiKey: 'key', embeddingModel: 'model', embeddingDimension: 2,
    summaryChunkSentenceCount: 1, summaryIndexChunkChronicleBySentence: false,
    summaryIndexArchiveMaxConcurrency: 10, summaryIndexArchiveMaxInputChars: 24000, summaryIndexArchiveEmbeddingConcurrency: 1,
  }),
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: () => ({ summaryKey: 'sheet_summary', table: h.table }),
  buildPreparedRows_ACU: () => ({
    rows: [{ rowId: 'r1', vectorSourceText: 't1', vectorSourceHash: 'h1' }, { rowId: 'r2', vectorSourceText: 't2', vectorSourceHash: 'h2' }],
    skippedRowCount: 0, error: '',
  }),
  buildRowChunkTexts_ACU: (text: string) => [text],
}));
vi.mock('../../../src/service/vector/summary-vector-index-chat-deletion-gc', () => ({ runScopedRetentionGcAfterFlush_ACU: async () => undefined }));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    uploadVectorIndexJsonFile_ACU: async (params: any) => {
      const json = JSON.stringify(params.data);
      h.disk.set(params.path, json);
      const now = new Date().toISOString();
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: json.length, checksum: await actual.sha256Text_ACU(json), createdAt: now, updatedAt: now, status: 'ready' } };
    },
    readVectorIndexJsonFile_ACU: async (path: string) => (h.disk.has(path)
      ? { ok: true, data: JSON.parse(h.disk.get(path)!) }
      : { ok: false, status: 404, corrupted: false, error: '404' }),
    deleteVectorIndexFile_ACU: async (path: string) => { h.deleted.push(path); h.disk.delete(path); return { ok: true, path }; },
    registerVectorIndexFiles_ACU: async (files: any[]) => { files.forEach((f) => h.registry.set(f.path, { ...f })); },
    unregisterVectorIndexFiles_ACU: async (paths: string[]) => { paths.forEach((p) => h.registry.delete(p)); },
  };
});

import { hashUserInput_ACU } from '../../../src/shared/utils';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import { _resetTableWriteTransactionLocksForTest_ACU } from '../../../src/service/table/table-write-transaction';
import { rebuildSummaryVectorMirror_ACU } from '../../../src/service/vector/summary-vector-mirror-rebuild';
import { resolveSummaryVectorMirrorHead_ACU } from '../../../src/service/vector/summary-vector-mirror-resolver';
import {
  finalizeSummaryVectorMirrorFiles_ACU,
  loadSummaryVectorMirrorManifest_ACU,
  persistSummaryVectorMirrorManifestPrepared_ACU,
} from '../../../src/service/vector/summary-vector-mirror-storage';

const rows = [
  { rowId: 'r1', chunks: [{ packHash: 'P', chunkIndex: 0 }] },
  { rowId: 'r2', chunks: [{ packHash: 'P', chunkIndex: 1 }] },
];

async function setup() {
  _resetTableWriteTransactionLocksForTest_ACU();
  h.disk.clear(); h.registry.clear(); h.deleted = [];
  h.saveStrict.mockReset(); h.saveStrict.mockResolvedValue(undefined);
  h.table = { name: '纪要表', content: [['row_id', '概要', '编码索引'], ['r1', 't1', 'A1'], ['r2', 't2', 'A2']] };
  // existing published pack (path as the real path builder would produce is irrelevant; refs carry path)
  h.disk.set('pack-P', JSON.stringify({ schema: 'content_addressed_vector_pack', version: 1, packKey: 'P', packScope: 'x', embeddingModel: 'model', dimension: 2,
    chunks: [{ textHash: 'h1', text: 't1', vector: 'AACAPwAAAEA=' }, { textHash: 'h2', text: 't2', vector: 'AACAPwAAAEA=' }] }));
  // existing checkpoint manifest, written & published by the earlier (initial) rebuild
  const persisted = await persistSummaryVectorMirrorManifestPrepared_ACU({
    chatKey: 'probe-chat', isolationKey: 'iso', sourceTableKey: 'sheet_summary',
    rows: { schema: 'summary_vector_mirror_manifest', version: 1, sourceTableKey: 'sheet_summary', rows },
  });
  await finalizeSummaryVectorMirrorFiles_ACU([persisted.file]);
  const data = { sheet_summary: JSON.parse(JSON.stringify(h.table)) };
  h.chat.length = 0;
  h.chat.push({ is_user: false, TavernDB_ACU_IsolatedData: { iso: {
    _acu_storage_version: 2,
    storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 't', data }, logEntries: [],
      summaryVectorIndexFrame: { version: 3, sourceTableKey: 'sheet_summary', logEntries: [], checkpoint: {
        kind: 'vector_full', createdAt: 1, reason: 'initial', sourceTableKey: 'sheet_summary',
        tableCheckpointFingerprint: getTableDataFingerprint_ACU(data),
        embedding: { endpointFingerprint: hashUserInput_ACU('https://embedding.test'), model: 'model', dimension: 2, sourceTextVersion: 2 },
        rowCount: 2, vectorRevision: 'rev', manifestRef: persisted.ref,
        packRefs: [{ packHash: 'P', path: 'pack-P', chunkCount: 2, byteLength: 1 }],
      } } },
  } } });
  return persisted;
}

describe('块 5 复审 R5-03：内容相同的 manifest 复用既有对象', () => {
  it('rebuild_repair 行集合不变且落盘失败时，不删除旧 checkpoint 仍在引用的 manifest', async () => {
    const persisted = await setup();
    h.saveStrict.mockRejectedValueOnce(new Error('strict save failed'));
    const result = await rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_repair' });
    expect(result).toMatchObject({ success: false, reason: 'rebuild_commit_failed' });
    expect(h.chat[0].TavernDB_ACU_IsolatedData.iso.storageFrame.summaryVectorIndexFrame.checkpoint.manifestRef.path).toBe(persisted.ref.path);
    expect(h.deleted).not.toContain(persisted.ref.path);
    const after = await resolveSummaryVectorMirrorHead_ACU({ chat: h.chat, isolationKey: 'iso', sourceTableKey: 'sheet_summary', loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref) });
    expect(after.status).toBe('ok');
  });

  it('重复写入同内容 manifest 不把已发布对象降级为 prepared，并标记为非新建', async () => {
    const persisted = await setup();
    const again = await persistSummaryVectorMirrorManifestPrepared_ACU({
      chatKey: 'probe-chat', isolationKey: 'iso', sourceTableKey: 'sheet_summary',
      rows: { schema: 'summary_vector_mirror_manifest', version: 1, sourceTableKey: 'sheet_summary', rows },
    });
    expect(again.createdNew).toBe(false);
    expect(again.ref.path).toBe(persisted.ref.path);
    expect(h.registry.get(persisted.ref.path)?.publicationState).toBe('published');
  });
});

describe('块 5 复审 R5-09：全部复用时维度取自复用的向量', () => {
  it('配置维度与已有向量不一致时，新 checkpoint 记录实际向量维度', async () => {
    await setup();
    const pack = JSON.parse(h.disk.get('pack-P')!);
    pack.dimension = 3;
    h.disk.set('pack-P', JSON.stringify(pack));
    const result = await rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_repair' });
    expect(result.success).toBe(true);
    const checkpoint = h.chat[0].TavernDB_ACU_IsolatedData.iso.storageFrame.summaryVectorIndexFrame.checkpoint;
    expect(checkpoint.embedding.dimension).toBe(3);
  });
});
