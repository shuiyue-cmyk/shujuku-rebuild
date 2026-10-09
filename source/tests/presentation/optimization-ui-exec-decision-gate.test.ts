/**
 * tests/presentation/optimization-ui-exec-decision-gate.test.ts
 * 正文替换「替换前判定」接线：决策模型判「好」才替换，判「不好」保持原文；判定失败照常替换。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const chat: any[] = [];
  const processed = new Map<string, string>();
  const hash = (value: string) => `sha:${value.length}:${value}`;
  const perform = vi.fn(async (_content: string, _options: any) => ({
    success: true,
    optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
    summary: '一处改进',
    optimizedContent: '',
  }));
  const record = vi.fn((payload: any) => {
    const messageId = payload?.messageId;
    const content = payload?.content;
    if (messageId === null || messageId === undefined) return null;
    if (typeof content !== 'string' || !content) return null;
    processed.set(String(messageId), hash(content));
    return { messageId: String(messageId), contentHash: hash(content) };
  });
  const shouldSkip = vi.fn((messageId: any, content: any) => {
    if (messageId === null || messageId === undefined) return false;
    if (typeof content !== 'string' || !content) return false;
    return processed.get(String(messageId)) === hash(content);
  });
  const replace = vi.fn(async (messageIndex: number, newContent: string) => {
    const message = chat[messageIndex];
    if (!message) return false;
    message.mes = newContent;
    return true;
  });
  return {
    chat,
    processed,
    hash,
    perform,
    record,
    shouldSkip,
    replace,
    setLastBase: vi.fn(),
    logDebug: vi.fn(),
    logError: vi.fn(),
    toast: vi.fn(),
    showResultDialog: vi.fn(),
    showResultToast: vi.fn(),
    showDiffDialogForLoop: vi.fn(),
    triggerAutoUpdate: vi.fn(async () => undefined),
    judge: vi.fn(async (_text: string): Promise<any> => ({ kind: 'disabled' })),
    showOverlay: vi.fn(),
    hideOverlay: vi.fn(),
    ensureNotCancelled: vi.fn(),
    abortSignal: new AbortController().signal,
    releaseAbort: vi.fn(),
  };
});

vi.mock('../../src/service/plot/plot-state', () => ({
  _set_currentEditablePlotPresetState_ACU: vi.fn(),
  _set_activePlotEditorSettings_ACU: vi.fn(),
  _set_currentPlotTaskEditorId_ACU: vi.fn(),
}));
vi.mock('../../src/presentation/theme/toast', () => ({ showToastr_ACU: h.toast }));
vi.mock('../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => h.chat,
  replaceChatMessage_ACU: (...args: any[]) => h.replace(...(args as [number, string])),
  getOriginalContent_ACU: (index: number) => h.chat[index]?.extra?._acu_original_content || null,
}));
vi.mock('../../src/presentation/dom-utils', () => ({
  jQuery_API_ACU: (() => {
    const api: any = () => api;
    api.append = () => api;
    api.on = () => api;
    api.off = () => api;
    api.prop = () => api;
    api.text = () => api;
    api.remove = () => api;
    return api;
  })(),
}));
vi.mock('../../src/service/runtime/state-manager', () => ({
  settings_ACU: { contentOptimizationSettings: {} },
}));
vi.mock('../../src/shared/html-helpers', () => ({ escapeHtml_ACU: (value: any) => String(value) }));
vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: h.logDebug,
  logError_ACU: h.logError,
}));
vi.mock('../../src/presentation/triggers/settings-ui-sync', () => ({
  triggerAutomaticUpdateIfNeeded_ACU: (...args: any[]) => h.triggerAutoUpdate(...(args as [])),
}));
vi.mock('../../src/service/optimization/content-optimization', () => ({
  contentOptimizationAbortRequested_ACU: false,
  ensureOptimizationNotCancelled_ACU: (...args: any[]) => h.ensureNotCancelled(...(args as [])),
  trackContentOptimizationAbort_ACU: () => ({ signal: h.abortSignal, release: h.releaseAbort }),
  performContentOptimization_ACU: (...args: any[]) => h.perform(...(args as [string, any])),
  setLastOptimizationBase_ACU: (...args: any[]) => h.setLastBase(...(args as [any])),
  shouldSkipDuplicateAutoContentOptimization_ACU: (...args: any[]) => h.shouldSkip(...(args as [any, any])),
  recordAutoContentOptimizationProcessed_ACU: (...args: any[]) => h.record(...(args as [any])),
  _set_optimizationProgressToast_ACU: vi.fn(),
  _set_contentOptimizationAbortRequested_ACU: vi.fn(),
}));
vi.mock('../../src/service/runtime/helpers-remaining', () => ({
  applyContextTagFilters_ACU: (text: string) => text,
}));
vi.mock('../../src/presentation/components/optimization-ui/optimization-ui-overlay', () => ({
  showOptimizationOverlay_ACU: (...args: any[]) => h.showOverlay(...(args as [])),
  hideOptimizationOverlay_ACU: (...args: any[]) => h.hideOverlay(...(args as [])),
  showOptimizationProgressToast_ACU: vi.fn(),
  hideOptimizationProgressToast_ACU: vi.fn(),
}));
vi.mock('../../src/service/optimization/decision-gate', () => ({
  judgeContentForAutoReplace_ACU: (...args: any[]) => h.judge(...(args as [string])),
}));
vi.mock('../../src/presentation/components/optimization-ui/optimization-ui-diff', () => ({
  showOptimizationDiffDialogForLoop_ACU: h.showDiffDialogForLoop,
  showOptimizationResultDialog_ACU: h.showResultDialog,
  showOptimizationResultToast_ACU: h.showResultToast,
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import { executeContentOptimization_ACU } from '../../src/presentation/components/optimization-ui/optimization-ui-exec';

const ORIGINAL = '夜色漫过屋檐，她收起最后一封信，站在阶前听雨。';
const OPTIMIZED = '夜色漫过窗台，她收起最后一封信，站在阶前听雨。';

function useSettings(overrides: Record<string, any> = {}) {
  (settings_ACU as any).contentOptimizationSettings = {
    enabled: true,
    seamlessMode: true,
    autoApply: true,
    showDiff: false,
    minLength: 1,
    loopCount: 1,
    extractTags: '',
    extractRules: [],
    excludeTags: '',
    excludeRules: [],
    decisionGate: { enabled: true },
    ...overrides,
  };
}

beforeEach(() => {
  h.chat.length = 0;
  h.chat.push(
    { is_user: true, message_id: 10, mes: '玩家：推门而入' },
    { is_user: false, message_id: 11, mes: ORIGINAL },
  );
  h.processed.clear();
  for (const fn of [h.perform, h.replace, h.record, h.shouldSkip, h.setLastBase, h.toast, h.triggerAutoUpdate, h.judge, h.showOverlay, h.hideOverlay, h.showDiffDialogForLoop, h.releaseAbort]) fn.mockClear();
  h.ensureNotCancelled.mockReset();
  h.perform.mockImplementation(async () => ({
    success: true,
    optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
    summary: '一处改进',
    optimizedContent: OPTIMIZED,
  }));
  h.judge.mockImplementation(async () => ({ kind: 'disabled' }));
  useSettings();
});

describe('替换前判定（executeContentOptimization_ACU）', () => {
  it('判「好」→ 照常替换，判定看的是本楼正文', async () => {
    h.judge.mockResolvedValue({ kind: 'decided', replace: true, choice: '好', goodProbability: 0.9, model: 'm' });

    expect(await executeContentOptimization_ACU(1)).toBe(true);

    expect(h.judge).toHaveBeenCalledWith(ORIGINAL, expect.anything());
    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledWith(1, OPTIMIZED, expect.anything());
  });

  it('判「不好」→ 不调替换模型、不写回，登记本楼已处理并提示', async () => {
    h.judge.mockResolvedValue({ kind: 'decided', replace: false, choice: '不好', goodProbability: 0.2, model: 'm' });

    expect(await executeContentOptimization_ACU(1)).toBe(true);

    expect(h.perform).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.chat[1].mes).toBe(ORIGINAL);
    // 同一楼再收到重复的生成结束事件时不再重复判定
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ messageId: 11, content: ORIGINAL }));
    expect(h.toast).toHaveBeenCalledWith('info', expect.stringContaining('不替换'));
  });

  it('判定失败 → 照常替换并提示原因', async () => {
    h.judge.mockResolvedValue({ kind: 'error', message: 'HTTP 401：User not found.' });

    expect(await executeContentOptimization_ACU(1)).toBe(true);

    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith('warning', expect.stringContaining('401'));
  });

  it('判定未开启 → 不发判定、行为与原来一致', async () => {
    useSettings({ decisionGate: { enabled: false } });
    expect(await executeContentOptimization_ACU(1)).toBe(true);
    expect(h.judge).not.toHaveBeenCalled();
    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.toast).not.toHaveBeenCalledWith('info', expect.stringContaining('不替换'));
  });

  it('无感模式下判定期间遮住本楼', async () => {
    h.judge.mockResolvedValue({ kind: 'decided', replace: false, choice: '不好', goodProbability: 0.1, model: 'm' });
    await executeContentOptimization_ACU(1);
    expect(h.showOverlay).toHaveBeenCalledWith(expect.stringContaining('判定'));
  });

  it('手动确认模式判「不好」时照常触发填表（原本由确认流程收尾时触发）', async () => {
    useSettings({ seamlessMode: false, autoApply: false });
    h.judge.mockResolvedValue({ kind: 'decided', replace: false, choice: '不好', goodProbability: 0.1, model: 'm' });

    await executeContentOptimization_ACU(1);

    expect(h.perform).not.toHaveBeenCalled();
    expect(h.triggerAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it('并行模式判「不好」时不重复触发填表（填表已在并行跑）', async () => {
    useSettings({ seamlessMode: false, autoApply: false, parallelMode: true });
    h.judge.mockResolvedValue({ kind: 'decided', replace: false, choice: '不好', goodProbability: 0.1, model: 'm' });

    await executeContentOptimization_ACU(1);

    expect(h.triggerAutoUpdate).not.toHaveBeenCalled();
  });
  it('判定期间 MVU 往本楼追加了变量块：登记的是追加后的实际正文，重复事件不会再判一次', async () => {
    h.judge.mockImplementation(async () => {
      h.chat[1].mes = `${ORIGINAL}

<UpdateVariable>_.set("a", 1, 2);</UpdateVariable>`;
      return { kind: 'decided', replace: false, choice: '不好', goodProbability: 0.2, model: 'm' };
    });

    await executeContentOptimization_ACU(1);

    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ messageId: 11, content: h.chat[1].mes }));
  });

  it('判定时把取消信号交给请求；判定期间按了取消：不再继续替换、不提示、不触发填表，并撤掉遮罩', async () => {
    useSettings({ seamlessMode: false, autoApply: false });
    h.judge.mockResolvedValue({ kind: 'decided', replace: false, choice: '不好', goodProbability: 0.1, model: 'm' });
    h.ensureNotCancelled.mockImplementation(() => { throw new Error('用户终止正文优化'); });

    expect(await executeContentOptimization_ACU(1)).toBe(false);

    expect(h.judge).toHaveBeenCalledWith(ORIGINAL, { signal: h.abortSignal });
    expect(h.releaseAbort).toHaveBeenCalled();
    expect(h.perform).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.triggerAutoUpdate).not.toHaveBeenCalled();
  });

  it('调用方接管填表时（MVU 早跑）：判「不好」只通知调用方，不自己触发填表', async () => {
    useSettings({ seamlessMode: false, autoApply: false });
    h.judge.mockResolvedValue({ kind: 'decided', replace: false, choice: '不好', goodProbability: 0.1, model: 'm' });
    const onGateSkipped = vi.fn();

    expect(await executeContentOptimization_ACU(1, { onGateSkipped })).toBe(true);

    expect(onGateSkipped).toHaveBeenCalledTimes(1);
    expect(h.triggerAutoUpdate).not.toHaveBeenCalled();
  });
});
