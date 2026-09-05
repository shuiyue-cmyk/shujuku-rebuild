/**
 * tests/service/runtime/state-manager-presignature.test.ts
 * GenerationContext.preSignature（配对零产出证据）与 recordGenerationContext_ACU 第 4 参测试。
 *
 * 铁律：旧三参调用形状不变（无 preSignature 键）；显式传入第 4 参才落盘。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: vi.fn(() => ({})),
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: {},
}));

import {
  generationGate_ACU,
  recordGenerationContext_ACU,
} from '../../../src/service/runtime/state-manager';

beforeEach(() => {
  generationGate_ACU.activeGenerations = [];
  generationGate_ACU.generationSeq = 0;
  generationGate_ACU.lastGeneration = null;
});

describe('recordGenerationContext_ACU preSignature 第 4 参', () => {
  it('旧三参调用形状不变：context 无 preSignature 自有键', () => {
    const context = recordGenerationContext_ACU('normal', {}, false);
    expect(Object.prototype.hasOwnProperty.call(context, 'preSignature')).toBe(false);
    expect(context.seq).toBe(1);
    expect(generationGate_ACU.lastGeneration).toBe(context);
  });

  it('显式传入第 4 参时原样落盘', () => {
    const pre = { aiFloorCount: 2, latestAiMessageId: 7, latestContentHash: 'abc' };
    const context = recordGenerationContext_ACU('normal', {}, false, pre);
    expect(context.preSignature).toEqual(pre);
  });

  it('第 4 参传 undefined 时不落盘（与三参同形）', () => {
    const context = recordGenerationContext_ACU('normal', {}, false, undefined);
    expect(Object.prototype.hasOwnProperty.call(context, 'preSignature')).toBe(false);
  });

  it('第 4 参传 null 时存 null（显式无证据）', () => {
    const context = recordGenerationContext_ACU('normal', {}, false, null);
    expect(Object.prototype.hasOwnProperty.call(context, 'preSignature')).toBe(true);
    expect(context.preSignature).toBeNull();
  });

  it('quiet/dryRun 判定不受第 4 参影响（门控旧行为）', async () => {
    const { shouldProcessAutoTableUpdateForGenerationEnded_ACU } = await import(
      '../../../src/service/runtime/state-manager'
    );
    const quiet = recordGenerationContext_ACU('quiet', {}, false, { aiFloorCount: 0, latestAiMessageId: null, latestContentHash: null });
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(quiet)).toBe(false);
    const normal = recordGenerationContext_ACU('normal', {}, false, { aiFloorCount: 0, latestAiMessageId: null, latestContentHash: null });
    expect(shouldProcessAutoTableUpdateForGenerationEnded_ACU(normal)).toBe(true);
  });
});
