import { onBeforeUnmount } from 'vue';

export type UiCloseGuard = () => boolean | Promise<boolean>;

const guards = new Set<UiCloseGuard>();

export function registerUiCloseGuard(guard: UiCloseGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function useUiCloseGuard(guard: UiCloseGuard): void {
  const unregister = registerUiCloseGuard(guard);
  onBeforeUnmount(unregister);
}

export async function canCloseUi(): Promise<boolean> {
  for (const guard of Array.from(guards)) {
    const result = guard();
    const allowed = result instanceof Promise ? await result : result;
    if (!allowed) return false;
  }
  return true;
}

/**
 * R10B-06：切页、切基础/高手模式、打开可视化编辑器同样会卸载当前页，
 * 页内未保存的草稿与关闭 UI 时面临同样的丢失，因此共用同一组守卫。
 */
export function canLeaveCurrentPage(): Promise<boolean> {
  return canCloseUi();
}

export function __resetUiCloseGuardsForTests(): void {
  guards.clear();
}
