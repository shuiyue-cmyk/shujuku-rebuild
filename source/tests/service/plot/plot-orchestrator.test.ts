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
  orchestrateAfterCommandsStrategy1_ACU,
  orchestrateAfterCommandsStrategy2_ACU,
} from '../../../src/service/plot/plot-orchestrator';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.plotSettings = { enabled: true };
  mockFlightModeActive.mockReturnValue(false);
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
  it('用户中止返回 aborted', async () => {
    const msg = { is_user: true, mes: '你好' };
    const runPlanning = vi.fn().mockResolvedValue({ aborted: true, manual: true, restoreText: '你好' });
    const result = await orchestrateAfterCommandsStrategy1_ACU(msg, 5, runPlanning);
    expect(result.action).toBe('aborted');
    expect(result.manual).toBe(true);
  });
  it('规划跳过返回 skipped（S1 已匹配不再进 S2）', async () => {
    const msg = { is_user: true, mes: '你好' };
    const runPlanning = vi.fn().mockResolvedValue({ skipped: true, reason: 'disabled' });
    const result = await orchestrateAfterCommandsStrategy1_ACU(msg, 5, runPlanning);
    expect(result.action).toBe('skipped');
  });
  it('API 重试耗尽透出 failed（发送层据此中断，不吞成 no_match）', async () => {
    const msg = { is_user: true, mes: '你好' };
    const runPlanning = vi.fn().mockResolvedValue({ apiRetriesExhausted: true });
    const result = await orchestrateAfterCommandsStrategy1_ACU(msg, 5, runPlanning);
    expect(result.action).toBe('failed');
    expect(result.apiRetriesExhausted).toBe(true);
    expect(result.originalMessage).toBe('你好');
    expect(result.lastMessageIndex).toBe(5);
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
  it('规划跳过返回 skip', async () => {
    const runPlanning = vi.fn().mockResolvedValue({ skipped: true });
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('skip');
  });
  it('API 重试耗尽透出 failed（发送层据此中断，不吞成 skip）', async () => {
    const runPlanning = vi.fn().mockResolvedValue({ apiRetriesExhausted: true });
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('failed');
    expect(result.apiRetriesExhausted).toBe(true);
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
