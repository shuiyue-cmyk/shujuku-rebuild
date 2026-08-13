import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogDebug, mockLogWarn } = vi.hoisted(() => ({
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logWarn_ACU: mockLogWarn,
}));

import { logAutoFillSkip_ACU } from '../../src/shared/trigger-diagnostics';

describe('logAutoFillSkip_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a structured warning without message content', () => {
    logAutoFillSkip_ACU('ambiguous_generated_ai_message', {
      eventType: 'GENERATION_ENDED',
      messageId: 42,
      chatKey: 'chat-1',
      messageText: 'must never be logged',
    });

    expect(mockLogWarn).toHaveBeenCalledOnce();
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[AutoFill] Trigger skipped',
      expect.objectContaining({
        reason: 'ambiguous_generated_ai_message',
        eventType: 'GENERATION_ENDED',
        messageId: 42,
        chatKey: 'chat-1',
      }),
    );
    expect(JSON.stringify(mockLogWarn.mock.calls[0])).not.toContain('must never be logged');
  });

  it('routes expected control-flow skips to debug instead of warn', () => {
    logAutoFillSkip_ACU('quiet_or_background_generation', {
      eventType: 'GENERATION_ENDED',
      lastGenerationType: 'quiet',
    });

    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      '[AutoFill] Trigger skipped',
      expect.objectContaining({
        reason: 'quiet_or_background_generation',
        lastGenerationType: 'quiet',
      }),
    );
  });
});
