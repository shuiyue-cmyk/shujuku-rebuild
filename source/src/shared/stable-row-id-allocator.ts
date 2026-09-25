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
 * Allocates an ID greater than every already-reserved positive integer and
 * reserves it immediately. Decimal spellings such as `01` remain untouched in
 * `reserved`, but contribute their SQLite INTEGER value to the maximum so a
 * newly allocated canonical ID cannot collide with them. Unsafe integers fail
 * closed instead of being silently ignored.
 */
export function allocateStableRowId_ACU(reserved: Set<string>): string {
  const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
  let maxRowId = 0n;
  for (const rawValue of reserved) {
    const value = String(rawValue ?? '').trim();
    if (!/^\d+$/.test(value)) continue;
    const numericId = BigInt(value);
    if (numericId > maxSafeInteger) {
      throw new Error('无法分配 row_id：已达到正安全整数上限。');
    }
    if (numericId > maxRowId) maxRowId = numericId;
  }
  if (maxRowId >= maxSafeInteger) {
    throw new Error('无法分配 row_id：已达到正安全整数上限。');
  }
  const rowId = String(maxRowId + 1n);
  reserved.add(rowId);
  return rowId;
}
