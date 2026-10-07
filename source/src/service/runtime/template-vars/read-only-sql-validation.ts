export interface ReadOnlySqlValidationResult_ACU {
  valid: boolean;
  reason?: string;
}

// END（CASE … END）与 REPLACE（REPLACE() 函数）不在词表：它们在只读查询里很常见；作为语句开头
// （END TRANSACTION / REPLACE INTO）时过不了下面的首关键字判定，WITH 后的主语句另有顶层判定。
// 真正的写入兜底在引擎层：executeQuery 以单语句 + query_only 执行。
const FORBIDDEN_SQL_KEYWORDS_ACU = new Set([
  'ALTER', 'ANALYZE', 'ATTACH', 'BEGIN', 'COMMIT', 'CREATE', 'DELETE', 'DETACH',
  'DROP', 'INSERT', 'REINDEX', 'RELEASE', 'ROLLBACK', 'SAVEPOINT',
  'TRUNCATE', 'UPDATE', 'VACUUM',
]);

/** WITH 语句的主语句（括号深度 0 的首个 DML/SELECT 关键字）必须是 SELECT 或 VALUES。 */
function withMainStatementIsRead_ACU(normalized: string): boolean {
  let depth = 0;
  const tokens = normalized.toUpperCase().match(/[A-Z_]+|[()]/g) || [];
  for (const token of tokens) {
    if (token === '(') { depth++; continue; }
    if (token === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue;
    if (token === 'SELECT' || token === 'VALUES') return true;
    if (token === 'INSERT' || token === 'UPDATE' || token === 'DELETE' || token === 'REPLACE') return false;
  }
  return false;
}

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
    // SQLite 的 [方括号] 标识符：内部没有转义，读到 ] 结束；里面的引号不是字符串开头。
    if (char === '[') {
      index++;
      while (index < sql.length && sql[index] !== ']') index++;
      index = Math.min(sql.length, index + 1);
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

  const body = normalized.replace(/^EXPLAIN\s+(?:QUERY\s+PLAN\s+)?/i, '');
  if (/^WITH\b/i.test(body)) return withMainStatementIsRead_ACU(body) ? { valid: true } : { valid: false, reason: 'statement_not_read_only' };
  if (/^SELECT\b/i.test(body)) return { valid: true };
  return { valid: false, reason: 'statement_not_read_only' };
}

/** Shared read-path classifier. Callers that need a diagnostic should use validateReadOnlySql_ACU directly. */
export function isReadOnlySqlStatement_ACU(sql: unknown): boolean {
  return validateReadOnlySql_ACU(sql).valid;
}
