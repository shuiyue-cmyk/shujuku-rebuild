/**
 * 自定义 API 发送方式：经酒馆转接发送（默认）与数据库直接发送。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockGetHeaders } = vi.hoisted(() => ({
  mockSettings: { apiMode: 'custom', apiConfig: {}, streamingEnabled: false, apiPresets: [] as any[] } as any,
  mockGetHeaders: vi.fn(() => ({ 'X-CSRF-Token': 'host-token' })),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: mockSettings }));
vi.mock('../../../src/data/gateways/ai-gateway', () => ({ getHostRequestHeaders_ACU: mockGetHeaders }));
vi.mock('../../../src/service/ai/preset-rate-limiter', () => ({ acquirePresetRateLimitSlot_ACU: vi.fn(async () => {}) }));
vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn() };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { buildCustomApiRequestBody_ACU, callAIWithResolvedPreset_ACU, postChatCompletion_ACU, postChatCompletionTurn_ACU } from '../../../src/service/ai/api-call';
import { buildDirectProviderRequest_ACU, isDirectSendBody_ACU, normalizeDirectProviderReply_ACU, sendChatCompletionBody_ACU } from '../../../src/service/ai/direct-send';

const messages = [
  { role: 'system', content: '系统一' },
  { role: 'system', content: '系统二' },
  { role: 'user', content: '你好' },
  { role: 'system', content: '中部系统' },
  { role: 'assistant', content: '预填' },
];

function config(overrides: Record<string, unknown> = {}) {
  return { url: 'https://api.example.com/v1', apiKey: 'sk-direct', model: 'model-x', max_tokens: 1000, temperature: 1, customApiFormat: 'openai_compat', ...overrides } as any;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function lastRequest() {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url: String(url), init: init as RequestInit, body: JSON.parse(String((init as RequestInit).body)), headers: new Headers((init as RequestInit).headers) };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockGetHeaders.mockClear();
});

describe('发送方式选择', () => {
  it('缺省（经酒馆转接发送）：请求体不登记直接发送，照旧发往酒馆生成端点并带宿主请求头', async () => {
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config());
    expect(isDirectSendBody_ACU(body)).toBe(false);
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    await sendChatCompletionBody_ACU(body);
    const { url, headers, body: sent } = lastRequest();
    expect(url).toBe('/api/backends/chat-completions/generate');
    expect(headers.get('X-CSRF-Token')).toBe('host-token');
    expect(sent.reverse_proxy).toBe('https://api.example.com/v1');
  });

  it('数据库直接发送：请求直达端点，不带宿主请求头与 Cookie，也不带酒馆专用字段', async () => {
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct', bodyParams: 'top_k: 40', excludeBodyParams: 'top_p' }));
    expect(isDirectSendBody_ACU(body)).toBe(true);
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    await sendChatCompletionBody_ACU(body);
    const { url, init, headers, body: sent } = lastRequest();
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.credentials).toBe('omit');
    expect(headers.get('X-CSRF-Token')).toBeNull();
    expect(headers.get('Authorization')).toBe('Bearer sk-direct');
    for (const key of ['reverse_proxy', 'proxy_password', 'custom_url', 'custom_include_headers', 'custom_include_body', 'custom_exclude_body', 'chat_completion_source', 'custom_api_format', 'type', 'group_names', 'preserve_multiple_system', 'custom_prompt_post_processing']) {
      expect(sent).not.toHaveProperty(key);
    }
    expect(sent.top_k).toBe(40);
    expect(sent).not.toHaveProperty('top_p');
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('接入三处请求出口：postChatCompletion / postChatCompletionTurn / callAIWithResolvedPreset 都按发送方式走', async () => {
    const direct = config({ sendChannel: 'direct' });
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'a' } }] }));
    await postChatCompletion_ACU(buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], direct));
    expect(lastRequest().url).toBe('https://api.example.com/v1/chat/completions');

    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'b' } }] }));
    await postChatCompletionTurn_ACU(buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], direct));
    expect(lastRequest().url).toBe('https://api.example.com/v1/chat/completions');

    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'c' } }] }));
    const text = await callAIWithResolvedPreset_ACU([{ role: 'user', content: 'hi' }], { apiMode: 'custom', apiConfig: direct, tavernProfile: '' });
    expect(text).toBe('c');
    expect(lastRequest().url).toBe('https://api.example.com/v1/chat/completions');
  });

  it('直接发送连不上（跨域被拦）时报可操作提示，仍按网络错误归类', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct' }));
    const error = await sendChatCompletionBody_ACU(body).catch(e => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain('api.example.com');
    expect(error.message).toContain('经酒馆转接发送');
  });

  it('直接发送的失败回复原样交回，由调用方按状态码报错', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct' }));
    const error = await postChatCompletion_ACU(body).catch(e => e);
    expect(error.status).toBe(401);
    expect(error.message).toContain('bad key');
  });
});

describe('直接发送的协议改写', () => {
  it('Claude Messages：开头 system 进 system 字段、中部 system 按 user 发、同角色合并；密钥走 x-api-key', () => {
    const body = buildCustomApiRequestBody_ACU(messages, config({ sendChannel: 'direct', customApiFormat: 'claude_messages', reasoningEffort: 'high' }));
    const request = buildDirectProviderRequest_ACU(body);
    expect(request.url).toBe('https://api.example.com/v1/messages');
    const headers = new Headers(request.headers);
    expect(headers.get('x-api-key')).toBe('sk-direct');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(request.body.system).toEqual([{ type: 'text', text: '系统一' }, { type: 'text', text: '系统二' }]);
    expect(request.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '你好' }, { type: 'text', text: '中部系统' }] },
      { role: 'assistant', content: [{ type: 'text', text: '预填' }] },
    ]);
    expect(request.body.output_config).toEqual({ effort: 'high' });
    expect(request.body).not.toHaveProperty('temperature');
    expect(request.body.top_p).toBe(0.95);
    expect(request.body.max_tokens).toBe(1000);
  });

  it('OpenAI Responses：system 转 developer，助手消息转 output_text，思考强度进 reasoning', () => {
    const body = buildCustomApiRequestBody_ACU(messages, config({ sendChannel: 'direct', customApiFormat: 'openai_responses', reasoningEffort: 'low' }));
    const request = buildDirectProviderRequest_ACU(body);
    expect(request.url).toBe('https://api.example.com/v1/responses');
    expect(request.body.input[0]).toEqual({ role: 'developer', content: '系统一' });
    expect(request.body.input[4]).toEqual({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '预填' }] });
    expect(request.body.reasoning).toEqual({ effort: 'low' });
    expect(request.body.max_output_tokens).toBe(1000);
    expect(request.body.store).toBe(false);
  });

  it('Gemini generateContent：模型进路径、流式用 streamGenerateContent?alt=sse、关安全过滤、密钥走 x-goog-api-key', () => {
    const base = { sendChannel: 'direct', customApiFormat: 'gemini_generate_content', url: 'https://g.example.com', model: 'gemini-3-pro', reasoningEffort: 'high' };
    const request = buildDirectProviderRequest_ACU(buildCustomApiRequestBody_ACU(messages, config(base)));
    expect(request.url).toBe('https://g.example.com/v1beta/models/gemini-3-pro:generateContent');
    expect(new Headers(request.headers).get('x-goog-api-key')).toBe('sk-direct');
    expect(request.body.systemInstruction).toEqual({ parts: [{ text: '系统一\n\n系统二' }] });
    expect(request.body.contents).toEqual([
      { role: 'user', parts: [{ text: '你好' }, { text: '中部系统' }] },
      { role: 'model', parts: [{ text: '预填' }] },
    ]);
    expect(request.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high', includeThoughts: false });
    expect(request.body.safetySettings.every((item: any) => item.threshold === 'OFF')).toBe(true);
    const streamed = buildDirectProviderRequest_ACU(buildCustomApiRequestBody_ACU(messages, config({ ...base, url: 'https://g.example.com/v1beta', streamingEnabled: true })));
    expect(streamed.url).toBe('https://g.example.com/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse');
  });

  it('Gemini Interactions：自动补 /v1beta，system 合成 system_instruction', () => {
    const request = buildDirectProviderRequest_ACU(buildCustomApiRequestBody_ACU(messages, config({ sendChannel: 'direct', customApiFormat: 'gemini_interactions', url: 'https://g.example.com' })));
    expect(request.url).toBe('https://g.example.com/v1beta/interactions');
    expect(request.body.system_instruction).toBe('系统一\n\n系统二\n\n中部系统');
    expect(request.body.input).toEqual([
      { type: 'user_input', content: [{ type: 'text', text: '你好' }] },
      { type: 'model_output', content: [{ type: 'text', text: '预填' }] },
    ]);
    expect(request.body.store).toBe(false);
  });

  it('原生工具：按协议改写工具定义与选择方式', () => {
    const tools = [{ type: 'function', function: { name: 'table_sql', description: '写表', parameters: { type: 'object' } } }];
    const claude = buildDirectProviderRequest_ACU(buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct', customApiFormat: 'claude_messages' }), { tools, toolChoice: 'auto' }));
    expect(claude.body.tools).toEqual([{ name: 'table_sql', description: '写表', input_schema: { type: 'object' } }]);
    expect(claude.body.tool_choice).toEqual({ type: 'auto' });
    const gemini = buildDirectProviderRequest_ACU(buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct', customApiFormat: 'gemini_generate_content' }), { tools, toolChoice: 'auto' }));
    expect(gemini.body.tools).toEqual([{ function_declarations: [{ name: 'table_sql', description: '写表', parameters: { type: 'object' } }] }]);
    expect(gemini.body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  });

  it('附加请求标头里用户写的同名头覆盖默认密钥头；格式不对时不发请求', async () => {
    const request = buildDirectProviderRequest_ACU(buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct', requestHeaders: 'Authorization: Bearer relay-token' })));
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer relay-token');
    const bad = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct', requestHeaders: '不是标头' }));
    await expect(sendChatCompletionBody_ACU(bad)).rejects.toThrow('附加请求标头');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('直接发送的回复归一', () => {
  it('Claude：正文拼接、tool_use 转 tool_calls、用量映射', () => {
    const reply = normalizeDirectProviderReply_ACU({
      content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '甲' }, { type: 'text', text: '乙' }, { type: 'tool_use', id: 'tu1', name: 'table_sql', input: { sql: 'x' } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }, 'claude_messages') as any;
    expect(reply.choices[0].message.content).toBe('甲乙');
    expect(reply.choices[0].message.tool_calls).toEqual([{ id: 'tu1', type: 'function', function: { name: 'table_sql', arguments: '{"sql":"x"}' } }]);
    expect(reply.usage.prompt_tokens).toBe(10);
    expect(reply.usage.completion_tokens).toBe(5);
  });

  it('Responses、Gemini、Interactions 的正文都能取到，思考内容不混进正文', () => {
    expect((normalizeDirectProviderReply_ACU({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'R' }] }] }, 'openai_responses') as any).choices[0].message.content).toBe('R');
    expect((normalizeDirectProviderReply_ACU({ candidates: [{ content: { parts: [{ text: '想', thought: true }, { text: 'G' }] } }] }, 'gemini_generate_content') as any).choices[0].message.content).toBe('G');
    expect((normalizeDirectProviderReply_ACU({ steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'I' }] }] }, 'gemini_interactions') as any).choices[0].message.content).toBe('I');
  });

  it('非流式直接发送的回复经归一后由既有解析取到正文', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: '克劳德' }] }));
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], config({ sendChannel: 'direct', customApiFormat: 'claude_messages' }));
    expect(await postChatCompletion_ACU(body)).toBe('克劳德');
  });
});
