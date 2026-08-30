import type { ContinuationHostGenerationBridge_ACU } from './host-generation-bridge';

let activeBridge_ACU: ContinuationHostGenerationBridge_ACU | null = null;

/**
 * Binds the currently mounted continuation runtime to the shared host lifecycle.
 * The caller owns lifecycle disposal; replacing a bridge never activates two
 * continuation consumers for one host generation.
 */
export function registerContinuationHostGenerationBridge_ACU(bridge: ContinuationHostGenerationBridge_ACU): () => void {
  activeBridge_ACU = bridge;
  return () => {
    if (activeBridge_ACU === bridge) activeBridge_ACU = null;
  };
}

export function getContinuationHostGenerationBridge_ACU(): ContinuationHostGenerationBridge_ACU | null {
  return activeBridge_ACU;
}

export function resetContinuationHostGenerationBridgeForTests_ACU(): void {
  activeBridge_ACU = null;
}
