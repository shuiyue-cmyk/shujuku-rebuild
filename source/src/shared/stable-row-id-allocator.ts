function canonicalRowId_ACU(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const rowId = String(value).trim();
  return rowId ? rowId : null;
}

export function createStableRowIdReservation_ACU(rows: unknown[] | null | undefined): Set<string> {
  const reserved = new Set<string>();
  for (const row of rows || []) {
    if (!Array.isArray(row)) continue;
    const rowId = canonicalRowId_ACU(row[0]);
    if (rowId) reserved.add(rowId);
  }
  return reserved;
}

/**
 * Allocates an ID greater than every already-reserved canonical positive integer
 * and reserves it immediately. Gaps from deleted rows are intentionally not reused:
 * row_id is a stable identity, not a display position.
 * This is only for newly created rows; it must not be used to rewrite persisted IDs.
 */
export function allocateStableRowId_ACU(reserved: Set<string>): string {
  let maxRowId = 0;
  for (const value of reserved) {
    if (!/^[1-9]\d*$/.test(value)) continue;
    const numericId = Number(value);
    if (Number.isSafeInteger(numericId) && String(numericId) === value) {
      maxRowId = Math.max(maxRowId, numericId);
    }
  }
  if (maxRowId >= Number.MAX_SAFE_INTEGER) {
    throw new Error('无法分配 row_id：已达到正安全整数上限。');
  }
  const rowId = String(maxRowId + 1);
  reserved.add(rowId);
  return rowId;
}
