/**
 * service/runtime/helpers-context-tags.ts — 上下文标签提取/过滤
 * 从 helpers-remaining.ts 拆出
 */
import {
  DEFAULT_PLOT_SETTINGS_ACU
} from "../../shared/defaults-json.js";
import {
  normalizeExcludeRules_ACU,
  normalizeExtractRules_ACU,
} from "../../shared/utils";

function extractContextTags_ACU(
  text: string,
  tagNames: string[],
  excludeUserMessages = false,
) {
  if (!text || !tagNames || tagNames.length === 0) {
    return text;
  }

  let result = text;

  // 如果排除用户消息，则需要按行处理
  if (excludeUserMessages) {
    const lines = result.split("\n");
    const processedLines = lines.map((line: string) => {
      // 检查是否是用户消息行（通常以特定格式标识）
      if (
        line.includes("[User]") ||
        line.includes("User:") ||
        line.includes("用户:")
      ) {
        return line; // 用户消息不处理
      }
      // 对非用户消息行进行标签提取
      return extractTagsFromLine(line, tagNames);
    });
    result = processedLines.join("\n");
  } else {
    result = extractTagsFromLine(result, tagNames);
  }

  return result;
}

// 辅助函数：从单行文本中提取标签内容
function extractTagsFromLine(text: string, tagNames: string[]) {
  if (!text || !tagNames || tagNames.length === 0) {
    return text;
  }

  let result = text;
  const extractedParts: string[] = [];

  tagNames.forEach((tagName: string) => {
    const content = extractLastTagContent(text, tagName);
    if (content !== null) {
      extractedParts.push(`<${tagName}>${content}</${tagName}>`);
    }
  });

  if (extractedParts.length > 0) {
    result = extractedParts.join("\n\n");
  }

  return result;
}

// 辅助函数：提取文本中最后一个指定标签的内容
function extractLastTagContent(text: string, tagName: string) {
  if (!text || !tagName) return null;
  const lower = text.toLowerCase();
  const open = `<${tagName.toLowerCase()}>`;
  const close = `</${tagName.toLowerCase()}>`;

  const closeIdx = lower.lastIndexOf(close);
  if (closeIdx === -1) return null;

  const openIdx = lower.lastIndexOf(open, closeIdx);
  if (openIdx === -1) return null;

  const contentStart = openIdx + open.length;
  const content = text.slice(contentStart, closeIdx);
  return content;
}

export function getDefaultPlotContextExtractRules_ACU() {
  return normalizeExtractRules_ACU(
    DEFAULT_PLOT_SETTINGS_ACU.contextExtractRules,
    DEFAULT_PLOT_SETTINGS_ACU.contextExtractTags || "",
  );
}

export function getDefaultPlotContextExcludeRules_ACU() {
  return normalizeExcludeRules_ACU(
    DEFAULT_PLOT_SETTINGS_ACU.contextExcludeRules,
    DEFAULT_PLOT_SETTINGS_ACU.contextExcludeTags || "",
  );
}

function removeAllMatchedBoundaries_ACU(
  text: string,
  startBoundary: string,
  endBoundary: string,
) {
  const source = String(text ?? "");
  const start = String(startBoundary || "");
  const end = String(endBoundary || "");
  if (!source || !start || !end) return source;

  const lowerSource = source.toLowerCase();
  const lowerStart = start.toLowerCase();
  const lowerEnd = end.toLowerCase();
  const openStartIndexes: number[] = [];
  const matchedRanges: Array<{ start: number; end: number }> = [];
  let searchIndex = 0;

  while (searchIndex < lowerSource.length) {
    const nextStartIdx = lowerSource.indexOf(lowerStart, searchIndex);
    const nextEndIdx = lowerSource.indexOf(lowerEnd, searchIndex);
    if (nextStartIdx === -1 && nextEndIdx === -1) break;

    const isStartBoundary = nextStartIdx !== -1
      && (nextEndIdx === -1 || nextStartIdx <= nextEndIdx);
    if (isStartBoundary) {
      openStartIndexes.push(nextStartIdx);
      searchIndex = nextStartIdx + lowerStart.length;
      continue;
    }

    if (openStartIndexes.length > 0) {
      const matchedStartIdx = openStartIndexes.pop()!;
      const matchedEndIdx = nextEndIdx + lowerEnd.length;
      if (matchedEndIdx > matchedStartIdx) {
        matchedRanges.push({ start: matchedStartIdx, end: matchedEndIdx });
      }
    }
    searchIndex = nextEndIdx + lowerEnd.length;
  }

  if (matchedRanges.length === 0) return source;

  matchedRanges.sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: Array<{ start: number; end: number }> = [];
  matchedRanges.forEach((range) => {
    const previousRange = mergedRanges[mergedRanges.length - 1];
    if (!previousRange || range.start > previousRange.end) {
      mergedRanges.push({ ...range });
      return;
    }
    previousRange.end = Math.max(previousRange.end, range.end);
  });

  let result = source;
  for (let rangeIndex = mergedRanges.length - 1; rangeIndex >= 0; rangeIndex--) {
    const range = mergedRanges[rangeIndex];
    result = result.slice(0, range.start) + result.slice(range.end);
  }
  return result;
}

export function applyExcludeRulesToText_ACU(
  text: string,
  { excludeRules = [] as any[], excludeTags = "" } = {},
) {
  let result = String(text ?? "");
  const rules = normalizeExcludeRules_ACU(excludeRules, excludeTags);
  if (!result || rules.length === 0) return result;

  rules.forEach((rule) => {
    result = removeAllMatchedBoundaries_ACU(result, rule.start, rule.end);
  });

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function extractLastMatchedBoundary_ACU(
  text: string,
  startBoundary: string,
  endBoundary: string,
) {
  const source = String(text ?? "");
  const start = String(startBoundary || "");
  const end = String(endBoundary || "");
  if (!source || !start || !end) return null;

  const lowerSource = source.toLowerCase();
  const lowerStart = start.toLowerCase();
  const lowerEnd = end.toLowerCase();

  const endIdx = lowerSource.lastIndexOf(lowerEnd);
  if (endIdx === -1) return null;
  const startIdx = lowerSource.lastIndexOf(lowerStart, Math.max(0, endIdx - 1));
  if (startIdx === -1) return null;

  const rangeEnd = endIdx + end.length;
  if (rangeEnd <= startIdx) return null;
  return source.slice(startIdx, rangeEnd);
}

function applyExtractRulesToText_ACU(
  text: string,
  { extractRules = [] as any[], extractTags = "" } = {},
) {
  const source = String(text ?? "");
  const rules = normalizeExtractRules_ACU(extractRules, extractTags);
  if (!source || rules.length === 0) return source;

  const parts: string[] = [];
  rules.forEach((rule: any) => {
    const matched = extractLastMatchedBoundary_ACU(
      source,
      rule.start,
      rule.end,
    );
    if (matched !== null) parts.push(matched);
  });
  if (parts.length === 0) return source;
  return parts.join("\n\n");
}

export function applyContextTagFilters_ACU(
  text: string,
  {
    extractTags = "",
    extractRules = [] as any[],
    excludeTags = "",
    excludeRules = [] as any[],
  } = {},
) {
  let result = String(text ?? "");
  result = applyExtractRulesToText_ACU(result, { extractRules, extractTags });
  result = applyExcludeRulesToText_ACU(result, { excludeRules, excludeTags });
  return result;
}
