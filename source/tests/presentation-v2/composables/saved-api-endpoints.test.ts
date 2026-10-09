import { describe, expect, it } from 'vitest';
import {
  collectSavedApiEndpoints_ACU,
  matchSavedApiEndpoint_ACU,
} from '../../../src/presentation-v2/composables/saved-api-endpoints';

const presets = [
  { name: 'OpenCode GLM', apiConfig: { url: 'https://opencode.ai/zen/go/v1', customApiFormat: 'openai_compat' } },
  { name: 'OpenCode MiniMax', apiConfig: { url: 'https://opencode.ai/zen/go/v1', customApiFormat: 'claude_messages' } },
  { name: 'OpenCode Kimi', apiConfig: { url: 'https://OpenCode.ai/zen/go/v1/', customApiFormat: 'openai_compat' } },
  { name: 'DeepSeek', apiConfig: { url: 'https://api.deepseek.com', customApiFormat: '' } },
  { name: '空端点', apiConfig: { url: '  ', customApiFormat: 'openai_compat' } },
  { name: '缺配置', apiConfig: null },
  { name: 'OpenCode GLM 2', apiConfig: { url: 'https://opencode.ai/zen/go/v1', customApiFormat: 'openai_compat' } },
];

describe('API 预设已保存的端点', () => {
  it('按「端点 + 协议」去重（忽略大小写与末尾斜杠），跳过空端点，保持预设顺序', () => {
    const endpoints = collectSavedApiEndpoints_ACU(presets);
    expect(endpoints.map(e => [e.url, e.format])).toEqual([
      ['https://opencode.ai/zen/go/v1', 'openai_compat'],
      ['https://opencode.ai/zen/go/v1', 'claude_messages'],
      ['https://api.deepseek.com', 'openai_compat'],
    ]);
  });

  it('标签带协议与来源预设名，来源过多时折叠', () => {
    const [first, second, third] = collectSavedApiEndpoints_ACU(presets);
    expect(first.label).toBe('opencode.ai/zen/go/v1 · 兼容 OpenAI（来自：OpenCode GLM、OpenCode Kimi 等 3 个）');
    expect(second.label).toBe('opencode.ai/zen/go/v1 · Claude Messages（来自：OpenCode MiniMax）');
    expect(third.label).toBe('api.deepseek.com · 兼容 OpenAI（来自：DeepSeek）');
  });

  it('按当前端点 + 协议回显；协议不同或新地址不回显', () => {
    const endpoints = collectSavedApiEndpoints_ACU(presets);
    expect(matchSavedApiEndpoint_ACU(endpoints, 'https://opencode.ai/zen/go/v1/', 'claude_messages')?.label).toContain('OpenCode MiniMax');
    expect(matchSavedApiEndpoint_ACU(endpoints, 'https://api.deepseek.com', '')?.format).toBe('openai_compat');
    expect(matchSavedApiEndpoint_ACU(endpoints, 'https://api.deepseek.com', 'claude_messages')).toBeNull();
    expect(matchSavedApiEndpoint_ACU(endpoints, 'https://relay.example.com/v1', 'openai_compat')).toBeNull();
    expect(matchSavedApiEndpoint_ACU(endpoints, '', 'openai_compat')).toBeNull();
  });
});
