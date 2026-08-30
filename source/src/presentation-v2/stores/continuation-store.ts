/**
 * Retired v2 quick-reply continuation settings entry point.
 *
 * Continuation settings are now owned by the first-floor continuation envelope.
 * Keep this module fail-closed rather than allowing an untracked legacy import
 * to write deprecated loop fields back into plot settings.
 */
export function useContinuationStore(): never {
  throw new Error('LEGACY_CONTINUATION_STORE_RETIRED');
}
