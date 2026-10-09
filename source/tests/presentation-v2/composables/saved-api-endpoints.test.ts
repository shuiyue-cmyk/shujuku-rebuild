import { describe, expect, it } from 'vitest';
import {
  collectSavedApiEndpoints_ACU,
  matchSavedApiEndpoint_ACU,
} from '../../../src/presentation-v2/composables/saved-api-endpoints';

const presets = [
  { name: 'OpenCode GLM', apiConfig: { url: 'https://opencode.ai/zen/go/v1' } },
  { name: 'OpenCode MiniMax', apiConfig: { url: 'https://opencode.ai/zen/go/v1' } },
  { name: 'DeepSeek', apiConfig: { url: 'https://api.deepseek.com' } },
  { name: 'OpenCode Kimi', apiConfig: { url: 'https://OpenCode.ai/zen/go/v1/' } },
  { name: '空端点', apiConfig: { url: '  ' } },
  { name: '缺配置', apiConfig: null },
];

describe('API 预设已保存的端点', () => {
  it('只按端点去重（忽略大小写与末尾斜杠，不分协议），跳过空端点，保持预设顺序', () => {
    const endpoints = collectSavedApiEndpoints_ACU(presets);
    expect(endpoints.map(e => e.url)).toEqual(['https://opencode.ai/zen/go/v1', 'https://api.deepseek.com']);
  });

  it('标签带来源预设名，来源过多时折叠', () => {
    const [first, second] = collectSavedApiEndpoints_ACU(presets);
    expect(first.label).toBe('opencode.ai/zen/go/v1（来自：OpenCode GLM、OpenCode MiniMax 等 3 个）');
    expect(second.label).toBe('api.deepseek.com（来自：DeepSeek）');
  });

  it('按当前端点回显；新地址或空地址不回显', () => {
    const endpoints = collectSavedApiEndpoints_ACU(presets);
    expect(matchSavedApiEndpoint_ACU(endpoints, 'https://opencode.ai/zen/go/v1/')?.url).toBe('https://opencode.ai/zen/go/v1');
    expect(matchSavedApiEndpoint_ACU(endpoints, 'https://relay.example.com/v1')).toBeNull();
    expect(matchSavedApiEndpoint_ACU(endpoints, '')).toBeNull();
  });
});
