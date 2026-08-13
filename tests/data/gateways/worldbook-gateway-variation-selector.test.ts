/**
 * tests/data/gateways/worldbook-gateway-variation-selector.test.ts
 * 世界书名称含变体选择器/特殊 Unicode 字符时的归一化与唯一解析。
 */
import { describe, expect, it, vi } from 'vitest';

const { mockTavernHelper, mockSillyTavern } = vi.hoisted(() => ({
  mockTavernHelper: {} as any,
  mockSillyTavern: {} as any,
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: mockTavernHelper,
  SillyTavern_API_ACU: mockSillyTavern,
}));

import { normalizeLorebookNameForMatch_ACU, resolveLorebookNameFromList_ACU } from '../../../src/data/gateways/worldbook-gateway';

// U+FE0F: emoji presentation selector；U+FE0E: text presentation selector；U+E0100–U+E01EF: supplementary variation selectors
const FE0F = '\uFE0F';
const FE0E = '\uFE0E';
const VS17 = '\uDB40\uDD00'; // U+E0100
const VS18 = '\uDB40\uDD01'; // U+E0101

describe('变体选择器名称归一化', () => {
  it('U+FE0F emoji presentation selector 被移除', () => {
    expect(normalizeLorebookNameForMatch_ACU(`书⚔${FE0F}`)).toBe('书⚔');
    expect(normalizeLorebookNameForMatch_ACU(`书⚔${FE0E}`)).toBe('书⚔');
  });

  it('supplementary variation selector 被移除', () => {
    expect(normalizeLorebookNameForMatch_ACU(`书⚔${VS17}`)).toBe('书⚔');
    expect(normalizeLorebookNameForMatch_ACU(`书⚔${VS18}`)).toBe('书⚔');
  });

  it('多个变体选择器叠加仍归一化到同一键', () => {
    const plain = normalizeLorebookNameForMatch_ACU('书⚔');
    const variant = normalizeLorebookNameForMatch_ACU(`书⚔${FE0F}${FE0E}${VS17}`);
    expect(variant).toBe(plain);
  });

  it('宿主真实名称含变体选择器时唯一解析成功', () => {
    expect(resolveLorebookNameFromList_ACU('书⚔', [`书⚔${FE0F}`])).toBe(`书⚔${FE0F}`);
    expect(resolveLorebookNameFromList_ACU(`书⚔${FE0F}`, ['书⚔'])).toBe('书⚔');
    expect(resolveLorebookNameFromList_ACU(`书⚔${FE0E}`, [`书⚔${FE0F}`])).toBe(`书⚔${FE0F}`);
  });

  it('归一化后仍存在多个候选时拒绝猜测', () => {
    // 请求名无变体选择器且列表存在精确匹配时，精确匹配优先（不是多解拒绝）
    expect(resolveLorebookNameFromList_ACU('书⚔', ['书⚔', `书⚔${FE0F}`])).toBe('书⚔');
    // 请求名带变体选择器、精确匹配不存在且两个列表项归一化后同键时拒绝猜测
    expect(resolveLorebookNameFromList_ACU(`书⚔${FE0E}`, ['书⚔', `书⚔${FE0F}`])).toBeNull();
  });

  it('可见 emoji 本体不被移除', () => {
    expect(normalizeLorebookNameForMatch_ACU('书⚔')).toBe('书⚔');
    expect(normalizeLorebookNameForMatch_ACU('书⚔')).not.toBe('书');
  });
});
