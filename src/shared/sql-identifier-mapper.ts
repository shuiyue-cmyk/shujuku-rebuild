import { canonicalizeDisplayName_ACU, toAsciiSlug_ACU } from './sheet-identity';

export interface SqlColumnMapping_ACU {
  index: number;
  displayName: string;
  canonicalName: string;
  sqlName: string;
  isRowId: boolean;
}

export interface SqlIdentifierDiagnostic_ACU {
  code: 'empty_column_name' | 'duplicate_canonical_column_name' | 'missing_row_id' | 'misplaced_row_id';
  index: number;
  originalName: string;
  normalizedDisplayName: string;
  canonicalName: string;
  candidateSqlName: string | null;
  conflictsWithIndex?: number;
}

export interface SqlColumnMappingResult_ACU {
  mappings: SqlColumnMapping_ACU[];
  diagnostics: SqlIdentifierDiagnostic_ACU[];
}

/**
 * Maps display headers to fallback SQLite identifiers. Mapping is positional and deterministic:
 * physical collisions use _2, _3 suffixes in header order. Callers must reject duplicate
 * canonical display names before a persistence or migration operation.
 */
export function mapSqlColumnIdentifiers_ACU(headers: readonly unknown[]): SqlColumnMappingResult_ACU {
  const usedSqlNames = new Set<string>();
  const firstCanonicalIndex = new Map<string, number>();
  const mappings: SqlColumnMapping_ACU[] = [];
  const diagnostics: SqlIdentifierDiagnostic_ACU[] = [];
  const firstHeaderCanonicalName = canonicalizeDisplayName_ACU(headers[0]);
  // visualizer 的不可编辑 row_id 占位也是 null（content[0][0] === null），
  // 与 row_id 精确匹配等价，视为 row_id 身份。
  const firstIsRowIdPlaceholder = headers[0] === null || headers[0] === undefined;
  if (!firstIsRowIdPlaceholder && firstHeaderCanonicalName !== 'row_id') {
    diagnostics.push({
      code: 'missing_row_id', index: 0, originalName: String(headers[0] ?? ''),
      normalizedDisplayName: String(headers[0] ?? '').normalize('NFKC').trim(),
      canonicalName: firstHeaderCanonicalName, candidateSqlName: null,
    });
  }

  headers.forEach((header, index) => {
    const originalName = String(header ?? '');
    const displayName = originalName.normalize('NFKC').trim();
    const canonicalName = canonicalizeDisplayName_ACU(displayName);
    const isRowId = index === 0 && (canonicalName === 'row_id' || header === null || header === undefined);
    const firstIndex = canonicalName ? firstCanonicalIndex.get(canonicalName) : undefined;
    // 首列 null 占位视为合法 row_id 身份，不报 empty_column_name；
    // 其余列（含非首列的空/空白）仍 fail-closed。
    if (!canonicalName && !isRowId) {
      diagnostics.push({ code: 'empty_column_name', index, originalName, normalizedDisplayName: displayName, canonicalName, candidateSqlName: null });
    } else if (firstIndex === undefined) {
      firstCanonicalIndex.set(canonicalName, index);
    } else {
      diagnostics.push({ code: 'duplicate_canonical_column_name', index, originalName, normalizedDisplayName: displayName, canonicalName, candidateSqlName: null, conflictsWithIndex: firstIndex });
    }

    const baseName = isRowId ? 'row_id' : toSqlIdentifierBase_ACU(displayName, index);
    const sqlName = isRowId
      ? reserveRowId_ACU(usedSqlNames, index)
      : reserveSqlName_ACU(baseName, usedSqlNames);
    if (!isRowId && canonicalName === 'row_id') {
      diagnostics.push({ code: 'misplaced_row_id', index, originalName, normalizedDisplayName: displayName, canonicalName, candidateSqlName: sqlName });
    }
    mappings.push({ index, displayName, canonicalName, sqlName, isRowId });
  });
  return { mappings, diagnostics };
}

export function toSqlIdentifierBase_ACU(displayName: unknown, index = 0): string {
  const slug = toAsciiSlug_ACU(displayName);
  const normalized = slug.replace(/^\d+/, match => `col_${match}`);
  if (normalized === 'row_id' || SQLITE_RESERVED_IDENTIFIERS_ACU.has(normalized)) return `col_${normalized}`;
  return normalized || `col_${index + 1}`;
}

function reserveRowId_ACU(usedSqlNames: Set<string>, index: number): string {
  if (index === 0 && !usedSqlNames.has('row_id')) {
    usedSqlNames.add('row_id');
    return 'row_id';
  }
  return reserveSqlName_ACU('row_id', usedSqlNames);
}

function reserveSqlName_ACU(baseName: string, usedSqlNames: Set<string>): string {
  let candidate = baseName;
  let suffix = 2;
  while (usedSqlNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  usedSqlNames.add(candidate.toLowerCase());
  return candidate;
}

const SQLITE_RESERVED_IDENTIFIERS_ACU = new Set([
  'abort', 'action', 'add', 'after', 'all', 'alter', 'analyze', 'and', 'as', 'asc', 'attach',
  'autoincrement', 'before', 'begin', 'between', 'by', 'cascade', 'case', 'cast', 'check',
  'collate', 'column', 'commit', 'conflict', 'constraint', 'create', 'cross', 'current_date',
  'current', 'current_time', 'current_timestamp', 'database', 'default', 'deferrable', 'deferred', 'delete',
  'desc', 'detach', 'distinct', 'drop', 'each', 'else', 'end', 'escape', 'except', 'exclude',
  'exclusive', 'exists', 'explain', 'fail', 'filter', 'first', 'following', 'for', 'foreign',
  'from', 'full', 'generated', 'glob', 'group', 'groups', 'having', 'if', 'ignore', 'immediate', 'in',
  'index', 'indexed', 'initially', 'inner', 'insert', 'instead', 'intersect', 'into', 'is',
  'isnull', 'join', 'key', 'last', 'left', 'like', 'limit', 'match', 'materialized', 'natural', 'no', 'not',
  'nothing', 'notnull', 'null', 'nulls', 'of', 'offset', 'on', 'or', 'order', 'others', 'outer',
  'over', 'partition', 'plan', 'pragma', 'preceding', 'primary', 'query', 'raise', 'range',
  'recursive', 'references', 'regexp', 'reindex', 'release', 'rename', 'replace', 'restrict',
  'returning', 'right', 'rollback', 'row', 'rowid', 'rows', 'savepoint', 'select', 'set', 'table', 'temp',
  'temporary', 'then', 'ties', 'to', 'transaction', 'trigger', 'unbounded', 'union', 'unique',
  'update', 'using', 'vacuum', 'values', 'view', 'virtual', 'when', 'where', 'window', 'with',
  'without',
]);
