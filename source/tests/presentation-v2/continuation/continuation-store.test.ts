/**
 * Legacy v2 continuation store retirement boundary.
 */
import { describe, expect, it } from 'vitest';
import { useContinuationStore } from '../../../src/presentation-v2/stores/continuation-store';

describe('useContinuationStore', () => {
  it('fails closed and cannot restore the retired quick-reply settings path', () => {
    expect(() => useContinuationStore()).toThrow('LEGACY_CONTINUATION_STORE_RETIRED');
  });

  it('retired host-input loop module is physically deleted (production uses useContinuationRuntime)', async () => {
    const { existsSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    expect(existsSync(resolve(here, '../../../src/presentation-v2/composables/useContinuationLoop.ts'))).toBe(false);
  });
});
