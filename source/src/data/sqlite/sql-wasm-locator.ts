/**
 * data/sqlite/sql-wasm-locator.ts
 * sql.js WASM 文件的 URL 解析（多形态）：
 * 1. 显式覆盖：globalThis.ACU_SQL_WASM_URL_ACU（仅 http/https，否则忽略并警告）；
 * 2. 扩展形态：import.meta.url 可用时取所在目录；
 * 3. 托管形态：document.currentScript 或按已知产物名匹配 <script src>；
 * 4. 兜底：当前页面目录（而非硬编码根路径，避免子路径部署 404）。
 *
 * 日志只输出 origin + pathname，不打印 query，避免泄露参数。
 */
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
/** 已知油猴/扩展产物名，用于托管形态定位当前脚本所在目录。 */
const KNOWN_SCRIPT_NAMES_ACU = [
  'index.bundle.js',
  'index.js',
  'acu-database.js',
  'database.js',
];

function isNodeRuntime_ACU(): boolean {
  try {
    const nodeProcess = (globalThis as any).process;
    return typeof nodeProcess !== 'undefined' && !!nodeProcess?.versions?.node;
  } catch {
    return false;
  }
}

/** Node 测试环境：从 import.meta.url 向上找到仓库 node_modules/sql.js/dist。
 *  纯 URL 构造（不依赖 fs/require），node 分支在浏览器打包后不可达（isNodeRuntime_ACU=false）。 */
function resolveFromNodeModules_ACU(fileName: string): string | null {
  if (!isNodeRuntime_ACU()) return null;
  try {
    return new URL('../../../node_modules/sql.js/dist/' + fileName, import.meta.url).toString();
  } catch {
    return null;
  }
}

function safeDocument_ACU(): Document | null {
  try {
    return typeof document !== 'undefined' ? document : null;
  } catch {
    return null;
  }
}

function safeLocation_ACU(): Location | null {
  try {
    return typeof location !== 'undefined' ? location : null;
  } catch {
    return null;
  }
}


/** 从 URL 推导目录（去掉末尾文件名）。 */
function directoryOfUrl_ACU(url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    segments.pop();
    parsed.pathname = segments.join('/') + '/';
    return parsed.toString();
  } catch {
    return null;
  }
}

/** 显式覆盖：globalThis.ACU_SQL_WASM_URL_ACU。 */
function resolveFromExplicitOverride_ACU(fileName: string): string | null {
  try {
    const override = (globalThis as any).ACU_SQL_WASM_URL_ACU;
    if (typeof override !== 'string' || !override.trim()) return null;
    const trimmed = override.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      logWarn_ACU('[SQLite] ACU_SQL_WASM_URL_ACU 不是合法 URL，已忽略:', trimmed);
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      logWarn_ACU('[SQLite] ACU_SQL_WASM_URL_ACU 仅支持 http/https 协议，已忽略:', trimmed);
      return null;
    }
    // 覆盖值视为目录：只保留 origin + pathname（丢弃 query/hash），末尾补斜杠
    const pathname = parsed.pathname.endsWith('/') ? parsed.pathname : parsed.pathname + '/';
    const base = parsed.origin + pathname;
    return new URL(fileName, base).toString();
  } catch {
    return null;
  }
}

/** 扩展形态：import.meta.url 所在目录。 */
function resolveFromImportMetaUrl_ACU(fileName: string): string | null {
  try {
    if (typeof import.meta === 'undefined' || !import.meta.url) return null;
    return directoryOfUrl_ACU(import.meta.url) ? new URL(fileName, directoryOfUrl_ACU(import.meta.url)!).toString() : null;
  } catch {
    return null;
  }
}

/** 托管形态：document.currentScript 或按已知产物名匹配 <script src>。 */
function resolveFromHostedScript_ACU(fileName: string): string | null {
  const doc = safeDocument_ACU();
  if (!doc) return null;
  try {
    const currentScript = (doc as any).currentScript as HTMLScriptElement | null;
    if (currentScript?.src) {
      const dir = directoryOfUrl_ACU(currentScript.src);
      if (dir) return new URL(fileName, dir).toString();
    }
    const scripts = Array.from(doc.querySelectorAll('script[src]')) as HTMLScriptElement[];
    for (const script of scripts) {
      const src = String(script.src || '');
      if (KNOWN_SCRIPT_NAMES_ACU.some((name) => src.includes(name))) {
        const dir = directoryOfUrl_ACU(src);
        if (dir) return new URL(fileName, dir).toString();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 兜底：当前页面目录。 */
function resolveFromPageDirectory_ACU(fileName: string): string | null {
  const loc = safeLocation_ACU();
  if (!loc) return null;
  try {
    const base = loc.origin + loc.pathname.replace(/\/[^/]*$/, '/');
    return new URL(fileName, base).toString();
  } catch {
    return null;
  }
}

/**
 * 解析 sql.js 运行时请求的 wasm 文件 URL。
 * @param fileName 运行时传入的文件名，通常是 'sql-wasm.wasm'
 */
export function resolveSqlWasmUrl_ACU(fileName: string): string {
  const candidates = [
    resolveFromExplicitOverride_ACU(fileName),
    resolveFromNodeModules_ACU(fileName),
    resolveFromImportMetaUrl_ACU(fileName),
    resolveFromHostedScript_ACU(fileName),
    resolveFromPageDirectory_ACU(fileName),
  ];
  const resolved = candidates.find((value): value is string => !!value);
  if (!resolved) {
    // 无 location 环境（如 Node 测试）：退化为纯文件名，由调用方决定是否可用
    return fileName;
  }
  try {
    const url = new URL(resolved);
    logDebug_ACU('[SQLite] wasm 解析: ' + url.origin + url.pathname);
  } catch {
    // 忽略日志失败
  }
  return resolved;
}
