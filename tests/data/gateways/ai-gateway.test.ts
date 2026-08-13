/**
 * tests/data/gateways/ai-gateway.test.ts
 * AI 调用网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTavernHelper, mockSillyTavern, mockLogWarn } = vi.hoisted(() => ({
  mockTavernHelper: {} as any,
  mockSillyTavern: {} as any,
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: mockTavernHelper,
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

import {
  isGenerateRawAvailable_ACU,
  isConnectionManagerAvailable_ACU,
  isTriggerSlashAvailable_ACU,
  generateRaw_ACU,
  sendConnectionManagerRequest_ACU,
  triggerSlash_ACU,
  getConnectionManagerProfiles_ACU,
  getHostRequestHeaders_ACU,
} from '../../../src/data/gateways/ai-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockTavernHelper).forEach(k => delete mockTavernHelper[k]);
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('isGenerateRawAvailable_ACU', () => {
  it('不可用返回 false', () => {
    expect(isGenerateRawAvailable_ACU()).toBe(false);
  });

  it('可用返回 true', () => {
    mockTavernHelper.generateRaw = vi.fn();
    expect(isGenerateRawAvailable_ACU()).toBe(true);
  });
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

describe('isTriggerSlashAvailable_ACU', () => {
  it('不可用返回 false', () => {
    expect(isTriggerSlashAvailable_ACU()).toBe(false);
  });

  it('可用返回 true', () => {
    mockTavernHelper.triggerSlash = vi.fn();
    expect(isTriggerSlashAvailable_ACU()).toBe(true);
  });
});

describe('generateRaw_ACU', () => {
  it('不可用时抛错', async () => {
    await expect(generateRaw_ACU({ ordered_prompts: [] })).rejects.toThrow('generateRaw');
  });

  it('可用时返回生成文本', async () => {
    mockTavernHelper.generateRaw = vi.fn().mockResolvedValue('生成的文本');
    const result = await generateRaw_ACU({ ordered_prompts: [{ role: 'user', content: '你好' }] });
    expect(result).toBe('生成的文本');
  });

  it('返回非字符串时转为字符串', async () => {
    mockTavernHelper.generateRaw = vi.fn().mockResolvedValue(123);
    const result = await generateRaw_ACU({ ordered_prompts: [] });
    expect(result).toBe('123');
  });

  it('返回 null 时转为空字符串', async () => {
    mockTavernHelper.generateRaw = vi.fn().mockResolvedValue(null);
    const result = await generateRaw_ACU({ ordered_prompts: [] });
    expect(result).toBe('');
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

describe('triggerSlash_ACU', () => {
  it('不可用时返回空字符串', async () => {
    expect(await triggerSlash_ACU('/help')).toBe('');
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时返回命令结果', async () => {
    mockTavernHelper.triggerSlash = vi.fn().mockResolvedValue('命令结果');
    expect(await triggerSlash_ACU('/help')).toBe('命令结果');
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