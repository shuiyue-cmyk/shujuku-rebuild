/**
 * 世界书条目批量操作的作用范围（R10B-05）。
 * 列表有搜索词时，「全选/全不选/Skill 全选/Skill 全不选」只应作用于筛选结果；
 * null/undefined 表示全部条目（无搜索词）。
 */
export type WorldbookEntryScope_ACU = ReadonlyArray<{ bookName: string; uid: number }> | null | undefined;

export function createWorldbookEntryScopePredicate_ACU(scope: WorldbookEntryScope_ACU): (bookName: string, uid: number) => boolean {
  if (!scope) return () => true;
  const keys = new Set(scope.map(item => `${item.bookName}\u0000${item.uid}`));
  return (bookName, uid) => keys.has(`${bookName}\u0000${uid}`);
}
