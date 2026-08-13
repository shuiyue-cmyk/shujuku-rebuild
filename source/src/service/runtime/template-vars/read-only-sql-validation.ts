export interface ReadOnlySqlValidationResult_ACU {
  valid: boolean;
  reason?: string;
}

const FORBIDDEN_SQL_KEYWORDS_ACU = new Set([
  'ALTER', 'ANALYZE', 'ATTACH', 'BEGIN', 'COMMIT', 'CREATE', 'DELETE', 'DETACH',
  'DROP', 'END', 'INSERT', 'REINDEX', 'RELEASE', 'REPLACE', 'ROLLBACK', 'SAVEPOINT',
  'TRUNCATE', 'UPDATE', 'VACUUM',
]);

const ALLOWED_PRAGMAS_ACU = new Set([
  'table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list',
]);

function stripSqlCommentsAndStrings_ACU(sql: string): string {
  let result = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n') index++;
      result += ' ';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index++;
      index = Math.min(sql.length, index + 2);
      result += ' ';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      index++;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index++;
          break;
        }
        index++;
      }
      result += ' ';
      continue;
    }
    result += char;
    index++;
  }
  return result;
}

function hasMultipleStatements_ACU(sql: string): boolean {
  const stripped = stripSqlCommentsAndStrings_ACU(sql).trim();
  const withoutTrailingTerminator = stripped.replace(/;\s*$/, '');
  return withoutTrailingTerminator.includes(';');
}

export function validateReadOnlySql_ACU(sql: unknown): ReadOnlySqlValidationResult_ACU {
  const source = String(sql || '').trim();
  if (!source) return { valid: false, reason: 'empty_sql' };
  if (hasMultipleStatements_ACU(source)) return { valid: false, reason: 'multiple_statements' };

  const normalized = stripSqlCommentsAndStrings_ACU(source).replace(/;\s*$/, '').trim();
  const tokens = normalized.toUpperCase().match(/[A-Z_]+/g) || [];
  if (tokens.some(token => FORBIDDEN_SQL_KEYWORDS_ACU.has(token))) {
    return { valid: false, reason: 'write_or_maintenance_statement' };
  }

  const pragmaMatch = normalized.match(/^PRAGMA\s+([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?\s*$/i);
  if (pragmaMatch) {
    if (!ALLOWED_PRAGMAS_ACU.has(pragmaMatch[1].toLowerCase())) return { valid: false, reason: 'pragma_not_allowed' };
    if (!String(pragmaMatch[2] || '').trim()) return { valid: false, reason: 'pragma_argument_required' };
    if (/=/.test(normalized)) return { valid: false, reason: 'pragma_assignment_not_allowed' };
    return { valid: true };
  }

  if (/^EXPLAIN\s+(?:QUERY\s+PLAN\s+)?(?:SELECT\b|WITH\b)/i.test(normalized)) return { valid: true };
  if (/^(?:SELECT\b|WITH\b)/i.test(normalized)) return { valid: true };
  return { valid: false, reason: 'statement_not_read_only' };
}

/** Shared read-path classifier. Callers that need a diagnostic should use validateReadOnlySql_ACU directly. */
export function isReadOnlySqlStatement_ACU(sql: unknown): boolean {
  return validateReadOnlySql_ACU(sql).valid;
}
