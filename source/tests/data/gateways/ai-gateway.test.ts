/**
 * tests/data/gateways/ai-gateway.test.ts
 * AI 调用网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSillyTavern, mockLogWarn } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: {},
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

import {
  isConnectionManagerAvailable_ACU,
  sendConnectionManagerRequest_ACU,
  getConnectionManagerProfiles_ACU,
  getHostRequestHeaders_ACU,
} from '../../../src/data/gateways/ai-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('isConnectionManagerAvailable_ACU', () => {
  it('不可用返回 false', () => {
    expect(isConnectionManagerAvailable_ACU()).toBe(false);
  });

  it('可用返回 true', () => {
    mockSillyTavern.ConnectionManagerRequestService = { sendRequest: vi.fn() };
    expect(isConnectionManagerAvailable_ACU()).toBe(true);
  });
});

describe('sendConnectionManagerRequest_ACU', () => {
  it('不可用时抛错', async () => {
    await expect(sendConnectionManagerRequest_ACU('profile1', [], 100)).rejects.toThrow('ConnectionManagerRequestService');
  });

  it('可用时调用并返回结果', async () => {
    const response = { choices: [{ message: { content: '回复' } }] };
    mockSillyTavern.ConnectionManagerRequestService = {
      sendRequest: vi.fn().mockResolvedValue(response),
    };
    const result = await sendConnectionManagerRequest_ACU('profile1', [{ role: 'user', content: '你好' }], 100);
    expect(result).toEqual(response);
  });
});

describe('getConnectionManagerProfiles_ACU', () => {
  it('不可用时返回空数组', () => {
    expect(getConnectionManagerProfiles_ACU()).toEqual([]);
  });

  it('可用时返回配置列表', () => {
    mockSillyTavern.extensionSettings = {
      connectionManager: { profiles: [{ id: 'p1', name: '配置1' }] },
    };
    expect(getConnectionManagerProfiles_ACU()).toEqual([{ id: 'p1', name: '配置1' }]);
  });
});

describe('getHostRequestHeaders_ACU', () => {
  it('SillyTavern 不可用时返回空对象', () => {
    expect(getHostRequestHeaders_ACU()).toEqual({});
  });

  it('可用时返回请求头', () => {
    const headers = { 'X-CSRF-Token': 'abc123' };
    (globalThis as any).SillyTavern = { getContext: () => ({ getRequestHeaders: () => headers }) };
    expect(getHostRequestHeaders_ACU()).toEqual(headers);
    delete (globalThis as any).SillyTavern;
  });
});