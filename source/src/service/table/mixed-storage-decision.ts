import type { IsolationConfig_ACU } from '../../data/models/chat-message-data';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { resolveHistoricalSheetKeyMigrations_ACU } from '../../shared/sql-read-resolver';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { collectMixedStorageEvidence_ACU, type MixedStorageEvidence_ACU } from './mixed-storage-evidence';
import { auditTableDataForUpgrade_ACU, type UpgradeAuditResult_ACU } from './table-data-upgrade-audit';
import { repairTableDataFromAudit_ACU, type RepairResult_ACU } from './table-data-repair';

export type MixedStorageDecisionKind_ACU =
  | 'blocked_replay_unavailable'
  | 'blocked_checkpoint_convergence'
  | 'blocked_legacy_requires_confirmation'
  | 'equivalent_provenance_verified'
  | 'equivalent_projection_verified'
  | 'v2_successor_verified'
  | 'legacy_has_v2_missing_data'
  | 'conflict_requires_user_choice';

export type MixedStorageDecisionAction_ACU = 'keep_v2' | 'commit_merge_candidate' | 'download_snapshots' | 'noop';
export type MixedStorageDecisionDiagnosticCode_ACU =
  | 'v2_replay_unavailable'
  | 'v2_anchor_missing_without_artifacts'
  | 'v2_anchor_missing_with_artifacts'
  | 'v2_replay_failed'
  | 'v2_slot_malformed'
  | 'v2_static_sheets_not_covered_by_legacy'
  | 'v2_static_scan_undecodable'
  | 'v2_requires_checkpoint_convergence'
  | 'legacy_requires_confirmation'
  | 'scope_isolation_mismatch'
  | 'provenance_missing_or_invalid'
  | 'provenance_claim_mismatch'
  | 'v2_coverage_insufficient'
  | 'v2_successor_activity_missing'
  | 'legacy_v2_fingerprints_equal'
  | 'legacy_v2_fingerprints_differ'
  | 'legacy_keys_normalized'
  | 'merge_candidate_available'
  | 'merge_candidate_conflict';

export interface MixedStorageScopeSnapshot_ACU {
  chatReference: readonly any[];
  chatIdentifier: string;
  activeIsolationKey: string;
}

export interface EvaluateMixedStorageDecisionOptions_ACU {
  chat: readonly any[];
  isolationKey: string;
  isolationConfig: Readonly<IsolationConfig_ACU>;
  legacyData: TableDataObject_ACU | null;
  scope?: MixedStorageScopeSnapshot_ACU;
}

export interface MixedStorageDecision_ACU {
  kind: MixedStorageDecisionKind_ACU;
  decisionId: string;
  createdAt: number;
  scopeSnapshot: MixedStorageScopeSnapshot_ACU;
  evidence: MixedStorageEvidence_ACU;
  legacyAudit: UpgradeAuditResult_ACU;
  legacyRepair: RepairResult_ACU;
  legacyFingerprint: string | null;
  v2Fingerprint: string | null;
  diagnosticCodes: MixedStorageDecisionDiagnosticCode_ACU[];
  allowedActions: MixedStorageDecisionAction_ACU[];
  frozenMergeCandidate?: TableDataObject_ACU;
}

let decisionSequence_ACU = 0;

function clone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze_ACU<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    // scope 只保留 live chat 的引用作失效比对；冻结它会污染调用方状态。
    if (key !== 'chatReference') deepFreeze_ACU(item);
  });
  return Object.freeze(value);
}

function freezeScopeSnapshot_ACU(scopeSnapshot: MixedStorageScopeSnapshot_ACU): MixedStorageScopeSnapshot_ACU {
  return Object.freeze({ ...scopeSnapshot });
}

function captureScope_ACU(chat: readonly any[]): MixedStorageScopeSnapshot_ACU {
  return {
    chatReference: chat,
    chatIdentifier: String(currentChatFileIdentifier_ACU || '').trim(),
    activeIsolationKey: getCurrentIsolationKey_ACU(),
  };
}

function stableJson_ACU(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.keys(item).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = item[key];
      return result;
    }, {});
  });
}

function sheetKeys_ACU(data: TableDataObject_ACU): string[] {
  return Object.keys(data).filter(key => key.startsWith('sheet_')).sort((left, right) => left.localeCompare(right));
}

function rowsById_ACU(rows: unknown, sheetKey: string): Map<string, unknown[]> | null {
  if (!Array.isArray(rows)) return new Map();
  const result = new Map<string, unknown[]>();
  for (const row of rows) {
    if (!Array.isArray(row) || row[0] === null || row[0] === undefined || String(row[0]).trim() === '') return null;
    const rowId = String(row[0]).trim();
    if (result.has(rowId)) return null;
    result.set(rowId, row);
  }
  return result;
}

function appendMissingRows_ACU(v2Rows: unknown[], legacyRows: unknown[], sheetKey: string): boolean {
  const v2ById = rowsById_ACU(v2Rows, sheetKey);
  const legacyById = rowsById_ACU(legacyRows, sheetKey);
  if (!v2ById || !legacyById) return false;
  for (const [rowId, legacyRow] of legacyById) {
    const v2Row = v2ById.get(rowId);
    if (v2Row && stableJson_ACU(v2Row) !== stableJson_ACU(legacyRow)) return false;
    if (!v2Row) v2Rows.push(clone_ACU(legacyRow));
  }
  return true;
}

function sheetMetadata_ACU(sheet: Record<string, unknown>): Record<string, unknown> {
  const { content: _content, seedRows: _seedRows, ...metadata } = sheet;
  return metadata;
}

function buildConservativeMergeCandidate_ACU(
  legacyData: TableDataObject_ACU,
  replayedV2Data: TableDataObject_ACU,
): TableDataObject_ACU | null {
  if (stableJson_ACU((legacyData as any).mate) !== stableJson_ACU((replayedV2Data as any).mate)) return null;
  const legacyKeys = sheetKeys_ACU(legacyData);
  const v2Keys = sheetKeys_ACU(replayedV2Data);
  if (stableJson_ACU(legacyKeys) !== stableJson_ACU(v2Keys)) return null;

  const candidate = clone_ACU(replayedV2Data);
  for (const sheetKey of legacyKeys) {
    const legacySheet = legacyData[sheetKey] as unknown as Record<string, unknown>;
    const v2Sheet = candidate[sheetKey] as unknown as Record<string, unknown>;
    if (!legacySheet || !v2Sheet || stableJson_ACU(sheetMetadata_ACU(legacySheet)) !== stableJson_ACU(sheetMetadata_ACU(v2Sheet))) return null;
    const legacyContent = legacySheet.content;
    const v2Content = v2Sheet.content;
    if (!Array.isArray(legacyContent) || !Array.isArray(v2Content)
      || stableJson_ACU(legacyContent[0]) !== stableJson_ACU(v2Content[0])) return null;
    const candidateContentRows = v2Content.slice(1);
    if (!appendMissingRows_ACU(candidateContentRows, legacyContent.slice(1), sheetKey)) return null;
    v2Sheet.content = [v2Content[0], ...candidateContentRows];
    if (!Array.isArray(v2Sheet.seedRows) && legacySheet.seedRows !== undefined) return null;
    if (Array.isArray(v2Sheet.seedRows) && !appendMissingRows_ACU(v2Sheet.seedRows, Array.isArray(legacySheet.seedRows) ? legacySheet.seedRows : [], sheetKey)) return null;
  }
  return auditTableDataForUpgrade_ACU(candidate).status === 'clean' ? candidate : null;
}

function coverageIsSufficient_ACU(evidence: MixedStorageEvidence_ACU): boolean {
  return Object.entries(evidence.legacy.lastChangedAiFloorBySheet).every(([sheetKey, legacyFloor]) => {
    const coverage = evidence.v2.sheetCoverage.find(item => item.sheetKey === sheetKey);
    return !!coverage && coverage.lastChangedAiFloor >= legacyFloor;
  });
}

function hasV2SuccessorActivity_ACU(evidence: MixedStorageEvidence_ACU): boolean {
  const anchorIndex = evidence.v2.anchor.messageIndex;
  return anchorIndex !== null && evidence.v2.frames.some(frame => frame.messageIndex > anchorIndex
    && (frame.logEntryCount > 0 || frame.perSheetCheckpointKeys.length > 0));
}

function verifiedProvenance_ACU(evidence: MixedStorageEvidence_ACU): boolean {
  const provenance = evidence.v2.provenance;
  return provenance.present
    && provenance.validation?.valid === true
    && provenance.targetMatchesAnchor === true
    && provenance.isolationKeyMatches === true
    && provenance.sourceEvidenceMatches === true
    && provenance.legacyFingerprintMatchesCandidate === true;
}

function actionsFor_ACU(kind: MixedStorageDecisionKind_ACU): MixedStorageDecisionAction_ACU[] {
  if (kind === 'equivalent_provenance_verified' || kind === 'equivalent_projection_verified' || kind === 'v2_successor_verified') return ['noop', 'download_snapshots', 'keep_v2'];
  if (kind === 'legacy_has_v2_missing_data') return ['noop', 'download_snapshots', 'commit_merge_candidate'];
  return ['noop', 'download_snapshots'];
}

function normalizeLegacyKeysToReplay_ACU(data: TableDataObject_ACU, replayedData: TableDataObject_ACU): { data: TableDataObject_ACU; migrations: Map<string, string> } {
  const migrations = resolveHistoricalSheetKeyMigrations_ACU(data, replayedData);
  if (migrations.size === 0) return { data, migrations };
  const normalized = clone_ACU(data);
  for (const [sourceKey, targetKey] of migrations) {
    normalized[targetKey] = normalized[sourceKey];
    const targetSheet = normalized[targetKey] as any;
    if (targetSheet && typeof targetSheet === 'object') targetSheet.uid = targetKey;
    delete normalized[sourceKey];
  }
  return { data: normalized, migrations };
}

export async function evaluateMixedStorageDecision_ACU(
  options: EvaluateMixedStorageDecisionOptions_ACU,
): Promise<MixedStorageDecision_ACU> {
  const scopeSnapshot = options.scope || captureScope_ACU(options.chat);
  const initialChatIdentifier = String(currentChatFileIdentifier_ACU || '').trim();
  const legacyAudit = auditTableDataForUpgrade_ACU(options.legacyData);
  const legacyRepair = repairTableDataFromAudit_ACU(legacyAudit);
  let repairedLegacyData = legacyRepair.candidateData as TableDataObject_ACU;
  let evidence = await collectMixedStorageEvidence_ACU({
    chat: options.chat,
    isolationKey: options.isolationKey,
    isolationConfig: options.isolationConfig,
    legacyCandidateData: legacyAudit.status === 'unrecoverable' ? null : repairedLegacyData,
  });
  const diagnostics: MixedStorageDecisionDiagnosticCode_ACU[] = [];
  if (evidence.v2.replay.status === 'success' && evidence.v2.replay.data) {
    const normalized = normalizeLegacyKeysToReplay_ACU(repairedLegacyData, evidence.v2.replay.data);
    if (normalized.migrations.size > 0) {
      repairedLegacyData = normalized.data;
      diagnostics.push('legacy_keys_normalized');
      evidence = await collectMixedStorageEvidence_ACU({
        chat: options.chat,
        isolationKey: options.isolationKey,
        isolationConfig: options.isolationConfig,
        legacyCandidateData: repairedLegacyData,
      });
    }
  }
  const scopeMatches = scopeSnapshot.chatReference === options.chat
    && scopeSnapshot.activeIsolationKey === options.isolationKey
    && scopeSnapshot.chatIdentifier === initialChatIdentifier
    && initialChatIdentifier === String(currentChatFileIdentifier_ACU || '').trim()
    && options.isolationKey === getCurrentIsolationKey_ACU();
  if (!scopeMatches) diagnostics.push('scope_isolation_mismatch');
  // 细化子因：区分 anchor 缺失形态与 replay 具体失败原因（T7）
  if (evidence.v2.replay.status !== 'success') {
    diagnostics.push('v2_replay_unavailable');
    if (evidence.v2.anchor.status === 'missing_without_artifacts') {
      diagnostics.push('v2_anchor_missing_without_artifacts');
    } else if (evidence.v2.anchor.status === 'missing_with_artifacts') {
      diagnostics.push('v2_anchor_missing_with_artifacts');
    } else if (evidence.v2.replay.status === 'failed') {
      diagnostics.push('v2_replay_failed');
    }
  }
  if (evidence.v2.frames.some(frame => frame.logEntryCount === 0 && frame.perSheetCheckpointKeys.length === 0
    && evidence.v2.anchor.messageIndex === null)) {
    diagnostics.push('v2_slot_malformed');
  }
  if (evidence.v2.replay.requiresCheckpointConvergence || evidence.v2.replay.compatibilityRepairs?.length) diagnostics.push('v2_requires_checkpoint_convergence');
  if (legacyAudit.status === 'unrecoverable' || legacyRepair.requiresConfirmation) diagnostics.push('legacy_requires_confirmation');
  if (evidence.comparison.fingerprintsEqual === true) diagnostics.push('legacy_v2_fingerprints_equal');
  if (evidence.comparison.fingerprintsEqual === false) diagnostics.push('legacy_v2_fingerprints_differ');

  let kind: MixedStorageDecisionKind_ACU;
  let frozenMergeCandidate: TableDataObject_ACU | undefined;
  if (evidence.v2.replay.status !== 'success') {
    kind = 'blocked_replay_unavailable';
  } else if (evidence.v2.replay.requiresCheckpointConvergence || evidence.v2.replay.compatibilityRepairs?.length) {
    kind = 'blocked_checkpoint_convergence';
  } else if (legacyAudit.status === 'unrecoverable' || legacyRepair.requiresConfirmation) {
    kind = 'blocked_legacy_requires_confirmation';
  } else {
    const provenanceVerified = verifiedProvenance_ACU(evidence);
    const coverageSufficient = coverageIsSufficient_ACU(evidence);
    if (!provenanceVerified) diagnostics.push(evidence.v2.provenance.present ? 'provenance_claim_mismatch' : 'provenance_missing_or_invalid');
    if (!coverageSufficient) diagnostics.push('v2_coverage_insufficient');
    if (scopeMatches && provenanceVerified && coverageSufficient && evidence.comparison.fingerprintsEqual === true) {
      kind = 'equivalent_provenance_verified';
    } else if (scopeMatches && !evidence.v2.provenance.present && coverageSufficient && evidence.comparison.fingerprintsEqual === true) {
      kind = 'equivalent_projection_verified';
    } else if (scopeMatches && provenanceVerified && coverageSufficient && evidence.comparison.fingerprintsEqual === false && hasV2SuccessorActivity_ACU(evidence)) {
      kind = 'v2_successor_verified';
    } else {
      if (scopeMatches && evidence.v2.replay.data && evidence.comparison.fingerprintsEqual === false) {
        const candidate = buildConservativeMergeCandidate_ACU(repairedLegacyData, evidence.v2.replay.data);
        if (candidate) {
          frozenMergeCandidate = candidate;
          diagnostics.push('merge_candidate_available');
        } else {
          diagnostics.push('merge_candidate_conflict');
        }
      }
      if (provenanceVerified && coverageSufficient && evidence.comparison.fingerprintsEqual === false && !hasV2SuccessorActivity_ACU(evidence)) diagnostics.push('v2_successor_activity_missing');
      kind = frozenMergeCandidate ? 'legacy_has_v2_missing_data' : 'conflict_requires_user_choice';
    }
  }

  const createdAt = Date.now();
  decisionSequence_ACU += 1;
  return deepFreeze_ACU({
    kind,
    decisionId: `mixed:${createdAt.toString(36)}:${decisionSequence_ACU.toString(36)}`,
    createdAt,
    scopeSnapshot: freezeScopeSnapshot_ACU(scopeSnapshot),
    evidence: clone_ACU(evidence),
    legacyAudit: clone_ACU(legacyAudit),
    legacyRepair: clone_ACU(legacyRepair),
    legacyFingerprint: evidence.legacy.candidateFingerprint,
    v2Fingerprint: evidence.v2.replay.fingerprint,
    diagnosticCodes: [...new Set(diagnostics)],
    allowedActions: actionsFor_ACU(kind),
    ...(frozenMergeCandidate ? { frozenMergeCandidate: clone_ACU(frozenMergeCandidate) } : {}),
  });
}
