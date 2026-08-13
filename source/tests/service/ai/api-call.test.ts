/**
 * tests/service/ai/api-call.test.ts
 * AI 调用编排 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockIsGenerateRawAvailable, mockGenerateRaw, mockSendConnectionManager, mockGetHeaders, mockHandleApiResponse } = vi.hoisted(() => ({
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
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  handleApiResponse_ACU: mockHandleApiResponse,
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

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

// mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  callApiWithPlotPreset_ACU,
  getApiConfigByPreset_ACU,
  callAIWithPreset_ACU,
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

  it('excludeBodyParams 作为 SillyTavern custom_exclude_body 透传', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, excludeBodyParams: 'temperature,top_p' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    expect(body.custom_exclude_body).toBe('- temperature\n- top_p');
    expect(body).toHaveProperty('max_tokens');
  });

  it('bodyParams 与 excludeBodyParams 分别透传给 SillyTavern 合并与排除', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, bodyParams: 'temperature:0.3', excludeBodyParams: 'temperature' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.custom_include_body).toBe('temperature:0.3');
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
