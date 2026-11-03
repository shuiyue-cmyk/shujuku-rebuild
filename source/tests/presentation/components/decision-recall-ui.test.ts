import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  run: vi.fn(),
  untrack: vi.fn(),
}));

vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: h.toast }));
vi.mock('../../../src/shared/host-api', () => ({ toastr_API_ACU: { clear: vi.fn() } }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
  settings_ACU: { decisionRecallSettings: {} },
  trackAbortController_ACU: vi.fn(),
  untrackAbortController_ACU: h.untrack,
}));
vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({ isFlightModeActive_ACU: () => false }));
vi.mock('../../../src/service/decision-recall/decision-recall-settings', () => ({
  normalizeDecisionRecallSettings_ACU: () => ({ directive: '' }),
}));
vi.mock('../../../src/service/decision-recall/decision-recall-runtime', () => ({
  buildDecisionRecallFinalMessage_ACU: vi.fn(() => 'final'),
  describeDecisionRecallWarning_ACU: vi.fn(() => ''),
  logDecisionRecallResult_ACU: vi.fn(),
  runDecisionRecall_ACU: h.run,
}));

import { runDecisionRecallWithUI_ACU } from '../../../src/presentation/components/decision-recall-ui';

describe('决策召回「单独召回」UI 封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.run.mockResolvedValue({ status: 'skipped', reason: 'empty' });
  });

  it('宿主 toastr 弹进度提示时抛错：在途标记照样复位，下一次召回不会被当成「在途」静默跳过', async () => {
    h.toast.mockImplementationOnce(() => { throw new Error('toastr broken'); });
    await runDecisionRecallWithUI_ACU('第一句').catch(() => undefined);
    expect(h.untrack).toHaveBeenCalledTimes(1);

    const second = await runDecisionRecallWithUI_ACU('第二句');
    expect(second).not.toMatchObject({ reason: 'inflight' });
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});
