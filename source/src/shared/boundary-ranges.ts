/**
 * shared/boundary-ranges.ts — 字面量边界段「区间计算」纯函数（零依赖、零副作用）
 *
 * 从 service/runtime/helpers-context-tags.ts 的排除段匹配器逐字抽出，供两条链共用同一套语义：
 *   1) 上下文标签排除：helpers-context-tags 拿到区间后删除命中段（发送/规划上下文裁剪）；
 *   2) 正文优化写回保护：shared/text-optimization 判断优化建议的 original 是否落在排除区间内。
 *
 * 语义与原实现保持逐字一致：
 *   - indexOf 字面量匹配（不做正则、不做词边界）；
 *   - 小写容错（`<SYSTEM>` 命中规则 `<system`）；
 *   - 栈式逐对非贪婪配对：遇到结束边界时与最近一个未配对的开始边界配成一对；
 *   - 未配对的孤立开始/结束边界不参与（孤立尾巴既不会被删除，也不构成排除区间）。
 */

export interface BoundaryRange_ACU {
  start: number;
  end: number;
}

/**
 * 合并区间：先按 start 升序（start 相同按 end 升序），再合并所有相交或首尾相接的区间。
 */
export function mergeBoundaryRanges_ACU(
  ranges: BoundaryRange_ACU[],
): BoundaryRange_ACU[] {
  const sorted = [...(ranges || [])].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: BoundaryRange_ACU[] = [];
  sorted.forEach((range) => {
    const previousRange = merged[merged.length - 1];
    if (!previousRange || range.start > previousRange.end) {
      merged.push({ ...range });
      return;
    }
    previousRange.end = Math.max(previousRange.end, range.end);
  });
  return merged;
}

/**
 * 收集一段文本中所有「开始边界…结束边界」配对命中的区间（含两侧边界本身）。
 * 返回值已排序且合并；无命中时返回空数组。
 */
export function collectMatchedBoundaryRanges_ACU(
  text: string,
  startBoundary: string,
  endBoundary: string,
): BoundaryRange_ACU[] {
  const source = String(text ?? "");
  const start = String(startBoundary || "");
  const end = String(endBoundary || "");
  if (!source || !start || !end) return [];

  const lowerSource = source.toLowerCase();
  const lowerStart = start.toLowerCase();
  const lowerEnd = end.toLowerCase();
  const openStartIndexes: number[] = [];
  const matchedRanges: BoundaryRange_ACU[] = [];
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

  if (matchedRanges.length === 0) return [];
  return mergeBoundaryRanges_ACU(matchedRanges);
}

/**
 * 按多条排除规则（已归一化为 { start, end }）计算原文中的全部排除区间。
 * 规则之间取并集（统一合并），因此调用方只需做一次重叠判断。
 */
export function collectExcludeRanges_ACU(
  text: string,
  rules: Array<{ start?: string; end?: string } | null | undefined> = [],
): BoundaryRange_ACU[] {
  const source = String(text ?? "");
  if (!source || !Array.isArray(rules) || rules.length === 0) return [];

  const collected: BoundaryRange_ACU[] = [];
  rules.forEach((rule) => {
    if (!rule) return;
    collected.push(
      ...collectMatchedBoundaryRanges_ACU(source, rule.start as string, rule.end as string),
    );
  });

  if (collected.length === 0) return [];
  return mergeBoundaryRanges_ACU(collected);
}

/** 两个区间是否有重叠（首尾相接不算重叠）。 */
export function boundaryRangesOverlap_ACU(
  left: BoundaryRange_ACU,
  right: BoundaryRange_ACU,
): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * 在已合并的区间集合中查找与 [start, end) 重叠的第一个区间；不重叠返回 null。
 * 完全落在区间内、跨出边界的部分重叠，都算命中。
 */
export function findOverlappingBoundaryRange_ACU(
  ranges: BoundaryRange_ACU[],
  start: number,
  end: number,
): BoundaryRange_ACU | null {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;

  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (boundaryRangesOverlap_ACU(range, { start, end })) return range;
  }
  return null;
}

/**
 * 从文本中删除所有命中区间（区间按从后往前 splice，避免下标漂移）。
 * helpers-context-tags 的排除实现与任何需要「按区间裁剪」的调用方共用。
 */
export function removeBoundaryRangesFromText_ACU(
  text: string,
  ranges: BoundaryRange_ACU[],
): string {
  const source = String(text ?? "");
  if (!source || !Array.isArray(ranges) || ranges.length === 0) return source;

  let result = source;
  for (let rangeIndex = ranges.length - 1; rangeIndex >= 0; rangeIndex--) {
    const range = ranges[rangeIndex];
    result = result.slice(0, range.start) + result.slice(range.end);
  }
  return result;
}
