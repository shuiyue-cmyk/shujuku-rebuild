/**
 * 块 5 复审 R5-05：向量镜像不可用时折叠降级，不阻塞表格 compaction。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  manifest: null as any,
  pack: null as any,
}));

vi.mock('../../../src/service/table/compat-transition-checkpoint', () => ({
  findLatestTransitionCheckpoint_ACU: () => null,
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-storage', () => ({
  loadSummaryVectorMirrorManifest_ACU: async () => h.manifest,
  loadSummaryVectorMirrorPack_ACU: async () => h.pack,
  discardSummaryVectorMirrorPreparedFiles_ACU: vi.fn(async () => undefined),
  finalizeSummaryVectorMirrorFiles_ACU: vi.fn(async () => undefined),
  persistSummaryVectorMirrorManifestPrepared_ACU: vi.fn(async () => { throw new Error('should not persist'); }),
  persistSummaryVectorMirrorPackPrepared_ACU: vi.fn(async () => { throw new Error('should not persist'); }),
}));

import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import { foldSummaryVectorMirrorAtBoundary_ACU } from '../../../src/service/vector/summary-vector-mirror-fold';

const SOURCE = 'sheet_summary';
const TABLE_DATA = { sheet_summary: { uid: 'sheet_summary', name: '纪要表', content: [['row_id', '摘要'], ['1', 'a']] } };
const EMB = { endpointFingerprint: 'ep', model: 'model-a', dimension: 4, sourceTextVersion: 2 };

function frame(withMirror: boolean) {
  return {
    version: 2,
    checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: JSON.parse(JSON.stringify(TABLE_DATA)) },
    logEntries: [],
    ...(withMirror ? {
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SOURCE,
        logEntries: [],
        checkpoint: {
          kind: 'vector_full', createdAt: 1, reason: 'initial', sourceTableKey: SOURCE,
          tableCheckpointFingerprint: getTableDataFingerprint_ACU(TABLE_DATA),
          embedding: EMB, rowCount: 1, vectorRevision: 'rev',
          manifestRef: { manifestHash: 'mf', path: 'mf', byteLength: 1 },
          packRefs: [{ packHash: 'p0', path: 'p0', chunkCount: 1, byteLength: 1 }],
        },
      },
    } : {}),
  };
}

function makeChat() {
  return [
    { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(true) } } },
    { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(false) } } },
  ];
}

const hasMirror = (chat: any[]) => chat.some((m) => !!m.TavernDB_ACU_IsolatedData[''].storageFrame.summaryVectorIndexFrame);

describe('块 5 复审 R5-05：镜像不可用时折叠降级', () => {
  beforeEach(() => {
    h.manifest = null;
    h.pack = null;
  });

  it('manifest 读不到时不抛错，剥掉镜像让后续重建，不阻塞 compaction', async () => {
    const chat = makeChat();
    const result = await foldSummaryVectorMirrorAtBoundary_ACU({
      chat, isolationKey: '', boundaryAnchorIndex: 1, tableCheckpointFingerprint: 'fp', sourceTableKey: SOURCE,
    });
    expect(result).toMatchObject({ folded: false, files: [] });
    expect(hasMirror(chat)).toBe(false);
  });

  it('pack 读不到时同样降级', async () => {
    h.manifest = { schema: 'summary_vector_mirror_manifest', version: 1, sourceTableKey: SOURCE, rows: [{ rowId: '1', chunks: [{ packHash: 'p0', chunkIndex: 0 }] }] };
    const chat = makeChat();
    const result = await foldSummaryVectorMirrorAtBoundary_ACU({
      chat, isolationKey: '', boundaryAnchorIndex: 1, tableCheckpointFingerprint: 'fp', sourceTableKey: SOURCE,
    });
    expect(result).toMatchObject({ folded: false, files: [] });
    expect(hasMirror(chat)).toBe(false);
  });
});
