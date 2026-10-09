/**
 * plot-planning-ui 中断口径 — 普通失败继续发送，仅 API 重试耗尽中断。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockRunOptimizationLogic,
  mockShowToastr,
  mockClear,
} = vi.hoisted(() => ({
  mockRunOptimizationLogic: vi.fn(),
  mockShowToastr: vi.fn(() => null),
  mockClear: vi.fn(),
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  runOptimizationLogic_ACU: mockRunOptimizationLogic,
}));

vi.mock('../../../src/presentation/theme/toast', () => ({
  showToastr_ACU: mockShowToastr,
}));

vi.mock('../../../src/shared/host-api', () => ({
  toastr_API_ACU: { clear: mockClear },
  jQuery_API_ACU: undefined,
  SillyTavern_API_ACU: undefined,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  abortController_ACU: null,
  _set_isProcessing_Plot_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/constants', () => ({
  ACU_TOAST_CATEGORY_ACU: { PLANNING: 'planning', ERROR: 'error', PLAN_OK: 'plan_ok' },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

import { runOptimizationLogicWithUI_ACU } from '../../../src/presentation/components/plot-planning-ui';

beforeEach(() => {
  vi.clearAllMocks();
  mockShowToastr.mockReturnValue(null);
});

describe('runOptimizationLogicWithUI_ACU 中断口径', () => {
  it('规划成功返回最终消息', async () => {
    mockRunOptimizationLogic.mockResolvedValue({ success: true, finalMessage: '规划好的正文' });
    const result = await runOptimizationLogicWithUI_ACU('继续');
    expect(result).toBe('规划好的正文');
  });

  it('普通失败只告警并返回 skipped（继续宿主发送，不再弹 error 中断语义）', async () => {
    mockRunOptimizationLogic.mockResolvedValue({ success: false, errorType: 'stage_failure', errorMessage: '阶段失败' });
    const result = await runOptimizationLogicWithUI_ACU('继续');
    expect(result).toEqual({ skipped: true, reason: 'stage_failure' });
    expect(mockShowToastr).toHaveBeenCalledWith('warning', expect.anything(), '剧情推进');
  });

  it('API 重试耗尽弹 error 并透出标记（发送层据此中断）', async () => {
    mockRunOptimizationLogic.mockResolvedValue({ success: false, apiRetriesExhausted: true, errorMessage: '重试耗尽' });
    const result = await runOptimizationLogicWithUI_ACU('继续');
    expect(result).toEqual({ apiRetriesExhausted: true });
    expect(mockShowToastr).toHaveBeenCalledWith('error', '重试耗尽', '规划失败', expect.anything());
  });

  it('服务抛异常不向外抛：告警后返回 skipped（继续宿主发送）', async () => {
    mockRunOptimizationLogic.mockRejectedValue(new Error('boom'));
    const result = await runOptimizationLogicWithUI_ACU('继续');
    expect(result).toEqual({ skipped: true, reason: 'processing_error' });
    expect(mockShowToastr).toHaveBeenCalledWith('warning', '剧情任务处理异常，继续宿主发送。', '剧情推进');
  });
});
