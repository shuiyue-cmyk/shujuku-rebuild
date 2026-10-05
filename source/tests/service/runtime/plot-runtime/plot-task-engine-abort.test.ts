/**
 * plot-task-engine 中断口径 — 普通失败继续、API 耗尽标记、宿主 Abort 不劫持。
 *
 * 经 runPlotTasksRuntime_ACU 公开入口驱动单任务预设，mock 边界：宿主状态、聊天数组、
 * 任务 API、世界书读取、Agent 可用性、绿灯清理。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockCallApi,
  mockReadContext,
} = vi.hoisted(() => ({
  mockCallApi: vi.fn(),
  mockReadContext: { characterLorebookNamesPromise: Promise.resolve([] as string[]), runId: 'test', dispose: vi.fn() },
}));

function rejectReadContextOnce(error: unknown): void {
  const rejected = Promise.reject(error);
  // 先挂一个空处理，避免“未处理拒绝”误报；真实读取 await 时仍按拒绝走。
  rejected.catch(() => {});
  (mockReadContext as any).characterLorebookNamesPromise = rejected;
}

vi.mock('../../../../src/service/runtime/state-manager', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    settings_ACU: {},
    abortController_ACU: null,
    currentChatFileIdentifier_ACU: 'chat-test',
    currentJsonTableData_ACU: null,
    tempPlotToSave_ACU: null,
    getCurrentIsolationKey_ACU: vi.fn(() => ''),
  _set_tempPlotToSave_ACU: vi.fn(),
  _set_currentJsonTableData_ACU: vi.fn(),
  _set_pendingFinalGenerationGreenlights_ACU: vi.fn(),
  capturePlotRuntimeScope_ACU: vi.fn(() => ({ chatId: 'chat-test', characterId: 'c', isolationKey: '', reliable: true })),
  trackAbortController_ACU: vi.fn(),
  untrackAbortController_ACU: vi.fn(),
  };
});

vi.mock('../../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../../../src/service/ai/api-call', () => ({
  callApiWithPlotPreset_ACU: mockCallApi,
}));

vi.mock('../../../../src/service/worldbook/pipeline', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getWorldbookContentForPlot_ACU: vi.fn(async () => '') };
});

vi.mock('../../../../src/service/runtime/plot-runtime/plot-tag-utils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    tryRenderPlotTemplateWithEjs_ACU: async (content: string) => {
      if (String(content).includes('[[THROW]]')) throw new Error('ejs boom');
      return actual.tryRenderPlotTemplateWithEjs_ACU(content);
    },
  };
});

vi.mock('../../../../src/service/runtime/plot-runtime/plot-worldbook-read-context', () => ({
  createPlotWorldbookReadContext_ACU: vi.fn(() => mockReadContext),
}));

vi.mock('../../../../src/agent/agent-worldbook-skill-meta', () => ({
  hasUsableWorldbookSkillMeta_ACU: vi.fn(() => false),
  resolveAgentWorldbookFilterAvailability_ACU: vi.fn(async () => ({ available: false })),
}));

vi.mock('../../../../src/agent/agent-worldbook-takeover', () => ({
  clearFinalGenerationGreenlights_ACU: vi.fn(async () => ({ status: 'ok' })),
  resolvePreTakeoverWorldbookSnapshot_ACU: vi.fn(),
  writeFinalGenerationGreenlights_ACU: vi.fn(async () => true),
}));

vi.mock('../../../../src/service/flight-mode/flight-mode-state', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, isFlightModeActive_ACU: vi.fn(() => false) };
});

vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  escapeRegExp_ACU: (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  hashUserInput_ACU: (s: string) => `hash:${String(s)}`,
  isEntryBlocked_ACU: () => false,
  normalizeNonNegativeInteger_ACU: (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 0 ? v : d),
  normalizePositiveInteger_ACU: (v: unknown, d: number) => (Number.isInteger(v) && (v as number) > 0 ? v : d),
  normalizeExcludeRules_ACU: (v: unknown) => v,
  normalizeExtractRules_ACU: (v: unknown) => v,
}));

import { runPlotTasksRuntime_ACU } from '../../../../src/service/runtime/plot-runtime/plot-task-engine';

function singleTaskSettings(overrides: Record<string, any> = {}): any {
  return {
    enabled: true,
    contextTurnCount: 0,
    loopSettings: { maxRetries: 3 },
    plotTasks: [
      {
        id: 't1',
        name: '任务1',
        enabled: true,
        stage: 1,
        order: 0,
        maxRetries: 1,
        minLength: 0,
        promptGroup: [{ role: 'user', content: '测试提示词' }],
        ...overrides,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCallApi.mockReset().mockResolvedValue('模型正常回复正文，长度足够。');
  (mockReadContext as any).characterLorebookNamesPromise = Promise.resolve([]);
});

describe('runPlotTasksRuntime_ACU 中断口径', () => {
  it('世界书读取抛宿主 AbortError（信号没断）：不抛到外层，告警后继续调 AI', async () => {
    rejectReadContextOnce(Object.assign(new Error('host reset'), { name: 'AbortError' }));
    const reportWarning = vi.fn();

    const result = await runPlotTasksRuntime_ACU(singleTaskSettings(), '继续', { reportWarning } as any);

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(result.successfulResults).toHaveLength(1);
    expect(reportWarning).toHaveBeenCalledWith(expect.stringContaining('世界书'));
  });

  it('世界书读取普通失败：告警后继续调 AI（世界书留空，不阻断任务）', async () => {
    rejectReadContextOnce(new Error('book boom'));
    const reportWarning = vi.fn();

    const result = await runPlotTasksRuntime_ACU(singleTaskSettings(), '继续', { reportWarning } as any);

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(result.successfulResults).toHaveLength(1);
    expect(reportWarning).toHaveBeenCalledWith(expect.stringContaining('世界书'));
  });

  it('API 次次失败耗尽重试：任务带 apiRetriesExhausted，顶层透出', async () => {
    mockCallApi.mockRejectedValue(new Error('API 500'));

    const result = await runPlotTasksRuntime_ACU(singleTaskSettings(), '继续');

    expect(result.finalMessage).toBeNull();
    expect(result.failedResults).toHaveLength(1);
    expect(result.failedResults[0].apiRetriesExhausted).toBe(true);
  });

  it('模型有回但过短耗尽重试：不是 API 耗尽，不带标记', async () => {
    mockCallApi.mockResolvedValue('短');
    const settings = singleTaskSettings({ minLength: 10 });

    const result = await runPlotTasksRuntime_ACU(settings, '继续');

    expect(result.finalMessage).toBeNull();
    expect(result.failedResults).toHaveLength(1);
    expect(result.failedResults[0].apiRetriesExhausted).not.toBe(true);
  });

  it('提示词段渲染失败只跳过该段，其余段继续调 AI', async () => {
    const settings = singleTaskSettings({});
    settings.plotTasks[0].promptGroup = [
      { role: 'user', content: '[[THROW]]' },
      { role: 'user', content: '正常段' },
    ];
    const reportWarning = vi.fn();

    const result = await runPlotTasksRuntime_ACU(settings, '继续', { reportWarning } as any);

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    const sentMessages = mockCallApi.mock.calls[0][0];
    expect(sentMessages.map((m: any) => m.content)).toEqual(['正常段']);
    expect(result.successfulResults).toHaveLength(1);
    expect(reportWarning).toHaveBeenCalledWith(expect.stringContaining('提示词段'));
  });
});
