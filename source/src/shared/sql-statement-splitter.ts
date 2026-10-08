/**
 * SQL 分句器的唯一实现（R1-05）。写入期（AI 填表、运行时日志、受限 DML、SQL API）与回放期
 * 必须用同一份切分口径，否则同一段 SQL 写入时与回放时切出不同的语句，结果分叉。
 *
 * - 引号：'…'、"…"、`…`（成对引号转义 '' "" ``）与 […] 内的分号、注释符号都不算数；
 * - 注释：-- 到行尾、/* … *\/ 按 SQLite 语义视为空白并从结果中剥除——注释里的分号不再把语句切断，
 *   只剩注释的片段也不会变成一条「语句」；
 * - 结果逐条 trim，空语句丢弃。
 */
export interface SplitSqlStatementsOptions_ACU {
  /** 字符串字面量未闭合时抛错（受限 DML 需要）；默认宽容，把剩余文本归入最后一条语句。 */
  strictQuotes?: boolean;
}

export function splitSqlStatements_ACU(sql: string, options: SplitSqlStatementsOptions_ACU = {}): string[] {
  const source = String(sql ?? '');
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;
  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      current += char;
      if (char === quote) {
        // 方括号标识符没有转义；其余引号成对出现即转义。
        if (quote !== ']' && next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      const lineEnd = source.indexOf('\n', index + 2);
      if (lineEnd === -1) break;
      current += '\n';
      index = lineEnd;
      continue;
    }
    if (char === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      current += ' ';
      if (commentEnd === -1) break;
      index = commentEnd + 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[') {
      quote = ']';
      current += char;
      continue;
    }
    if (char === ';') {
      pushCurrent();
      continue;
    }
    current += char;
  }

  if (quote && options.strictQuotes) throw new Error('SQL 字符串字面量未闭合');
  pushCurrent();
  return statements;
}
