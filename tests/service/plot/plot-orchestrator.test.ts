/**
 * tests/service/plot/plot-orchestrator.test.ts
 * 剧情推进编排逻辑 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockIsProcessing, mockSetIsProcessing, mockFlightModeActive } = vi.hoisted(() => ({
  mockSettings: { plotSettings: { enabled: true } } as any,
  mockIsProcessing: false,
  mockSetIsProcessing: vi.fn(),
  mockFlightModeActive: vi.fn(() => false),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  get isProcessing_Plot_ACU() { return mockIsProcessing; },
  _set_isProcessing_Plot_ACU: mockSetIsProcessing,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => `hash_${text}`),
}));

vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({
  isFlightModeActive_ACU: mockFlightModeActive,
}));

import {
  prepareStrategy1Context_ACU,
  orchestrateAfterCommandsStrategy1_ACU,
  orchestrateAfterCommandsStrategy2_ACU,
} from '../../../src/service/plot/plot-orchestrator';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.plotSettings = { enabled: true };
  mockFlightModeActive.mockReturnValue(false);
});

// ═══ prepareStrategy1Context_ACU ═══
describe('prepareStrategy1Context_ACU', () => {
  it('正常用户消息返回上下文', () => {
    const msg = { is_user: true, mes: '你好' };
    const result = prepareStrategy1Context_ACU(msg);
    expect(result).not.toBeNull();
    expect(result!.messageToProcess).toBe('你好');
    expect(msg._plot_processed).toBe(true);
  });
  it('非用户消息返回 null', () => {
    expect(prepareStrategy1Context_ACU({ is_user: false, mes: '你好' })).toBeNull();
  });
  it('已处理消息返回 null', () => {
    expect(prepareStrategy1Context_ACU({ is_user: true, mes: '你好', _plot_processed: true })).toBeNull();
  });
  it('空消息返回 null', () => {
    expect(prepareStrategy1Context_ACU({ is_user: true, mes: '' })).toBeNull();
  });
  it('null 返回 null', () => {
    expect(prepareStrategy1Context_ACU(null)).toBeNull();
  });
});

// ═══ orchestrateAfterCommandsStrategy1_ACU ═══
describe('orchestrateAfterCommandsStrategy1_ACU', () => {
  it('规划成功返回 planned', async () => {
    const msg = { is_user: true, mes: '你好' };
    const runPlanning = vi.fn().mockResolvedValue('规划结果');
    const result = await orchestrateAfterCommandsStrategy1_ACU(msg, 5, runPlanning);
    expect(result.action).toBe('planned');
    expect(result.finalMessage).toBe('规划结果');
    expect(result.lastMessageIndex).toBe(5);
  });
  it('非用户消息返回 no_match', async () => {
    const result = await orchestrateAfterCommandsStrategy1_ACU({ is_user: false }, 5, vi.fn());
    expect(result.action).toBe('no_match');
  });
  it('用户中止返回 aborted', async () => {
    const msg = { is_user: true, mes: '你好' };
    const runPlanning = vi.fn().mockResolvedValue({ aborted: true, manual: true, restoreText: '你好' });
    const result = await orchestrateAfterCommandsStrategy1_ACU(msg, 5, runPlanning);
    expect(result.action).toBe('aborted');
    expect(result.manual).toBe(true);
  });
});

// ═══ orchestrateAfterCommandsStrategy2_ACU ═══
describe('orchestrateAfterCommandsStrategy2_ACU', () => {
  it('规划成功返回 planned', async () => {
    const runPlanning = vi.fn().mockResolvedValue('规划结果');
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('planned');
    expect(result.finalMessage).toBe('规划结果');
  });
  it('空文本返回 skip', async () => {
    const result = await orchestrateAfterCommandsStrategy2_ACU('', vi.fn());
    expect(result.action).toBe('skip');
  });
  it('规划跳过返回 skip', async () => {
    const runPlanning = vi.fn().mockResolvedValue({ skipped: true });
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('skip');
  });
  it('用户中止返回 aborted', async () => {
    const runPlanning = vi.fn().mockResolvedValue({ aborted: true, manual: true });
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('aborted');
    expect(result.manual).toBe(true);
  });
  it('规划异常返回 skip', async () => {
    const runPlanning = vi.fn().mockRejectedValue(new Error('失败'));
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('skip');
  });
});
