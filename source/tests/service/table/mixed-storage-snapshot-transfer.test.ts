import { describe, expect, it } from 'vitest';
import { buildMixedStorageSnapshotTransfer_ACU } from '../../../src/service/table/mixed-storage-snapshot-transfer';

function decision(overrides: Record<string, unknown> = {}): any {
  const raw = { sheet_0: { content: [['row_id', '名称'], ['1', '药水']] } };
  const replay = { sheet_0: { content: [['row_id', '名称'], ['1', '药水']] } };
  return {
    decisionId: 'mixed:abc/def',
    createdAt: 123456789,
    scopeSnapshot: { chatReference: [{ secret: 'must-not-export' }], chatIdentifier: 'chat:/unsafe', activeIsolationKey: '' },
    legacyAudit: { status: 'clean', issues: [], repairPlan: [], dataFingerprintBefore: 'legacy-before', sourceData: raw },
    legacyRepair: { status: 'clean', candidateData: raw, idRemap: [], overflowCells: [], dataFingerprintAfter: 'legacy-after', requiresConfirmation: false },
    legacyFingerprint: 'legacy-fingerprint',
    v2Fingerprint: 'v2-fingerprint',
    evidence: {
      legacy: { messages: [{ messageIndex: 0, aiFloor: 1, locations: ['top_level_standard'], sheetKeys: ['sheet_0'], modifiedKeys: [], updateGroupKeys: [], identityMatchedForTopLevel: true }], sourceMessageIndices: [0], sourceAiFloors: [1], candidateFingerprint: 'legacy-fingerprint', lastFilledAiFloorBySheet: { sheet_0: 1 }, lastChangedAiFloorBySheet: { sheet_0: 1 } },
      v2: { frames: [{ messageIndex: 1, aiFloor: 2, hasFullCheckpoint: true, perSheetCheckpointKeys: [], logEntryCount: 0, headRevision: 'r2' }], anchor: { status: 'anchored', messageIndex: 1, aiFloor: 2, reason: 'migration', createdAt: 2, headRevision: 'r2' }, sheetCoverage: [{ sheetKey: 'sheet_0', lastReplayMessageIndex: 1, lastReplayAiFloor: 2, lastChangedAiFloor: 1 }], replay: { status: 'success', fingerprint: 'v2-fingerprint', data: replay }, provenance: { present: false } },
      comparison: { fingerprintsComparable: true, fingerprintsEqual: true },
    },
    ...overrides,
  };
}

describe('mixed-storage-snapshot-transfer', () => {
  it('构建两个彼此隔离、冻结且不含 live chat 的 payload', () => {
    const source = decision();
    const transfer = buildMixedStorageSnapshotTransfer_ACU(source);

    expect(Object.isFrozen(transfer)).toBe(true);
    expect(Object.isFrozen(transfer.legacy.payload)).toBe(true);
    expect(Object.isFrozen(transfer.v2.payload)).toBe(true);
    expect(transfer.legacy.payload.scope).not.toBe(transfer.v2.payload.scope);
    expect(JSON.stringify(transfer)).not.toContain('chatReference');
    expect(JSON.stringify(transfer)).not.toContain('must-not-export');
    source.legacyAudit.sourceData.sheet_0.content[1][1] = '变更后';
    source.evidence.v2.replay.data.sheet_0.content[1][1] = '变更后';
    expect(transfer.legacy.payload.legacy.rawData.sheet_0.content[1][1]).toBe('药水');
    expect(transfer.v2.payload.v2.replayData?.sheet_0.content[1][1]).toBe('药水');
  });

  it('拒绝 payload 中递归出现的原型污染危险键', () => {
    const source = decision();
    source.legacyAudit.sourceData = JSON.parse('{"sheet_0":{"__proto__":{"polluted":true}}}');

    expect(() => buildMixedStorageSnapshotTransfer_ACU(source)).toThrow('危险键');
  });

  it('以消毒后的 scope、决策 id 和时间戳生成可下载文件名，并绑定相同关联信息', () => {
    const transfer = buildMixedStorageSnapshotTransfer_ACU(decision());

    expect(transfer.legacy.filename).toBe('TavernDB_mixed_legacy_chat_unsafe_default-isolation_mixed_abc_def_123456789.json');
    expect(transfer.v2.filename).toBe('TavernDB_mixed_v2_chat_unsafe_default-isolation_mixed_abc_def_123456789.json');
    for (const payload of [transfer.legacy.payload, transfer.v2.payload]) {
      expect(payload.decisionId).toBe('mixed:abc/def');
      expect(payload.scope).toEqual({ chatIdentifier: 'chat:/unsafe', activeIsolationKey: '' });
    }
    expect(transfer.legacy.payload.legacy.fingerprint).toBe('legacy-fingerprint');
    expect(transfer.legacy.payload.v2Fingerprint).toBe('v2-fingerprint');
    expect(transfer.v2.payload.v2.fingerprint).toBe('v2-fingerprint');
    expect(transfer.v2.payload.legacyFingerprint).toBe('legacy-fingerprint');
  });
});
