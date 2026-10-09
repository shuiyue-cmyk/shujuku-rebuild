/**
 * tests/presentation/optimization-ui-tt-surface.test.ts
 * 旧 presentation 层正文优化浮层的 TT Layout ABI 打标验证：
 * full-bleed 遮罩 = backdrop，居中/顶部小窗 = free-window。
 * 属性对非 TT 环境完全惰性，这里只断言渲染出的 DOM 携带宿主 taxonomy 声明。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MiniJQ_ACU {
  elements: HTMLElement[];

  constructor(elements: HTMLElement[] = []) {
    this.elements = elements;
  }

  get length() {
    return this.elements.length;
  }

  append(input: unknown) {
    const html = typeof input === 'string' ? input : '';
    this.elements.forEach(element => {
      const template = document.createElement('template');
      template.innerHTML = html;
      Array.from(template.content.children).forEach(child => {
        element.appendChild(child);
      });
    });
    return this;
  }

  remove() {
    this.elements.forEach(element => element.remove());
    this.elements = [];
    return this;
  }

  off() {
    return this;
  }

  on(_event: string, handler: (this: HTMLElement, e?: unknown) => void) {
    this.elements.forEach(element => {
      element.addEventListener('click', event => handler.call(element, event));
    });
    return this;
  }

  prop(_name: string, _value: unknown) {
    return this;
  }

  text(_value?: unknown) {
    return this;
  }

  closest(_selector: string) {
    return new MiniJQ_ACU([]);
  }
}

function miniJQuery_ACU(input: unknown): MiniJQ_ACU {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('<')) return new MiniJQ_ACU([]);
    return new MiniJQ_ACU(Array.from(document.querySelectorAll(trimmed)) as HTMLElement[]);
  }
  if (input instanceof HTMLElement) return new MiniJQ_ACU([input]);
  if (input instanceof MiniJQ_ACU) return input;
  return new MiniJQ_ACU([]);
}

vi.mock('../../src/presentation/dom-utils', () => ({
  jQuery_API_ACU: miniJQuery_ACU,
}));

vi.mock('../../src/presentation/theme/toast', () => ({
  showToastr_ACU: vi.fn(() => null),
  showHostSurfaceToast_ACU: vi.fn(),
}));

vi.mock('../../src/shared/html-helpers', () => ({
  escapeHtml_ACU: (value: string) => String(value),
  renderStopButton_ACU: () => '',
  renderToastActionButton_ACU: () => '',
}));

vi.mock('../../src/service/plot/plot-state', () => ({
  _set_currentEditablePlotPresetState_ACU: vi.fn(),
  _set_activePlotEditorSettings_ACU: vi.fn(),
  _set_currentPlotTaskEditorId_ACU: vi.fn(),
}));

vi.mock('../../src/service/optimization/content-optimization', () => ({
  cancelContentOptimization_ACU: vi.fn(() => ({ cancelled: false, reason: '' })),
  optimizationProgressToast_ACU: null,
  _set_optimizationProgressToast_ACU: vi.fn(),
  _set_contentOptimizationAbortRequested_ACU: vi.fn(),
}));

// optimization-ui-diff 顶部循环 import exec；打桩切断 exec 的重依赖链
vi.mock('../../src/presentation/components/optimization-ui/optimization-ui-exec', () => ({
  getOriginalContent_ACU: vi.fn(() => '原始内容'),
  reoptimizeMessage_ACU: vi.fn(async () => true),
  replaceChatMessage_ACU: vi.fn(async () => true),
}));

import {
  showOptimizationOverlay_ACU,
  hideOptimizationOverlay_ACU,
} from '../../src/presentation/components/optimization-ui/optimization-ui-overlay';
import {
  showOptimizationDiffDialogForLoop_ACU,
  showOptimizationResultDialog_ACU,
  showOptimizationResultToast_ACU,
} from '../../src/presentation/components/optimization-ui/optimization-ui-diff';
import { showHostSurfaceToast_ACU } from '../../src/presentation/theme/toast';
import { _set_jQuery_API_ACU } from '../../src/shared/host-api';

function makeResult(currentLoop: number, totalLoops: number) {
  return {
    success: true,
    summary: '测试摘要',
    optimizedContent: '优化后内容',
    currentLoop,
    totalLoops,
    optimizations: [
      { original: '原文片段', plan: '修改方案', reason: '理由', optimized: '优化片段' },
    ],
  };
}

describe('optimization-ui TT surface 打标', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('acu-host-dialog-styles')?.remove();
    _set_jQuery_API_ACU(miniJQuery_ACU as any);
  });

  it('优化遮罩 #acu-optimization-overlay 声明为 backdrop', () => {
    showOptimizationOverlay_ACU('正在优化正文...');

    const overlay = document.getElementById('acu-optimization-overlay') as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute('data-tt-mobile-surface')).toBe('backdrop');

    hideOptimizationOverlay_ACU();
    expect(document.getElementById('acu-optimization-overlay')).toBeNull();
  });

  it('Diff 对话框声明为 free-window，配套 #acu-opt-backdrop 声明为 backdrop', () => {
    showOptimizationDiffDialogForLoop_ACU(3, makeResult(1, 2), vi.fn());

    const dialog = document.querySelector<HTMLElement>('.acu-optimization-dialog');
    const backdrop = document.getElementById('acu-opt-backdrop') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(backdrop).not.toBeNull();
    expect(dialog!.getAttribute('data-tt-mobile-surface')).toBe('free-window');
    expect(backdrop!.getAttribute('data-tt-mobile-surface')).toBe('backdrop');
  });

  /**
   * `free-window` 在宿主 geometry firewall 里**零规则**，而且显式打标会让分类器提前 return
   * （mobile-overlay-compat-controller.js:226-229），连准入时的一次性 nudge 都不会有
   * ⇒ 顶部偏移必须我们自己吃安全区。硬编码 `top: 10px` 在 Android 非沉浸模式 / iOS 刘海机上
   * 会顶进状态栏，正是宿主文档 docs/AndroidDevelopment.md:309-318 记录的原始 bug 形态。
   */
  it('对话框顶部偏移消费宿主安全区变量，不再硬编码', () => {
    showOptimizationDiffDialogForLoop_ACU(3, makeResult(1, 2), vi.fn());

    const dialog = document.querySelector<HTMLElement>('.acu-optimization-dialog');
    expect(dialog!.classList.contains('acu-hd-dialog--floating')).toBe(true);
    const css = document.getElementById('acu-host-dialog-styles')?.textContent || '';
    const rule = css.slice(css.indexOf('.acu-hd-dialog--floating {'), css.indexOf('}', css.indexOf('.acu-hd-dialog--floating {')));
    expect(rule).toContain('--tt-inset-top');
    expect(rule).toContain('safe-area-inset-top');
    expect(rule).not.toMatch(/top:\s*10px\s*;/);
  });

  it('结果对话框同样使用插件弹窗样式，关闭按钮与遮罩都能关', () => {
    showOptimizationResultDialog_ACU(3, makeResult(1, 1));

    const dialog = document.querySelector<HTMLElement>('.acu-optimization-dialog')!;
    expect(dialog.classList.contains('acu-hd-dialog')).toBe(true);
    expect(dialog.getAttribute('data-tt-mobile-surface')).toBe('free-window');
    expect(document.getElementById('acu-opt-backdrop')!.getAttribute('data-tt-mobile-surface')).toBe('backdrop');
    expect(document.body.innerHTML).not.toContain('style=');
    expect(document.getElementById('acu-opt-result-close')!.className).toContain('acu-hd-btn--primary');
    expect(dialog.textContent).toContain('共 1 处改进');

    document.getElementById('acu-opt-backdrop')!.click();
    expect(document.querySelector('.acu-optimization-dialog')).toBeNull();
  });

  it('无感模式完成提示：走插件提示框（不受静默拦截），点「查看对比」打开只读结果对话框', async () => {
    vi.mocked(showHostSurfaceToast_ACU).mockClear();
    showOptimizationResultToast_ACU(3, makeResult(1, 1), '正文优化完成，共 1 轮优化，累计 1 处改进');

    expect(showHostSurfaceToast_ACU).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(showHostSurfaceToast_ACU).mock.calls[0][0];
    expect(payload.kind).toBe('success');
    expect(payload.text).toContain('正文优化完成');
    expect(payload.action?.label).toBe('查看对比');
    expect(document.querySelector('.acu-optimization-dialog')).toBeNull();

    await payload.action!.onClick();
    const dialog = document.querySelector<HTMLElement>('.acu-optimization-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('正文替换完成');
    expect(dialog!.querySelectorAll('.acu-hd-item').length).toBe(1);
  });

  it('优化遮罩为主题化卡片：强调色转圈、次级取消按钮，无旧配色', () => {
    showOptimizationOverlay_ACU('正在优化正文...');

    const overlay = document.getElementById('acu-optimization-overlay')!;
    expect(overlay.classList.contains('acu-hd-layer')).toBe(true);
    expect(overlay.classList.contains('acu-host-surface')).toBe(true);
    expect(overlay.querySelector('.acu-hd-spinner')).not.toBeNull();
    expect(overlay.textContent).toContain('正在优化正文...');
    expect(document.getElementById('acu-optimization-overlay-cancel')!.className).toContain('acu-hd-btn--ghost');
    expect(document.body.innerHTML).not.toContain('style=');
    expect(document.body.innerHTML).not.toContain('#7bb7ff');
    expect(document.body.innerHTML).not.toContain('#ffc107');
    const css = document.getElementById('acu-host-dialog-styles')?.textContent || '';
    expect(css).toMatch(/\.acu-hd-spinner\s*\{[^}]*var\(--acu-accent/);
  });
});
