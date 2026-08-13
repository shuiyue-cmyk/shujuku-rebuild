/**
 * shared/utils.ts — 纯工具函数
 *
 * 零副作用、零全局依赖、零 DOM 操作。
 * 从 src/core/04_shared_helpers.js 迁移而来。
 */

/**
 * 清洗聊天文件名：去除路径前缀和扩展名后缀
 */
import { TABLE_TEMPLATE_ACU } from './defaults-json.js';
import { DEBUG_MODE_ACU, SCRIPT_ID_PREFIX_ACU, TABLE_ORDER_FIELD_ACU } from './constants';
import { safeJsonParseWithJsoncComments_ACU } from './json-helpers';
import { pushLog, isDebugLogEnabled, isWarnLogEnabled } from './log-buffer';

export function cleanChatName_ACU(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') return 'unknown_chat_source';
  let cleanedName = fileName;
  if (fileName.includes('/') || fileName.includes('\\')) {
    const parts = fileName.split(/[\\/]/);
    cleanedName = parts[parts.length - 1];
  }
  return cleanedName.replace(/\.jsonl$/, '').replace(/\.json$/, '');
}

/**
 * 深度合并两个对象（source 覆盖 target）
 */
export function deepMerge_ACU(target: any, source: any): any {
  const isObject = (obj: any) => obj && typeof obj === 'object' && !Array.isArray(obj);
  let output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target))
          Object.assign(output, { [key]: source[key] });
        else
          output[key] = deepMerge_ACU(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

/**
 * 颜色加深/减淡
 */
export function lightenDarkenColor_ACU(col: string, amt: number): string {
  let usePound = false;
  if (col.startsWith('#')) {
    col = col.slice(1);
    usePound = true;
  }
  let num = parseInt(col, 16);
  let r = (num >> 16) + amt;
  if (r > 255) r = 255;
  else if (r < 0) r = 0;
  let b = ((num >> 8) & 0x00ff) + amt;
  if (b > 255) b = 255;
  else if (b < 0) b = 0;
  let g = (num & 0x0000ff) + amt;
  if (g > 255) g = 255;
  else if (g < 0) g = 0;
  return (usePound ? '#' : '') + ('000000' + ((r << 16) | (b << 8) | g).toString(16)).slice(-6);
}

/**
 * 根据背景色计算前景色（黑或白）
 */
export function getContrastYIQ_ACU(hexcolor: string): string {
  if (hexcolor.startsWith('#')) hexcolor = hexcolor.slice(1);
  var r = parseInt(hexcolor.substr(0, 2), 16);
  var g = parseInt(hexcolor.substr(2, 2), 16);
  var b = parseInt(hexcolor.substr(4, 2), 16);
  var yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#FFFFFF';
}

/**
 * 转义正则表达式特殊字符
 */
export function escapeRegExp_ACU(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成用户输入文本的哈希值（FNV-1a 变体）
 */
export function hashUserInput_ACU(text: string): string {
  if (!text) return '';
  const normalized = String(text).trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash.toString(36);
}

/**
 * 非负整数归一化（fallback 默认 0）
 */
export function normalizeNonNegativeInteger_ACU(value: any, fallbackValue: number = 0): number {
  const num = Number(value);
  if (Number.isFinite(num) && num >= 0) return Math.floor(num);
  const fallback = Number(fallbackValue);
  return Number.isFinite(fallback) && fallback >= 0 ? Math.floor(fallback) : 0;
}

/**
 * 正整数归一化（fallback 默认 1）
 */
export function normalizePositiveInteger_ACU(value: any, fallbackValue: number = 1): number {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.floor(num);
  const fallback = Number(fallbackValue);
  return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 1;
}

/**
 * 判断表格是否是总结表、总体大纲表或纪要表
 */
export function isSummaryOrOutlineTable_ACU(tableName: string): boolean {
  if (!tableName || typeof tableName !== 'string') return false;
  const trimmedName = tableName.trim();
  return trimmedName === '总结表' || trimmedName === '总体大纲' || trimmedName === '纪要表';
}

/**
 * 判断表格是否是标准表（非总结表和总体大纲表）
 */
export function isStandardTable_ACU(tableName: string): boolean {
  return !isSummaryOrOutlineTable_ACU(tableName);
}


// 标签列表解析：支持英文逗号/中文逗号/空格分隔
function parseTagList_ACU(input: string) {
    if (!input || typeof input !== 'string') return [];
    return input
        .split(/[,，\s]+/g)
        .map(t => t.trim())
        .filter(Boolean)
        .map(t => t.replace(/[<>]/g, ''));
}

// 兼容旧"标签提取/排除"字符串：tagA,tagB -> [{start:"<tagA", end:"</tagA>"}, ...]
export function buildBoundaryRulesFromLegacyTags_ACU(tagsText = '') {
    const tags = parseTagList_ACU(tagsText);
    return tags.map(tag => ({ start: `<${tag}`, end: `</${tag}>` }));
}

export   function normalizeExtractRules_ACU(extractRulesInput: any, legacyExtractTags = '') {
      return normalizeExcludeRules_ACU(extractRulesInput, legacyExtractTags);
  }


export   function normalizeExcludeRules_ACU(excludeRulesInput: any, legacyExcludeTags = '') {
      const normalized: any[] = [];
      const dedup = new Set();

      const pushRule = (startRaw: any, endRaw: any) => {
          const start = String(startRaw || '').trim();
          const end = String(endRaw || '').trim();
          if (!start || !end) return;
          const key = `${start}\u0000${end}`;
          if (dedup.has(key)) return;
          dedup.add(key);
          normalized.push({ start, end });
      };

      if (Array.isArray(excludeRulesInput)) {
          excludeRulesInput.forEach(rule => {
              if (!rule) return;
              if (typeof rule === 'string') {
                  const parts = rule.split('|');
                  if (parts.length >= 2) {
                      const start = parts.shift();
                      const end = parts.join('|');
                      pushRule(start, end);
                  }
                  return;
              }
              if (typeof rule === 'object') {
                  pushRule(rule.start ?? rule.begin ?? rule.open, rule.end ?? rule.close ?? rule.finish);
              }
          });
      }

      // 兼容旧配置：若未提供新规则，则回退旧标签字符串
      if (normalized.length === 0) {
          buildBoundaryRulesFromLegacyTags_ACU(legacyExcludeTags).forEach(rule => pushRule(rule.start, rule.end));
      }

      return normalized;
  }


export   function logDebug_ACU(...args: any[]) {
    if (DEBUG_MODE_ACU) console.log(`[${SCRIPT_ID_PREFIX_ACU}]`, ...args);
    // 仅当 debug 日志启用时才写入缓冲区，避免性能开销
    if (isDebugLogEnabled()) {
      pushLog('debug', [`[${SCRIPT_ID_PREFIX_ACU}]`, ...args]);
    }
  }


export   function logError_ACU(...args: any[]) {
    console.error(`[${SCRIPT_ID_PREFIX_ACU}]`, ...args);
    pushLog('error', [`[${SCRIPT_ID_PREFIX_ACU}]`, ...args]);
  }


export   function logWarn_ACU(...args: any[]) {
    if (!isWarnLogEnabled()) return;
    console.warn(`[${SCRIPT_ID_PREFIX_ACU}]`, ...args);
    pushLog('warn', [`[${SCRIPT_ID_PREFIX_ACU}]`, ...args]);
  }


export   function stripSeedRowsFromTemplate_ACU(templateObj: any) {
      if (!templateObj || typeof templateObj !== 'object') return templateObj;
      Object.keys(templateObj).forEach(k => {
          if (!k.startsWith('sheet_')) return;
          const table = templateObj[k];
          if (!table || !Array.isArray(table.content) || table.content.length === 0) return;
          const headerRow = table.content[0];
          // 仅保留表头行，移除所有数据行（包括模板自带的示例/预置数据）
          table.content = [headerRow];
      });
      return templateObj;
  }


export   function parseTableTemplateJson_ACU({ stripSeedRows = false } = {}) {
      try {
          let cleanTemplate = TABLE_TEMPLATE_ACU.trim();
          const parseTemplateJson = (str: string) => safeJsonParseWithJsoncComments_ACU(str, null);

          // [修复2026-03-06] 处理DEFAULT_TABLE_TEMPLATE_ACU的双重JSON编码问题
          function escapeStringForJson_ACU(str: string) {
              return str
                  .replace(/\\/g, '\\\\')
                  .replace(/"/g, '\\"')
                  .replace(/\n/g, '\\n')
                  .replace(/\r/g, '\\r')
                  .replace(/\t/g, '\\t');
          }
          
          let obj = null;
          
          // 如果模板字符串以双引号开头和结尾，说明是被引号包围的JSON字符串
          if (cleanTemplate.startsWith('"') && cleanTemplate.endsWith('"')) {
              try {
                  // 方案1：尝试直接解析
                  try {
                      const unquoted = JSON.parse(cleanTemplate);
                      if (typeof unquoted === 'string') {
                          obj = parseTemplateJson(unquoted);
                          if (obj) return stripSeedRows ? stripSeedRowsFromTemplate_ACU(obj) : obj;
                      } else if (typeof unquoted === 'object' && unquoted !== null) {
                          return stripSeedRows ? stripSeedRowsFromTemplate_ACU(unquoted) : unquoted;
                      }
                  } catch (e1) {
                      // 方案1失败，继续方案2
                  }
                  
                  // 方案2：转义控制字符后再解析
                  const innerContent = cleanTemplate.slice(1, -1);
                  const escapedContent = escapeStringForJson_ACU(innerContent);
                  const rewrapped = '"' + escapedContent + '"';
                  
                  try {
                      const unquoted = JSON.parse(rewrapped);
                      if (typeof unquoted === 'string') {
                          obj = parseTemplateJson(unquoted);
                          if (obj) return stripSeedRows ? stripSeedRowsFromTemplate_ACU(obj) : obj;
                          try {
                              obj = parseTemplateJson(unquoted);
                              if (obj) return stripSeedRows ? stripSeedRowsFromTemplate_ACU(obj) : obj;
                          } catch (e3) {
                              // fallback 也失败
                          }
                      } else if (typeof unquoted === 'object' && unquoted !== null) {
                          return stripSeedRows ? stripSeedRowsFromTemplate_ACU(unquoted) : unquoted;
                      }
                  } catch (e2) {
                      // 方案2失败
                  }
              } catch (e) {
                  // 双引号格式处理失败
              }
          }
          
          // 常规解析
          if (!obj) {
              obj = parseTemplateJson(cleanTemplate);
          }
          
          // 转义后解析
          if (!obj && typeof cleanTemplate === 'string') {
              try {
                  const escaped = escapeStringForJson_ACU(cleanTemplate);
                  obj = parseTemplateJson(escaped);
              } catch (e) {
                  // 转义后解析异常
              }
          }
          
          if (!obj) {
              logError_ACU('[模板解析] 所有解析方案均失败，模板长度:', cleanTemplate.length, '首字符:', JSON.stringify(cleanTemplate[0]));
              return null;
          }
          return stripSeedRows ? stripSeedRowsFromTemplate_ACU(obj) : obj;
      } catch (e) {
          logError_ACU('[模板解析] 解析异常:', e);
          return null;
      }
  }


export   function applySheetOrderNumbers_ACU(dataObj: Record<string, any>, orderedKeys: string[]) {
      if (!dataObj || typeof dataObj !== 'object') return false;
      const keys = Array.isArray(orderedKeys) ? orderedKeys : [];
      let changed = false;
      keys.forEach((k, idx) => {
          const sheet = dataObj[k];
          if (!sheet || typeof sheet !== 'object') return;
          if (sheet[TABLE_ORDER_FIELD_ACU] !== idx) {
              sheet[TABLE_ORDER_FIELD_ACU] = idx;
              changed = true;
          }
      });
      return changed;
  }


export   function ensureSheetOrderNumbers_ACU(dataObj: Record<string, any>, { baseOrderKeys = null as string[] | null, forceRebuild = false } = {}) {
      if (!dataObj || typeof dataObj !== 'object') return false;
      const sheetKeys = Array.isArray(baseOrderKeys) && baseOrderKeys.length
          ? baseOrderKeys.filter(k => k && k.startsWith('sheet_') && dataObj[k])
          : Object.keys(dataObj).filter(k => k.startsWith('sheet_'));
      if (sheetKeys.length === 0) return false;

      // 检查现有编号是否合法且不重复
      const seen = new Set();
      let needRebuild = !!forceRebuild;
      for (const k of sheetKeys) {
          const v = dataObj?.[k]?.[TABLE_ORDER_FIELD_ACU];
          if (!Number.isFinite(v)) { needRebuild = true; break; }
          const iv = Math.trunc(v);
          if (seen.has(iv)) { needRebuild = true; break; }
          seen.add(iv);
      }

      if (!needRebuild) return false;
      return applySheetOrderNumbers_ACU(dataObj, sheetKeys);
  }





export   function getChatFirstLayerMessage_ACU(chat: any[]) {
      if (!Array.isArray(chat) || chat.length === 0) return null;
      return chat[0] || null;
  }


export   function cloneScopedConfigData_ACU(value: any, fallback: any = null) {
      if (value === undefined) return fallback;
      try {
          return JSON.parse(JSON.stringify(value));
      } catch (e) {
          return fallback;
      }
  }

  export function formatPlotScopeUpdatedAt_ACU(updatedAt: any) {
    const ts = Number(updatedAt) || 0;
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('zh-CN', { hour12: false });
    } catch (error) {
      return '';
    }
  }


  export function isEntryBlocked_ACU(entry: any) {
    if (!entry) return false;
    const blockedKeywords = ["规则", "思维链", "cot", "MVU", "mvu", "变量", "状态", "Status", "Rule", "rule", "检定", "判断", "叙事", "文风", "InitVar", "格式"];
    const name = String(entry.comment || entry.name || '');
    return blockedKeywords.some(keyword => name.includes(keyword));
  }
