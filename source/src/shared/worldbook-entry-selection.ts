/**
 * 用户是否在条目勾选列表里显式勾选了这条世界书条目（R7-03）。
 * 屏蔽词（isEntryBlocked_ACU）只决定「默认不发送」；用户亲手勾选的条目优先于屏蔽词。
 * 「未配置勾选 = 全部发送」这类默认放行不算显式勾选。
 */
export function isEntryExplicitlySelected_ACU(enabledEntriesMap: unknown, bookName: unknown, uid: unknown): boolean {
  if (!enabledEntriesMap || typeof enabledEntriesMap !== 'object') return false;
  const list = (enabledEntriesMap as Record<string, unknown>)[String(bookName ?? '')];
  if (!Array.isArray(list)) return false;
  const target = String(uid ?? '').trim();
  return target !== '' && list.some(item => String(item ?? '').trim() === target);
}
