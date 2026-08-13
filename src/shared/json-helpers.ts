/**
 * shared/json-helpers.ts — JSON 安全解析/序列化工具
 *
 * 零副作用、零全局依赖。
 * safeJsonParse/safeJsonStringify 从 src/core/02_storage_and_profile.js 迁移而来。
 *
 * 注意：02_api_call.js 中的 JSON 清洗管线（normalizeQuotesLayer 等 ~15 个函数）
 * 目前嵌套在 parseAndApplyTableEdits_ACU 闭包内，暂不迁移，等阶段 5 整体重构时拆出。
 */

/**
 * 安全 JSON 解析（失败时返回 fallback 而不抛异常）
 */
export function safeJsonParse_ACU(str: string, fallback: any = null): any {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

/**
 * 剥离 JSONC 风格注释，但保留 JSON 字符串里的双斜杠与块注释标记文本。
 *
 * 不能用简单的行注释正则；URL 会被切断，事故就是这么来的。
 */
export function stripJsonCommentsPreservingStrings_ACU(input: string): string {
  if (typeof input !== 'string' || !input) return input;

  let result = '';
  let inString = false;
  let escapeNext = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextChar = input[i + 1] || '';

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (inString) {
      result += char;
      if (char === '\\') {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === '/' && nextChar === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++;
      result += ' ';
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * 安全 JSON/JSONC 解析：优先按标准 JSON 解析，失败后仅剥离字符串外注释再解析。
 */
export function safeJsonParseWithJsoncComments_ACU(str: string, fallback: any = null): any {
  try { return JSON.parse(str); } catch (e) {}
  try { return JSON.parse(stripJsonCommentsPreservingStrings_ACU(str)); } catch (e) { return fallback; }
}

/**
 * 安全 JSON 序列化（失败时返回 fallback 而不抛异常）
 */
export function safeJsonStringify_ACU(obj: any, fallback: string = '{}'): string {
  try { return JSON.stringify(obj); } catch (e) { return fallback; }
}
