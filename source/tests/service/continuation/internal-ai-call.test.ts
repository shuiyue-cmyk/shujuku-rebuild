import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallAIWithResolvedPreset_ACU } = vi.hoisted(() => ({
  mockCallAIWithResolvedPreset_ACU: vi.fn(async () => 'ok'),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithResolvedPreset_ACU: mockCallAIWithResolvedPreset_ACU,
}));

import { callContinuationInternalAi_ACU, formatAgentUsageLabel_ACU } from '../../../src/service/continuation/internal-ai-call';
import type { ContinuationResolvedApiPreset_ACU } from '../../../src/service/continuation/api-preset';
import type { ContinuationInternalAiRequestIdentity_ACU } from '../../../src/service/continuation/model';

const preset_ACU: ContinuationResolvedApiPreset_ACU = {
  presetName: 'route-preset',
  source: 'fixed',
  reason: 'fixed_preset',
  apiMode: 'custom',
  apiConfig: {
    url: 'https://gateway.example/v1',
    apiKey: 'sensitive-api-key',
    model: 'model-alpha',
    useMainApi: false,
    max_tokens: 4096,
    temperature: 0.7,
    bodyParams: '',
    excludeBodyParams: '',
    requestHeaders: '',
  },
  tavernProfile: '',
};

function identity_ACU(overrides: Partial<ContinuationInternalAiRequestIdentity_ACU> = {}): ContinuationInternalAiRequestIdentity_ACU {
  return {
    source: 'agent_main',
    requestId: 'request-a',
    chatIdentity: 'chat/敏感身份',
    taskId: 'task-a',
    stageId: 'stage-a',
    revision: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mockCallAIWithResolvedPreset_ACU.mockClear();
});

describe('formatAgentUsageLabel_ACU', () => {
  it('字段缺失时显示未报告，且不追加未报告的缓存写入', () => {
    expect(formatAgentUsageLabel_ACU({})).toBe('输入 未报告 · 缓存读取 未报告 · 输出 未报告');
  });

  it('明确报告 0 时保留 0，并显示缓存写入', () => {
    expect(formatAgentUsageLabel_ACU({
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    })).toBe('输入 0 · 缓存读取 0 · 输出 0 · 缓存写入 0');
  });

  it('正数沿用紧凑缩写', () => {
    expect(formatAgentUsageLabel_ACU({
      promptTokens: 1500,
      completionTokens: 999,
      cachedTokens: 1200,
      cacheWriteTokens: 1000,
    })).toBe('输入 1.5k · 缓存读取 1.2k · 输出 999 · 缓存写入 1.0k');
  });
});

describe('callContinuationInternalAi_ACU prompt cache key', () => {
  async function captureKey_ACU(input: {
    identity?: ContinuationInternalAiRequestIdentity_ACU;
    preset?: ContinuationResolvedApiPreset_ACU;
    scope?: string;
  } = {}): Promise<string | undefined> {
    await callContinuationInternalAi_ACU(
      [{ role: 'user', content: '缓存路由测试' }],
      input.preset ?? preset_ACU,
      input.identity ?? identity_ACU(),
      null,
      { promptCacheEnabled: true, cacheScope: input.scope ?? '主 Agent / scope' },
    );
    const extras = mockCallAIWithResolvedPreset_ACU.mock.calls.at(-1)?.[4] as { promptCacheKey?: string } | undefined;
    return extras?.promptCacheKey;
  }

  it('相同稳定输入生成相同的版本化白名单键，且不泄露原始标识与路由文本', async () => {
    const scope = '主 Agent / scope '.repeat(20);
    const first = await captureKey_ACU({ scope });
    const second = await captureKey_ACU({ identity: identity_ACU({ requestId: 'request-b' }), scope });

    expect(first).toBe(second);
    expect(first).toMatch(/^acu-cont-v2-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect(first?.length).toBeLessThanOrEqual(64);
    for (const raw of [
      identity_ACU().chatIdentity,
      'scope',
      preset_ACU.apiConfig.model,
      preset_ACU.apiConfig.url,
      preset_ACU.apiConfig.apiKey,
    ]) {
      expect(first).not.toContain(raw);
    }
  });

  it('chat、scope、apiMode、model 与 URL 任一变化时隔离缓存键', async () => {
    const baseline = await captureKey_ACU();
    const variants = [
      await captureKey_ACU({ identity: identity_ACU({ chatIdentity: 'chat/另一个身份' }) }),
      await captureKey_ACU({ scope: 'sub-mainline-planner' }),
      await captureKey_ACU({ preset: { ...preset_ACU, apiMode: 'tavern' } }),
      await captureKey_ACU({
        preset: { ...preset_ACU, apiConfig: { ...preset_ACU.apiConfig, model: 'model-beta' } },
      }),
      await captureKey_ACU({
        preset: { ...preset_ACU, apiConfig: { ...preset_ACU.apiConfig, url: 'https://gateway.example/v2' } },
      }),
    ];

    expect(new Set([baseline, ...variants]).size).toBe(6);
  });

  it('缓存关闭时不向 AI 网关传递 promptCacheKey', async () => {
    await callContinuationInternalAi_ACU(
      [{ role: 'user', content: '关闭缓存' }],
      preset_ACU,
      identity_ACU(),
      null,
      { promptCacheEnabled: false, cacheScope: 'agent-main' },
    );

    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledOnce();
    expect(mockCallAIWithResolvedPreset_ACU.mock.calls[0]?.[4]).toBeUndefined();
  });

  it('关闭 prompt_cache_key 时仍把 onUsage 传给网关，会话流还能统计缓存命中', async () => {
    const onUsage = vi.fn();
    await callContinuationInternalAi_ACU(
      [{ role: 'user', content: '只要用量不要 key' }],
      preset_ACU,
      identity_ACU(),
      null,
      { promptCacheEnabled: false, cacheScope: 'agent-main', onUsage },
    );

    expect(mockCallAIWithResolvedPreset_ACU.mock.calls[0]?.[3]).toEqual(expect.objectContaining({ onUsage }));
    expect(mockCallAIWithResolvedPreset_ACU.mock.calls[0]?.[4]).toBeUndefined();
  });
});
