/**
 * Legacy v2 continuation store retirement boundary.
 */
import { describe, expect, it } from 'vitest';
import { useContinuationLoop } from '../../../src/presentation-v2/composables/useContinuationLoop';
import { useContinuationStore } from '../../../src/presentation-v2/stores/continuation-store';

describe('useContinuationStore', () => {
  it('fails closed and cannot restore the retired quick-reply settings path', () => {
    expect(() => useContinuationStore()).toThrow('LEGACY_CONTINUATION_STORE_RETIRED');
  });

  it('fails closed and cannot restart the retired host-input loop', () => {
    expect(() => useContinuationLoop()).toThrow('LEGACY_CONTINUATION_LOOP_RETIRED');
  });
});
