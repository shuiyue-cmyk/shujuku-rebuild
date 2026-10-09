/**
 * tests/data/gateways/host-state-gateway.test.ts
 * 宿主运行时状态访问网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSillyTavern, mockTopLevelWindow, mockGetCurrentCharData } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockTopLevelWindow: {} as any,
  mockGetCurrentCharData: vi.fn(() => null),
}));

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopLevelWindow,
}));

vi.mock('../../../src/data/gateways/character-gateway', () => ({
  getCurrentCharData_ACU: mockGetCurrentCharData,
}));

import {
  getUserName_ACU,
  getCurrentCharacterFallback_ACU,
  getCharDescription_ACU,
  getCurrentCharacterId_ACU,
} from '../../../src/data/gateways/host-state-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
  Object.keys(mockTopLevelWindow).forEach(k => delete mockTopLevelWindow[k]);
  mockGetCurrentCharData.mockReturnValue(null);
});

describe('getUserName_ACU', () => {
  it('不可用时返回默认值 "用户"', () => {
    expect(getUserName_ACU()).toBe('用户');
  });
});

describe('getCurrentCharacterId_ACU', () => {
  it('优先使用 SillyTavern API 的 this_chid，并保留 0', () => {
    mockSillyTavern.this_chid = 0;
    mockTopLevelWindow.SillyTavern = { getContext: () => ({ characterId: 9 }) };
    mockTopLevelWindow.this_chid = 12;
    expect(getCurrentCharacterId_ACU()).toBe('0');
  });

  it('降级使用 SillyTavern context 的 characterId', () => {
    mockTopLevelWindow.SillyTavern = { getContext: () => ({ characterId: 9 }) };
    mockTopLevelWindow.this_chid = 12;
    expect(getCurrentCharacterId_ACU()).toBe('9');
  });

  it('忽略字符串形式的初始化占位值', () => {
    mockSillyTavern.this_chid = 'null';
    mockTopLevelWindow.SillyTavern = { getContext: () => ({ characterId: 'undefined' }) };
    mockTopLevelWindow.this_chid = 'NULL';
    expect(getCurrentCharacterId_ACU()).toBeNull();
  });
});

describe('getCurrentCharacterFallback_ACU', () => {

  it('降级到 SillyTavern.getContext()', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    const charData = { name: '角色C' };
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({ characters: { 0: charData }, characterId: 0 }),
    };
    const result = getCurrentCharacterFallback_ACU();
    expect(result).toEqual(charData);
  });
});

describe('getCharDescription_ACU', () => {

  it('从 data.description 获取', () => {
    mockGetCurrentCharData.mockReturnValue({ data: { description: '嵌套描述' } });
    expect(getCharDescription_ACU()).toBe('嵌套描述');
  });

  it('优先使用原生 getCharacterCardFields().description，压过 name2_description', () => {
    // TT dev 的 getContext() 不导出 name2_description；卡片字段是裸环境唯一有效来源。
    mockGetCurrentCharData.mockReturnValue(null);
    const getCharacterCardFields = vi.fn(() => ({ description: '原生卡面描述', personality: '冷淡' }));
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({ getCharacterCardFields, name2_description: '旧扁平描述' }),
    };
    expect(getCharDescription_ACU()).toBe('原生卡面描述');
    expect(getCharacterCardFields).toHaveBeenCalledTimes(1);
  });

  it('getCharacterCardFields 抛异常时不吞掉 name2_description 降级', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({
        getCharacterCardFields: () => { throw new Error('宿主未就绪'); },
        name2_description: '旧扁平描述',
      }),
    };
    expect(getCharDescription_ACU()).toBe('旧扁平描述');
  });
});