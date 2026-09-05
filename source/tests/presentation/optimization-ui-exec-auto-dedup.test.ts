/**
 * tests/presentation/optimization-ui-exec-auto-dedup.test.ts
 * [W1] 自动正文替换「已处理集合」判重入口行为验证
 *
 * 覆盖：
 *   ① 同一楼、内容未变的第二次自动触发 → 跳过，AI mock 零调用、不写回；
 *   ② 楼层内容变化 → 正常执行并更新记录；
 *   ③ 手动「重新优化」不受判重影响；
 *   （记录集合容量裁剪在 tests/data/storage/optimization-cache-storage.test.ts 覆盖）
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
    showDiff: vi.fn(),
    showResultDialog: vi.fn(),
    showDiffDialogForLoop: vi.fn(),
    triggerAutoUpdate: vi.fn(async () => undefined),
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
  ensureOptimizationNotCancelled_ACU: vi.fn(),
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
  showOptimizationOverlay_ACU: vi.fn(),
  hideOptimizationOverlay_ACU: vi.fn(),
  showOptimizationProgressToast_ACU: vi.fn(),
  hideOptimizationProgressToast_ACU: vi.fn(),
}));
vi.mock('../../src/presentation/components/optimization-ui/optimization-ui-diff', () => ({
  showOptimizationDiffDialogForLoop_ACU: h.showDiffDialogForLoop,
  showOptimizationDiff_ACU: h.showDiff,
  showOptimizationResultDialog_ACU: h.showResultDialog,
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import {
  executeContentOptimization_ACU,
  reoptimizeMessage_ACU,
} from '../../src/presentation/components/optimization-ui/optimization-ui-exec';

const LONG_ENOUGH = '夜色漫过屋檐，她收起最后一封信，站在阶前听雨。';

function useAutoApplySettings() {
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
  };
}

beforeEach(() => {
  h.chat.length = 0;
  h.chat.push(
    { is_user: true, message_id: 10, mes: '玩家：推门而入' },
    { is_user: false, message_id: 11, mes: LONG_ENOUGH },
  );
  h.processed.clear();
  h.perform.mockClear();
  h.replace.mockClear();
  h.record.mockClear();
  h.shouldSkip.mockClear();
  h.setLastBase.mockClear();
  h.logDebug.mockClear();
  h.toast.mockClear();
  h.showDiff.mockClear();
  h.showResultDialog.mockClear();
  h.showDiffDialogForLoop.mockClear();
  h.triggerAutoUpdate.mockClear();
  useAutoApplySettings();
});

describe('自动正文替换入口判重（executeContentOptimization_ACU）', () => {
  it('①同一楼内容未变的第二次自动触发：跳过且 AI 零调用、不写回', async () => {
    h.perform.mockImplementation(async () => ({
      success: true,
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: '夜色漫过窗台，她收起最后一封信，站在阶前听雨。',
    }));

    const first = await executeContentOptimization_ACU(1);
    expect(first).toBe(true);
    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledTimes(1);
    // 写回成功后登记的是「写回后的消息内容」
    expect(h.processed.get('11')).toBe(h.hash('夜色漫过窗台，她收起最后一封信，站在阶前听雨。'));

    const second = await executeContentOptimization_ACU(1);
    expect(second).toBe(true);
    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.setLastBase).toHaveBeenCalledTimes(1);
    expect(h.logDebug).toHaveBeenCalledWith(expect.stringContaining('内容未变，跳过重复自动替换'));
  });

  it('②楼层内容变化 → 正常执行并更新记录', async () => {
    h.perform.mockImplementation(async (content: string) => ({
      success: true,
      optimizations: [{ type: 'replace', original: '听雨', optimized: '听雷', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: content.replace('听雨', '听雷'),
    }));

    await executeContentOptimization_ACU(1);
    expect(h.perform).toHaveBeenCalledTimes(1);
    const recordedAfterFirst = h.processed.get('11');

    // 宿主又产出一轮内容（同一楼被改写）
    h.chat[1].mes = `新内容：${LONG_ENOUGH}`;
    const second = await executeContentOptimization_ACU(1);

    expect(second).toBe(true);
    expect(h.perform).toHaveBeenCalledTimes(2);
    expect(h.replace).toHaveBeenCalledTimes(2);
    expect(h.processed.get('11')).not.toBe(recordedAfterFirst);
  });

  it('回声跳过时不覆盖优化基准缓存（避免把已替换内容当成原文）', async () => {
    h.perform.mockImplementation(async () => ({
      success: true,
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: '夜色漫过窗台。',
    }));
    await executeContentOptimization_ACU(1);
    expect(h.setLastBase).toHaveBeenCalledTimes(1);

    h.chat[1].mes = '夜色漫过窗台。';
    await executeContentOptimization_ACU(1);
    expect(h.setLastBase).toHaveBeenCalledTimes(1);
  });

  it('拿不到 message_id 的楼层不参与判重', async () => {
    h.chat[1].message_id = null;
    h.perform.mockImplementation(async () => ({
      success: true,
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: '夜色漫过窗台。',
    }));

    await executeContentOptimization_ACU(1);
    await executeContentOptimization_ACU(1);
    expect(h.perform).toHaveBeenCalledTimes(2);
    expect(h.processed.size).toBe(0);
  });

  it('写回失败不登记（不能把没替换成功的楼标成已处理）', async () => {
    h.perform.mockImplementation(async () => ({
      success: true,
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: '夜色漫过窗台。',
    }));
    h.replace.mockResolvedValueOnce(false as any);

    await executeContentOptimization_ACU(1);
    expect(h.processed.size).toBe(0);

    await executeContentOptimization_ACU(1);
    expect(h.perform).toHaveBeenCalledTimes(2);
  });

  it('手动确认模式（autoApply=false）写回成功后同样登记，回声第二次直接跳过', async () => {
    (settings_ACU as any).contentOptimizationSettings.seamlessMode = false;
    (settings_ACU as any).contentOptimizationSettings.autoApply = false;
    h.perform.mockImplementation(async () => ({
      success: true,
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: '夜色漫过窗台。',
    }));
    // 手动确认模式会弹对比框：这里只验登记接线，直接回放 apply 回调
    h.showDiffDialogForLoop.mockImplementation((_index: number, _result: any, callback: any) => {
      callback('apply');
    });

    await executeContentOptimization_ACU(1);
    expect(h.processed.size).toBe(1);
    expect(h.replace).toHaveBeenCalledTimes(1);

    h.chat[1].mes = '夜色漫过窗台。';
    await executeContentOptimization_ACU(1);
    expect(h.perform).toHaveBeenCalledTimes(1);
  });

  it('③手动「重新优化」不受判重影响：同一楼同一内容重复点击仍会调 AI', async () => {
    h.perform.mockImplementation(async () => ({
      success: true,
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: '夜色漫过窗台。',
    }));
    // 先让自动链把本楼登记为已处理
    await executeContentOptimization_ACU(1);
    h.chat[1].mes = '夜色漫过窗台。';
    expect(h.shouldSkip(11, '夜色漫过窗台。')).toBe(true);
    h.perform.mockClear();
    h.shouldSkip.mockClear();

    // 手动入口：reoptimizeMessage_ACU 走 getOriginalContent_ACU，需要 extra 里的原文
    h.chat[1].extra = { _acu_original_content: LONG_ENOUGH };
    await reoptimizeMessage_ACU(1);
    await reoptimizeMessage_ACU(1);

    expect(h.perform).toHaveBeenCalledTimes(2);
    expect(h.shouldSkip).not.toHaveBeenCalled();
    expect(h.replace).toHaveBeenCalledTimes(1);
  });
  it('判重只挂在自动入口：exec 源码里判重调用恰好一处，手动重优化函数体不含判重', async () => {
    const { readFileSync } = await import('node:fs');
    const execSource = readFileSync(
      'src/presentation/components/optimization-ui/optimization-ui-exec.ts',
      'utf8',
    );
    expect(execSource.match(/shouldSkipDuplicateAutoContentOptimization_ACU\(/g) || []).toHaveLength(1);
    // 定义 1 处 + 自动应用/手动确认两条写回路径各 1 处
    expect(execSource.match(/recordAutoProcessedAfterWriteBack_ACU\(/g) || []).toHaveLength(3);

    const reoptBody = execSource.slice(
      execSource.indexOf('export async function reoptimizeMessage_ACU'),
      execSource.indexOf('function showReoptimizationDialog_ACU'),
    );
    expect(reoptBody).not.toContain('shouldSkipDuplicateAutoContentOptimization_ACU');
    expect(reoptBody).not.toContain('recordAutoContentOptimizationProcessed_ACU');
  });

  it('功能未启用 / 用户消息楼层：不查判重，既有早退分支不变', async () => {
    (settings_ACU as any).contentOptimizationSettings.enabled = false;
    expect(await executeContentOptimization_ACU(1)).toBe(false);
    expect(h.shouldSkip).not.toHaveBeenCalled();

    (settings_ACU as any).contentOptimizationSettings.enabled = true;
    expect(await executeContentOptimization_ACU(0)).toBe(false);
    expect(h.shouldSkip).not.toHaveBeenCalled();

    expect(await executeContentOptimization_ACU(99)).toBe(false);
    expect(h.shouldSkip).not.toHaveBeenCalled();
  });

  it('处理后正文长度不足 minLength 时仍按既有门槛跳过（判重不干扰该分支）', async () => {
    (settings_ACU as any).contentOptimizationSettings.minLength = 100000;
    expect(await executeContentOptimization_ACU(1)).toBe(false);
    expect(h.perform).not.toHaveBeenCalled();
    expect(h.processed.size).toBe(0);
  });

  it('自动应用 + 显示优化对比（非无感）：写回后弹只读结果对话框而非 toast', async () => {
    (settings_ACU as any).contentOptimizationSettings.seamlessMode = false;
    (settings_ACU as any).contentOptimizationSettings.showDiff = true;
    h.perform.mockImplementation(async () => ({
      success: true,
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
      summary: '一处改进',
      optimizedContent: '夜色漫过窗台，她收起最后一封信，站在阶前听雨。',
    }));

    expect(await executeContentOptimization_ACU(1)).toBe(true);
    expect(h.replace).toHaveBeenCalledTimes(1);
    // 只读结果对话框被调用一次，携带全部优化项；完成 toast 不再承担对比展示
    expect(h.showResultDialog).toHaveBeenCalledTimes(1);
    expect(h.showResultDialog).toHaveBeenCalledWith(1, expect.objectContaining({
      optimizations: [{ type: 'replace', original: '夜色漫过屋檐', optimized: '夜色漫过窗台', plan: '改写' }],
    }));
    expect(h.toast).not.toHaveBeenCalledWith('success', expect.stringContaining('正文优化完成'));
  });
});
