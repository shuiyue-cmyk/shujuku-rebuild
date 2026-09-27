import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallAIWithResolvedPreset_ACU } = vi.hoisted(() => ({
  mockCallAIWithResolvedPreset_ACU: vi.fn(async () => 'ok'),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithResolvedPreset_ACU: mockCallAIWithResolvedPreset_ACU,
}));

import { callContinuationInternalAi_ACU, formatAgentUsageLabel_ACU, isRetryableContinuationTransportError_ACU } from '../../../src/service/continuation/internal-ai-call';
import type { ContinuationResolvedApiPreset_ACU } from '../../../src/service/continuation/api-preset';
import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationInternalAiRequestIdentity_ACU } from '../../../src/service/continuation/model';

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
  it('缓存读取和写入字段缺失时不显示缓存用量', () => {
    expect(formatAgentUsageLabel_ACU({})).toBe('输入 未报告 · 输出 未报告');
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
    expect(mockCallAIWithResolvedPreset_ACU.mock.calls[0]?.[4]).toEqual({ sessionNamespace: expect.stringMatching(/^cont-agent-main-[0-9a-f]{8}$/) });
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
    expect(mockCallAIWithResolvedPreset_ACU.mock.calls[0]?.[4]).toEqual({ sessionNamespace: expect.stringMatching(/^cont-agent-main-[0-9a-f]{8}$/) });
  });

  it('不同聊天隔离 x-opencode-session 命名空间', async () => {
    const run = (chatIdentity: string) => callContinuationInternalAi_ACU(
      [{ role: 'user', content: '按聊隔离' }],
      preset_ACU,
      identity_ACU({ chatIdentity, requestId: `request-${chatIdentity}` }),
      null,
      { promptCacheEnabled: false, cacheScope: 'agent-main' },
    );
    await run('chat/A');
    const nsA = (mockCallAIWithResolvedPreset_ACU.mock.calls.at(-1)?.[4] as any)?.sessionNamespace;
    await run('chat/B');
    const nsB = (mockCallAIWithResolvedPreset_ACU.mock.calls.at(-1)?.[4] as any)?.sessionNamespace;
    expect(nsA).toMatch(/^cont-agent-main-[0-9a-f]{8}$/);
    expect(nsB).toMatch(/^cont-agent-main-[0-9a-f]{8}$/);
    expect(nsB).not.toBe(nsA);
  });
});

/**
 * 中止判定必须 duck typing，不能用裸 instanceof。
 *
 * 油猴模式运行在酒馆助手创建的 iframe 中（shared/runtime-env.ts:5,18-19），TT 会给**同源子窗口**
 * 打 fetch 补丁（src/tauri/main/bootstrap.js:236-258 的 patchWindow(openedWindow)），中止错误由
 * **宿主 realm** 的 `new DOMException(text, 'AbortError')` 构造（src/tauri/main/kernel/abort-error.js:4-5）。
 * 跨 realm 时本窗口的 `instanceof DOMException` / `instanceof Error` 双双落空 ⇒ 用户已停止的调用
 * 被判成「可重试」并延时重打。宿主自己的判据 likewise 只看 name（同文件 isAbortError），
 * 本库 api-call.ts:106-111 也早就是 duck typing，只有这一处漏了。
 */
describe('isRetryableContinuationTransportError_ACU', () => {
  it('用户中止一律不可重试：跨 realm 形状（instanceof 认不出）也必须判出', () => {
    // 同 realm 的 DOMException（回归护栏）
    expect(isRetryableContinuationTransportError_ACU(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
    // 跨 realm：形状对得上但原型链不是本窗口的 DOMException / Error
    expect(isRetryableContinuationTransportError_ACU({ name: 'AbortError', message: 'The operation was aborted.' })).toBe(false);
    expect(isRetryableContinuationTransportError_ACU(Object.assign(Object.create(null), { name: 'AbortError' }))).toBe(false);
  });

  it('传输层错误可重试；续写自身的校验错误不可重试', () => {
    expect(isRetryableContinuationTransportError_ACU(new Error('502 Bad Gateway'))).toBe(true);
    expect(isRetryableContinuationTransportError_ACU(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableContinuationTransportError_ACU(
      new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_persist', '已失效', false)),
    )).toBe(false);
  });
});
