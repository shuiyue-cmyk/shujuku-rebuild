import { describe, expect, it } from 'vitest';
import {
  getContinuationHostGenerationBridge_ACU,
  registerContinuationHostGenerationBridge_ACU,
  resetContinuationHostGenerationBridgeForTests_ACU,
} from '../../../src/service/continuation/host-generation-bridge-registry';

describe('continuation host generation bridge registry', () => {
  it('only releases the bridge owned by its disposer', () => {
    resetContinuationHostGenerationBridgeForTests_ACU();
    const first = {} as any;
    const second = {} as any;
    const disposeFirst = registerContinuationHostGenerationBridge_ACU(first);
    const disposeSecond = registerContinuationHostGenerationBridge_ACU(second);

    disposeFirst();
    expect(getContinuationHostGenerationBridge_ACU()).toBe(second);

    disposeSecond();
    expect(getContinuationHostGenerationBridge_ACU()).toBeNull();
  });
});
