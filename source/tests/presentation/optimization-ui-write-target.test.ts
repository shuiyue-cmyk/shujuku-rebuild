/**
 * tests/presentation/optimization-ui-write-target.test.ts
 * R9-01：正文优化写回前复核楼层身份（滑动 / 删楼 / 切聊天后不写错楼）。
 * R9-08：手动确认多轮，末轮「跳过」时写回前几轮已确认的结果，只触发一次填表。
 * R9-09：重新优化对话框里 AI 返回的 summary 必须转义。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MiniJQ_ACU {
  elements: HTMLElement[];
  constructor(elements: HTMLElement[] = []) { this.elements = elements; }
  get length() { return this.elements.length; }
  append(input: unknown) {
    const html = typeof input === 'string' ? input : '';
    this.elements.forEach(element => {
      const template = document.createElement('template');
      template.innerHTML = html;
      Array.from(template.content.children).forEach(child => element.appendChild(child));
    });
    return this;
  }
  remove() { this.elements.forEach(element => element.remove()); this.elements = []; return this; }
  off() { return this; }
  on(_event: string, handler: (this: HTMLElement, e?: unknown) => void) {
    this.elements.forEach(element => element.addEventListener('click', event => handler.call(element, event)));
    return this;
  }
  prop() { return this; }
  text() { return this; }
  closest() { return new MiniJQ_ACU([]); }
}
function miniJQuery_ACU(input: unknown): MiniJQ_ACU {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('<')) return new MiniJQ_ACU([]);
    return new MiniJQ_ACU(Array.from(document.querySelectorAll(trimmed)) as HTMLElement[]);
  }
  if (input instanceof HTMLElement) return new MiniJQ_ACU([input]);
  return new MiniJQ_ACU([]);
}

const h = vi.hoisted(() => {
  const chat: any[] = [];
  const state = { chatIdentity: 'chat-a', settings: { contentOptimizationSettings: {} as any } };
  return {
    chat,
    state,
    perform: vi.fn(),
    record: vi.fn(),
    toast: vi.fn(),
    triggerAutoUpdate: vi.fn(async () => undefined),
    replace: vi.fn(),
  };
});

vi.mock('../../src/presentation/dom-utils', () => ({ jQuery_API_ACU: miniJQuery_ACU }));
vi.mock('../../src/presentation/theme/toast', () => ({ showToastr_ACU: h.toast }));
vi.mock('../../src/service/plot/plot-state', () => ({
  _set_currentEditablePlotPresetState_ACU: vi.fn(),
  _set_activePlotEditorSettings_ACU: vi.fn(),
  _set_currentPlotTaskEditorId_ACU: vi.fn(),
}));
vi.mock('../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => h.chat }));
vi.mock('../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return h.state.settings; },
  get currentChatFileIdentifier_ACU() { return h.state.chatIdentity; },
}));
vi.mock('../../src/service/chat/chat-service', async () => {
  const target = await import('../../src/service/chat/chat-message-write-target');
  h.replace.mockImplementation(async (index: number, content: string, options: any = {}) => {
    if (options.expected !== undefined && !target.isChatMessageWriteTargetCurrent_ACU(options.expected)) return false;
    const message = h.chat[index];
    if (!message) return false;
    message.mes = content;
    return true;
  });
  return {
    getChatArray_ACU: () => h.chat,
    replaceChatMessage_ACU: (...args: any[]) => h.replace(...args),
    getOriginalContent_ACU: (index: number) => h.chat[index]?.extra?._acu_original_content || null,
  };
});
vi.mock('../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../src/presentation/triggers/settings-ui-sync', () => ({
  triggerAutomaticUpdateIfNeeded_ACU: (...args: any[]) => h.triggerAutoUpdate(...(args as [])),
}));
vi.mock('../../src/service/optimization/content-optimization', () => ({
  contentOptimizationAbortRequested_ACU: false,
  cancelContentOptimization_ACU: vi.fn(() => ({ cancelled: false, reason: '' })),
  optimizationProgressToast_ACU: null,
  ensureOptimizationNotCancelled_ACU: vi.fn(),
  performContentOptimization_ACU: (...args: any[]) => h.perform(...args),
  setLastOptimizationBase_ACU: vi.fn(),
  shouldSkipDuplicateAutoContentOptimization_ACU: vi.fn(() => false),
  recordAutoContentOptimizationProcessed_ACU: (...args: any[]) => h.record(...args),
  _set_optimizationProgressToast_ACU: vi.fn(),
  _set_contentOptimizationAbortRequested_ACU: vi.fn(),
}));
vi.mock('../../src/service/runtime/helpers-remaining', () => ({ applyContextTagFilters_ACU: (text: string) => text }));
vi.mock('../../src/presentation/components/optimization-ui/optimization-ui-overlay', () => ({
  showOptimizationOverlay_ACU: vi.fn(),
  hideOptimizationOverlay_ACU: vi.fn(),
  showOptimizationProgressToast_ACU: vi.fn(),
  hideOptimizationProgressToast_ACU: vi.fn(),
}));

import { executeContentOptimization_ACU, reoptimizeMessage_ACU } from '../../src/presentation/components/optimization-ui/optimization-ui-exec';

function optimizeResult(content: string, from: string, to: string, summary = '一处改进') {
  return {
    success: true,
    optimizations: [{ original: from, optimized: to, plan: '改写' }],
    summary,
    optimizedContent: content.replace(from, to),
  };
}

function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

function click(selector: string) {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) throw new Error(`missing ${selector}`);
  element.click();
}

beforeEach(() => {
  document.body.innerHTML = '';
  h.chat.length = 0;
  h.state.chatIdentity = 'chat-a';
  h.perform.mockReset();
  h.record.mockReset();
  h.toast.mockReset();
  h.triggerAutoUpdate.mockClear();
  h.replace.mockClear();
  h.chat.push({ is_user: true, mes: '你好' });
  h.chat.push({ is_user: false, mes: '旧回复：夜色漫过屋檐', message_id: 1, swipe_id: 0, extra: {} });
});

describe('R9-01 自动应用：写回前复核楼层身份', () => {
  beforeEach(() => {
    h.state.settings.contentOptimizationSettings = { enabled: true, autoApply: true, minLength: 1, loopCount: 1 };
  });

  it('AI 在途期间滑动（同楼正文换成新 swipe）时放弃写回并提示', async () => {
    const g = gate();
    h.perform.mockImplementationOnce(async (content: string) => { await g.promise; return optimizeResult(content, '屋檐', '窗台'); });

    const pending = executeContentOptimization_ACU(1);
    await Promise.resolve();
    h.chat[1].mes = '新 swipe：完全不同的回复';
    h.chat[1].swipe_id = 1;
    g.release();

    expect(await pending).toBe(false);
    expect(h.chat[1].mes).toBe('新 swipe：完全不同的回复');
    expect(h.record).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith('warning', expect.stringContaining('已丢弃'));
  });

  it('AI 在途期间切聊天（同下标换成另一个聊天的楼）时不写进新聊天', async () => {
    const g = gate();
    h.perform.mockImplementationOnce(async (content: string) => { await g.promise; return optimizeResult(content, '屋檐', '窗台'); });

    const pending = executeContentOptimization_ACU(1);
    await Promise.resolve();
    h.chat.length = 0;
    h.chat.push({ is_user: true, mes: 'B 用户' });
    h.chat.push({ is_user: false, mes: '旧回复：夜色漫过屋檐', message_id: 1, swipe_id: 0, extra: {} });
    h.state.chatIdentity = 'chat-b';
    g.release();

    expect(await pending).toBe(false);
    expect(h.chat[1].mes).toBe('旧回复：夜色漫过屋檐');
  });

  it('楼层未变时照常写回并登记已处理', async () => {
    h.perform.mockImplementationOnce(async (content: string) => optimizeResult(content, '屋檐', '窗台'));

    expect(await executeContentOptimization_ACU(1)).toBe(true);
    expect(h.chat[1].mes).toBe('旧回复：夜色漫过窗台');
    expect(h.record).toHaveBeenCalledOnce();
  });
});

describe('手动确认模式', () => {
  beforeEach(() => {
    h.state.settings.contentOptimizationSettings = { enabled: true, autoApply: false, minLength: 1, loopCount: 2 };
  });

  // 末轮对话框没有「跳过」按钮；用户确认过的前几轮结果在末轮「无需优化」或失败时同样会丢。
  it.each([
    ['末轮无需优化', { success: true, optimizations: [], summary: '', optimizedContent: '' }],
    ['末轮请求失败', { success: false, error: 'boom' }],
  ])('R9-08：第 1 轮已应用、%s时写回第 1 轮结果，只触发一次填表', async (_label, secondRound) => {
    h.perform
      .mockImplementationOnce(async (content: string) => optimizeResult(content, '屋檐', '窗台'))
      .mockImplementationOnce(async () => secondRound);

    const pending = executeContentOptimization_ACU(1);
    await vi.waitFor(() => expect(document.querySelector('#acu-opt-apply')).not.toBeNull());
    click('#acu-opt-apply');

    expect(await pending).toBe(true);
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.chat[1].mes).toBe('旧回复：夜色漫过窗台');
    expect(h.record).toHaveBeenCalledOnce();
    expect(h.triggerAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it('末轮「应用并完成」只写回一次，并登记已处理', async () => {
    h.state.settings.contentOptimizationSettings.loopCount = 1;
    h.perform.mockImplementationOnce(async (content: string) => optimizeResult(content, '屋檐', '窗台'));

    const pending = executeContentOptimization_ACU(1);
    await vi.waitFor(() => expect(document.querySelector('#acu-opt-apply')).not.toBeNull());
    click('#acu-opt-apply');

    expect(await pending).toBe(true);
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.chat[1].mes).toBe('旧回复：夜色漫过窗台');
    expect(h.record).toHaveBeenCalledOnce();
  });

  it('R9-01：对比框打开期间楼层被滑动，点应用不写回并关闭对话框', async () => {
    h.state.settings.contentOptimizationSettings.loopCount = 1;
    h.perform.mockImplementationOnce(async (content: string) => optimizeResult(content, '屋檐', '窗台'));

    const pending = executeContentOptimization_ACU(1);
    await vi.waitFor(() => expect(document.querySelector('#acu-opt-apply')).not.toBeNull());
    h.chat[1].mes = '新 swipe';
    click('#acu-opt-apply');

    expect(await pending).toBe(true);
    expect(h.chat[1].mes).toBe('新 swipe');
    expect(h.record).not.toHaveBeenCalled();
    expect(document.querySelector('#acu-opt-apply')).toBeNull();
    expect(h.toast).toHaveBeenCalledWith('warning', expect.stringContaining('已丢弃'));
  });
});

describe('重新优化', () => {
  beforeEach(() => {
    h.state.settings.contentOptimizationSettings = { enabled: true, autoApply: true, minLength: 1, loopCount: 1 };
  });

  it('R9-09：AI 返回的 summary 转义后再插入对话框', async () => {
    h.perform.mockImplementationOnce(async (content: string) => optimizeResult(content, '屋檐', '窗台', '<img src=x onerror="window.__acuXss=1">'));

    await reoptimizeMessage_ACU(1);

    expect(document.querySelector('.acu-optimization-dialog img')).toBeNull();
    expect(document.querySelector('.acu-optimization-dialog')?.textContent).toContain('<img src=x');
  });

  it('R9-01：结果出来后楼层被滑动，点应用不写回', async () => {
    h.perform.mockImplementationOnce(async (content: string) => optimizeResult(content, '屋檐', '窗台'));

    await reoptimizeMessage_ACU(1);
    h.chat[1].mes = '新 swipe';
    click('#acu-opt-apply');
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('warning', expect.stringContaining('已丢弃')));

    expect(h.chat[1].mes).toBe('新 swipe');
    expect(document.querySelector('#acu-opt-apply')).toBeNull();
  });
});
