// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/host-api', () => ({ jQuery_API_ACU: undefined, SillyTavern_API_ACU: undefined }));
vi.mock('../../../src/shared/host-input', () => ({
  getSendTextareaValue_ACU: vi.fn(() => ''),
  setSendTextareaValue_ACU: vi.fn(() => false),
}));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));

import {
  beginPlotPendingDisguise_ACU,
  isPendingDisguiseGenerationType_ACU,
  shouldBeginPlotPendingDisguise_ACU,
} from '../../../src/presentation/components/plot-pending-disguise';

describe('伪装发送楼层（可选项，默认关闭）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['regenerate', 'swipe', 'impersonate', 'quiet'])('%s 不把发送框当用户楼层发送，不得伪装', type => {
    expect(isPendingDisguiseGenerationType_ACU(type)).toBe(false);
  });

  it.each([['send' as const], ['normal' as const], [undefined], ['']])('type=%s 允许伪装', type => {
    expect(isPendingDisguiseGenerationType_ACU(type)).toBe(true);
  });

  it('总开关关闭时一律不伪装（可选项语义：默认关闭、用户显式开启才生效）', () => {
    expect(shouldBeginPlotPendingDisguise_ACU({
      disguiseEnabled: false,
      generationType: 'send',
      lastIsUserFloor: false,
      text: '继续推进剧情',
    })).toBe(false);
  });

  it('末楼已是用户楼层（/send 先入楼路径）时不伪装，避免与真实楼层并存', () => {
    expect(shouldBeginPlotPendingDisguise_ACU({
      disguiseEnabled: true,
      generationType: 'send',
      lastIsUserFloor: true,
      text: '继续推进剧情',
    })).toBe(false);
  });

  it('无 jQuery（宿主环境不可用）时返回 null，调用方保持原有行为', () => {
    expect(beginPlotPendingDisguise_ACU('继续推进剧情')).toBeNull();
  });
});
