/**
 * ORM 模板表达式解释器（R3-02）。
 *
 * {[db....]} / <if db="..."> 的表达式来自聊天正文、世界书等不可信文本；此前用 `new Function`
 * 执行、只靠正则白名单把关，标签模板 + 计算属性即可绕过并执行任意 JS。这里改为自己解析：
 * 只认「db 方法链 + 字面量参数 + 可选的末尾比较」，从不把文本交给 JS 引擎执行。
 *
 * 语法：
 *   expr    := chain (compareOp literal)?
 *   chain   := 'db' ( '.' ident ( '(' args? ')' )? | '[' literal ']' )*
 *   args    := value (',' value)*
 *   value   := literal | '[' (literal (',' literal)*)? ']'
 *   literal := string | number | true | false | null
 */

type Token_ACU =
  | { kind: 'ident'; text: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'punct'; text: string };

const COMPARE_OPERATORS_ACU = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<'] as const;
type CompareOperator_ACU = typeof COMPARE_OPERATORS_ACU[number];

const FORBIDDEN_NAMES_ACU = new Set(['__proto__', 'prototype', 'constructor', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);

const IDENT_START_RE_ACU = /[A-Za-z_$一-龥]/;
const IDENT_PART_RE_ACU = /[\w$一-龥]/;

function fail_ACU(message: string): never {
  throw new Error(`db 表达式不合法：${message}`);
}

function readEscape_ACU(source: string, index: number): { char: string; next: number } {
  const char = source[index];
  const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', f: '\f', v: '\v' };
  if (char in simple) return { char: simple[char], next: index + 1 };
  if (char === 'u') {
    const hex = source.slice(index + 1, index + 5);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail_ACU('非法的 \\u 转义');
    return { char: String.fromCharCode(parseInt(hex, 16)), next: index + 5 };
  }
  if (char === 'x') {
    const hex = source.slice(index + 1, index + 3);
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail_ACU('非法的 \\x 转义');
    return { char: String.fromCharCode(parseInt(hex, 16)), next: index + 3 };
  }
  if (char === undefined) fail_ACU('字符串未闭合');
  return { char, next: index + 1 };
}

function tokenize_ACU(source: string): Token_ACU[] {
  const tokens: Token_ACU[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === "'" || char === '"') {
      let value = '';
      index++;
      while (true) {
        if (index >= source.length) fail_ACU('字符串未闭合');
        const current = source[index];
        if (current === char) { index++; break; }
        if (current === '\\') {
          const escaped = readEscape_ACU(source, index + 1);
          value += escaped.char;
          index = escaped.next;
          continue;
        }
        value += current;
        index++;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    const numberMatch = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (numberMatch) {
      tokens.push({ kind: 'number', value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }
    if (IDENT_START_RE_ACU.test(char)) {
      let text = char;
      index++;
      while (index < source.length && IDENT_PART_RE_ACU.test(source[index])) text += source[index++];
      tokens.push({ kind: 'ident', text });
      continue;
    }
    const operator = COMPARE_OPERATORS_ACU.find(op => source.startsWith(op, index));
    if (operator) {
      tokens.push({ kind: 'punct', text: operator });
      index += operator.length;
      continue;
    }
    if ('.()[],-'.includes(char)) {
      tokens.push({ kind: 'punct', text: char });
      index++;
      continue;
    }
    fail_ACU(`不支持的字符 ${JSON.stringify(char)}`);
  }
  return tokens;
}

type Step_ACU =
  | { kind: 'member'; name: string }
  | { kind: 'call'; name: string; args: unknown[] }
  | { kind: 'index'; key: string | number };

interface ParsedDbExpression_ACU {
  steps: Step_ACU[];
  compare?: { operator: CompareOperator_ACU; right: unknown };
}

function parse_ACU(tokens: Token_ACU[]): ParsedDbExpression_ACU {
  let position = 0;
  const peek = () => tokens[position];
  const isPunct = (text: string) => { const token = peek(); return token?.kind === 'punct' && token.text === text; };
  const expectPunct = (text: string) => { if (!isPunct(text)) fail_ACU(`缺少 ${text}`); position++; };

  const parseLiteral = (): unknown => {
    const token = peek();
    if (!token) fail_ACU('缺少值');
    if (token.kind === 'punct' && token.text === '-') {
      position++;
      const next = peek();
      if (next?.kind !== 'number') fail_ACU('负号后必须是数字');
      position++;
      return -next.value;
    }
    if (token.kind === 'string' || token.kind === 'number') { position++; return token.value; }
    if (token.kind === 'ident' && ['true', 'false', 'null'].includes(token.text)) {
      position++;
      return token.text === 'true' ? true : token.text === 'false' ? false : null;
    }
    return fail_ACU('参数只能是字符串、数字、true/false/null 或它们组成的数组');
  };
  const parseValue = (): unknown => {
    if (!isPunct('[')) return parseLiteral();
    position++;
    const items: unknown[] = [];
    if (!isPunct(']')) {
      items.push(parseLiteral());
      while (isPunct(',')) { position++; items.push(parseLiteral()); }
    }
    expectPunct(']');
    return items;
  };

  const head = peek();
  if (head?.kind !== 'ident' || head.text !== 'db') fail_ACU('必须以 db. 开头');
  position++;
  const steps: Step_ACU[] = [];
  while (isPunct('.') || isPunct('[')) {
    if (isPunct('[')) {
      position++;
      const key = parseLiteral();
      if (typeof key !== 'string' && typeof key !== 'number') fail_ACU('下标只能是字符串或数字');
      expectPunct(']');
      steps.push({ kind: 'index', key });
      continue;
    }
    position++;
    const name = peek();
    if (name?.kind !== 'ident') fail_ACU('. 后必须是名称');
    position++;
    if (!isPunct('(')) { steps.push({ kind: 'member', name: name.text }); continue; }
    position++;
    const args: unknown[] = [];
    if (!isPunct(')')) {
      args.push(parseValue());
      while (isPunct(',')) { position++; args.push(parseValue()); }
    }
    expectPunct(')');
    steps.push({ kind: 'call', name: name.text, args });
  }
  if (!steps.length) fail_ACU('db 后缺少表名或方法');
  let compare: ParsedDbExpression_ACU['compare'];
  const operatorToken = peek();
  if (operatorToken?.kind === 'punct' && (COMPARE_OPERATORS_ACU as readonly string[]).includes(operatorToken.text)) {
    position++;
    compare = { operator: operatorToken.text as CompareOperator_ACU, right: parseLiteral() };
  }
  if (position !== tokens.length) fail_ACU('表达式末尾有多余内容');
  return { steps, compare };
}

export interface DbExpressionEnvironment_ACU {
  /** db 根对象：取属性得到表查询构建器或静态函数。 */
  root: Record<string, unknown>;
  /** 判断某对象上的某方法是否允许调用（构建器方法或 db 静态函数）。 */
  isCallable: (target: unknown, name: string) => boolean;
}

function readMember_ACU(target: unknown, name: string | number, env: DbExpressionEnvironment_ACU, isRoot: boolean): unknown {
  if (typeof name === 'string' && FORBIDDEN_NAMES_ACU.has(name)) fail_ACU(`禁止访问 ${name}`);
  if (isRoot) return env.root[String(name)];
  if (Array.isArray(target)) {
    if (name === 'length') return target.length;
    const index = typeof name === 'number' ? name : Number(name);
    return Number.isInteger(index) && index >= 0 && index < target.length ? target[index] : undefined;
  }
  if (typeof target === 'string' && name === 'length') return target.length;
  if (target && typeof target === 'object' && Object.getPrototypeOf(target) === Object.prototype) {
    return Object.prototype.hasOwnProperty.call(target, name) ? (target as Record<string, unknown>)[String(name)] : undefined;
  }
  return fail_ACU(`不能读取 ${String(name)}`);
}

function compare_ACU(left: unknown, operator: CompareOperator_ACU, right: unknown): unknown {
  /* eslint-disable eqeqeq */
  switch (operator) {
    case '===': return left === right;
    case '!==': return left !== right;
    case '==': return left == right;
    case '!=': return left != right;
    case '>=': return (left as number) >= (right as number);
    case '<=': return (left as number) <= (right as number);
    case '>': return (left as number) > (right as number);
    case '<': return (left as number) < (right as number);
    case '&&': return left && right;
    case '||': return left || right;
  }
  /* eslint-enable eqeqeq */
}

/**
 * 解析并求值一条 db 表达式。语法不合法、访问禁止成员或调用未授权方法时抛错。
 * @param expression 以 db. 开头的表达式（$v: 引用须已替换）
 * @param env db 根对象与可调用方法判定
 * @returns 求值结果
 */
export function evaluateDbExpression_ACU(expression: string, env: DbExpressionEnvironment_ACU): unknown {
  const parsed = parse_ACU(tokenize_ACU(String(expression ?? '')));
  let current: unknown = env.root;
  let isRoot = true;
  for (const step of parsed.steps) {
    if (step.kind === 'index') {
      current = readMember_ACU(current, step.key, env, isRoot);
    } else if (step.kind === 'member') {
      current = readMember_ACU(current, step.name, env, isRoot);
      if (typeof current === 'function') fail_ACU(`${step.name} 是方法，需要加括号调用`);
    } else {
      if (FORBIDDEN_NAMES_ACU.has(step.name)) fail_ACU(`禁止调用 ${step.name}`);
      const owner = current;
      const method = isRoot ? env.root[step.name] : (owner as Record<string, unknown> | null | undefined)?.[step.name];
      if (typeof method !== 'function' || !env.isCallable(isRoot ? env.root : owner, step.name)) fail_ACU(`不允许调用 ${step.name}`);
      current = (method as (...args: unknown[]) => unknown).apply(isRoot ? undefined : owner, step.args);
    }
    isRoot = false;
  }
  return parsed.compare ? compare_ACU(current, parsed.compare.operator, parsed.compare.right) : current;
}
