import type { ContinuationInternalAiRequestIdentity_ACU } from './model';

interface InternalRequestRecord_ACU {
  identity: ContinuationInternalAiRequestIdentity_ACU;
  mainApiInvocationActive: boolean;
  generationSeq: number | null;
  expiresAt: number;
}

const INTERNAL_REQUEST_TTL_MS_ACU = 60_000;
const requestsById_ACU = new Map<string, InternalRequestRecord_ACU>();

function purgeExpiredRequests_ACU(now = Date.now()): void {
  for (const [requestId, record] of requestsById_ACU) {
    if (record.expiresAt <= now) requestsById_ACU.delete(requestId);
  }
}

/**
 * Keeps host-event provenance separate from the legacy loop's mutable counter.
 * A host generation can be claimed only after one explicit internal request was
 * observed entering the main-API transport and then bound to one start sequence.
 */
export function beginContinuationInternalAiRequest_ACU(identity: ContinuationInternalAiRequestIdentity_ACU): void {
  purgeExpiredRequests_ACU();
  if (requestsById_ACU.has(identity.requestId)) {
    throw new Error(`重复的 continuation 内部请求 ID: ${identity.requestId}`);
  }
  requestsById_ACU.set(identity.requestId, { identity, mainApiInvocationActive: false, generationSeq: null, expiresAt: Date.now() + INTERNAL_REQUEST_TTL_MS_ACU });
}

/**
 * Opens a synchronous attribution window around the direct generateRaw call.
 * A later arbitrary GENERATION_STARTED is not eligible for attribution.
 */
export function beginContinuationInternalAiMainApiInvocation_ACU(requestId: string): void {
  const record = requestsById_ACU.get(requestId);
  if (!record) return;
  record.mainApiInvocationActive = true;
  record.expiresAt = Date.now() + INTERNAL_REQUEST_TTL_MS_ACU;
}

export function endContinuationInternalAiMainApiInvocation_ACU(requestId: string): void {
  const record = requestsById_ACU.get(requestId);
  if (record) record.mainApiInvocationActive = false;
}

/** A result without a synchronously attributed host lifecycle is not retained for late-event guessing. */
export function settleContinuationInternalAiRequest_ACU(requestId: string): void {
  const record = requestsById_ACU.get(requestId);
  if (!record) return;
  if (record.generationSeq === null) requestsById_ACU.delete(requestId);
  else record.expiresAt = Date.now() + INTERNAL_REQUEST_TTL_MS_ACU;
}

export function cancelContinuationInternalAiRequest_ACU(requestId: string): void {
  requestsById_ACU.delete(requestId);
}

export function bindContinuationInternalAiGenerationStarted_ACU(generationSeq: number): ContinuationInternalAiRequestIdentity_ACU | null {
  purgeExpiredRequests_ACU();
  const candidates = [...requestsById_ACU.values()].filter(record => record.mainApiInvocationActive && record.generationSeq === null);
  // The host omits request IDs. Only a synchronous invocation boundary may bind
  // an event; nested calls remain ambiguous and are intentionally unclaimed.
  if (candidates.length !== 1) return null;
  const record = candidates[0];
  record.generationSeq = generationSeq;
  record.expiresAt = Date.now() + INTERNAL_REQUEST_TTL_MS_ACU;
  return record.identity;
}

export function consumeContinuationInternalAiGenerationEnded_ACU(generationSeq: number | undefined): ContinuationInternalAiRequestIdentity_ACU | null {
  if (generationSeq === undefined) return null;
  purgeExpiredRequests_ACU();
  const match = [...requestsById_ACU.values()].find(record => record.generationSeq === generationSeq);
  if (!match) return null;
  requestsById_ACU.delete(match.identity.requestId);
  return match.identity;
}

export function resetContinuationInternalAiEventRegistryForTests_ACU(): void {
  requestsById_ACU.clear();
}
