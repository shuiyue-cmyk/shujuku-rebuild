/**
 * tests/service/ai/prompt-api-call.test.ts
 * AI API 调用 — prompt 组装 + 流式/非流式响应处理 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockCurrentAbortControllerRef,
  mockCurrentJsonTableData,
  mockSetCurrentAbortController,
  mockTrackAbortController,
  mockUntrackAbortController,
  mockGetApiConfigByPreset,
  mockGetPersonaDescription,
  mockGetCharDescription,
  mockIsGenerateRawAvailable,
  mockGenerateRaw,
  mockSendConnectionManagerRequest,
  mockTriggerSlash,
  mockGetConnectionManagerProfiles,
  mockGetHostRequestHeaders,
  mockApplyExcludeRulesToText,
  mockGetLatestAIMessageContent,
  mockGetPlotFromHistory,
  mockParseIfBlocksInContent,
  mockParseRandomTags,
  mockReplaceRandomVariables,
  mockReplaceDbSqlVariables,
  mockBuildCustomBody,
} = vi.hoisted(() => {
  const mockCurrentAbortControllerRef = { value: null as any };
  return {
    mockSettings: {
      tableApiPreset: '',
      charCardPrompt: [
        { role: 'SYSTEM', content: '系统提示词 $0 $1 $4' },
        { role: 'USER', content: '用户提示词 $U $C $6 $8' },
      ],
      tableContextExcludeTags: '',
      tableContextExcludeRules: [],
      streamingEnabled: false,
      promptTemplateSettings: { enabled: true },
    } as any,
    mockCurrentAbortControllerRef,
    mockCurrentJsonTableData: { sheet_0: { name: '表' } } as any,
    mockSetCurrentAbortController: vi.fn((v: any) => { mockCurrentAbortControllerRef.value = v; }),
    mockTrackAbortController: vi.fn(),
    mockUntrackAbortController: vi.fn(),
    mockGetApiConfigByPreset: vi.fn(),
    mockGetPersonaDescription: vi.fn(() => '用户设定'),
    mockGetCharDescription: vi.fn(() => '角色描述'),
    mockIsGenerateRawAvailable: vi.fn(() => true),
    mockGenerateRaw: vi.fn(),
    mockSendConnectionManagerRequest: vi.fn(),
    mockTriggerSlash: vi.fn(),
    mockGetConnectionManagerProfiles: vi.fn(() => []),
    mockGetHostRequestHeaders: vi.fn(() => ({ 'X-Custom': 'test' })),
    mockApplyExcludeRulesToText: vi.fn((text: string) => text),
    mockGetLatestAIMessageContent: vi.fn(() => '最近AI内容'),
    mockGetPlotFromHistory: vi.fn(() => '上轮剧情'),
    mockParseIfBlocksInContent: vi.fn((text: string) => text),
    mockParseRandomTags: vi.fn((text: string) => text),
    mockReplaceRandomVariables: vi.fn((text: string) => text),
    mockReplaceDbSqlVariables: vi.fn((text: string) => text),
    mockBuildCustomBody: vi.fn((messages: any[], _config: any, _overrides: any = {}) => ({
      messages,
      model: 'gpt-4',
      max_tokens: 4096,
      temperature: 1.0,
      top_p: 0.95,
      stream: false,
    })),
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentAbortController_ACU() { return mockCurrentAbortControllerRef.value; },
  trackAbortController_ACU: mockTrackAbortController,
  untrackAbortController_ACU: mockUntrackAbortController,
  _set_currentAbortController_ACU: mockSetCurrentAbortController,
  currentJsonTableData_ACU: mockCurrentJsonTableData,
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  getApiConfigByPreset_ACU: mockGetApiConfigByPreset,
  buildCustomApiRequestBody_ACU: mockBuildCustomBody,
}));

vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getPersonaDescription_ACU: mockGetPersonaDescription,
  getCharDescription_ACU: mockGetCharDescription,
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  isGenerateRawAvailable_ACU: mockIsGenerateRawAvailable,
  generateRaw_ACU: mockGenerateRaw,
  sendConnectionManagerRequest_ACU: mockSendConnectionManagerRequest,
  triggerSlash_ACU: mockTriggerSlash,
  getConnectionManagerProfiles_ACU: mockGetConnectionManagerProfiles,
  getHostRequestHeaders_ACU: mockGetHostRequestHeaders,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  normalizeExcludeRules_ACU: (rules: any) => Array.isArray(rules) ? rules : [],
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applyExcludeRulesToText_ACU: mockApplyExcludeRulesToText,
  getLatestAIMessageContent_ACU: mockGetLatestAIMessageContent,
  getPlotFromHistory_ACU: mockGetPlotFromHistory,
  parseIfBlocksInContent_ACU: mockParseIfBlocksInContent,
  parseRandomTags_ACU: mockParseRandomTags,
  replaceRandomVariables_ACU: mockReplaceRandomVariables,
}));

vi.mock('../../../src/service/runtime/template-vars/sql-query-var', () => ({
  replaceDbSqlVariables: mockReplaceDbSqlVariables,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: vi.fn((data: any) => Object.keys(data || {}).filter((key) => key.startsWith('sheet_'))),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  callCustomOpenAI_ACU,
  handleApiResponse_ACU,
  RetryableAiResponseError_ACU,
} from '../../../src/service/ai/prompt-builder/prompt-api-call';

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentAbortControllerRef.value = null;
  mockSettings.tableApiPreset = '';
  mockSettings.charCardPrompt = [
    { role: 'SYSTEM', content: '系统提示词 $0 $1 $4' },
    { role: 'USER', content: '用户提示词 $U $C $6 $8' },
  ];
  mockSettings.tableContextExcludeTags = '';
  mockSettings.tableContextExcludeRules = [];
  mockSettings.streamingEnabled = false;
  mockSettings.promptTemplateSettings = { enabled: true };

  mockApplyExcludeRulesToText.mockImplementation((text: string) => text);
  mockGetApiConfigByPreset.mockReturnValue({
    apiMode: 'custom',
    apiConfig: { useMainApi: true, url: '', model: '', max_tokens: 4096 },
    tavernProfile: '',
  });
  mockGetPersonaDescription.mockReturnValue('用户设定');
  mockGetCharDescription.mockReturnValue('角色描述');
  mockGetPlotFromHistory.mockReturnValue('上轮剧情');
  mockIsGenerateRawAvailable.mockReturnValue(true);
});

// ═══ handleApiResponse_ACU ═══
describe('handleApiResponse_ACU', () => {
  it('非流式模式：解析 JSON 响应中的 choices[0].message.content', async () => {
    mockSettings.streamingEnabled = false;
    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'AI回复内容' } }],
      }),
    };
    const result = await handleApiResponse_ACU(mockResponse);
    expect(result).toBe('AI回复内容');
  });

  it('非流式模式：解析 content 字段', async () => {
    mockSettings.streamingEnabled = false;
    const mockResponse = {
      json: vi.fn().mockResolvedValue({ content: '直接内容' }),
    };
    const result = await handleApiResponse_ACU(mockResponse);
    expect(result).toBe('直接内容');
  });

  it('非流式模式：解析失败返回 null', async () => {
    mockSettings.streamingEnabled = false;
    const mockResponse = {
      json: vi.fn().mockRejectedValue(new Error('JSON 解析失败')),
    };
    const result = await handleApiResponse_ACU(mockResponse);
    expect(result).toBeNull();
  });

  it('非流式模式：未知格式返回 null', async () => {
    mockSettings.streamingEnabled = false;
    const mockResponse = {
      json: vi.fn().mockResolvedValue({ unknownField: true }),
    };
    const result = await handleApiResponse_ACU(mockResponse);
    expect(result).toBeNull();
  });

  it('流式模式：从 SSE 流中拼接 delta.content', async () => {
    mockSettings.streamingEnabled = true;
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"好"}}]}\n\n'),
      encoder.encode('data: [DONE]\n\n'),
    ];
    let chunkIndex = 0;
    const mockReader = {
      read: vi.fn(async () => {
        if (chunkIndex < chunks.length) {
          return { done: false, value: chunks[chunkIndex++] };
        }
        return { done: true, value: undefined };
      }),
      releaseLock: vi.fn(),
    };
    const mockResponse = {
      body: { getReader: () => mockReader },
    };
    const result = await handleApiResponse_ACU(mockResponse);
    expect(result).toBe('你好');
    expect(mockReader.releaseLock).toHaveBeenCalled();
  });
});

// ═══ callCustomOpenAI_ACU — prompt 组装 ═══
describe('callCustomOpenAI_ACU — prompt 组装', () => {
  it('占位符 $0/$1/$4/$6/$8/$9/$U/$C 被正确替换', async () => {
    mockSettings.charCardPrompt = [
      { role: 'USER', content: '表格:$0 消息:$1 世界书:$4 剧情:$6 额外:$8 内部已排除世界书:$9/$9 用户:$U 角色:$C' },
    ];
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复');

    const result = await callCustomOpenAI_ACU({
      tableDataText: '表格数据',
      messagesText: '消息数据',
      worldbookContent: '世界书数据',
      worldbookDatabaseExcludedContent: '仅保留非内部条目',
      manualExtraHint: '额外提示',
    });

    expect(result).toBe('AI回复');
    // 验证 generateRaw 收到的 messages 中占位符已被替换
    const calledMessages = mockGenerateRaw.mock.calls[0][0].ordered_prompts;
    const content = calledMessages[0].content;
    expect(content).toContain('表格数据');
    expect(content).toContain('消息数据');
    expect(content).toContain('世界书数据');
    expect(content).toContain('上轮剧情');
    expect(content).toContain('额外提示');
    expect(content).toContain('内部已排除世界书:仅保留非内部条目/仅保留非内部条目');
    expect(content).toContain('用户设定');
    expect(content).toContain('角色描述');
    expect(content).not.toContain('$0');
    expect(content).not.toContain('$U');
  });

  it('if seed 优先使用 prepare 阶段冻结的填表上下文范围', async () => {
    mockSettings.charCardPrompt = [{ role: 'USER', content: '<if seed="批次关键词">命中</if>' }];
    mockGenerateRaw.mockResolvedValue('AI回复');
    mockGetLatestAIMessageContent.mockReturnValue('聊天最新层，不应参与本批次判断');
    mockParseIfBlocksInContent.mockImplementation((text: string) => text);

    await callCustomOpenAI_ACU({
      tableDataText: '',
      messagesText: '当前最新对话内容:\n角色: 批次关键词',
      conditionalSeedContent: '批次关键词',
    });

    expect(mockParseIfBlocksInContent).toHaveBeenCalledWith(
      '<if seed="批次关键词">命中</if>',
      expect.objectContaining({ seedContent: '批次关键词' }),
      0,
    );
    expect(mockGetLatestAIMessageContent).not.toHaveBeenCalled();
  });

  it('conditionalSeedContent 为空字符串时也不回退聊天最新层', async () => {
    mockSettings.charCardPrompt = [{ role: 'USER', content: '<if seed="批次关键词">命中</if>' }];
    mockGenerateRaw.mockResolvedValue('AI回复');
    mockGetLatestAIMessageContent.mockReturnValue('聊天最新层，空范围时不得读取');
    mockParseIfBlocksInContent.mockImplementation((text: string) => text);

    await callCustomOpenAI_ACU({
      tableDataText: '',
      messagesText: '当前最新对话内容:\n(无最新对话内容)',
      // 新调用方明确传入空字符串：表示本次填表范围内没有可用的 AI 内容，
      // 必须使用空 seedContent，而不是回退读取聊天最新层。
      conditionalSeedContent: '',
    });

    expect(mockParseIfBlocksInContent).toHaveBeenCalledWith(
      '<if seed="批次关键词">命中</if>',
      expect.objectContaining({ seedContent: '' }),
      0,
    );
    expect(mockGetLatestAIMessageContent).not.toHaveBeenCalled();
  });


  it('charCardPrompt 为字符串时转为单段落', async () => {
    mockSettings.charCardPrompt = '纯字符串提示词 $0';
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复');

    await callCustomOpenAI_ACU({ tableDataText: '数据' });

    const calledMessages = mockGenerateRaw.mock.calls[0][0].ordered_prompts;
    expect(calledMessages).toHaveLength(1);
    expect(calledMessages[0].role).toBe('user');
    expect(calledMessages[0].content).toContain('数据');
  });

  it('getPersonaDescription 抛错时 $U 替换为空字符串', async () => {
    mockSettings.charCardPrompt = [{ role: 'USER', content: '用户:$U' }];
    mockGetPersonaDescription.mockImplementation(() => { throw new Error('获取失败'); });
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复');

    await callCustomOpenAI_ACU({});

    const content = mockGenerateRaw.mock.calls[0][0].ordered_prompts[0].content;
    expect(content).toBe('用户:');
  });

  it('在 EJS 之前替换已确认的表名 token，并将未知 token 原样保留', async () => {
    mockSettings.charCardPrompt = [{ role: 'USER', content: '表:{{人物关系表}} 未知:{{不存在的表}}' }];
    mockGenerateRaw.mockResolvedValue('AI回复');
    const ejsEvaluate = vi.fn(async (content: string) => content);
    (globalThis as any).EjsTemplate = { evalTemplate: ejsEvaluate };
    const resolveTableWorldbookContent = vi.fn(async (tableName: string) => (
      tableName.trim() === '人物关系表' ? '<worldbook_context>\n关系正文\n</worldbook_context>' : null
    ));

    await callCustomOpenAI_ACU({ resolveTableWorldbookContent });

    expect(resolveTableWorldbookContent).toHaveBeenCalledWith('人物关系表');
    expect(resolveTableWorldbookContent).toHaveBeenCalledWith('不存在的表');
    expect(ejsEvaluate).toHaveBeenCalledWith('表:<worldbook_context>\n关系正文\n</worldbook_context> 未知:{{不存在的表}}');
    const content = mockGenerateRaw.mock.calls[0][0].ordered_prompts[0].content;
    expect(content).toContain('<worldbook_context>\n关系正文\n</worldbook_context>');
    expect(content).toContain('{{不存在的表}}');
    delete (globalThis as any).EjsTemplate;
  });

  it('$9 按填表上下文排除规则过滤', async () => {
    mockSettings.charCardPrompt = [{ role: 'USER', content: '$9' }];
    mockSettings.tableContextExcludeRules = ['已排除'];
    mockApplyExcludeRulesToText.mockImplementation((text: string) => text === '已排除的世界书正文' ? '过滤后的世界书' : text);
    mockGenerateRaw.mockResolvedValue('AI回复');

    await callCustomOpenAI_ACU({ worldbookDatabaseExcludedContent: '已排除的世界书正文' });

    expect(mockApplyExcludeRulesToText).toHaveBeenCalledWith('已排除的世界书正文', expect.any(Object));
    expect(mockGenerateRaw.mock.calls[0][0].ordered_prompts[0].content).toBe('过滤后的世界书');
  });
});

// ═══ callCustomOpenAI_ACU — useMainApi 模式 ═══
describe('callCustomOpenAI_ACU — useMainApi 模式', () => {
  beforeEach(() => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      tavernProfile: '',
    });
  });

  it('正常调用 generateRaw 并返回结果', async () => {
    mockGenerateRaw.mockResolvedValue('  AI回复  ');
    const result = await callCustomOpenAI_ACU({});
    expect(result).toBe('AI回复');
    expect(mockGenerateRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        ordered_prompts: expect.any(Array),
        should_stream: false,
      }),
    );
  });

  it('generateRaw 不可用时抛错', async () => {
    mockIsGenerateRawAvailable.mockReturnValue(false);
    await expect(callCustomOpenAI_ACU({})).rejects.toThrow('generateRaw');
  });

  it('generateRaw 返回非字符串时抛错', async () => {
    mockGenerateRaw.mockResolvedValue(42);
    await expect(callCustomOpenAI_ACU({})).rejects.toThrow('未返回预期的文本响应');
  });
});

// ═══ callCustomOpenAI_ACU — custom fetch 模式 ═══
describe('callCustomOpenAI_ACU — custom fetch 模式', () => {
  beforeEach(() => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: false, url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 },
      tavernProfile: '',
    });
  });

  it('正常 fetch 并返回解析结果', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'fetch回复' } }] }),
    });
    const result = await callCustomOpenAI_ACU({});
    expect(result).toBe('fetch回复');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/backends/chat-completions/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('URL 或 model 未配置时抛错', async () => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: false, url: '', model: '' },
      tavernProfile: '',
    });
    await expect(callCustomOpenAI_ACU({})).rejects.toThrow('URL或模型未配置');
  });

  it('fetch 返回非 ok 时抛错', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });
    await expect(callCustomOpenAI_ACU({})).rejects.toThrow('500');
  });

  it('handleApiResponse 返回 null 时抛出可重试的模型响应错误', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ unknownFormat: true }),
    });
    const request = callCustomOpenAI_ACU({});
    await expect(request).rejects.toMatchObject({
      name: 'RetryableAiResponseError',
      code: 'empty_or_invalid_api_response',
    });
    await expect(request).rejects.toBeInstanceOf(RetryableAiResponseError_ACU);
  });

  it('custom fetch overrides 不含 temperature/topP/maxTokens', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'fetch回复' } }] }),
    });
    await callCustomOpenAI_ACU({});
    expect(mockBuildCustomBody).toHaveBeenCalled();
    const overrides = mockBuildCustomBody.mock.calls[mockBuildCustomBody.mock.calls.length - 1][2];
    expect(overrides).not.toHaveProperty('temperature');
    expect(overrides).not.toHaveProperty('topP');
    expect(overrides).not.toHaveProperty('maxTokens');
    expect(overrides.stripModelPrefix).toBe(false);
  });

});

// ═══ callCustomOpenAI_ACU — tavern 模式 ═══
describe('callCustomOpenAI_ACU — tavern 模式', () => {
  beforeEach(() => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'tavern',
      apiConfig: { max_tokens: 4096 },
      tavernProfile: 'profile-1',
    });
  });

  it('profileId 为空时抛错', async () => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'tavern',
      apiConfig: {},
      tavernProfile: '',
    });
    await expect(callCustomOpenAI_ACU({})).rejects.toThrow('未选择酒馆连接预设');
  });

  it('目标预设不存在时抛错', async () => {
    mockGetConnectionManagerProfiles.mockReturnValue([]);
    mockTriggerSlash.mockResolvedValue('原始预设');
    await expect(callCustomOpenAI_ACU({})).rejects.toThrow('无法找到ID为');
  });

  it('预设无 API 配置时抛错', async () => {
    mockGetConnectionManagerProfiles.mockReturnValue([
      { id: 'profile-1', name: '预设1', api: '', preset: 'preset-1' },
    ]);
    mockTriggerSlash.mockResolvedValue('原始预设');
    await expect(callCustomOpenAI_ACU({})).rejects.toThrow('没有配置API');
  });

  it('正常调用返回结果', async () => {
    mockGetConnectionManagerProfiles.mockReturnValue([
      { id: 'profile-1', name: '预设1', api: 'openai', preset: 'preset-1' },
    ]);
    mockTriggerSlash.mockResolvedValue('预设1');
    mockSendConnectionManagerRequest.mockResolvedValue({
      ok: true,
      result: { choices: [{ message: { content: '酒馆回复' } }] },
    });
    const result = await callCustomOpenAI_ACU({});
    expect(result).toBe('酒馆回复');
    expect(mockSendConnectionManagerRequest).toHaveBeenCalledWith('profile-1', expect.any(Array), 4096);
  });

  it('max_tokens=0 透传给 sendConnectionManagerRequest_ACU', async () => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'tavern',
      apiConfig: { max_tokens: 0 },
      tavernProfile: 'profile-1',
    });
    mockGetConnectionManagerProfiles.mockReturnValue([
      { id: 'profile-1', name: '预设1', api: 'openai', preset: 'preset-1' },
    ]);
    mockTriggerSlash.mockResolvedValue('预设1');
    mockSendConnectionManagerRequest.mockResolvedValue({
      ok: true,
      result: { choices: [{ message: { content: '酒馆回复' } }] },
    });
    const result = await callCustomOpenAI_ACU({});
    expect(result).toBe('酒馆回复');
    expect(mockSendConnectionManagerRequest).toHaveBeenCalledWith('profile-1', expect.any(Array), 0);
  });
});

// ═══ callCustomOpenAI_ACU — AbortController 管理 ═══
describe('callCustomOpenAI_ACU — AbortController 管理', () => {
  it('finally 块中 untrack 并重置 currentAbortController', async () => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复');

    await callCustomOpenAI_ACU({});

    expect(mockTrackAbortController).toHaveBeenCalledTimes(1);
    expect(mockUntrackAbortController).toHaveBeenCalledTimes(1);
    // 传入的 AbortController 应该被 track 和 untrack
    const trackedController = mockTrackAbortController.mock.calls[0][0];
    const untrackedController = mockUntrackAbortController.mock.calls[0][0];
    expect(trackedController).toBe(untrackedController);
  });

  it('使用外部传入的 AbortController', async () => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复');
    const externalController = new AbortController();

    await callCustomOpenAI_ACU({}, externalController);

    expect(mockSetCurrentAbortController).toHaveBeenCalledWith(externalController);
    expect(mockTrackAbortController).toHaveBeenCalledWith(externalController);
    expect(mockUntrackAbortController).toHaveBeenCalledWith(externalController);
  });

  it('API 调用失败后仍然执行 untrack', async () => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      tavernProfile: '',
    });
    mockIsGenerateRawAvailable.mockReturnValue(false);

    await expect(callCustomOpenAI_ACU({})).rejects.toThrow();
    expect(mockUntrackAbortController).toHaveBeenCalledTimes(1);
  });

  // ═══════════════════════════════════════════════════════════════
  // options.tableApiPreset 覆盖
  // ═══════════════════════════════════════════════════════════════
  it('options.tableApiPreset 覆盖全局 tableApiPreset', async () => {
    mockSettings.tableApiPreset = 'global-preset';
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '', max_tokens: 4096, temperature: 1.0 },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复内容');

    const dynamicContent = {
      tableDataText: '表格数据',
      messagesText: '消息',
      worldbookContent: '世界书',
      manualExtraHint: '',
    };

    await callCustomOpenAI_ACU(dynamicContent, null, { tableApiPreset: 'override-preset' });

    // getApiConfigByPreset 应被调用时传入 override-preset，而非 global-preset
    expect(mockGetApiConfigByPreset).toHaveBeenCalledWith('override-preset');
  });

  it('options 无 tableApiPreset 时使用全局 tableApiPreset', async () => {
    mockSettings.tableApiPreset = 'global-preset';
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '', max_tokens: 4096, temperature: 1.0 },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复内容');

    const dynamicContent = {
      tableDataText: '表格数据',
      messagesText: '消息',
      worldbookContent: '世界书',
      manualExtraHint: '',
    };

    await callCustomOpenAI_ACU(dynamicContent, null, {});

    expect(mockGetApiConfigByPreset).toHaveBeenCalledWith('global-preset');
  });

  it('options 为 null 时使用全局 tableApiPreset', async () => {
    mockSettings.tableApiPreset = 'global-preset';
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '', max_tokens: 4096, temperature: 1.0 },
      tavernProfile: '',
    });
    mockGenerateRaw.mockResolvedValue('AI回复内容');

    const dynamicContent = {
      tableDataText: '表格数据',
      messagesText: '消息',
      worldbookContent: '世界书',
      manualExtraHint: '',
    };

    await callCustomOpenAI_ACU(dynamicContent, null, null);

    expect(mockGetApiConfigByPreset).toHaveBeenCalledWith('global-preset');
  });
});
