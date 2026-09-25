/**
 * SQL/DSL 协议标记清理。
 *
 * `<tableEdit>` 允许使用 HTML 注释包裹正文，但 SQL 字符串字面量、注释和
 * quoted identifier 中的同名文本属于用户数据，不能用全局正则删除。
 */
export function stripHtmlCommentMarkersOutsideSqlLiterals_ACU(input: string): string {
  const text = String(input ?? '');
  let output = '';
  let index = 0;
  type State = 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line_comment' | 'block_comment';
  let state: State = 'normal';

  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];

    if (state === 'normal') {
      if (text.startsWith('<!--', index)) {
        index += 4;
        continue;
      }
      if (text.startsWith('-->', index)) {
        index += 3;
        continue;
      }
      if (char === '-' && next === '-') {
        output += char;
        index += 1;
        state = 'line_comment';
        continue;
      }
      if (char === '/' && next === '*') {
        output += char;
        index += 1;
        state = 'block_comment';
        continue;
      }
      if (char === "'") {
        output += char;
        index += 1;
        state = 'single';
        continue;
      }
      if (char === '"') {
        output += char;
        index += 1;
        state = 'double';
        continue;
      }
      if (char === '`') {
        output += char;
        index += 1;
        state = 'backtick';
        continue;
      }
      if (char === '[') {
        output += char;
        index += 1;
        state = 'bracket';
        continue;
      }
      output += char;
      index += 1;
      continue;
    }

    if (state === 'line_comment') {
      output += char;
      index += 1;
      if (char === '\n' || char === '\r') state = 'normal';
      continue;
    }

    if (state === 'block_comment') {
      if (char === '*' && next === '/') {
        output += char;
        output += next;
        index += 2;
        state = 'normal';
        continue;
      }
      output += char;
      index += 1;
      continue;
    }

    // SQL quoted strings/identifiers use doubled closing characters. Copy
    // them verbatim and only leave the quote state on an unescaped terminator.
    if (state === 'bracket' && char === ']' && next === ']') {
      output += char;
      output += next;
      index += 2;
      continue;
    }

    if (
      (state === 'single' && char === "'")
      || (state === 'double' && char === '"')
      || (state === 'backtick' && char === '`')
      || (state === 'bracket' && char === ']')
    ) {
      output += char;
      index += 1;
      if (index < text.length && text[index] === char) {
        output += text[index];
        index += 1;
        continue;
      }
      state = 'normal';
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}
