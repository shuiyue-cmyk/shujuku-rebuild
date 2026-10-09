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
  getHostRequestHeaders_ACU,
} from '../../../src/data/gateways/ai-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('getHostRequestHeaders_ACU', () => {

  it('可用时返回请求头', () => {
    const headers = { 'X-CSRF-Token': 'abc123' };
    (globalThis as any).SillyTavern = { getContext: () => ({ getRequestHeaders: () => headers }) };
    expect(getHostRequestHeaders_ACU()).toEqual(headers);
    delete (globalThis as any).SillyTavern;
  });
});