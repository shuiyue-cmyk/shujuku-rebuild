/**
 * tests/service/ai/api-call.test.ts
 * AI 调用编排 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse } from 'yaml';

const { mockSettings, mockIsGenerateRawAvailable, mockGenerateRaw, mockSendConnectionManager, mockGetHeaders, mockHandleApiResponse, mockRateLimitSlot } = vi.hoisted(() => ({
  mockSettings: {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 },
    tavernProfile: 'default',
    plotApiPreset: '',
    streamingEnabled: false,
    apiPresets: [] as any[],
  } as any,
  mockIsGenerateRawAvailable: vi.fn(() => true),
  mockGenerateRaw: vi.fn(),
  mockSendConnectionManager: vi.fn(),
  mockGetHeaders: vi.fn(() => ({ 'X-Custom': 'test' })),
  mockHandleApiResponse: vi.fn(),
  mockRateLimitSlot: vi.fn(async () => {}),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  handleApiResponse_ACU: mockHandleApiResponse,
  extractAiUsageMetadata_ACU: vi.fn(() => null),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  isGenerateRawAvailable_ACU: mockIsGenerateRawAvailable,
  generateRaw_ACU: mockGenerateRaw,
  sendConnectionManagerRequest_ACU: mockSendConnectionManager,
  getHostRequestHeaders_ACU: mockGetHeaders,
}));

vi.mock('../../../src/service/ai/preset-rate-limiter', () => ({
  acquirePresetRateLimitSlot_ACU: mockRateLimitSlot,
}));

// log 打点 mock 掉防噪；assertSafeHttpEndpoint_ACU 保留真身——
// 调用编排必须真实通过 SSRF 守卫（V4-b：此前 vi.fn() mock 让守卫在测试里永不生效）。
vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
  };
});

// mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  callApiWithPlotPreset_ACU,
  getApiConfigByPreset_ACU,
  callAIWithPreset_ACU,
  callAIWithResolvedPreset_ACU,
  callCustomOpenAI_ACU_Direct,
  buildCustomApiRequestBody_ACU,
} from '../../../src/service/ai/api-call';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.apiMode = 'custom';
  mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 };
  mockSettings.tavernProfile = 'default';
  mockSettings.plotApiPreset = '';
  mockSettings.streamingEnabled = false;
  mockSettings.apiPresets = [];
});

// ═══ getApiConfigByPreset_ACU ═══
describe('getApiConfigByPreset_ACU', () => {
  it('空预设名返回当前配置', () => {
    const config = getApiConfigByPreset_ACU('');
    expect(config.apiMode).toBe('custom');
    expect(config.apiConfig).toBe(mockSettings.apiConfig);
  });

  it('找到预设时返回预设配置', () => {
    mockSettings.apiPresets = [
      { name: '预设A', apiMode: 'custom', apiConfig: { url: 'http://a.com' } },
    ];
    const config = getApiConfigByPreset_ACU('预设A');
    expect(config.apiMode).toBe('custom');
    expect(config.apiConfig.url).toBe('http://a.com');
  });

  it('预设不存在时回退到当前配置', () => {
    mockSettings.apiPresets = [];
    const config = getApiConfigByPreset_ACU('不存在');
    expect(config.apiMode).toBe('custom');
  });
});

// ═══ callApi_ACU ═══
// ═══ callAIWithPreset_ACU ═══
describe('callAIWithPreset_ACU', () => {
  it('空消息数组返回 null', async () => {
    const result = await callAIWithPreset_ACU([]);
    expect(result).toBeNull();
  });

  it('非数组返回 null', async () => {
    const result = await callAIWithPreset_ACU(null as any);
    expect(result).toBeNull();
  });

  it('自定义 API 模式使用 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('指定预设名使用对应预设', async () => {
    mockSettings.apiPresets = [
      { name: '预设B', apiMode: 'custom', apiConfig: { url: 'https://b.com', model: 'gpt-4', apiKey: 'sk-test' } },
    ];
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('预设B回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '预设B');
    expect(result).toBe('预设B回复');
  });

  it('自定义 API 模式把 signal 传给 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const controller = new AbortController();
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', undefined, controller.signal);
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
  });

  it('custom 分支 signal 已 abort 时仍先发请求，handleApiResponse 拒绝中断', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    const controller = new AbortController();
    controller.abort();
    mockFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(
      callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', undefined, controller.signal),
    ).rejects.toThrow();
  });

});

// ═══ callCustomOpenAI_ACU_Direct ═══
// ═══ buildCustomApiRequestBody_ACU ═══
describe('buildCustomApiRequestBody_ACU', () => {
  it('max_tokens=0 不被回退为 20000', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 0 },
    );
    expect(body.max_tokens).toBe(0);
  });

  it('custom_api_format 缺省回退 openai_compat，预设值白名单透传', () => {
    const defaultBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(defaultBody.chat_completion_source).toBe('custom');
    expect(defaultBody.custom_api_format).toBe('openai_compat');

    const claudeBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', customApiFormat: 'claude_messages' as any },
    );
    expect(claudeBody.custom_api_format).toBe('claude_messages');

    const invalidBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', customApiFormat: 'unknown_format' as any },
    );
    expect(invalidBody.custom_api_format).toBe('openai_compat');
  });

  it('maxTokens 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', maxTokens: 1234 },
    );
    expect(body.max_tokens).toBe(1234);
  });

  it('temperature=0 不被回退为 1.0', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 0 },
    );
    expect(body.temperature).toBe(0);
  });

  it('top_p=0 进入 body.top_p', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', top_p: 0 },
    );
    expect(body.top_p).toBe(0);
  });

  it('topP 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', topP: 0.5 },
    );
    expect(body.top_p).toBe(0.5);
  });

  it('topP=0 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', topP: 0 },
    );
    expect(body.top_p).toBe(0);
  });

  it('bodyParams 作为 SillyTavern custom_include_body 透传给最终 provider', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, top_p: 0.95, max_tokens: 20000, bodyParams: 'temperature:0.3\ntop_p:0.5\nmax_tokens:100' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    expect(body.max_tokens).toBe(20000);
    expect(body.custom_include_body).toBe('temperature:0.3\ntop_p:0.5\nmax_tokens:100');
  });

  it('bodyParams 保留 YAML 对象值给 SillyTavern 解析', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'response_format:\n  type: json_object\nmetadata:\n  source: acu' },
    );
    expect(body.custom_include_body).toBe('response_format:\n  type: json_object\nmetadata:\n  source: acu');
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('metadata');
  });

  it('bodyParams 保留数组和布尔 YAML 给 SillyTavern 解析', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'stop:\n  - </json>\nparallel_tool_calls: false' },
    );
    expect(body.custom_include_body).toBe('stop:\n  - </json>\nparallel_tool_calls: false');
    expect(body).not.toHaveProperty('parallel_tool_calls');
  });

  it('overrides.responseFormat 作为结构化对象注入 custom_include_body', () => {
    const responseFormat = {
      type: 'json_schema',
      json_schema: { name: 'table_edit_ops_response', strict: true, schema: { type: 'object' } },
    };
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
      { responseFormat },
    );
    expect(parse(body.custom_include_body)).toEqual({ response_format: responseFormat });
    // response_format 只走 custom_include_body 合并，不直接挂在请求体顶层。
    expect(body).not.toHaveProperty('response_format');
  });

  it('overrides.responseFormat 与 YAML mapping 共存时按对象语义合并', () => {
    const responseFormat = { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: {} } };
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'temperature: 0.3' },
      { responseFormat },
    );
    expect(parse(body.custom_include_body)).toEqual({ temperature: 0.3, response_format: responseFormat });
  });

  it('bodyParams 为 JSON 对象时仍注入插件字段，并保留用户 stream_options 子字段', () => {
    mockSettings.streamingEnabled = true;
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: '{"stop":["</json>"],"stream_options":{"trace":true}}' },
      { promptCacheKey: 'cache-key', includeStreamUsage: true },
    );
    expect(parse(body.custom_include_body)).toEqual({
      stop: ['</json>'],
      stream_options: { trace: true, include_usage: true },
      prompt_cache_key: 'cache-key',
    });
  });

  it('YAML sequence 按 SillyTavern 顺序浅合并对象项，忽略非对象项', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: '- {temperature: 0.2, metadata: {source: first}}\n- ignored\n- {temperature: 0.4, top_p: 0.6}' },
      { promptCacheKey: 'cache-key' },
    );
    expect(parse(body.custom_include_body)).toEqual({
      temperature: 0.4,
      metadata: { source: 'first' },
      top_p: 0.6,
      prompt_cache_key: 'cache-key',
    });
  });

  it('非法 YAML 或标量根节点保留用户原文并跳过插件字段', () => {
    const invalid = 'metadata: [';
    const invalidBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: invalid },
      { promptCacheKey: 'cache-key' },
    );
    const scalar = 'plain scalar';
    const scalarBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: scalar },
      { promptCacheKey: 'cache-key' },
    );
    expect(invalidBody.custom_include_body).toBe(invalid);
    expect(scalarBody.custom_include_body).toBe(scalar);
  });

  it('excludeBodyParams 与预设显式配置冲突时按排除优先（不再自动剔除，A2 连带项）', async () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, excludeBodyParams: 'temperature,top_p' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    // 用户显式排除清单原样透传（temperature 冲突仅 warn，不删键）；排除由后端在发往上游前执行。
    expect(body.custom_exclude_body).toBe('- temperature\n- top_p');
    expect(body).toHaveProperty('max_tokens');
  });

  it('bodyParams 与 excludeBodyParams 同名时两者均原样透传，由后端定序', async () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, bodyParams: 'temperature:0.3', excludeBodyParams: 'temperature' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.custom_include_body).toBe('temperature:0.3');
    // 旧行为会因冲突把排除键删成空串；新行为尊重用户排除意图。
    expect(body.custom_exclude_body).toBe('- temperature');
  });



  it('overrides.maxTokens 优先于 effectiveApiConfig', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 9999 },
      { maxTokens: 100 },
    );
    expect(body.max_tokens).toBe(100);
  });

  it('无配置时使用默认值', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(body.max_tokens).toBe(20000);
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
  });

  it('messages 的 role 以大写 SYSTEM/USER 传入时归一为小写', () => {
    // 回归点：改表助手伪 role 提示词组（buildPseudoRoleTemplateAssistantPromptSegments_ACU）
    // 产出 role 为大写 SYSTEM / USER，自定义 chat-completions 后端只接受小写 role。
    // 此前 messages 被原样透传导致 `unknown variant SYSTEM`。
    const before = [
      { role: 'SYSTEM', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'USER', content: '请改表。' },
    ];
    const body = buildCustomApiRequestBody_ACU(
      before,
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(body.messages).toEqual([
      { role: 'system', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'user', content: '请改表。' },
    ]);
    // 不原地修改调用方原始数组与对象
    expect(before).toEqual([
      { role: 'SYSTEM', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'USER', content: '请改表。' },
    ]);
    expect(body.messages).not.toBe(before);
    expect(body.messages[0]).not.toBe(before[0]);
  });

  it('messages 的 role 已为小写时不改变内容，也不改动调用方数组', () => {
    const original = [{ role: 'user', content: '你好' }];
    const body = buildCustomApiRequestBody_ACU(original, { url: 'https://api.example.com', model: 'gpt-4' });
    expect(body.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(original).toEqual([{ role: 'user', content: '你好' }]);
    expect(body.messages).not.toBe(original);
    expect(body.messages[0]).not.toBe(original[0]);
  });

  it('缺失或非字符串 role、数组/原始值等异常消息原样保留，不静默改造成 undefined', () => {
    const input = [
      { content: '缺 role' },
      { role: null, content: 'role 为 null' },
      { role: 123, content: 'role 为数字' },
      ['x'],
      'raw string',
      null,
    ] as any[];
    const body = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' });
    // 边界契约：仅字符串 role 归一化；缺失/非字符串/数组/原始值原样保留，交由后端校验
    expect(body.messages).toEqual([
      { content: '缺 role' },
      { role: null, content: 'role 为 null' },
      { role: 123, content: 'role 为数字' },
      ['x'],
      'raw string',
      null,
    ]);
  });

  it('非预填充支持开启时 assistant 消息改写为 user 并加「助手：」前缀', () => {
    mockSettings.nonPrefillSupport = true;
    const input = [
      { role: 'system', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'user', content: '请改表。' },
    ];
    const body = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' });
    expect(body.messages).toEqual([
      { role: 'system', content: '你是改表助手。' },
      { role: 'user', content: '助手：\n收到。' },
      { role: 'user', content: '请改表。' },
    ]);
    // 不原地修改调用方
    expect(input[1]).toEqual({ role: 'assistant', content: '收到。' });
    delete mockSettings.nonPrefillSupport;
  });

  it('非预填充支持关闭时 assistant 消息保持原样', () => {
    delete mockSettings.nonPrefillSupport;
    delete mockSettings.nonPrefillGlobal;
    const input = [
      { role: 'assistant', content: '收到。' },
    ];
    const body = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' });
    expect(body.messages).toEqual([{ role: 'assistant', content: '收到。' }]);
  });

  it('overrides 传入 nonPrefillSupport 时优先于全局设置（预设级）', () => {
    mockSettings.nonPrefillSupport = false;
    const input = [{ role: 'assistant', content: '收到。' }];
    // 全局关闭但预设开启 → 应用转换
    const onBody = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' }, { nonPrefillSupport: true });
    expect(onBody.messages).toEqual([{ role: 'user', content: '助手：\n收到。' }]);
    // 全局开启但预设关闭 → 不转换
    mockSettings.nonPrefillSupport = true;
    const offBody = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' }, { nonPrefillSupport: false });
    expect(offBody.messages).toEqual([{ role: 'assistant', content: '收到。' }]);
    delete mockSettings.nonPrefillSupport;
  });
});

// ═══ callAIWithPreset_ACU 自定义模式最终发送 body 层面：role 小写化回归 ═══
describe('callAIWithPreset_ACU 自定义模式 role 归一化', () => {
  it('改表助手大写的 SYSTEM/USER 消息在最终 fetch body 中归一为小写', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const messages = [
      { role: 'SYSTEM', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'USER', content: '以下是全局表格结构：$3' },
    ];
    const result = await callAIWithPreset_ACU(messages, '');
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.messages).toEqual([
      { role: 'system', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'user', content: '以下是全局表格结构：$3' },
    ]);
    // 调用方原始数组未被原地修改
    expect(messages).toEqual([
      { role: 'SYSTEM', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'USER', content: '以下是全局表格结构：$3' },
    ]);
  });
});

// ═══ callApi_ACU 温度透传 ═══
// ═══ callApiWithPlotPreset_ACU 温度透传 ═══
describe('callApiWithPlotPreset_ACU 温度透传', () => {
  it('custom 模式 fetch body 使用配置温度', async () => {
    mockSettings.plotApiPreset = '';
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0.5, top_p: 0.7 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApiWithPlotPreset_ACU([{ role: 'user', content: '你好' }], '');
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.5);
    expect(fetchBody.top_p).toBe(0.7);
  });

  it('custom 模式指定预设温度进入 fetch body', async () => {
    mockSettings.plotApiPreset = '预设C';
    mockSettings.apiPresets = [
      { name: '预设C', apiMode: 'custom', apiConfig: { url: 'https://api.example.com', model: 'gpt-4', temperature: 0.2, top_p: 0.6 }, tavernProfile: '' },
    ];
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApiWithPlotPreset_ACU([{ role: 'user', content: '你好' }], '预设C');
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.2);
    expect(fetchBody.top_p).toBe(0.6);
  });
});

// ═══ callAIWithPreset_ACU 参数透传 ═══
describe('callAIWithPreset_ACU 参数透传', () => {
  it('custom 分支 fetch body temperature=0 不被回退', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0);
  });

  it('custom 分支 fetch body topP 驼峰别名生效', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', topP: 0.3 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.top_p).toBe(0.3);
  });

  it('custom 分支 fetch body max_tokens=0 不被回退', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 0 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.max_tokens).toBe(0);
  });
});

// ═══ callAIWithResolvedPreset_ACU 传输超时（V3-c：租约不能被挂死的 transport 无限占用）═══
describe('callAIWithResolvedPreset_ACU 传输超时', () => {
  const resolved = {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 4096 },
    tavernProfile: 'default',
  };

  it('外部 signal 在场时将取消并入超时控制器（fetch 收到的是合并后的 signal）', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('正文');
    const result = await callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved, controller.signal);
    expect(result).toBe('正文');
    const passed = mockFetch.mock.calls[0][1].signal;
    expect(passed).toBeTruthy();
    expect(passed).not.toBe(controller.signal);
    expect(passed.aborted).toBe(false);
  });

  it('外部 abort 立即中断挂起的 fetch 并按取消上报', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const pending = callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow('请求已取消');
  });

  it('transport 挂死时按 120s 超时兜底中断，错误文案区分超时', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation((_url: string, init: any) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }));
      const pending = callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved);
      const guarded = pending.catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(120_000);
      const failure = await guarded;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('内部 AI 请求超时');
      expect((failure as Error).message).toContain('120');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══ callAIWithResolvedPreset_ACU 基础路径（V4-a：限流/配置校验/错误路径此前零覆盖）═══
describe('callAIWithResolvedPreset_ACU 基础路径', () => {
  const resolved = {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 4096 },
    tavernProfile: 'default',
  };

  it('空消息数组直接拒绝，不触达限流与 fetch', async () => {
    await expect(callAIWithResolvedPreset_ACU([], resolved)).rejects.toThrow('内部 AI 消息必须是非空数组');
    expect(mockRateLimitSlot).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('URL 或模型未配置时按自定义路径拒绝', async () => {
    const broken = { ...resolved, apiConfig: { model: 'gpt-4' } };
    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], broken)).rejects.toThrow('自定义 API 的 URL 或模型未配置');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('publicServiceMode 预设先过限流闸再发请求（以预设名计数）', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('正文');
    const publicService = { ...resolved, presetName: '公益站A', publicServiceMode: true };
    const result = await callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], publicService);
    expect(result).toBe('正文');
    expect(mockRateLimitSlot).toHaveBeenCalledWith('公益站A', expect.anything());
    // 无 publicServiceMode 的调用不占限流闸
    expect(mockRateLimitSlot).toHaveBeenCalledTimes(1);
  });

  it('非 2xx 响应抛出带状态码的受控错误', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'backend down' });
    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved)).rejects.toThrow('API 请求失败: 500 backend down');
  });

  it('响应解析出空白内容时返回 null 而非空串', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('   ');
    const result = await callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved);
    expect(result).toBeNull();
  });

  it('将合成缓存键、usage 订阅与用户 stream_options 合并后发送给宿主', async () => {
    mockSettings.streamingEnabled = true;
    mockHandleApiResponse.mockResolvedValue('宿主边界回复');
    mockFetch.mockResolvedValue({ ok: true });
    const onUsage = vi.fn();

    await expect(callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: '合成宿主边界验证' }],
      {
        apiMode: 'custom',
        apiConfig: {
          url: 'https://resolved.example', apiKey: '', model: 'resolved-model', useMainApi: false,
          max_tokens: 222, temperature: 0,
          bodyParams: '{"metadata":{"source":"synthetic"},"stream_options":{"trace":true}}',
          excludeBodyParams: '', requestHeaders: '',
        },
        tavernProfile: '',
      },
      undefined,
      { onUsage },
      { promptCacheKey: 'acu-cont-v2-12345678-abcdef01-deadbeef' },
    )).resolves.toBe('宿主边界回复');

    expect(mockFetch).toHaveBeenCalledWith('/api/backends/chat-completions/generate', expect.objectContaining({
      method: 'POST', body: expect.any(String),
    }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parse(body.custom_include_body)).toEqual({
      metadata: { source: 'synthetic' },
      stream_options: { trace: true, include_usage: true },
      prompt_cache_key: 'acu-cont-v2-12345678-abcdef01-deadbeef',
    });
  });
});
