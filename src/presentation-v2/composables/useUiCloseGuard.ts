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

export function __resetUiCloseGuardsForTests(): void {
  guards.clear();
}
