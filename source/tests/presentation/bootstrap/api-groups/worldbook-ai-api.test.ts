/**
 * tests/presentation/bootstrap/api-groups/worldbook-ai-api.test.ts
 * worldbook-ai-api callAI 参数透传测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallAIWithPreset, mockSettings } = vi.hoisted(() => ({
  mockCallAIWithPreset: vi.fn(),
  mockSettings: { streamingEnabled: false, tavernProfile: 'default' } as any,
}));

vi.mock('../../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: mockCallAIWithPreset,
  // 与真实 isRetryableAiRequestError_ACU 同语义，供单发重试包装的 catch 路径使用。
  isRetryableAiRequestError_ACU: (error: any) => {
    const status = Number(error?.status);
    if (String(error?.name || '') === 'AbortError') return false;
    if (Number.isFinite(status)) return status === 408 || status === 429 || (status >= 500 && status <= 599);
    if (String(error?.name || '') === 'TimeoutError') return true;
    return error instanceof TypeError || /(?:timeout|timed out|network(?:\s+error)?|connection reset|socket hang up)/i.test(String(error?.message || ''));
  },
}));
vi.mock('../../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: null,
}));
vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));
vi.mock('../../../../src/shared/env', () => ({ topLevelWindow_ACU: {} }));
vi.mock('../../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: vi.fn() }));
vi.mock('../../../../src/service/settings/settings-service', () => ({ setZeroTkOccupyMode_ACU: vi.fn() }));
vi.mock('../../../../src/service/worldbook/pipeline', () => ({ deleteAllGeneratedEntries_ACU: vi.fn(), updateReadableLorebookEntry_ACU: vi.fn() }));
vi.mock('../../../../src/service/worldbook/injection-engine', () => ({ updateOutlineTableEntry_ACU: vi.fn() }));
vi.mock('../../../../src/service/runtime/helpers-remaining', () => ({ formatJsonToReadable_ACU: vi.fn() }));
vi.mock('../../../../src/service/optimization/content-optimization', () => ({ cancelContentOptimization_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/components/optimization-ui', () => ({ reoptimizeMessage_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));

import { createWorldbookAiApi } from '../../../../src/presentation/bootstrap/api-groups/worldbook-ai-api';

beforeEach(() => {
  vi.clearAllMocks();
  mockCallAIWithPreset.mockResolvedValue('AI reply');
});

describe('callAI 委托与输入边界', () => {
  it('使用默认 preset 和未指定的 max tokens 委托 service 层', async () => {
    const api = createWorldbookAiApi({} as any);
    const messages = [{ role: 'user', content: 'hello' }];

    await expect(api.callAI(messages)).resolves.toBe('AI reply');
    expect(mockCallAIWithPreset).toHaveBeenCalledWith(messages, '', undefined);
  });

  it('保留 presetName 并透传 max_tokens=0', async () => {
    const api = createWorldbookAiApi({} as any);
    const messages = [{ role: 'user', content: 'hello' }];

    await api.callAI(messages, { presetName: ' preset-A ', max_tokens: 0 });
    expect(mockCallAIWithPreset).toHaveBeenCalledWith(messages, 'preset-A', 0);
  });

  it('接受 maxTokens 驼峰别名', async () => {
    const api = createWorldbookAiApi({} as any);
    const messages = [{ role: 'user', content: 'hello' }];

    await api.callAI(messages, { maxTokens: 0 });
    expect(mockCallAIWithPreset).toHaveBeenCalledWith(messages, '', 0);
  });

  it('拒绝空消息而不调用 service 层', async () => {
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([])).resolves.toBeNull();
    expect(mockCallAIWithPreset).not.toHaveBeenCalled();
  });

  it.each(['apiConfig', 'apiKey', 'url', 'requestHeaders', 'temperature', 'stream'])('拒绝禁止字段 %s', async forbiddenKey => {
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([{ role: 'user', content: 'hello' }], { [forbiddenKey]: 'unsafe' })).resolves.toBeNull();
    expect(mockCallAIWithPreset).not.toHaveBeenCalled();
  });

  it('service 层抛错时返回 null', async () => {
    mockCallAIWithPreset.mockRejectedValue(new Error('upstream failure'));
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([{ role: 'user', content: 'hello' }])).resolves.toBeNull();
  });

  it('瞬时 503 重试后成功（同调用形状逐字一致）', async () => {
    mockCallAIWithPreset
      .mockRejectedValueOnce(Object.assign(new Error('API请求失败: 503'), { status: 503 }))
      .mockResolvedValueOnce('recovered');
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([{ role: 'user', content: 'hello' }])).resolves.toBe('recovered');
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(2);
  }, 15000);

  it('AbortError 立停不重试，返回 null', async () => {
    mockCallAIWithPreset.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([{ role: 'user', content: 'hello' }])).resolves.toBeNull();
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
  });
});
