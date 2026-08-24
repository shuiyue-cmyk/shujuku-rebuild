/**
 * shared/log-buffer.ts — 日志缓冲区
 *
 * 零 DOM 依赖的内存日志存储。
 * Error 始终写入；Debug / Warn 仅在对应采集开关开启时写入。
 * presentation 层通过 subscribe 实时接收已写入的新日志并渲染到 UI。
 */

import { readWarnLogEnabled } from './v2-ui-state';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type LogLevel = 'debug' | 'warn' | 'error';

export interface LogEntry {
  /** 自增 ID（用于去重和排序） */
  id: number;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 日志级别 */
  level: LogLevel;
  /** 模块标签（从消息中提取的 [xxx] 部分，如 "SQL"、"ORM"、"条件模板"） */
  tag: string;
  /** 完整的日志消息（所有 args 拼接后的字符串） */
  message: string;
}

export type LogSubscriber = (entry: LogEntry) => void;

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 缓冲区最大容量（环形覆盖：超过时覆盖最旧日志，写入 O(1) 无拷贝） */
const MAX_BUFFER_SIZE = 50000;

/** 未分类标签 */
const UNCATEGORIZED_TAG = '未分类';

// ═══════════════════════════════════════════════════════════════
// 内部状态
// ═══════════════════════════════════════════════════════════════

/** 日志缓冲区（环形数组，固定容量） */
let _buffer: (LogEntry | undefined)[] = new Array(MAX_BUFFER_SIZE);
/** 环形写入游标（下一个写入位置） */
let _writeIndex = 0;
/** 当前缓冲区中的有效条数 */
let _count = 0;

/** 自增 ID 计数器 */
let _nextId = 1;

/** 订阅者列表 */
const _subscribers: Set<LogSubscriber> = new Set();

/** 已出现过的所有标签（供 UI 过滤器使用） */
const _knownTags: Set<string> = new Set();

/** debug 级别日志是否写入缓冲区（默认关闭，减少性能开销） */
let _debugLogEnabled = false;

/** warn 级别日志是否写入缓冲区（默认关闭，用户显式开启后才采集） */
let _warnLogEnabled = readWarnLogEnabled();

// ═══════════════════════════════════════════════════════════════
// 公共 API
// ═══════════════════════════════════════════════════════════════

/**
 * 从日志参数中提取模块标签
 * 匹配第一个参数中的 [xxx] 格式，如 "[SQL]"、"[ORM]"、"[条件模板]"
 * 注意：第一个 arg 通常是 `[ACU]` 前缀（由 logDebug_ACU 等函数添加），
 * 模块标签在第二个 arg 中，格式为 "[模块名] 消息内容"
 */
export function extractTag(args: any[]): string {
  // args[0] 是 "[ACU]" 前缀，args[1] 开始是实际消息
  // 实际消息格式通常是 "[模块名] 消息内容" 或直接是消息内容
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg === 'string') {
      const match = arg.match(/^\[([^\]]+)\]/);
      if (match) {
        return match[1];
      }
    }
  }
  // 如果 args[1] 不含标签，检查 args[0]（可能没有 ACU 前缀的情况）
  if (args.length > 0 && typeof args[0] === 'string') {
    const match = args[0].match(/^\[([^\]]+)\]/);
    if (match && match[1] !== 'ACU') {
      return match[1];
    }
  }
  return UNCATEGORIZED_TAG;
}

const LOG_SENSITIVE_KEYS = /^(api[_-]?key|apikey|key|token|authorization|auth|password|proxy[_-]?password|secret|bearer|accessToken|access_token)$/i;

function maskSensitiveInLogValue(value: any, depth = 0, seen = new WeakSet()): any {
  if (typeof value === 'string') {
    return value
      .replace(/(Authorization\s*:\s*Bearer\s+)([^\s"',}\n]+)/gi, '$1***')
      .replace(/(Bearer\s+)(sk-[A-Za-z0-9-_]+)/g, '$1***')
      .replace(/("(?:api[_-]?key|apikey|authorization|token|password|secret)"\s*:\s*")([^"]+)(")/gi, '$1***$3');
  }
  if (depth > 6 || value === null || value === undefined) return depth > 6 ? '[Truncated]' : value;
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 200) return `[Array(${value.length}) truncated]`;
    return value.map((v) => maskSensitiveInLogValue(v, depth + 1, seen));
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (LOG_SENSITIVE_KEYS.test(k)) out[k] = '***';
      else out[k] = maskSensitiveInLogValue(v, depth + 1, seen);
    }
    return out;
  }
  return value;
}

function normalizeLogArg_ACU(arg: any): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') {
    return arg
      .replace(/(Authorization\s*:\s*Bearer\s+)([^\s"',}\n]+)/gi, '$1***')
      .replace(/(Bearer\s+)(sk-[A-Za-z0-9-_]+)/g, '$1***')
      .replace(/\"(api[_-]?key|apikey|authorization|token|password|secret|auth|bearer|accessToken|access_token)\"\s*:\s*\"[^\"]*\"/gi, '\"$1\":\"***\"')
      // [L4] 裸形态脱敏：apiKey=xxx / token: xxx（键与值均不带引号的日志形态）。
      // 值若以 bearer 开头（如 Authorization: Bearer xxx）交由上方既有规则处理，避免双重掩码。
      .replace(/\b(api[_-]?key|apikey|authorization|token|password|secret|auth|bearer|accessToken|access_token)\b(\s*[:=]\s*)(?!["']|bearer\b)[^\s"',;}\n]+/gi, '$1$2***')
      // [L4] 无前缀独立出现的 sk- 开头密钥串（长度阈值避免误伤普通词）
      .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***');
  }
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') return String(arg);
  if (typeof arg === 'symbol') return String(arg);
  if (typeof arg === 'function') return `[Function ${arg.name || 'anonymous'}]`;

  const maybeErrorName = typeof arg?.name === 'string' ? arg.name : '';
  const maybeErrorMessage = typeof arg?.message === 'string' ? arg.message : '';
  const maybeErrorStack = typeof arg?.stack === 'string' ? arg.stack : '';
  if (arg instanceof Error || maybeErrorMessage || maybeErrorStack) {
    const parts: string[] = [];
    const header = `${maybeErrorName || 'Error'}${maybeErrorMessage ? `: ${maybeErrorMessage}` : ''}`;
    parts.push(header);
    if (maybeErrorStack && maybeErrorStack !== header) parts.push(maybeErrorStack);
    if (arg?.cause !== undefined) parts.push(`cause=${normalizeLogArg_ACU(arg.cause)}`);
    return parts.join(' | ');
  }

  try {
    const masked = maskSensitiveInLogValue(arg);
    const json = JSON.stringify(masked, null, 0);
    if (json && json !== '{}') return json;
  } catch {
    // Fall through to structural fallback below.
  }

  try {
    const constructorName = arg?.constructor?.name && arg.constructor.name !== 'Object'
      ? arg.constructor.name
      : 'Object';
    const ownProperties = Object.getOwnPropertyNames(arg || {})
      .map((key) => `${key}=${normalizeLogArg_ACU(arg[key])}`)
      .join(', ');
    if (ownProperties) return `${constructorName}{${ownProperties}}`;
    const stringValue = String(arg);
    return stringValue === '[object Object]' ? `${constructorName}{}` : stringValue;
  } catch {
    return '[Unserializable log argument]';
  }
}

/**
 * 将日志参数序列化为可读的消息字符串
 */
export function formatArgs(args: any[]): string {
  return args.map(normalizeLogArg_ACU).join(' ');
}

/**
 * 设置 debug 级别日志是否写入缓冲区
 * 关闭时 debug 日志不会进入内存缓冲区，也不会通知订阅者，大幅减少性能开销
 */
export function setDebugLogEnabled(enabled: boolean): void {
  _debugLogEnabled = enabled;
}

/**
 * 获取 debug 级别日志是否启用
 */
export function isDebugLogEnabled(): boolean {
  return _debugLogEnabled;
}

/**
 * 设置 warn 级别日志是否启用。
 * logWarn_ACU 复用此状态控制 console.warn，pushLog 复用此状态控制缓冲写入与订阅通知。
 */
export function setWarnLogEnabled(enabled: boolean): void {
  _warnLogEnabled = enabled;
}

/**
 * 获取 warn 级别日志是否启用
 */
export function isWarnLogEnabled(): boolean {
  return _warnLogEnabled;
}

/**
 * 推送一条日志到缓冲区
 * 由 logDebug_ACU / logWarn_ACU / logError_ACU 调用
 * 当对应日志级别禁用时，debug / warn 日志会被跳过
 */
export function pushLog(level: LogLevel, args: any[]): void {
  // 可选日志级别禁用时直接跳过，避免噪声与不必要的序列化开销
  if (level === 'debug' && !_debugLogEnabled) return;
  if (level === 'warn' && !_warnLogEnabled) return;

  const tag = extractTag(args);
  _knownTags.add(tag);

  const entry: LogEntry = {
    id: _nextId++,
    timestamp: Date.now(),
    level,
    tag,
    message: formatArgs(args),
  };

  // 环形缓冲区：固定容量覆盖写，O(1) 无数组拷贝
  _buffer[_writeIndex] = entry;
  _writeIndex = (_writeIndex + 1) % MAX_BUFFER_SIZE;
  if (_count < MAX_BUFFER_SIZE) _count++;

  // 通知所有订阅者
  for (const subscriber of _subscribers) {
    try {
      subscriber(entry);
    } catch {
      // 订阅者回调出错不影响日志系统
    }
  }
}

/**
 * 获取缓冲区中的所有日志（按时间顺序）
 */
export function getAllLogs(): LogEntry[] {
  if (_count === 0) return [];
  const start = _count < MAX_BUFFER_SIZE ? 0 : _writeIndex;
  const result: LogEntry[] = [];
  for (let i = 0; i < _count; i++) {
    const entry = _buffer[(start + i) % MAX_BUFFER_SIZE];
    if (entry) result.push(entry);
  }
  return result;
}

/**
 * 获取缓冲区中的日志数量
 */
export function getLogCount(): number {
  return _count;
}

/**
 * 清空缓冲区
 */
export function clearLogs(): void {
  _buffer = new Array(MAX_BUFFER_SIZE);
  _writeIndex = 0;
  _count = 0;
  _knownTags.clear();
}

/**
 * 获取所有已知的模块标签（供 UI 过滤器使用）
 */
export function getKnownTags(): string[] {
  return [..._knownTags].sort();
}

/**
 * 订阅新日志事件
 * 返回取消订阅的函数
 */
export function subscribe(callback: LogSubscriber): () => void {
  _subscribers.add(callback);
  return () => {
    _subscribers.delete(callback);
  };
}

/**
 * 取消订阅
 */
export function unsubscribe(callback: LogSubscriber): void {
  _subscribers.delete(callback);
}

/**
 * 获取当前订阅者数量（调试用）
 */
export function getSubscriberCount(): number {
  return _subscribers.size;
}

/**
 * 重置整个日志系统（仅供测试使用）
 */
export function _resetForTesting(): void {
  _buffer = new Array(MAX_BUFFER_SIZE);
  _writeIndex = 0;
  _count = 0;
  _nextId = 1;
  _subscribers.clear();
  _knownTags.clear();
  _debugLogEnabled = false;
  _warnLogEnabled = false;
}
