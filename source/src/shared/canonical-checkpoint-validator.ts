import { isEmptyCanonicalRowId_ACU } from './canonical-row-normalizer';

export type CanonicalCheckpointKind_ACU = 'full' | 'sheet_full' | 'data';

export type CanonicalCheckpointIssueType_ACU =
  | 'checkpoint_not_object'
  | 'invalid_checkpoint_kind'
  | 'invalid_created_at'
  | 'invalid_reason'
  | 'invalid_data'
  | 'missing_sheet'
  | 'invalid_sheet_key'
  | 'sheet_key_mismatch'
  | 'invalid_sheet'
  | 'invalid_content'
  | 'invalid_header'
  | 'invalid_row'
  | 'row_width_mismatch'
  | 'empty_row_id'
  | 'duplicate_row_id'
  | 'invalid_fallback_provenance';

export interface CanonicalCheckpointValidationContext_ACU {
  messageIndex?: number;
  aiFloor?: number;
  isolationKey?: string;
  reason?: string;
}

export interface CanonicalCheckpointIssue_ACU extends CanonicalCheckpointValidationContext_ACU {
  checkpointKind: CanonicalCheckpointKind_ACU;
  type: CanonicalCheckpointIssueType_ACU;
  sheetKey?: string;
  rowIndex?: number;
  rowId?: string;
}

export interface CanonicalCheckpointValidationResult_ACU {
  valid: boolean;
  issues: CanonicalCheckpointIssue_ACU[];
}

export type MigrationProvenanceIssueType_ACU =
  | 'provenance_not_object'
  | 'unsupported_provenance_version'
  | 'invalid_legacy_fingerprint'
  | 'invalid_source_indices'
  | 'invalid_source_ai_floors'
  | 'invalid_last_changed_floor_by_sheet'
  | 'invalid_target_message_index'
  | 'invalid_target_ai_floor'
  | 'invalid_provenance_isolation_key'
  | 'invalid_migrated_at';

export interface MigrationProvenanceValidationResult_ACU {
  valid: boolean;
  issues: MigrationProvenanceIssueType_ACU[];
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createResult_ACU(): CanonicalCheckpointValidationResult_ACU {
  return { valid: true, issues: [] };
}

function addIssue_ACU(
  result: CanonicalCheckpointValidationResult_ACU,
  checkpointKind: CanonicalCheckpointKind_ACU,
  context: CanonicalCheckpointValidationContext_ACU,
  type: CanonicalCheckpointIssueType_ACU,
  details: Pick<CanonicalCheckpointIssue_ACU, 'sheetKey' | 'rowIndex' | 'rowId'> = {},
): void {
  result.valid = false;
  result.issues.push({ checkpointKind, ...context, type, ...details });
}

export function validateCanonicalCheckpointSheet_ACU(
  sheet: unknown,
  sheetKey: string,
  checkpointKind: CanonicalCheckpointKind_ACU,
  context: CanonicalCheckpointValidationContext_ACU = {},
): CanonicalCheckpointValidationResult_ACU {
  const result = createResult_ACU();
  if (!sheetKey.startsWith('sheet_')) {
    addIssue_ACU(result, checkpointKind, context, 'invalid_sheet_key', { sheetKey });
    return result;
  }
  if (!isRecord_ACU(sheet)) {
    addIssue_ACU(result, checkpointKind, context, 'invalid_sheet', { sheetKey });
    return result;
  }
  const content = sheet.content;
  if (!Array.isArray(content)) {
    addIssue_ACU(result, checkpointKind, context, 'invalid_content', { sheetKey });
    return result;
  }
  const header = content[0];
  if (!Array.isArray(header) || header.length === 0 || header[0] !== 'row_id') {
    addIssue_ACU(result, checkpointKind, context, 'invalid_header', { sheetKey, rowIndex: 0 });
    return result;
  }

  const rowIds = new Set<string>();
  for (let rowIndex = 1; rowIndex < content.length; rowIndex += 1) {
    const row = content[rowIndex];
    if (!Array.isArray(row)) {
      addIssue_ACU(result, checkpointKind, context, 'invalid_row', { sheetKey, rowIndex });
      continue;
    }
    if (isEmptyCanonicalRowId_ACU(row[0])) {
      addIssue_ACU(result, checkpointKind, context, 'empty_row_id', { sheetKey, rowIndex });
      continue;
    }
    const rowId = String(row[0]).trim();
    if (row.length !== header.length) {
      addIssue_ACU(result, checkpointKind, context, 'row_width_mismatch', { sheetKey, rowIndex, rowId });
    }
    if (rowIds.has(rowId)) {
      addIssue_ACU(result, checkpointKind, context, 'duplicate_row_id', { sheetKey, rowIndex, rowId });
      continue;
    }
    rowIds.add(rowId);
  }
  return result;
}

export function validateCanonicalCheckpointData_ACU(
  data: unknown,
  context: CanonicalCheckpointValidationContext_ACU = {},
): CanonicalCheckpointValidationResult_ACU {
  const result = createResult_ACU();
  if (!isRecord_ACU(data)) {
    addIssue_ACU(result, 'data', context, 'invalid_data');
    return result;
  }
  const sheets = Object.entries(data).filter(([key]) => key.startsWith('sheet_'));
  if (sheets.length === 0) {
    addIssue_ACU(result, 'data', context, 'missing_sheet');
    return result;
  }
  for (const [sheetKey, sheet] of sheets) {
    const validation = validateCanonicalCheckpointSheet_ACU(sheet, sheetKey, 'data', context);
    result.valid = result.valid && validation.valid;
    result.issues.push(...validation.issues);
  }
  return result;
}

function isNonNegativeInteger_ACU(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger_ACU(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

/**
 * 仅供 mixed-storage evaluator 信任 migration lineage 前调用。
 * 它故意不接入 canonical checkpoint 校验，以保持历史无 provenance frame 的 replay 兼容。
 */
export function validateMigrationProvenanceV1_ACU(
  provenance: unknown,
): MigrationProvenanceValidationResult_ACU {
  const issues: MigrationProvenanceIssueType_ACU[] = [];
  if (!isRecord_ACU(provenance)) {
    return { valid: false, issues: ['provenance_not_object'] };
  }
  if (provenance.version !== 1) issues.push('unsupported_provenance_version');
  if (typeof provenance.legacyDataFingerprint !== 'string' || provenance.legacyDataFingerprint.trim() === '') {
    issues.push('invalid_legacy_fingerprint');
  }

  const sourceIndices = provenance.legacySourceMessageIndices;
  if (!Array.isArray(sourceIndices)
    || sourceIndices.length === 0
    || !sourceIndices.every(isNonNegativeInteger_ACU)
    || sourceIndices.some((index, position) => position > 0 && index <= sourceIndices[position - 1])) {
    issues.push('invalid_source_indices');
  }
  const sourceAiFloors = provenance.legacySourceAiFloors;
  if (!Array.isArray(sourceAiFloors)
    || !Array.isArray(sourceIndices)
    || sourceAiFloors.length !== sourceIndices.length
    || !sourceAiFloors.every(isPositiveInteger_ACU)) {
    issues.push('invalid_source_ai_floors');
  }

  const lastChangedBySheet = provenance.legacyLastChangedAiFloorBySheet;
  if (!isRecord_ACU(lastChangedBySheet)
    || Object.keys(lastChangedBySheet).some(sheetKey => !sheetKey.startsWith('sheet_') || !isNonNegativeInteger_ACU(lastChangedBySheet[sheetKey]))) {
    issues.push('invalid_last_changed_floor_by_sheet');
  }
  if (!isNonNegativeInteger_ACU(provenance.targetMessageIndex)) issues.push('invalid_target_message_index');
  if (!isPositiveInteger_ACU(provenance.targetAiFloor)) issues.push('invalid_target_ai_floor');
  if (typeof provenance.isolationKey !== 'string') issues.push('invalid_provenance_isolation_key');
  if (!Number.isFinite(provenance.migratedAt) || Number(provenance.migratedAt) < 0) issues.push('invalid_migrated_at');

  return { valid: issues.length === 0, issues };
}

export function validateCanonicalCheckpoint_ACU(
  checkpoint: unknown,
  context: CanonicalCheckpointValidationContext_ACU = {},
): CanonicalCheckpointValidationResult_ACU {
  const result = createResult_ACU();
  if (!isRecord_ACU(checkpoint)) {
    addIssue_ACU(result, 'full', context, 'checkpoint_not_object');
    return result;
  }
  const kind = checkpoint.kind;
  if (kind !== 'full' && kind !== 'sheet_full') {
    addIssue_ACU(result, 'full', context, 'invalid_checkpoint_kind');
    return result;
  }
  const checkpointKind = kind;
  const issueContext = { ...context, reason: typeof checkpoint.reason === 'string' ? checkpoint.reason : context.reason };
  if (!Number.isFinite(checkpoint.createdAt) || Number(checkpoint.createdAt) < 0) {
    addIssue_ACU(result, checkpointKind, issueContext, 'invalid_created_at');
  }
  if (typeof checkpoint.reason !== 'string' || checkpoint.reason.trim() === '') {
    addIssue_ACU(result, checkpointKind, issueContext, 'invalid_reason');
  }
  if (checkpointKind === 'full') {
    if (checkpoint.fallbackProvenance !== undefined) {
      const provenance = checkpoint.fallbackProvenance;
      let valid = false;
      if (isRecord_ACU(provenance)) {
        const rangeStart = provenance.rangeStartMessageIndex;
        const rangeEnd = provenance.rangeEndMessageIndex;
        const createdAt = provenance.createdAt;
        valid = provenance.version === 1
          && provenance.kind === 'manual_refill_template_root'
          && typeof provenance.runId === 'string' && provenance.runId.trim() !== ''
          && typeof provenance.isolationKey === 'string'
          && Array.isArray(provenance.targetSheetKeys)
          && provenance.targetSheetKeys.length > 0
          && provenance.targetSheetKeys.every(sheetKey => typeof sheetKey === 'string' && sheetKey.startsWith('sheet_'))
          && typeof rangeStart === 'number' && Number.isInteger(rangeStart) && rangeStart >= 0
          && typeof rangeEnd === 'number' && Number.isInteger(rangeEnd) && rangeEnd >= rangeStart
          && typeof provenance.templateFingerprint === 'string' && provenance.templateFingerprint.trim() !== ''
          && typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt >= 0;
      }
      if (!valid) addIssue_ACU(result, checkpointKind, issueContext, 'invalid_fallback_provenance');
    }
    const validation = validateCanonicalCheckpointData_ACU(checkpoint.data, issueContext);
    result.valid = result.valid && validation.valid;
    result.issues.push(...validation.issues.map(issue => ({ ...issue, checkpointKind: 'full' as const })));
    return result;
  }
  const sheetKey = checkpoint.sheetKey;
  if (typeof sheetKey !== 'string' || !sheetKey.startsWith('sheet_')) {
    addIssue_ACU(result, checkpointKind, issueContext, 'sheet_key_mismatch');
    return result;
  }
  const validation = validateCanonicalCheckpointSheet_ACU(checkpoint.data, sheetKey, checkpointKind, issueContext);
  result.valid = result.valid && validation.valid;
  result.issues.push(...validation.issues);
  return result;
}
