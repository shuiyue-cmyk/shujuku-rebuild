import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginContinuationInternalAiMainApiInvocation_ACU,
  beginContinuationInternalAiRequest_ACU,
  bindContinuationInternalAiGenerationStarted_ACU,
  consumeContinuationInternalAiGenerationEnded_ACU,
  endContinuationInternalAiMainApiInvocation_ACU,
  resetContinuationInternalAiEventRegistryForTests_ACU,
  settleContinuationInternalAiRequest_ACU,
} from '../../../src/service/continuation/internal-ai-events';

function identity_ACU(requestId: string) {
  return { source: 'turn_instruction' as const, requestId, chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-a', attemptId: 'attempt-a' };
}

describe('continuation internal AI event registry', () => {
  beforeEach(() => resetContinuationInternalAiEventRegistryForTests_ACU());

  it('claims only the lifecycle sequence synchronously bound to one internal main-API request', () => {
    const identity = identity_ACU('request-a');
    beginContinuationInternalAiRequest_ACU(identity);
    beginContinuationInternalAiMainApiInvocation_ACU(identity.requestId);

    expect(bindContinuationInternalAiGenerationStarted_ACU(7)).toEqual(identity);
    endContinuationInternalAiMainApiInvocation_ACU(identity.requestId);
    settleContinuationInternalAiRequest_ACU(identity.requestId);
    expect(consumeContinuationInternalAiGenerationEnded_ACU(7)).toEqual(identity);
    expect(consumeContinuationInternalAiGenerationEnded_ACU(7)).toBeNull();
  });

  it('fails closed for unrelated, late, and concurrent ambiguous starts', () => {
    expect(bindContinuationInternalAiGenerationStarted_ACU(1)).toBeNull();

    const first = identity_ACU('request-a');
    const second = identity_ACU('request-b');
    beginContinuationInternalAiRequest_ACU(first);
    beginContinuationInternalAiRequest_ACU(second);
    beginContinuationInternalAiMainApiInvocation_ACU(first.requestId);
    beginContinuationInternalAiMainApiInvocation_ACU(second.requestId);
    expect(bindContinuationInternalAiGenerationStarted_ACU(2)).toBeNull();

    endContinuationInternalAiMainApiInvocation_ACU(first.requestId);
    endContinuationInternalAiMainApiInvocation_ACU(second.requestId);
    settleContinuationInternalAiRequest_ACU(first.requestId);
    settleContinuationInternalAiRequest_ACU(second.requestId);
    expect(consumeContinuationInternalAiGenerationEnded_ACU(2)).toBeNull();
  });
});
