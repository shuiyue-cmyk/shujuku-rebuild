import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  table: null as any,
  isolationKey: 'iso',
  entries: [] as any[],
  embeddedInputs: [] as number[],
  files: new Map<string, any>(),
  saveStrict: vi.fn(async () => undefined),
  embeddingGate: null as null | { started: () => void; wait: Promise<void> },
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'probe-chat',
  getCurrentIsolationKey_ACU: () => h.isolationKey,
  get currentJsonTableData_ACU() { return { sheet_summary: h.table }; },
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHostStrict_ACU: (...args: any[]) => (h.saveStrict as any)(...args),
}));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({
  createEmbeddings_ACU: async (request: any) => {
    h.embeddedInputs.push(request.input.length);
    if (h.embeddingGate) { h.embeddingGate.started(); await h.embeddingGate.wait; }
    return request.input.map((_: string, index: number) => ({ index, embedding: [index + 1, 2] }));
  },
  isVectorEmbeddingError_ACU: () => false,
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({
    embeddingEndpoint: 'https://embedding.test', embeddingApiKey: 'key', embeddingModel: 'model', embeddingDimension: 2,
    summaryChunkSentenceCount: 1, summaryIndexChunkChronicleBySentence: false,
    summaryIndexArchiveMaxConcurrency: 1000, summaryIndexArchiveMaxInputChars: 240000, summaryIndexArchiveEmbeddingConcurrency: 1,
  }),
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: () => ({ summaryKey: 'sheet_summary', table: h.table }),
  buildPreparedRows_ACU: () => ({
    rows: h.table.content.slice(1).map((row: any[]) => ({ rowId: row[0], rowKey: row[0], vectorSourceText: row[1], vectorSourceHash: `hash-${row[1]}` })),
    skippedRowCount: 0, error: '',
  }),
  buildRowChunkTexts_ACU: (text: string) => [text],
}));
vi.mock('../../../src/service/table/summary-sheet-rowid-timeline', () => ({
  collectSummarySheetRowIdTimelineV2_ACU: async () => ({
    status: 'ok', rowIdsAtCheckpoint: ['r1', 'r2', 'r3'], entries: h.entries.map((e) => ({ ...e })), duplicates: [], emptyRowIdCount: 0,
  }),
  tableEntryTouchesSheetV2_ACU: () => true,
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-storage', () => ({
  encodeSummaryVectorMirrorVector_ACU: (v: number[]) => JSON.stringify(v),
  discardSummaryVectorMirrorPreparedFiles_ACU: async () => undefined,
  finalizeSummaryVectorMirrorFiles_ACU: async () => undefined,
  loadSummaryVectorMirrorManifest_ACU: async (ref: any) => h.files.get(ref.path) || null,
  loadSummaryVectorMirrorPack_ACU: async (ref: any) => h.files.get(ref.path) || null,
  persistSummaryVectorMirrorManifestPrepared_ACU: async (params: any) => {
    const path = `manifest${h.files.size}`;
    h.files.set(path, { ...params.rows });
    return { ref: { manifestHash: path, path, byteLength: 1 }, file: { path, byteSize: 1 } };
  },
  persistSummaryVectorMirrorPackPrepared_ACU: async (params: any) => {
    const packHash = `pack${h.files.size}`;
    h.files.set(packHash, { schema: 'content_addressed_vector_pack', packKey: packHash, chunks: params.chunks });
    return { ref: { packHash, path: packHash, chunkCount: params.chunks.length, byteLength: JSON.stringify(params.chunks).length }, file: { path: packHash, byteSize: 1 }, createdNew: true };
  },
}));

import { hashUserInput_ACU } from '../../../src/shared/utils';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import { _resetTableWriteTransactionLocksForTest_ACU, runTableWriteTransaction_ACU } from '../../../src/service/table/table-write-transaction';
import { flushSummaryVectorMirrorNow_ACU, planUnmirroredEntryDeltasV2_ACU } from '../../../src/service/vector/summary-vector-mirror-writer';
import { resolveSummaryVectorMirrorHead_ACU } from '../../../src/service/vector/summary-vector-mirror-resolver';
import { rebuildSummaryVectorMirror_ACU } from '../../../src/service/vector/summary-vector-mirror-rebuild';
vi.mock('../../../src/service/vector/summary-vector-index-chat-deletion-gc', () => ({ runScopedRetentionGcAfterFlush_ACU: async () => undefined }));

function setup() {
  _resetTableWriteTransactionLocksForTest_ACU();
  h.files.clear();
  h.entries = [];
  h.embeddedInputs = [];
  h.embeddingGate = null;
  h.saveStrict.mockReset(); h.saveStrict.mockResolvedValue(undefined);
  h.table = { name: '纪要表', content: [['row_id', '概要'], ['r1', 't1'], ['r2', 't2'], ['r3', 't3']] };
  const data = { sheet_summary: JSON.parse(JSON.stringify(h.table)) };
  h.files.set('pack-initial', { schema: 'content_addressed_vector_pack', packKey: 'pack-initial', chunks: [
    { textHash: 'hash-t1', text: 't1', vector: '[1,2]' }, { textHash: 'hash-t2', text: 't2', vector: '[1,2]' }, { textHash: 'hash-t3', text: 't3', vector: '[1,2]' },
  ] });
  h.files.set('manifest-initial', { schema: 'summary_vector_mirror_manifest', version: 1, sourceTableKey: 'sheet_summary', rows: [
    { rowId: 'r1', chunks: [{ packHash: 'pack-initial', chunkIndex: 0 }] },
    { rowId: 'r2', chunks: [{ packHash: 'pack-initial', chunkIndex: 1 }] },
    { rowId: 'r3', chunks: [{ packHash: 'pack-initial', chunkIndex: 2 }] },
  ] });
  h.chat.length = 0;
  h.chat.push({ is_user: false, TavernDB_ACU_IsolatedData: { iso: {
    _acu_storage_version: 2,
    storageFrame: {
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'test', data },
      logEntries: [],
      summaryVectorIndexFrame: { version: 3, sourceTableKey: 'sheet_summary', logEntries: [], checkpoint: {
        kind: 'vector_full', createdAt: 1, reason: 'initial', sourceTableKey: 'sheet_summary',
        tableCheckpointFingerprint: getTableDataFingerprint_ACU(data),
        embedding: { endpointFingerprint: hashUserInput_ACU('https://embedding.test'), model: 'model', dimension: 2, sourceTextVersion: 2 },
        rowCount: 3, vectorRevision: 'rev0',
        manifestRef: { manifestHash: 'mh', path: 'manifest-initial', byteLength: 1 },
        packRefs: [{ packHash: 'pack-initial', path: 'pack-initial', chunkCount: 3, byteLength: 1 }],
      } },
    },
  } } });
}

function addSummaryRowRound(k: number) {
  const rowId = `r${3 + k}`;
  h.table.content.push([rowId, `t${3 + k}`]);
  h.chat.push({ is_user: true, mes: 'u' });
  h.chat.push({ is_user: false, TavernDB_ACU_IsolatedData: { iso: { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [{ entryId: `e${k}` }] } } } });
  h.entries.push({ messageIndex: h.chat.length - 1, entryId: `e${k}`, commitRevision: null, seq: 1, rowIdsAfter: h.table.content.slice(1).map((r: any[]) => r[0]) });
}

const resolve = () => resolveSummaryVectorMirrorHead_ACU({
  chat: h.chat, isolationKey: 'iso', sourceTableKey: 'sheet_summary',
  loadManifest: async (ref: any) => h.files.get(ref.path) || null,
});

describe('块 5 复审 R5-01：镜像写入失败的回滚不吞并发提交', () => {
  beforeEach(setup);

  async function raceAgainstConcurrentWriter(start: () => Promise<any>) {
    let started!: () => void; const startedP = new Promise<void>((r) => { started = r; });
    let release!: () => void; const wait = new Promise<void>((r) => { release = r; });
    h.embeddingGate = { started, wait };
    const runP = start();
    await startedP;
    h.embeddingGate = null;
    let releaseOther!: () => void; const otherGate = new Promise<void>((r) => { releaseOther = r; });
    const target = h.chat[h.chat.length - 1];
    const otherP = runTableWriteTransaction_ACU({
      source: 'manual_crud' as any, reason: 'concurrent fill', isolationKey: 'iso',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_summary' }], workingDataMode: 'none',
    }, async (ctx) => {
      await otherGate;
      await ctx.runCommit(async () => {
        target.TavernDB_ACU_IsolatedData.iso.storageFrame.logEntries.push({ entryId: 'concurrent-fill-entry' });
      });
    });
    release();
    await new Promise((r) => setTimeout(r, 30));
    releaseOther();
    await otherP;
    const result = await runP;
    return { result, target };
  }

  it('flush 等锁期间别人提交了 entry：flush 失败后对方的 entry 仍在内存里', async () => {
    addSummaryRowRound(1);
    const { result, target } = await raceAgainstConcurrentWriter(() => flushSummaryVectorMirrorNow_ACU({ isolationKey: 'iso', sourceTableKey: 'sheet_summary' }));
    expect(result.reason).toBe('vector_mirror_commit_failed');
    const after = target.TavernDB_ACU_IsolatedData.iso.storageFrame.logEntries.map((e: any) => e.entryId);
    expect(after).toContain('concurrent-fill-entry');
  });

  it('重建等锁期间别人提交了 entry：重建失败后对方的 entry 仍在内存里', async () => {
    addSummaryRowRound(1);
    const { result, target } = await raceAgainstConcurrentWriter(() => rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_user' }));
    expect(result.success).toBe(false);
    const after = target.TavernDB_ACU_IsolatedData.iso.storageFrame.logEntries.map((e: any) => e.entryId);
    expect(after).toContain('concurrent-fill-entry');
  });

  it('strict save 失败时只撤销镜像字段：旧 checkpoint 原样恢复，且旧对象未被原地改动', async () => {
    addSummaryRowRound(1);
    const frame = h.chat[0].TavernDB_ACU_IsolatedData.iso.storageFrame;
    const oldMirror = frame.summaryVectorIndexFrame;
    const oldCheckpoint = oldMirror.checkpoint;
    h.saveStrict.mockRejectedValueOnce(new Error('disk full'));
    const result = await rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_user' });
    expect(result.success).toBe(false);
    expect(frame.summaryVectorIndexFrame).toBe(oldMirror);
    expect(oldMirror.checkpoint).toBe(oldCheckpoint);
  });
});

describe('块 5 复审 R5-02：flush 只嵌真正变化的行', () => {
  beforeEach(setup);

  it('每轮只新增 1 行时只嵌 1 行，召回要加载的 chunk 数等于当前行数', async () => {
    const perFlush: Array<{ embedded: number; chunks: number }> = [];
    for (let k = 1; k <= 4; k += 1) {
      addSummaryRowRound(k);
      h.embeddedInputs = [];
      const result = await flushSummaryVectorMirrorNow_ACU({ isolationKey: 'iso', sourceTableKey: 'sheet_summary' });
      expect(result.success).toBe(true);
      const head = await resolve();
      expect(head.status).toBe('ok');
      expect(head.chainConflict).toBe(false);
      expect(head.head.size).toBe(3 + k);
      perFlush.push({
        embedded: h.embeddedInputs.reduce((a, b) => a + b, 0),
        chunks: head.packRefs.reduce((sum, ref) => sum + ref.chunkCount, 0),
      });
    }
    expect(perFlush.map((p) => p.embedded)).toEqual([1, 1, 1, 1]);
    expect(perFlush.map((p) => p.chunks)).toEqual([4, 5, 6, 7]);
  });

  it('既有行正文改了才重嵌该行', async () => {
    addSummaryRowRound(1);
    h.table.content[2][1] = 't2-edited';
    h.embeddedInputs = [];
    const result = await flushSummaryVectorMirrorNow_ACU({ isolationKey: 'iso', sourceTableKey: 'sheet_summary' });
    expect(result.success).toBe(true);
    expect(h.embeddedInputs.reduce((a, b) => a + b, 0)).toBe(2);
    const head = await resolve();
    expect(head.status).toBe('ok');
    expect(head.head.size).toBe(4);
  });

  it('重建后紧跟的 flush 不再把刚嵌过的行再嵌一遍', async () => {
    addSummaryRowRound(1);
    h.embeddedInputs = [];
    const result = await rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_user' });
    expect(result.success).toBe(true);
    expect(h.embeddedInputs.reduce((a, b) => a + b, 0)).toBe(4);
  });
});

const gen = vi.hoisted(() => ({ invalid: false, calls: [] as Array<[string, number]> }));
vi.mock('../../../src/data/storage/vector-index-hot-cache', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    assertSummaryVectorFlushGenerationCurrent_ACU: async (scopeKey: string, generation: number) => {
      gen.calls.push([scopeKey, generation]);
      if (gen.invalid) throw new actual.SummaryVectorFlushGenerationInvalidatedError_ACU(scopeKey, generation, generation + 1);
    },
  };
});

describe('块 5 复审 R5-07 / R5-10：flush 提交前复核镜像与代次', () => {
  beforeEach(() => { setup(); gen.invalid = false; gen.calls = []; });

  it('embedding 期间镜像被重建/改写过：放弃提交，不在新镜像上追加旧计划的 delta', async () => {
    addSummaryRowRound(1);
    let started!: () => void; const startedP = new Promise<void>((r) => { started = r; });
    let release!: () => void; const wait = new Promise<void>((r) => { release = r; });
    h.embeddingGate = { started, wait };
    const flushP = flushSummaryVectorMirrorNow_ACU({ isolationKey: 'iso', sourceTableKey: 'sheet_summary' });
    await startedP;
    // 模拟并发 rebuild：checkpoint 被替换（新 vectorRevision），旧计划已基于过期 head。
    const frame = h.chat[0].TavernDB_ACU_IsolatedData.iso.storageFrame;
    frame.summaryVectorIndexFrame = { ...frame.summaryVectorIndexFrame, checkpoint: { ...frame.summaryVectorIndexFrame.checkpoint, vectorRevision: 'rev-rebuilt' } };
    release();
    const result = await flushP;
    expect(result.success).toBe(false);
    const last = h.chat[h.chat.length - 1].TavernDB_ACU_IsolatedData.iso.storageFrame;
    expect(last.summaryVectorIndexFrame).toBeUndefined();
  });

  it('flush 代次在提交前已失效（索引被删除/队列清空）：不提交', async () => {
    addSummaryRowRound(1);
    gen.invalid = true;
    const result = await flushSummaryVectorMirrorNow_ACU({
      isolationKey: 'iso', sourceTableKey: 'sheet_summary', expectedFlushScopeKey: 'scope-x', expectedFlushGeneration: 3,
    });
    expect(result).toMatchObject({ success: true, skipped: true, reason: 'flush_scope_invalidated' });
    expect(gen.calls).toEqual([['scope-x', 3]]);
    const last = h.chat[h.chat.length - 1].TavernDB_ACU_IsolatedData.iso.storageFrame;
    expect(last.summaryVectorIndexFrame).toBeUndefined();
  });
});
