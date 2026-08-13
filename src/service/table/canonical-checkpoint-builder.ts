import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import {
  validateCanonicalCheckpoint_ACU,
  type CanonicalCheckpointIssue_ACU,
  type CanonicalCheckpointValidationContext_ACU,
} from '../../shared/canonical-checkpoint-validator';
import type {
  ManualRefillTemplateRootProvenanceV1_ACU,
  ManualRefillProgressV2_ACU,
  TableCheckpointScheduleSummaryV2_ACU,
  TableCheckpointV2_ACU,
  TableMigrationProvenanceV1_ACU,
  TableMutationEventV2_ACU,
  TableSheetCheckpointV2_ACU,
} from './storage-frame-v2-types';

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export interface CanonicalCheckpointBuildFailure_ACU {
  checkpoint?: undefined;
  issues: CanonicalCheckpointIssue_ACU[];
  error: string;
}

export interface CanonicalCheckpointBuildSuccess_ACU<T> {
  checkpoint: T;
  issues?: undefined;
  error?: undefined;
}

export type CanonicalCheckpointBuildResult_ACU<T> =
  | CanonicalCheckpointBuildSuccess_ACU<T>
  | CanonicalCheckpointBuildFailure_ACU;

function formatIssues_ACU(issues: CanonicalCheckpointIssue_ACU[]): string {
  return issues.map(issue => {
    const location = issue.sheetKey === undefined
      ? ''
      : `: ${issue.sheetKey}${issue.rowIndex === undefined ? '' : ` 第 ${issue.rowIndex} 行`}`;
    return `${issue.type}${location}`;
  }).join('；');
}

function validateCandidate_ACU<T extends TableCheckpointV2_ACU | TableSheetCheckpointV2_ACU>(
  checkpoint: T,
  context: CanonicalCheckpointValidationContext_ACU,
): CanonicalCheckpointBuildResult_ACU<T> {
  const validation = validateCanonicalCheckpoint_ACU(checkpoint, context);
  if (!validation.valid) {
    return { error: `V2 checkpoint 行标识或结构不合法：${formatIssues_ACU(validation.issues)}`, issues: validation.issues };
  }
  return { checkpoint };
}

export interface BuildCanonicalFullCheckpointOptions_ACU {
  createdAt: number;
  reason: TableCheckpointV2_ACU['reason'];
  data: TableDataObject_ACU;
  scheduleSummary?: Record<string, TableCheckpointScheduleSummaryV2_ACU>;
  event?: TableMutationEventV2_ACU;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  migrationProvenance?: TableMigrationProvenanceV1_ACU;
  fallbackProvenance?: ManualRefillTemplateRootProvenanceV1_ACU;
  context?: CanonicalCheckpointValidationContext_ACU;
}

export function buildCanonicalFullCheckpoint_ACU(
  options: BuildCanonicalFullCheckpointOptions_ACU,
): CanonicalCheckpointBuildResult_ACU<TableCheckpointV2_ACU> {
  const checkpoint: TableCheckpointV2_ACU = {
    kind: 'full',
    createdAt: options.createdAt,
    reason: options.reason,
    data: deepClone_ACU(options.data),
    ...(options.scheduleSummary ? { scheduleSummary: deepClone_ACU(options.scheduleSummary) } : {}),
    ...(options.event ? { event: deepClone_ACU(options.event) } : {}),
    ...(options.manualRefillProgress ? { manualRefillProgress: deepClone_ACU(options.manualRefillProgress) } : {}),
    ...(options.migrationProvenance ? { migrationProvenance: deepClone_ACU(options.migrationProvenance) } : {}),
    ...(options.fallbackProvenance ? { fallbackProvenance: deepClone_ACU(options.fallbackProvenance) } : {}),
  };
  return validateCandidate_ACU(checkpoint, { ...options.context, reason: options.reason });
}

export interface BuildCanonicalSheetCheckpointOptions_ACU {
  createdAt: number;
  reason: TableSheetCheckpointV2_ACU['reason'];
  sheetKey: string;
  data: Sheet_ACU;
  scheduleSummary?: TableCheckpointScheduleSummaryV2_ACU;
  event?: TableMutationEventV2_ACU;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  baseRevision?: string | null;
  context?: CanonicalCheckpointValidationContext_ACU;
}

export function buildCanonicalSheetCheckpoint_ACU(
  options: BuildCanonicalSheetCheckpointOptions_ACU,
): CanonicalCheckpointBuildResult_ACU<TableSheetCheckpointV2_ACU> {
  const checkpoint: TableSheetCheckpointV2_ACU = {
    kind: 'sheet_full',
    createdAt: options.createdAt,
    reason: options.reason,
    sheetKey: options.sheetKey,
    data: deepClone_ACU(options.data),
    ...(options.scheduleSummary ? { scheduleSummary: deepClone_ACU(options.scheduleSummary) } : {}),
    ...(options.event ? { event: deepClone_ACU(options.event) } : {}),
    ...(options.manualRefillProgress ? { manualRefillProgress: deepClone_ACU(options.manualRefillProgress) } : {}),
    ...(options.baseRevision !== undefined ? { baseRevision: options.baseRevision } : {}),
  };
  return validateCandidate_ACU(checkpoint, { ...options.context, reason: options.reason });
}
