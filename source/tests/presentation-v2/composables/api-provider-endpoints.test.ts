import { describe, expect, it } from 'vitest';
import {
  API_PROVIDER_ENDPOINTS_ACU,
  matchApiProviderEndpoint_ACU,
} from '../../../src/presentation-v2/composables/api-provider-endpoints';
import { assertSafeHttpEndpoint_ACU } from '../../../src/shared/utils';

describe('API 预设常用服务商端点', () => {
  it('清单项 id / 端点唯一，端点都能通过保存校验，协议在本库白名单内', () => {
    const ids = API_PROVIDER_ENDPOINTS_ACU.map(p => p.id);
    const urls = API_PROVIDER_ENDPOINTS_ACU.map(p => p.url);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
    for (const provider of API_PROVIDER_ENDPOINTS_ACU) {
      expect(provider.url.startsWith('https://')).toBe(true);
      expect(() => assertSafeHttpEndpoint_ACU(provider.url)).not.toThrow();
      expect(['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions', 'gemini_generate_content']).toContain(provider.format);
    }
  });

  it('Claude Messages 端点都以 /v1 结尾（TT 直接拼 /messages）', () => {
    for (const provider of API_PROVIDER_ENDPOINTS_ACU.filter(p => p.format === 'claude_messages')) {
      expect(provider.url.endsWith('/v1')).toBe(true);
    }
  });

  it('按端点 + 协议回显服务商：忽略末尾斜杠与大小写；协议不符或手填地址不回显', () => {
    expect(matchApiProviderEndpoint_ACU('https://OpenRouter.ai/api/v1/', 'openai_compat')?.id).toBe('openrouter');
    expect(matchApiProviderEndpoint_ACU('https://openrouter.ai/api/v1', '')?.id).toBe('openrouter');
    expect(matchApiProviderEndpoint_ACU('https://api.anthropic.com/v1', 'claude_messages')?.id).toBe('anthropic');
    expect(matchApiProviderEndpoint_ACU('https://api.anthropic.com/v1', 'openai_compat')).toBeNull();
    expect(matchApiProviderEndpoint_ACU('https://my-relay.example.com/v1', 'openai_compat')).toBeNull();
    expect(matchApiProviderEndpoint_ACU('', 'openai_compat')).toBeNull();
  });
});
