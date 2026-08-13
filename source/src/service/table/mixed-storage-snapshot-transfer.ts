import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { sanitizeFilenameComponent_ACU } from '../../shared/template-preset-utils';
import type { MixedStorageDecision_ACU } from './mixed-storage-decision';

const SNAPSHOT_FORMAT_ACU = 'acu-mixed-storage-snapshot' as const;
const SNAPSHOT_VERSION_ACU = 1 as const;
const DANGEROUS_KEYS_ACU = new Set(['__proto__', 'constructor', 'prototype']);

export interface MixedStorageSnapshotScope_ACU {
  chatIdentifier: string;
  activeIsolationKey: string;
}

export interface MixedStorageSnapshotFile_ACU<TPayload> {
  filename: string;
  payload: TPayload;
}

export interface MixedStorageLegacySnapshotPayload_ACU {
  format: typeof SNAPSHOT_FORMAT_ACU;
  version: typeof SNAPSHOT_VERSION_ACU;
  storage: 'legacy-v1';
  decisionId: string;
  createdAt: number;
  scope: MixedStorageSnapshotScope_ACU;
  legacy: {
    rawData: unknown;
    repairedData: TableDataObject_ACU;
    audit: MixedStorageDecision_ACU['legacyAudit'];
    repair: MixedStorageDecision_ACU['legacyRepair'];
    sources: MixedStorageDecision_ACU['evidence']['legacy'];
    fingerprint: string | null;
  };
  v2Fingerprint: string | null;
}

export interface MixedStorageV2SnapshotPayload_ACU {
  format: typeof SNAPSHOT_FORMAT_ACU;
  version: typeof SNAPSHOT_VERSION_ACU;
  storage: 'storage-frame-v2';
  decisionId: string;
  createdAt: number;
  scope: MixedStorageSnapshotScope_ACU;
  v2: {
    replayData: TableDataObject_ACU | null;
    anchor: MixedStorageDecision_ACU['evidence']['v2']['anchor'];
    frames: MixedStorageDecision_ACU['evidence']['v2']['frames'];
    headRevision: string | null;
    sheetCoverage: MixedStorageDecision_ACU['evidence']['v2']['sheetCoverage'];
    provenance: MixedStorageDecision_ACU['evidence']['v2']['provenance'];
    fingerprint: string | null;
  };
  legacyFingerprint: string | null;
}

export interface MixedStorageSnapshotTransfer_ACU {
  legacy: MixedStorageSnapshotFile_ACU<MixedStorageLegacySnapshotPayload_ACU>;
  v2: MixedStorageSnapshotFile_ACU<MixedStorageV2SnapshotPayload_ACU>;
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSafeJsonValue_ACU(value: unknown, path = '$', seen = new Set<object>()): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`Mixed storage snapshot 包含循环引用：${path}`);
    seen.add(value);
    value.forEach((item, index) => assertSafeJsonValue_ACU(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (!isRecord_ACU(value)) return;
  if (seen.has(value)) throw new Error(`Mixed storage snapshot 包含循环引用：${path}`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS_ACU.has(key)) throw new Error(`Mixed storage snapshot 包含危险键：${path}.${key}`);
    assertSafeJsonValue_ACU(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function cloneAndFreeze_ACU<T>(value: T): T {
  assertSafeJsonValue_ACU(value);
  const cloned = JSON.parse(JSON.stringify(value)) as T;
  return deepFreeze_ACU(cloned);
}

function deepFreeze_ACU<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value as Record<string, unknown>).forEach(deepFreeze_ACU);
  return Object.freeze(value);
}

function snapshotScope_ACU(decision: MixedStorageDecision_ACU): MixedStorageSnapshotScope_ACU {
  return {
    chatIdentifier: decision.scopeSnapshot.chatIdentifier,
    activeIsolationKey: decision.scopeSnapshot.activeIsolationKey,
  };
}

function filename_ACU(storage: 'legacy' | 'v2', decision: MixedStorageDecision_ACU): string {
  const chat = sanitizeFilenameComponent_ACU(decision.scopeSnapshot.chatIdentifier) || 'chat';
  const isolation = sanitizeFilenameComponent_ACU(decision.scopeSnapshot.activeIsolationKey) || 'default-isolation';
  const decisionId = sanitizeFilenameComponent_ACU(decision.decisionId) || 'decision';
  return `TavernDB_mixed_${storage}_${chat}_${isolation}_${decisionId}_${decision.createdAt}.json`;
}

/** Builds detached, JSON-safe evidence exports. It never reads the live chat reference. */
export function buildMixedStorageSnapshotTransfer_ACU(decision: MixedStorageDecision_ACU): MixedStorageSnapshotTransfer_ACU {
  const scope = snapshotScope_ACU(decision);
  const legacyPayload: MixedStorageLegacySnapshotPayload_ACU = {
    format: SNAPSHOT_FORMAT_ACU,
    version: SNAPSHOT_VERSION_ACU,
    storage: 'legacy-v1',
    decisionId: decision.decisionId,
    createdAt: decision.createdAt,
    scope,
    legacy: {
      rawData: decision.legacyAudit.sourceData,
      repairedData: decision.legacyRepair.candidateData as TableDataObject_ACU,
      audit: decision.legacyAudit,
      repair: decision.legacyRepair,
      sources: decision.evidence.legacy,
      fingerprint: decision.legacyFingerprint,
    },
    v2Fingerprint: decision.v2Fingerprint,
  };
  const v2Payload: MixedStorageV2SnapshotPayload_ACU = {
    format: SNAPSHOT_FORMAT_ACU,
    version: SNAPSHOT_VERSION_ACU,
    storage: 'storage-frame-v2',
    decisionId: decision.decisionId,
    createdAt: decision.createdAt,
    scope,
    v2: {
      replayData: decision.evidence.v2.replay.data || null,
      anchor: decision.evidence.v2.anchor,
      frames: decision.evidence.v2.frames,
      headRevision: decision.evidence.v2.anchor.headRevision || null,
      sheetCoverage: decision.evidence.v2.sheetCoverage,
      provenance: decision.evidence.v2.provenance,
      fingerprint: decision.v2Fingerprint,
    },
    legacyFingerprint: decision.legacyFingerprint,
  };
  return deepFreeze_ACU({
    legacy: { filename: filename_ACU('legacy', decision), payload: cloneAndFreeze_ACU(legacyPayload) },
    v2: { filename: filename_ACU('v2', decision), payload: cloneAndFreeze_ACU(v2Payload) },
  });
}
