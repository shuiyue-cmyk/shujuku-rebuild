import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from './stable-row-id-allocator';

export interface CanonicalRowIssue_ACU {
  sheetKey: string;
  rowIndex: number;
  reason: 'empty_row_id' | 'invalid_row' | 'duplicate_row_id';
}

export interface CanonicalRowNormalizationResult_ACU {
  changedSheetKeys: string[];
  removedRows: CanonicalRowIssue_ACU[];
  errors: CanonicalRowIssue_ACU[];
}

export interface LegacyRowIdentityRepair_ACU {
  sheetKey: string;
  rowIndex: number;
  code: 'assigned_row_id' | 'header_identity_alias' | 'header_identity_inserted';
}

export interface LegacyRowIdentityResult_ACU {
  repairs: LegacyRowIdentityRepair_ACU[];
  conservation: {
    rowCountBefore: number;
    rowCountAfter: number;
    businessCellCountBefore: number;
    businessCellCountAfter: number;
  };
}

/**
 * Header cells that historically carried the row identity before `row_id`
 * became the canonical name. Only exact, unambiguous legacy spellings.
 */
const LEGACY_ROW_ID_HEADER_ALIASES_ACU = new Set(['id', 'rowid', 'row-id', 'row_id', '行号']);

function isLegacyRowIdHeaderAlias_ACU(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return LEGACY_ROW_ID_HEADER_ALIASES_ACU.has(value.trim().toLowerCase());
}

export function isEmptyCanonicalRowId_ACU(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function formatCanonicalRowIssues_ACU(issues: CanonicalRowIssue_ACU[]): string {
  return issues
    .map(issue => `${issue.sheetKey} 第 ${issue.rowIndex} 行：${issue.reason}`)
    .join('；');
}

/**
 * Legacy auto-merge state was incorrectly appended as an unheaded cell.
 * Only remove the exact, provably synthetic trailing marker; all other
 * row-width defects remain for the canonical validator to reject.
 */
export function repairLegacyAutoMergedRowTails_ACU(data: Record<string, any> | null | undefined): string[] {
  const changedSheetKeys: string[] = [];
  if (!data || typeof data !== 'object') return changedSheetKeys;

  Object.entries(data).forEach(([sheetKey, sheet]) => {
    if (!sheetKey.startsWith('sheet_') || !sheet || typeof sheet !== 'object') return;
    const content = (sheet as any).content;
    const header = Array.isArray(content) ? content[0] : null;
    if (!Array.isArray(header)) return;

    let changed = false;
    content.slice(1).forEach((row: unknown) => {
      if (!Array.isArray(row) || row.length !== header.length + 1 || row[row.length - 1] !== 'auto_merged') return;
      row.pop();
      changed = true;
    });
    if (changed) changedSheetKeys.push(sheetKey);
  });
  return changedSheetKeys;
}

function normalizeRows_ACU(
  rows: unknown[],
  sheetKey: string,
  startIndex: number,
  result: CanonicalRowNormalizationResult_ACU,
): { rows: unknown[]; changed: boolean } {
  const usedRowIds = new Set<string>();
  const nextRows: unknown[] = [];
  let changed = false;
  rows.forEach((row, offset) => {
    const rowIndex = startIndex + offset;
    if (!Array.isArray(row)) {
      result.errors.push({ sheetKey, rowIndex, reason: 'invalid_row' });
      changed = true;
      return;
    }
    if (isEmptyCanonicalRowId_ACU(row[0])) {
      result.removedRows.push({ sheetKey, rowIndex, reason: 'empty_row_id' });
      changed = true;
      return;
    }
    const rowId = String(row[0]).trim();
    if (usedRowIds.has(rowId)) {
      result.errors.push({ sheetKey, rowIndex, reason: 'duplicate_row_id' });
    } else {
      usedRowIds.add(rowId);
    }
    if (row[0] !== rowId) {
      row[0] = rowId;
      changed = true;
    }
    nextRows.push(row);
  });
  return { rows: nextRows, changed };
}

/**
 * Canonical table data must never retain a row without an identity.
 * Empty row_id means that row has been deleted; duplicate IDs remain an
 * explicit error because choosing a winner would silently lose data.
 *
 * These are the *current* protocol's semantics and only hold for data that was
 * written under it. Historical payloads predate the row_id contract, so read
 * paths must run restoreLegacyRowIdentity_ACU first; otherwise live legacy rows
 * are reported here as removed.
 */
export function normalizeCanonicalTableRows_ACU(data: Record<string, any> | null | undefined): CanonicalRowNormalizationResult_ACU {
  const result: CanonicalRowNormalizationResult_ACU = { changedSheetKeys: [], removedRows: [], errors: [] };
  if (!data || typeof data !== 'object') return result;

  Object.entries(data).forEach(([sheetKey, sheet]) => {
    if (!sheetKey.startsWith('sheet_') || !sheet || typeof sheet !== 'object') return;
    const content = (sheet as any).content;
    if (!Array.isArray(content) || content.length === 0 || !Array.isArray(content[0])) return;
    let changed = false;
    if (content[0][0] === null) {
      content[0][0] = 'row_id';
      changed = true;
    }
    const normalizedContent = normalizeRows_ACU(content.slice(1), sheetKey, 1, result);
    if (normalizedContent.changed) changed = true;
    content.splice(1, content.length - 1, ...normalizedContent.rows);

    if (Array.isArray((sheet as any).seedRows)) {
      const normalizedSeedRows = normalizeRows_ACU((sheet as any).seedRows, sheetKey, 0, result);
      if (normalizedSeedRows.changed) changed = true;
      (sheet as any).seedRows = normalizedSeedRows.rows;
    }
    if (changed) result.changedSheetKeys.push(sheetKey);
  });
  return result;
}

/**
 * Restores row identity for historical table data written before `row_id`
 * became the canonical identity column.
 *
 * Why this exists: `normalizeCanonicalTableRows_ACU` treats an empty row_id as
 * proof the row was deleted. That is the *current* protocol's semantics. Data
 * persisted by older versions never followed it — rows were addressed by their
 * physical index in `content`, and the identity column was variously `row_id`,
 * `id`, `null`, or entirely absent (see tests/fixtures/migrations/spv7.9/).
 * Applying the delete semantics to that data drops live business rows, so
 * historical read paths must repair identity *before* canonical normalization
 * runs.
 *
 * Contract:
 * - Never removes a row and never drops a business cell.
 * - Mutates the given object; callers must pass a deep clone, never a
 *   persisted frame. Determinism relies on the input being untouched, which is
 *   what makes repeated replays idempotent.
 * - Only assigns identities to rows that have none. Rows with an existing
 *   row_id keep it, so this does not rewrite persisted identities (see the
 *   contract note on allocateStableRowId_ACU).
 * - Duplicate and non-array rows are left for the canonical normalizer to
 *   report; picking a winner or coercing a shape here would lose data.
 */
export function restoreLegacyRowIdentity_ACU(data: Record<string, any> | null | undefined): LegacyRowIdentityResult_ACU {
  const result: LegacyRowIdentityResult_ACU = {
    repairs: [],
    conservation: { rowCountBefore: 0, rowCountAfter: 0, businessCellCountBefore: 0, businessCellCountAfter: 0 },
  };
  if (!data || typeof data !== 'object') return result;

  Object.entries(data).forEach(([sheetKey, sheet]) => {
    if (!sheetKey.startsWith('sheet_') || !sheet || typeof sheet !== 'object') return;
    const content = (sheet as any).content;
    if (!Array.isArray(content) || content.length === 0 || !Array.isArray(content[0])) return;

    const header = content[0] as unknown[];
    const dataRows = content.slice(1).filter((row: unknown): row is unknown[] => Array.isArray(row));
    const seedRows = Array.isArray((sheet as any).seedRows)
      ? ((sheet as any).seedRows as unknown[]).filter((row: unknown): row is unknown[] => Array.isArray(row))
      : [];

    // An absent identity column is not a defect in legacy data; the concept did
    // not exist. Insert one so every business cell keeps its column position.
    const hasIdentityColumn = header.length > 0 && (header[0] === null || isLegacyRowIdHeaderAlias_ACU(header[0]));

    // Count the baseline with the same column semantics used after the repair:
    // when there is no identity column yet, column 0 already holds business
    // data, so skipping it here would understate the baseline and make a
    // faithful repair look like it invented cells.
    const businessColumnOffsetBefore = hasIdentityColumn ? 1 : 0;
    result.conservation.rowCountBefore += dataRows.length + seedRows.length;
    [...dataRows, ...seedRows].forEach(row => {
      result.conservation.businessCellCountBefore += countBusinessCells_ACU(row, businessColumnOffsetBefore);
    });

    if (!hasIdentityColumn) {
      header.unshift('row_id');
      content.slice(1).forEach((row: unknown) => {
        if (Array.isArray(row)) row.unshift(null);
      });
      if (Array.isArray((sheet as any).seedRows)) {
        ((sheet as any).seedRows as unknown[]).forEach(row => {
          if (Array.isArray(row)) row.unshift(null);
        });
      }
      result.repairs.push({ sheetKey, rowIndex: 0, code: 'header_identity_inserted' });
    } else if (header[0] !== 'row_id') {
      header[0] = 'row_id';
      result.repairs.push({ sheetKey, rowIndex: 0, code: 'header_identity_alias' });
    }

    // Reserve across content and seedRows together: they share one identity
    // space, so allocating per-collection could collide between them.
    const liveRows = content.slice(1).filter((row: unknown): row is unknown[] => Array.isArray(row));
    const liveSeedRows = Array.isArray((sheet as any).seedRows)
      ? ((sheet as any).seedRows as unknown[]).filter((row: unknown): row is unknown[] => Array.isArray(row))
      : [];
    const reserved = createStableRowIdReservation_ACU([...liveRows, ...liveSeedRows]);

    assignMissingRowIds_ACU(liveRows, sheetKey, 1, reserved, result);
    assignMissingRowIds_ACU(liveSeedRows, sheetKey, 0, reserved, result);

    [...liveRows, ...liveSeedRows].forEach(row => {
      result.conservation.businessCellCountAfter += countBusinessCells_ACU(row, 1);
    });
    result.conservation.rowCountAfter += liveRows.length + liveSeedRows.length;
  });

  return result;
}

function countBusinessCells_ACU(row: unknown[], skipLeadingColumns: number): number {
  let count = 0;
  for (let index = skipLeadingColumns; index < row.length; index += 1) {
    const cell = row[index];
    if (cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')) continue;
    count += 1;
  }
  return count;
}

function assignMissingRowIds_ACU(
  rows: unknown[][],
  sheetKey: string,
  startIndex: number,
  reserved: Set<string>,
  result: LegacyRowIdentityResult_ACU,
): void {
  rows.forEach((row, offset) => {
    if (!isEmptyCanonicalRowId_ACU(row[0])) return;
    row[0] = allocateStableRowId_ACU(reserved);
    result.repairs.push({ sheetKey, rowIndex: startIndex + offset, code: 'assigned_row_id' });
  });
}
