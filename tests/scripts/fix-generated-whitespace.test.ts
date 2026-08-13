import { describe, expect, it } from 'vitest';
import { normalizeGeneratedWhitespace_ACU } from '../../scripts/fix-generated-whitespace.mjs';

describe('fix-generated-whitespace', () => {
  it('清理普通代码上下文中的 space-before-tab 缩进和纯闭合代码行尾空白', () => {
    const input = [
      'function demo() {',
      '    \tconst value = 1;',
      '\t\t} ',
      '}',
      '',
    ].join('\n');

    const result = normalizeGeneratedWhitespace_ACU(input);

    expect(result.text).toBe([
      'function demo() {',
      '\tconst value = 1;',
      '\t\t}',
      '}',
      '',
    ].join('\n'));
    expect(result.fixedIndentLineCount).toBe(1);
    expect(result.fixedClosingLineCount).toBe(1);
  });

  it('不改写模板字符串中的行首 space+tab 和纯闭合文本行', () => {
    const input = 'const text = `\n    \tliteral\n  } \n`;\n    \tconst value = 1;\n';
    const result = normalizeGeneratedWhitespace_ACU(input);

    expect(result.text).toBe('const text = `\n    \tliteral\n  } \n`;\n\tconst value = 1;\n');
    expect(result.fixedIndentLineCount).toBe(1);
    expect(result.fixedClosingLineCount).toBe(0);
  });

  it('不改写单引号、双引号和块注释覆盖的物理行', () => {
    const input = [
      "const single = 'open",
      '    \tstill string',
      "end';",
      'const double = "open',
      '  } ',
      'end";',
      '/* block',
      '    \tcomment',
      '  } ',
      '*/',
      '    \tconst value = 1;',
      '',
    ].join('\n');

    const result = normalizeGeneratedWhitespace_ACU(input);

    expect(result.text).toBe([
      "const single = 'open",
      '    \tstill string',
      "end';",
      'const double = "open',
      '  } ',
      'end";',
      '/* block',
      '    \tcomment',
      '  } ',
      '*/',
      '\tconst value = 1;',
      '',
    ].join('\n'));
    expect(result.fixedIndentLineCount).toBe(1);
    expect(result.fixedClosingLineCount).toBe(0);
  });
});
