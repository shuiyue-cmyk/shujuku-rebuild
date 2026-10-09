/**
 * 正文优化纯逻辑函数
 *
 * 纯文本处理工具。
 * 用于正文优化功能中的段落匹配、标点处理和优化应用。
 */

import { logDebug_ACU, normalizeExcludeRules_ACU } from './utils';
import {
  collectExcludeRanges_ACU,
  findOverlappingBoundaryRange_ACU,
  mergeBoundaryRanges_ACU,
  type BoundaryRange_ACU,
} from './boundary-ranges';

/**
 * 去除文本中的标点符号和空白，只保留文字和数字
 */
export function removePunctuation_ACU(text: string): string {
  if (!text) return '';
  return text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
}

/**
 * 从文本中提取关键词（简单的分词，取前N个有意义的词）
 */
export function extractKeywords_ACU(text: string, count: number = 5): string[] {
  if (!text) return [];
  const cleanText = removePunctuation_ACU(text);
  const keywords: string[] = [];

  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= cleanText.length - len; i++) {
      const word = cleanText.substring(i, i + len);
      if (!keywords.includes(word)) {
        keywords.push(word);
        if (keywords.length >= count) break;
      }
    }
    if (keywords.length >= count) break;
  }

  return keywords;
}

/**
 * 将去除标点后的位置映射回原始文本位置
 */
export function mapCleanPositionToOriginal_ACU(
  originalContent: string,
  cleanStart: number,
  cleanEnd: number,
): { start: number; end: number } {
  let cleanIndex = 0;
  let originalStart = -1;
  let originalEnd = -1;

  for (let i = 0; i < originalContent.length; i++) {
    const char = originalContent[i];
    const isWordChar = /[\u4e00-\u9fa5a-zA-Z0-9]/.test(char);

    if (isWordChar) {
      if (cleanIndex === cleanStart) {
        originalStart = i;
      }
      if (cleanIndex === cleanEnd - 1) {
        originalEnd = i + 1;
        break;
      }
      cleanIndex++;
    }
  }

  if (originalEnd === -1 && originalStart !== -1) {
    originalEnd = originalContent.length;
  }

  return { start: originalStart, end: originalEnd };
}

/**
 * 新的段落匹配算法：去除标点后，比较开头、结尾和关键词
 */
export function findParagraphMatch_ACU(
  originalText: string,
  fullContent: string,
): { start: number; end: number; method: string | null } {
  const exactIndex = fullContent.indexOf(originalText);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + originalText.length, method: '精确匹配' };
  }

  const cleanOriginal = removePunctuation_ACU(originalText);
  const cleanContent = removePunctuation_ACU(fullContent);

  if (cleanOriginal.length < 10) {
    return { start: -1, end: -1, method: null };
  }

  const prefixLen = Math.max(3, Math.min(10, Math.floor(cleanOriginal.length / 4)));
  const suffixLen = Math.max(3, Math.min(10, Math.floor(cleanOriginal.length / 4)));

  const originalPrefix = cleanOriginal.substring(0, prefixLen);
  const originalSuffix = cleanOriginal.substring(cleanOriginal.length - suffixLen);

  const keywords = extractKeywords_ACU(originalText, 5);

  let searchStart = 0;
  let bestMatch: any = null;
  let bestScore = 0;

  while (searchStart < cleanContent.length) {
    const prefixIndex = cleanContent.indexOf(originalPrefix, searchStart);
    if (prefixIndex === -1) break;

    const minLen = Math.floor(cleanOriginal.length * 0.5);
    const maxLen = Math.floor(cleanOriginal.length * 1.5);

    for (let len = minLen; len <= maxLen && prefixIndex + len + suffixLen <= cleanContent.length; len++) {
      const candidateSuffixPos = prefixIndex + len - suffixLen;
      const candidateSuffix = cleanContent.substring(candidateSuffixPos, candidateSuffixPos + suffixLen);

      if (candidateSuffix === originalSuffix) {
        const candidateText = cleanContent.substring(prefixIndex, prefixIndex + len);
        let matchedKeywords = 0;
        for (const kw of keywords) {
          if (candidateText.includes(kw)) {
            matchedKeywords++;
          }
        }

        const score = matchedKeywords / keywords.length;
        if (score >= 0.4 && score > bestScore) {
          bestScore = score;
          bestMatch = {
            cleanStart: prefixIndex,
            cleanEnd: prefixIndex + len,
            score: score,
            matchedKeywords: matchedKeywords,
            totalKeywords: keywords.length,
          };
          break;
        }
      }
    }

    searchStart = prefixIndex + 1;
  }

  if (bestMatch) {
    const mappedResult = mapCleanPositionToOriginal_ACU(fullContent, bestMatch.cleanStart, bestMatch.cleanEnd);
    return {
      start: mappedResult.start,
      end: mappedResult.end,
      method: `关键词匹配 (${(bestMatch.score * 100).toFixed(0)}%关键词匹配)`,
    };
  }

  return { start: -1, end: -1, method: null };
}

/**
 * 移除字符串两端的标点符号
 */
export function trimPunctuation_ACU(text: string): { trimmed: string; prefix: string; suffix: string } {
  if (!text) return { trimmed: '', prefix: '', suffix: '' };

  let prefix = '';
  let suffix = '';
  let trimmed = text;

  const prefixMatch = trimmed.match(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/);
  if (prefixMatch) {
    prefix = prefixMatch[0];
    trimmed = trimmed.substring(prefix.length);
  }

  const suffixMatch = trimmed.match(/[^\u4e00-\u9fa5a-zA-Z0-9]+$/);
  if (suffixMatch) {
    suffix = suffixMatch[0];
    trimmed = trimmed.substring(0, trimmed.length - suffix.length);
  }

  return { trimmed, prefix, suffix };
}

/**
 * 正文替换页「标签排除规则」在写回阶段的选项。
 * 语义（用户拍板 B 方案）= 写回保护：建议命中的原文区间与排除区间重叠时整条丢弃，
 * 不参与写回、不计入替换统计；发送链仍按原文发送，不做发送前剥离。
 * 未配置 / 空规则时所有入口零开销早退，行为与既有实现逐字一致。
 */
export interface OptimizationExcludeOptions_ACU {
  excludeRules?: any[];
  excludeTags?: string;
  /** 调用方已用同一规则对原文预过滤过：写回时跳过重复的预过滤，只做按当前正文的复核。 */
  alreadyFiltered?: boolean;
}

export interface DroppedOptimization_ACU {
  index: number;
  original: string;
  reason: string;
  range: BoundaryRange_ACU | null;
}

export interface OptimizationExclusionOutcome_ACU {
  /** 允许写回的优化项（保持原顺序） */
  kept: any[];
  /** 被排除规则丢弃的优化项及原因 */
  dropped: DroppedOptimization_ACU[];
  /** 原文中算出的排除区间（已合并） */
  ranges: BoundaryRange_ACU[];
}

/** 是否真的配置了排除规则（空数组/空标签视为未配置，用于回归锁早退）。 */
function hasExcludeRuleInput_ACU(options?: OptimizationExcludeOptions_ACU | null): boolean {
  if (!options || typeof options !== 'object') return false;
  if (Array.isArray(options.excludeRules) && options.excludeRules.length > 0) return true;
  return typeof options.excludeTags === 'string' && options.excludeTags.trim() !== '';
}

/**
 * MVU 变量更新块（标签名与 MVU 解析器一致，大小写不敏感）。未闭合的块保护到正文末尾。
 * MVU 把块留在正文里，手动重试还会按标签裁掉旧块重解析；块内被改写，变量就和正文对不上。
 */
const MVU_UPDATE_BLOCK_PATTERN_ACU = /<(updatevariable|variableupdate|jsonpatch)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

/** 正文里 MVU 变量更新块的区间（已合并）；没有块时返回空数组。 */
export function collectMvuUpdateBlockRanges_ACU(text: string): BoundaryRange_ACU[] {
  const source = String(text ?? '');
  if (!/<(?:updatevariable|variableupdate|jsonpatch)\b/i.test(source)) return [];
  const ranges: BoundaryRange_ACU[] = [];
  for (const match of source.matchAll(MVU_UPDATE_BLOCK_PATTERN_ACU)) {
    ranges.push({ start: match.index!, end: match.index! + match[0].length });
  }
  return mergeBoundaryRanges_ACU(ranges);
}

/**
 * 去掉 MVU 变量更新块后的剧情正文（替换前判定、送给替换模型的 $CONTENT）。
 * 夹在正文中间的块换成换行，免得前后两段粘成一句；没有块时原样返回。
 */
export function stripMvuUpdateBlocks_ACU(text: string): string {
  const source = String(text ?? '');
  const ranges = collectMvuUpdateBlockRanges_ACU(source);
  if (ranges.length === 0) return source;
  let result = source;
  for (let index = ranges.length - 1; index >= 0; index--) {
    result = result.slice(0, ranges[index].start) + '\n' + result.slice(ranges[index].end);
  }
  return result.trim();
}

/**
 * 计算原文中的排除区间集合（复用上下文标签的边界匹配器语义）。
 * MVU 变量更新块无论是否配置规则都算排除区间；两者都没有时返回空数组。
 */
export function collectOptimizationExcludeRanges_ACU(
  originalContent: string,
  options?: OptimizationExcludeOptions_ACU | null,
): BoundaryRange_ACU[] {
  const source = String(originalContent ?? '');
  if (!source) return [];

  const mvuRanges = collectMvuUpdateBlockRanges_ACU(source);
  if (!hasExcludeRuleInput_ACU(options)) return mvuRanges;
  const rules = normalizeExcludeRules_ACU(options!.excludeRules ?? [], options!.excludeTags ?? '');
  if (!Array.isArray(rules) || rules.length === 0) return mvuRanges;
  const userRanges = collectExcludeRanges_ACU(source, rules);
  return mvuRanges.length === 0 ? userRanges : mergeBoundaryRanges_ACU([...userRanges, ...mvuRanges]);
}

/**
 * 用排除规则过滤优化建议：original 在原文中的命中区间与任一排除区间重叠（含完全包含与跨边界
 * 的部分重叠）即整条丢弃；定位不到命中区间的建议保持原样放行，交给既有应用逻辑统计匹配失败。
 */
export function filterOptimizationsByExcludeRules_ACU(
  originalContent: string,
  optimizations: any[],
  options?: OptimizationExcludeOptions_ACU | null,
): OptimizationExclusionOutcome_ACU {
  const sourceList = Array.isArray(optimizations) ? optimizations : [];
  const ranges = collectOptimizationExcludeRanges_ACU(originalContent, options);
  if (ranges.length === 0) {
    return { kept: sourceList.slice(), dropped: [], ranges: [] };
  }

  const kept: any[] = [];
  const dropped: DroppedOptimization_ACU[] = [];
  const source = String(originalContent ?? '');

  for (let i = 0; i < sourceList.length; i++) {
    const opt = sourceList[i];
    const isReplaceItem = !!opt && typeof opt === 'object'
      && opt.type === 'replace' && opt.original && opt.optimized;
    if (!isReplaceItem) {
      kept.push(opt);
      continue;
    }

    const match = findParagraphMatch_ACU(String(opt.original), source);
    if (match.start === -1) {
      // 定位不到 → 不能断定它落在排除段内，放行（与未启用排除规则时行为一致）
      kept.push(opt);
      continue;
    }

    const hitRange = findOverlappingBoundaryRange_ACU(ranges, match.start, match.end);
    if (!hitRange) {
      kept.push(opt);
      continue;
    }

    const preview = String(opt.original).substring(0, 50);
    dropped.push({
      index: i + 1,
      original: String(opt.original).substring(0, 100)
        + (String(opt.original).length > 100 ? '...' : ''),
      reason: `命中排除段 ${hitRange.start}-${hitRange.end}`,
      range: hitRange,
    });
    logDebug_ACU(
      `[正文优化] 优化项 ${i + 1} 的原文落在排除区间 ${hitRange.start}-${hitRange.end} 内（写回保护），已丢弃: "${preview}..."`,
    );
  }

  return { kept, dropped, ranges };
}

/**
 * 应用优化到正文并返回应用统计。
 * @param originalContent 原始正文
 * @param optimizations AI 返回的优化建议列表
 * @param options 可选排除规则（正文替换页「标签排除规则」）；命中排除段的建议整条不写回
 */
export function applyOptimizationsWithStats_ACU(
  originalContent: string,
  optimizations: any[],
  options?: OptimizationExcludeOptions_ACU | null,
): {
  content: string;
  appliedCount: number;
  failedCount: number;
  failedItems: any[];
  effectiveCount: number;
} {
  let result = originalContent;
  let appliedCount = 0;
  let failedCount = 0;
  const failedItems: any[] = [];

  let effectiveOptimizations = Array.isArray(optimizations) ? optimizations : [];
  if (hasExcludeRuleInput_ACU(options) && !options?.alreadyFiltered) {
    effectiveOptimizations = filterOptimizationsByExcludeRules_ACU(
      originalContent,
      effectiveOptimizations,
      options,
    ).kept;
  }

  // 受保护区（MVU 变量块 / 排除段）按当前正文计算，只在正文真的被改写后才重算
  let protectedRanges = collectOptimizationExcludeRanges_ACU(result, options);
  for (let i = 0; i < effectiveOptimizations.length; i++) {
    const opt = effectiveOptimizations[i];
    if (opt.type === 'replace' && opt.original && opt.optimized) {
      let replaced = false;

      const match = findParagraphMatch_ACU(opt.original, result);
      // 前面的建议改过正文后，同一段原文可能改为命中受保护区里的同名文字：
      // 按当前正文重新核对，落进去就不写（预过滤只核对了原文里的第一处命中）。
      const hitProtected = match.start !== -1
        && !!findOverlappingBoundaryRange_ACU(protectedRanges, match.start, match.end);
      if (hitProtected) {
        logDebug_ACU(`[正文优化] 优化项 ${i + 1} 在当前正文中命中受保护区（写回保护），跳过`);
      }

      if (match.start !== -1 && !hitProtected) {
        const matchedText = result.substring(match.start, match.end);
        const originalPunct = trimPunctuation_ACU(matchedText);
        const optimizedPunct = trimPunctuation_ACU(opt.optimized);

        // 优化后的正文原样写回（R7-01）：过去这里会把单引号对改成双引号，段末嵌套引用会丢闭合引号、
        // 英文撇号会被改成弯引号，直接改坏用户正文。引号风格交给提示词约束。
        const finalContent = originalPunct.prefix + optimizedPunct.trimmed + originalPunct.suffix;

        result = result.substring(0, match.start) + finalContent + result.substring(match.end);
        protectedRanges = collectOptimizationExcludeRanges_ACU(result, options);
        replaced = true;
        logDebug_ACU(`[正文优化] 优化项 ${i + 1} 使用${match.method}成功，位置: ${match.start}-${match.end}`);
      }

      if (replaced) {
        appliedCount++;
      } else {
        failedCount++;
        failedItems.push({
          index: i + 1,
          original: opt.original.substring(0, 100) + (opt.original.length > 100 ? '...' : ''),
          plan: opt.plan || opt.reason || '未说明',
        });
        logDebug_ACU(`[正文优化] 优化项 ${i + 1} 匹配失败，原文片段: "${opt.original.substring(0, 50)}..."`);
      }
    }
  }

  logDebug_ACU(`[正文优化] 替换统计: 成功 ${appliedCount}/${effectiveOptimizations.length}，失败 ${failedCount}`);

  if (failedItems.length > 0) {
    console.warn('[正文优化] 以下优化项未能应用:', failedItems);
  }

  return {
    content: result,
    appliedCount,
    failedCount,
    failedItems,
    effectiveCount: effectiveOptimizations.length,
  };
}

/**
 * 兼容旧调用方的字符串返回契约。
 * 需要区分 no-op 的调用方应使用 applyOptimizationsWithStats_ACU。
 */
export function applyOptimizations_ACU(
  originalContent: string,
  optimizations: any[],
  options?: OptimizationExcludeOptions_ACU | null,
): string {
  return applyOptimizationsWithStats_ACU(originalContent, optimizations, options).content;
}
