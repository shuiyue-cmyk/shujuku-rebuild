/**
 * Retired v2 quick-reply continuation entry point.
 *
 * The production continuation page uses useContinuationRuntime instead.
 * This retained module fails closed so an untracked legacy import cannot restart
 * the removed host-input loop.
 */
export function useContinuationLoop(): never {
  throw new Error('LEGACY_CONTINUATION_LOOP_RETIRED');
}
