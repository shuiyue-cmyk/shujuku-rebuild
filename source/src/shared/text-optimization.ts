/**
 * 正文优化纯逻辑函数
 *
 * 纯文本处理工具。
 * 用于正文优化功能中的段落匹配、标点处理和优化应用。
 */

import { logDebug_ACU } from './utils';

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
 * 处理单引号
 */
export function processSingleQuotes_ACU(text: string): string {
  if (!text) return text;

  let result = text;

  result = result.replace(/\u2018([^\u2019]*)\u2019/g, (match: string, content: string, offset: number, string: string) => {
    const endPos = offset + match.length;
    const afterMatch = string.substring(endPos).trim();
    if (afterMatch === '' || /^[^\u4e00-\u9fa5a-zA-Z0-9]*$/.test(afterMatch)) {
      return `\u201C${content}`;
    } else {
      return `\u201C${content}\u201D`;
    }
  });

  result = result.replace(/'([^']*)'/g, (match: string, content: string, offset: number, string: string) => {
    const endPos = offset + match.length;
    const afterMatch = string.substring(endPos).trim();
    if (afterMatch === '' || /^[^\u4e00-\u9fa5a-zA-Z0-9]*$/.test(afterMatch)) {
      return `\u201C${content}`;
    } else {
      return `\u201C${content}\u201D`;
    }
  });

  return result;
}

/**
 * 应用优化到正文
 */
export function applyOptimizations_ACU(originalContent: string, optimizations: any[]): string {
  let result = originalContent;
  let appliedCount = 0;
  let failedCount = 0;
  const failedItems: any[] = [];

  for (let i = 0; i < optimizations.length; i++) {
    const opt = optimizations[i];
    if (opt.type === 'replace' && opt.original && opt.optimized) {
      let replaced = false;

      const match = findParagraphMatch_ACU(opt.original, result);

      if (match.start !== -1) {
        const matchedText = result.substring(match.start, match.end);
        const originalPunct = trimPunctuation_ACU(matchedText);
        const optimizedPunct = trimPunctuation_ACU(opt.optimized);

        let finalContent = originalPunct.prefix + optimizedPunct.trimmed + originalPunct.suffix;
        finalContent = processSingleQuotes_ACU(finalContent);

        result = result.substring(0, match.start) + finalContent + result.substring(match.end);
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

  logDebug_ACU(`[正文优化] 替换统计: 成功 ${appliedCount}/${optimizations.length}，失败 ${failedCount}`);

  if (failedItems.length > 0) {
    console.warn('[正文优化] 以下优化项未能应用:', failedItems);
  }

  return result;
}
