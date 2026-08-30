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
  code: 'assigned_row_id' | 'header_identity_alias' | 'header_identity_inserted' | 'row_identity_cell_inserted' | 'row_tail_padded';
}

export interface LegacyOrphanColumnRepairResult_ACU {
  changedSheetKeys: string[];
  warnings: string[];
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

/**
 * xing～spv7.9 时代的表头首格形态并不统一：`row_id` 别名、`null`、`undefined`、
 * 空串都出现过（undefined 经 JSON 持久化后还会变成 null）。这些都表示"这里就是
 * 身份列的位置"，必须原位改名而不是再插一列——否则会产生孤儿空列，行值相对
 * 表头整体左移一列（2025-12 真实事故形态）。
 */
function isIdentityPlaceholderHeaderCell_ACU(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return isLegacyRowIdHeaderAlias_ACU(value);
}

/** 稳定 row_id 是正整数字符串（见 stable-row-id-allocator）；xing 行号同为纯数字。 */
function looksLikeRowIdValue_ACU(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return /^\d+$/.test(String(value).trim());
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

/**
 * 读取期复位历史"孤儿身份列"错位（2025-12 真实事故形态，见
 * restoreLegacyRowIdentity_ACU 注释）：xing 表头首格 undefined/空串被旧身份判定
 * 误插 `row_id` 后固化为 `["row_id", null, 业务列…]` —— 表头多出一个空标签孤儿列，
 * 行值相对标签整体左移一列。
 *
 * 触发指纹：header[0]==='row_id' 且 header[1] 为空占位（null/undefined/空串）。
 * 逐行判定（content 与 seedRows 同规则）：
 * - row[1] 非空且尾格为空 → pop()（错位老行：值从第 1 列起占位，尾部是补进来的 null）；
 * - row[1] 为空 → splice(1,1)（迁移后按错误表头对齐的新行：孤儿列位置本来就是空格）；
 * - 两者皆非空 → 无法无损判定，整表放弃复位并记 warning（该列可能是真实数据列）。
 * 守恒契约：只删除可证明为合成的空格/孤儿标签，不删除任何业务值。幂等：复位后
 * 表头不再命中指纹。
 */
export function repairLegacyOrphanIdentityColumn_ACU(data: Record<string, any> | null | undefined): LegacyOrphanColumnRepairResult_ACU {
  const result: LegacyOrphanColumnRepairResult_ACU = { changedSheetKeys: [], warnings: [] };
  if (!data || typeof data !== 'object') return result;

  Object.entries(data).forEach(([sheetKey, sheet]) => {
    if (!sheetKey.startsWith('sheet_') || !sheet || typeof sheet !== 'object') return;
    const content = (sheet as any).content;
    if (!Array.isArray(content) || content.length === 0 || !Array.isArray(content[0])) return;
    const header = content[0] as unknown[];
    if (header.length < 2 || header[0] !== 'row_id') return;
    const orphanCell = header[1];
    const orphanCellIsPlaceholder = orphanCell === null || orphanCell === undefined
      || (typeof orphanCell === 'string' && orphanCell.trim() === '');
    if (!orphanCellIsPlaceholder) return;

    const collectRows = (rows: unknown): unknown[][] =>
      (Array.isArray(rows) ? rows : []).filter((row): row is unknown[] => Array.isArray(row));
    const dataRows = collectRows(content.slice(1));
    const seedRows = collectRows((sheet as any).seedRows);
    const allRows = [...dataRows, ...seedRows];

    const isEmptyCell = (value: unknown): boolean => value === null || value === undefined
      || (typeof value === 'string' && value.trim() === '');
    // 只有与（错误）表头等宽的行需要删一格；行宽 = 表头-1 的未 padding 老行在
    // 删除孤儿列后天然对齐，保持原样。其余宽度是别的缺陷，留给规范校验报告。
    const fullWidthRows = allRows.filter(row => row.length === header.length);
    // 判定歧义行：row[1] 与尾格都有值时既不能 pop 也不能 splice，说明这一列
    // 可能承载了真实数据——整表放弃，宁可保留错位也不冒删业务值的险。
    const ambiguousRow = fullWidthRows.find(row => !isEmptyCell(row[1]) && !isEmptyCell(row[row.length - 1]));
    if (ambiguousRow) {
      result.warnings.push(
        `[孤儿列复位] 表「${String((sheet as any).name || sheetKey)}」(${sheetKey}) 命中孤儿身份列指纹，`
        + `但存在第 1 列与尾格均非空的行，无法无损判定，已放弃复位（数据保持原样）。`,
      );
      return;
    }

    fullWidthRows.forEach(row => {
      if (!isEmptyCell(row[1])) {
        row.pop();
      } else {
        row.splice(1, 1);
      }
    });
    header.splice(1, 1);
    result.changedSheetKeys.push(sheetKey);
  });
  return result;
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
    // "Absent" means the first header cell holds a real business label; any
    // identity placeholder spelling (null/undefined/blank/alias) is renamed in
    // place instead — inserting there would create an orphan empty column and
    // shift every business value one column left of its label.
    const hasIdentityColumn = header.length > 0 && isIdentityPlaceholderHeaderCell_ACU(header[0]);

    // 行级宽度感知：表头有身份列而行宽 = 表头-1 的行缺一格。row[0] 是纯数字
    // （xing 行号/稳定 row_id 格式）→ 身份格在，缺的是尾格；row[0] 是业务值
    // → 缺的是身份格，行首插 null 保住每个业务格的列位置。
    const rowIsMissingIdentityCell = (row: unknown[]): boolean =>
      hasIdentityColumn
      && row.length === header.length - 1
      && !isEmptyCanonicalRowId_ACU(row[0])
      && !looksLikeRowIdValue_ACU(row[0]);
    const rowIsMissingTailCell = (row: unknown[]): boolean =>
      hasIdentityColumn
      && row.length === header.length - 1
      && !rowIsMissingIdentityCell(row);

    // Count the baseline with the same column semantics used after the repair:
    // when a row has no identity cell yet (absent identity column, or a
    // width-deficient row whose first cell is business data), column 0 already
    // holds business data, so skipping it here would understate the baseline
    // and make a faithful repair look like it invented cells.
    result.conservation.rowCountBefore += dataRows.length + seedRows.length;
    [...dataRows, ...seedRows].forEach(row => {
      const offset = (!hasIdentityColumn || rowIsMissingIdentityCell(row)) ? 0 : 1;
      result.conservation.businessCellCountBefore += countBusinessCells_ACU(row, offset);
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
    } else {
      if (header[0] !== 'row_id') {
        header[0] = 'row_id';
        result.repairs.push({ sheetKey, rowIndex: 0, code: 'header_identity_alias' });
      }
      const repairRowWidth = (row: unknown[], rowIndex: number): void => {
        if (rowIsMissingIdentityCell(row)) {
          row.unshift(null);
          result.repairs.push({ sheetKey, rowIndex, code: 'row_identity_cell_inserted' });
        } else if (rowIsMissingTailCell(row)) {
          row.push(null);
          result.repairs.push({ sheetKey, rowIndex, code: 'row_tail_padded' });
        }
      };
      content.slice(1).forEach((row: unknown, offset: number) => {
        if (Array.isArray(row)) repairRowWidth(row, offset + 1);
      });
      if (Array.isArray((sheet as any).seedRows)) {
        ((sheet as any).seedRows as unknown[]).forEach((row, offset) => {
          if (Array.isArray(row)) repairRowWidth(row, offset);
        });
      }
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
