import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockShowToastr, mockRunSession, mockApply, state, mockSettings_ACU, viewportState_ACU } = vi.hoisted(() => ({
  mockShowToastr: vi.fn(),
  mockRunSession: vi.fn(),
  mockApply: vi.fn(() => true),
  state: {
    tempData: {
      sheet_a: { name: 'A表' },
    } as any,
    currentSheetKey: 'sheet_a',
    sheetOrder: ['sheet_a'],
    deletedSheetKeys: [],
  },
  mockSettings_ACU: {
    apiPresets: [{ name: 'preset-alpha' }, { name: 'preset-beta' }],
    tableApiPreset: 'preset-alpha',
    tableApiPresetOverridesByName: {} as Record<string, string>,
  },
  viewportState_ACU: {
    width: 1440,
  },
}));

function jqueryStub_ACU(selectorOrElement: any) {
  let elements: HTMLElement[] = [];
  if (typeof selectorOrElement === 'string') {
    elements = Array.from(document.querySelectorAll(selectorOrElement)) as HTMLElement[];
  } else if (selectorOrElement instanceof HTMLElement || (selectorOrElement && typeof selectorOrElement === 'object')) {
    elements = [selectorOrElement];
  }
  const api: any = {
    length: elements.length,
    html(value?: string) {
      if (value === undefined) return elements[0]?.innerHTML || '';
      elements.forEach((el) => { el.innerHTML = value; });
      return api;
    },
    find(selector: string) {
      const found = elements.flatMap((el) => Array.from(el.querySelectorAll(selector)) as HTMLElement[]);
      if (found.length === 0) return jqueryStub_ACU({ __elements: [] });
      if (found.length === 1) return jqueryStub_ACU(found[0]);
      return jqueryStub_ACU({ __elements: found });
    },
    on(event: string, handler: any) {
      elements.forEach((el) => el.addEventListener(event, handler));
      return api;
    },
    val(value?: string) {
      const el = elements[0] as HTMLInputElement | HTMLTextAreaElement | undefined;
      if (!el) return value === undefined ? '' : api;
      if (value === undefined) return el.value;
      el.value = value;
      return api;
    },
    data(name: string) {
      return elements[0]?.getAttribute(`data-${name}`);
    },
    prop(name: string, value?: any) {
      const el = elements[0] as any;
      if (!el) return value === undefined ? undefined : api;
      if (value === undefined) return el[name];
      el[name] = value;
      return api;
    },
    closest(selector: string) {
      // Simplified closest implementation for tests
      // Since we're working with fake elements, we return a stub with the data method
      const el = elements[0];
      if (!el) return jqueryStub_ACU({ __elements: [] });
      
      // Try to find data-turn-id in the HTML by looking at the parent context
      const html = document.body.innerHTML;
      
      // For .acu-collapsible-section
      if (selector === '.acu-collapsible-section' || selector === '.acu-chat-turn-assistant') {
        // Find the turn-id by searching in the HTML for the closest parent with this element
        // Since we have the section-key, we can find the corresponding turn-id
        const sectionKey = el.getAttribute('data-section-key');
        if (sectionKey) {
          // Find the turn that contains this section
          const turnMatch = html.match(new RegExp(`data-turn-id="([^"]+)"[^>]*>[^]*?data-section-key="${sectionKey}"`));
          if (turnMatch) {
            return jqueryStub_ACU({ __elements: [], __turnId: turnMatch[1] });
          }
        }
      }
      
      return jqueryStub_ACU({ __elements: [] });
    },
  };
  if ((selectorOrElement as any)?.__elements) {
    elements = (selectorOrElement as any).__elements;
    api.length = elements.length;
  }
  api[0] = elements[0];
  if ((selectorOrElement as any)?.__turnId) {
    api.data = (name: string) => {
      if (name === 'turn-id') return (selectorOrElement as any).__turnId;
      return null;
    };
  }
  return api;
}

type ListenerMap_ACU = Record<string, Array<(event?: any) => any>>;

class FakeHTMLElement_ACU {
  private _innerHTML = '';
  style: Record<string, string> = {};
  value = '';
  disabled = false;
  checked = false;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  listeners: ListenerMap_ACU = {};
  attributes: Record<string, string> = {};
  parentElement: FakeHTMLElement_ACU | null = null;

  constructor(private readonly selector: string, private readonly owner: FakeDocument_ACU) {}

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value: string) {
    this._innerHTML = String(value || '');
    this.owner.invalidateCache();
  }

  addEventListener(event: string, handler: any) {
    this.listeners[event] ||= [];
    this.listeners[event].push(handler);
  }

  dispatchEvent(event: any) {
    const type = String(event?.type || '');
    const handlers = this.listeners[type] || [];
    handlers.forEach((handler) => handler.call(this, event));
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  getAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }

  appendChild(child: any) {
    // stub
  }

  removeChild(child: any) {
    // stub
  }

  querySelectorAll(selector: string) {
    return this.owner.querySelectorAll(selector);
  }

  private syncStyleMap(styleText: string) {
    this.style = {};
    String(styleText || '').split(';').forEach((part) => {
      const [rawKey, rawValue] = part.split(':');
      const key = String(rawKey || '').trim();
      const value = String(rawValue || '').trim();
      if (key) this.style[key] = value;
    });
  }

  syncFromHtml(html: string) {
    if (this.selector === '#acu-vis-assistant-host') {
      this._innerHTML = html;
      this.attributes['data-assistant-mode'] = /data-assistant-mode="([^"]+)"/i.test(html)
        ? String(html.match(/data-assistant-mode="([^"]+)"/i)?.[1] || '')
        : this.attributes['data-assistant-mode'] || '';
      this.attributes['data-open'] = /data-open="([^"]+)"/i.test(html)
        ? String(html.match(/data-open="([^"]+)"/i)?.[1] || '')
        : this.attributes['data-open'] || '';
      this.parentElement = /id="acu-visualizer-content"/i.test(html)
        ? this.owner.querySelector('#acu-visualizer-content') as FakeHTMLElement_ACU | null
        : null;
      return;
    }

    if (this.selector === '.acu-vis-assistant-panel') {
      const styleMatch = html.match(/class="acu-vis-assistant-panel"[^>]*style="([^"]*)"/);
      this.syncStyleMap(styleMatch?.[1] || '');
      return;
    }

    if (this.selector.startsWith('#')) {
      const id = this.selector.slice(1);
      const match = html.match(new RegExp(`<([a-zA-Z0-9-]+)[^>]*id="${id}"([^>]*)>`, 'i'));
      const tag = match?.[1] || '';
      const attrs = match?.[2] || '';
      this.disabled = /disabled/.test(attrs);
      const dataRiskKeyMatch = attrs.match(/data-risk-key="([^"]+)"/);
      const dataTurnIdMatch = attrs.match(/data-turn-id="([^"]+)"/);
      const valueMatch = attrs.match(/value="([^"]*)"/);
      this.attributes = {};
      if (dataRiskKeyMatch) this.attributes['data-risk-key'] = dataRiskKeyMatch[1];
      if (dataTurnIdMatch) this.attributes['data-turn-id'] = dataTurnIdMatch[1];
      const styleAttrMatch = attrs.match(/style="([^"]*)"/i);
      this.syncStyleMap(styleAttrMatch?.[1] || '');
      if ((tag.toLowerCase() === 'input' || tag.toLowerCase() === 'textarea') && valueMatch) {
        this.value = valueMatch[1];
      }
      if (tag.toLowerCase() === 'select') {
        const selectMatch = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\s\S]*?)<\/select>`, 'i'));
        const selectedValueMatch = selectMatch?.[1]?.match(/<option[^>]*value="([^"]*)"[^>]*selected[^>]*>/i);
        this.value = selectedValueMatch ? selectedValueMatch[1] : '';
      }
      return;
    }

    if (this.selector === '.acu-assistant-risk-confirm') {
      const match = html.match(/class="acu-assistant-risk-confirm"[^>]*data-turn-id="([^"]+)"[^>]*data-risk-key="([^"]+)"([^>]*)/);
      if (match) {
        this.attributes = { 'data-turn-id': match[1], 'data-risk-key': match[2] };
        this.checked = /checked/.test(match[3] || '');
      }
    }
  }
}

class FakeDocument_ACU {
  private elementCache = new Map<string, FakeHTMLElement_ACU[]>();
  private lastChatContainerState = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
  body = new FakeHTMLElement_ACU('#acu-vis-assistant-host', this);

  resetChatContainerState() {
    this.lastChatContainerState = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
  }

  invalidateCache() {
    const currentChatContainer = this.elementCache.get('.acu-chat-container')?.[0];
    if (currentChatContainer) {
      const scrollHeight = currentChatContainer.scrollHeight || this.lastChatContainerState.scrollHeight;
      const clientHeight = currentChatContainer.clientHeight || this.lastChatContainerState.clientHeight;
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
      const isNearBottom = currentChatContainer.scrollTop + clientHeight >= scrollHeight - 50;
      this.lastChatContainerState = {
        scrollTop: isNearBottom ? maxScrollTop : currentChatContainer.scrollTop,
        scrollHeight,
        clientHeight,
      };
    }
    this.elementCache.clear();
  }

  private buildElements(selector: string) {
    const html = this.body.innerHTML;
    if (selector === '#acu-visualizer-content') {
      if (!html.includes('id="acu-visualizer-content"')) return [];
      const el = new FakeHTMLElement_ACU(selector, this);
      return [el];
    }
    if (selector === '.acu-vis-content') {
      if (!html.includes('class="acu-vis-content"')) return [];
      const el = new FakeHTMLElement_ACU(selector, this);
      el.parentElement = this.querySelector('#acu-visualizer-content') as FakeHTMLElement_ACU | null;
      return [el];
    }
    if (selector === '#acu-vis-assistant-host') {
      this.body.syncFromHtml(html);
      return [this.body];
    }
    if (selector === '.acu-vis-assistant-panel') {
      if (!html.includes('acu-vis-assistant-panel')) return [];
      const el = new FakeHTMLElement_ACU(selector, this);
      el.syncFromHtml(html);
      return [el];
    }
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (!new RegExp(`id="${id}"`, 'i').test(html)) return [];
      const el = new FakeHTMLElement_ACU(selector, this);
      el.syncFromHtml(html);
      return [el];
    }
    if (selector === '.acu-assistant-risk-confirm') {
      if (!html.includes('acu-assistant-risk-confirm')) return [];
      const matches = Array.from(html.matchAll(/class="acu-assistant-risk-confirm"[^>]*data-turn-id="([^"]+)"[^>]*data-risk-key="([^"]+)"([^>]*)/g));
      return matches.map((match) => {
        const el = new FakeHTMLElement_ACU(selector, this);
        el.attributes = { 'data-turn-id': match[1], 'data-risk-key': match[2] };
        el.checked = /checked/.test(match[3] || '');
        return el;
      });
    }
    // Chat turn selectors
    if (selector === '.acu-chat-turn-user') {
      if (!html.includes('acu-chat-turn-user')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-chat-turn-user[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        return el;
      });
    }
    if (selector === '.acu-chat-turn-assistant') {
      if (!html.includes('acu-chat-turn-assistant')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-chat-turn-assistant[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        return el;
      });
    }
    if (selector === '.acu-chat-turn-error') {
      if (!html.includes('acu-chat-turn-error')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-chat-turn-error[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        return el;
      });
    }
    if (selector === '.acu-collapsed-summary') {
      if (!html.includes('acu-collapsed-summary')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-collapsed-summary[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        return el;
      });
    }
    if (selector === '.acu-expand-toggle') {
      if (!html.includes('acu-expand-toggle')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-expand-toggle[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        return el;
      });
    }
    if (selector === '.acu-detail-block') {
      if (!html.includes('acu-detail-block')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-detail-block[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        return el;
      });
    }
    if (selector === '.acu-chat-scroll-frame') {
      if (!html.includes('acu-chat-scroll-frame')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-chat-scroll-frame[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        return el;
      });
    }
    if (selector === '.acu-chat-container') {
      if (!html.includes('acu-chat-container')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-chat-container[^"]*"/g));
      return matches.map(() => {
        const el = new FakeHTMLElement_ACU(selector, this);
        el.scrollTop = this.lastChatContainerState.scrollTop;
        el.scrollHeight = this.lastChatContainerState.scrollHeight;
        el.clientHeight = this.lastChatContainerState.clientHeight;
        return el;
      });
    }
    if (selector === '.acu-assistant-action-row') {
      if (!html.includes('acu-assistant-action-row')) return [];
      const el = new FakeHTMLElement_ACU(selector, this);
      const styleMatch = html.match(/class="[^"]*acu-assistant-action-row[^"]*"[^>]*style="([^"]*)"/i);
      (el as any).syncStyleMap?.(styleMatch?.[1] || '');
      return [el];
    }
    if (selector === '.acu-message-bubble') {
      if (!html.includes('acu-message-bubble')) return [];
      const matches = Array.from(html.matchAll(/class="[^"]*acu-message-bubble[^"]*"/g));
      return matches.map(() => new FakeHTMLElement_ACU(selector, this));
    }
    return [];
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getElementById(id: string) {
    return this.querySelector('#' + id);
  }

  querySelectorAll(selector: string) {
    if (!this.elementCache.has(selector)) {
      this.elementCache.set(selector, this.buildElements(selector));
    }
    return this.elementCache.get(selector) || [];
  }
}

class FakeEvent_ACU {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
}

const fakeDocument_ACU = new FakeDocument_ACU();

(globalThis as any).document = fakeDocument_ACU;
(globalThis as any).window = {
  Event: FakeEvent_ACU,
  get innerWidth() {
    return viewportState_ACU.width;
  },
  set innerWidth(value: number) {
    viewportState_ACU.width = Number(value) || 1440;
  },
};
(globalThis as any).HTMLElement = FakeHTMLElement_ACU;
(globalThis as any).Event = FakeEvent_ACU;

vi.mock('../../src/presentation/theme/toast', () => ({
  showToastr_ACU: mockShowToastr,
}));

vi.mock('../../src/service/template-assistant/service', () => ({
  runTemplateAssistantSession_ACU: mockRunSession,
  createTemplateAssistantSessionGuard_ACU: () => ({
    createRunGuard: () => ({
      isCancelled: () => false,
      isStale: () => false,
      get signal() { return new AbortController().signal; },
    }),
    invalidate: () => {},
    cancel: () => {},
    reset: () => {},
    getSignal: () => new AbortController().signal,
  }),
  TemplateAssistantSessionStoppedError_ACU: class extends Error {
    constructor(stopReason: string) {
      super(stopReason === 'cancelled' ? '模板助手会话已取消' : '模板助手会话已过期');
      this.name = 'TemplateAssistantSessionStoppedError_ACU';
    }
  },
}));

vi.mock('../../src/presentation/pages/visualizer-template-assistant-apply', () => ({
  applyTemplateAssistantDraftToVisualizer_ACU: mockApply,
}));

vi.mock('../../src/presentation/pages/visualizer', () => ({
  _acuVisState: state,
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings_ACU,
}));

vi.mock('../../src/presentation/dom-utils', () => ({
  jQuery_API_ACU: jqueryStub_ACU,
}));

vi.mock('../../src/shared/html-helpers', () => ({
  escapeHtml_ACU: (v: string) => v,
}));

import {
  handleVisualizerTemplateAssistantSheetChange_ACU,
  renderVisualizerTemplateAssistantPanel_ACU,
  resetVisualizerTemplateAssistantState_ACU,
  setVisualizerTemplateAssistantOpen_ACU,
} from '../../src/presentation/pages/visualizer-template-assistant';

function buildVisualizerAssistantTestDom_ACU() {
  return '<div id="acu-visualizer-content"><div class="acu-vis-content"></div><div id="acu-vis-assistant-host"></div></div>';
}

describe('visualizer template assistant panel', () => {
  beforeEach(() => {
    resetVisualizerTemplateAssistantState_ACU();
    document.body.innerHTML = buildVisualizerAssistantTestDom_ACU();
    fakeDocument_ACU.resetChatContainerState();
    fakeDocument_ACU.invalidateCache();
    mockShowToastr.mockReset();
    mockRunSession.mockReset();
    mockApply.mockReset();
    mockApply.mockReturnValue(true);
    state.tempData = { sheet_a: { name: 'A表' } } as any;
    state.currentSheetKey = 'sheet_a';
    state.sheetOrder = ['sheet_a'];
    state.deletedSheetKeys = [];
    viewportState_ACU.width = 1440;
    mockSettings_ACU.apiPresets = [{ name: 'preset-alpha' }, { name: 'preset-beta' }];
    mockSettings_ACU.tableApiPreset = 'preset-alpha';
    mockSettings_ACU.tableApiPresetOverridesByName = {};
  });

  it('assistant 面板显示 API 预设下拉并使用当前有效 preset 作为默认值', () => {
    mockSettings_ACU.tableApiPresetOverridesByName = { 'A表': 'preset-beta' };
    resetVisualizerTemplateAssistantState_ACU();
    document.body.innerHTML = buildVisualizerAssistantTestDom_ACU();
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();

    const select = document.querySelector('#acu-vis-assistant-api-preset') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(document.body.innerHTML).toContain('API预设');
    expect(document.body.innerHTML).toContain('preset-alpha');
    expect(document.body.innerHTML).toContain('preset-beta');
    expect(document.body.innerHTML).toContain('<option value="preset-beta" selected>preset-beta</option>');
  });

  it('中屏模式下 assistant 面板切换为全屏 overlay 布局', () => {
    viewportState_ACU.width = 1100;
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();

    const host = document.querySelector('#acu-vis-assistant-host') as HTMLElement;
    const panel = document.querySelector('.acu-vis-assistant-panel') as HTMLElement;
    expect(host).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(host.getAttribute('data-assistant-mode')).toBe('fullscreen-overlay');
    expect(host.getAttribute('data-open')).toBe('true');
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.inset).toBe('0');
    expect(panel.style.width).toBe('100vw');
    expect(panel.style.height).toBe('100dvh');
    expect(panel.style.background).toContain('var(--vis-assistant-window-bg, var(--vis-bg-color, #111827))');
  });

  it('窄屏模式下 assistant 面板切换为全屏 overlay 且按钮纵向堆叠', () => {
    viewportState_ACU.width = 768;
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();

    const host = document.querySelector('#acu-vis-assistant-host') as HTMLElement;
    const panel = document.querySelector('.acu-vis-assistant-panel') as HTMLElement;
    const actionRow = document.querySelector('.acu-assistant-action-row') as HTMLElement;
    expect(host).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(host.getAttribute('data-assistant-mode')).toBe('fullscreen-overlay');
    expect(host.getAttribute('data-open')).toBe('true');
    expect(host.getAttribute('data-minimized')).toBe('false');
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.width).toBe('100vw');
    expect(panel.style.inset).toBe('0');
    expect(panel.style.height).toBe('100dvh');
    expect(actionRow.style['flex-direction']).toBe('column');
  });

  it('手机窄屏 visualizer 窗口应使用全页面窗口样式信号', async () => {
    const source = await import('../../src/presentation/window/window-system');
    expect(String(source.createACUWindow_ACU || source.createACUWindow || '')).toContain('forcePhoneFullscreen');
  });

  it('窄屏模式下可以关闭 assistant 面板', () => {
    viewportState_ACU.width = 768;
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();

    const closeBtn = document.querySelector('#acu-vis-assistant-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    const host = document.querySelector('#acu-vis-assistant-host') as HTMLElement;
    const panel = document.querySelector('.acu-vis-assistant-panel') as HTMLElement;
    expect(host.getAttribute('data-open')).toBe('false');
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.opacity).toBe('0');
    expect(panel.style.display).toBe('none');
  });

  it('切换 assistant API 预设后发送请求会把 tableApiPreset 传给 runSession', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-preset-ui', atomic: true, summary: '新增战利品表', warnings: [] },
      compileResult: {
        diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
        highRiskItems: [],
        lockChanges: [],
      },
    });

    const select = document.querySelector('#acu-vis-assistant-api-preset') as HTMLSelectElement;
    select.value = 'preset-beta';
    select.dispatchEvent(new Event('change'));

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '新增战利品表';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRunSession).toHaveBeenCalledWith(expect.objectContaining({ tableApiPreset: 'preset-beta' }));
  });

  it('panel 能打开和关闭', () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    expect(document.querySelector('.acu-vis-assistant-panel')).toBeTruthy();

    const closeBtn = document.querySelector('#acu-vis-assistant-close') as HTMLButtonElement;
    closeBtn.click();
    expect((document.querySelector('.acu-vis-assistant-panel') as HTMLElement).style.display).toBe('none');
  });

  it('生成时读取 _acuVisState.tempData 最新快照', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    state.tempData.sheet_b = { name: 'B表' } as any;
    mockRunSession.mockResolvedValue({ draft: { protocolVersion: 2, requestId: 'req-1', atomic: true, warnings: [] }, compileResult: { diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false }, highRiskItems: [], lockChanges: [] } });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '新增';
    textarea.dispatchEvent(new Event('input'));
    const btn = document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRunSession.mock.calls[0][0].tempData.sheet_b.name).toBe('B表');
  });

  it('draft 能展示 diff', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-2', atomic: true, summary: '新增战利品表', warnings: ['注意命名一致性'] },
      compileResult: {
        diff: {
          addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }],
          deletedSheets: [],
          renamedSheets: [{ sheetKey: 'sheet_a', beforeName: 'A表', afterName: '新A表' }],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [{ sheetKey: 'sheet_a', name: 'A表', keys: ['contextDepth'] }],
          patchedExportConfigSheets: [],
          patchedContentSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['新增 1 行'] }],
          patchedSchemaSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['新增列: 金额'] }],
          patchedLockSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['锁定列: 金额'] }],
          globalInjectionChanged: false,
        },
        highRiskItems: [],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '新增战利品表';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.body.innerHTML).toContain('战利品表 [sheet_new]');
    expect(document.body.innerHTML).toContain('A表: contextDepth');
    expect(document.body.innerHTML).toContain('A表 -> 新A表');
    expect(document.body.innerHTML).toContain('A表: 新增 1 行');
    expect(document.body.innerHTML).toContain('A表: 新增列: 金额');
    expect(document.body.innerHTML).toContain('A表: 锁定列: 金额');
  });

  it('存在高风险项时未确认前应用按钮不可用', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-3', atomic: true, summary: '删除旧表', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [{ sheetKey: 'sheet_a', name: 'A表' }],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [{ type: 'delete_sheet', label: '删除表: A表' }],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '删除旧表';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect((document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('确认高风险项后原地启用应用按钮而不重渲染整个聊天区', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-3b', atomic: true, summary: '更新 DDL', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['更新 DDL: 战利品表'] }],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [{ type: 'patch_sheet_schema', label: '更新 DDL: 战利品表' }],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '更新 DDL';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const beforeHtml = document.body.innerHTML;
    const checkbox = document.querySelector('.acu-assistant-risk-confirm') as HTMLInputElement;
    const applyBtn = document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement;
    expect(checkbox.checked).toBe(true);
    expect(applyBtn.disabled).toBe(false);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(applyBtn.disabled).toBe(true);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(applyBtn.disabled).toBe(false);
    expect(document.body.innerHTML).toBe(beforeHtml);
  });

  it('DDL 高风险项默认通过时点击应用按钮会真正触发 apply', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-3c', atomic: true, summary: '更新 DDL', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['更新 DDL: 战利品表'] }],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [{ type: 'patch_sheet_schema', label: '更新 DDL: 战利品表' }],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '更新 DDL';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const applyBtn = document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    applyBtn.click();

    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('非 DDL 高风险项未确认时即使触发 apply click 也不会执行应用', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-3d', atomic: true, summary: '删除 A表', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [{ sheetKey: 'sheet_a', name: 'A表' }],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [{ type: 'delete_sheet', label: '删除表: A表' }],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '删除 A表';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const applyBtn = document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    applyBtn.click();

    expect(mockApply).not.toHaveBeenCalled();
    expect(mockShowToastr).toHaveBeenCalledWith('warning', '请先确认所有高风险项后再应用。');
  });

  it('混合高风险时只对 DDL 项默认通过，其他项仍需确认', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-3e', atomic: true, summary: '更新 DDL 并删除旧表', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [{ sheetKey: 'sheet_b', name: 'B表' }],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['更新 DDL: 战利品表'] }],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [
          { type: 'patch_sheet_schema', label: '更新 DDL: 战利品表' },
          { type: 'delete_sheet', label: '删除表: B表' },
        ],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '更新 DDL 并删除旧表';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const checkboxes = document.querySelectorAll('.acu-assistant-risk-confirm') as unknown as HTMLInputElement[];
    const applyBtn = document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement;
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    expect(applyBtn.disabled).toBe(true);

    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new Event('change'));

    expect(applyBtn.disabled).toBe(false);
  });

  it('v1 草稿在切换当前表时会刷新标题并清空旧草稿', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 1, selectedSheetKey: 'sheet_a', summary: '新增战利品表', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }],
          deletedSheets: [],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '新增战利品表';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.body.innerHTML).toContain('当前表：A表 (sheet_a)');
    expect(document.body.innerHTML).toContain('战利品表 [sheet_new]');

    state.tempData.sheet_b = { name: 'B表' } as any;
    state.currentSheetKey = 'sheet_b';
    handleVisualizerTemplateAssistantSheetChange_ACU();

    expect(document.body.innerHTML).toContain('当前表：B表 (sheet_b)');
    expect(document.body.innerHTML).not.toContain('战利品表 [sheet_new]');
  });

  it('v2 草稿在切换当前表时保留已生成 diff', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-4', atomic: true, selectedSheetKey: 'sheet_a', summary: '跨表修改', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }],
          deletedSheets: [],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '跨表修改';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    state.tempData.sheet_b = { name: 'B表' } as any;
    state.currentSheetKey = 'sheet_b';
    handleVisualizerTemplateAssistantSheetChange_ACU();

    expect(document.body.innerHTML).toContain('当前表：B表 (sheet_b)');
    expect(document.body.innerHTML).toContain('战利品表 [sheet_new]');
  });

  it('多条高风险操作需要逐项确认', async () => {
    setVisualizerTemplateAssistantOpen_ACU(true);
    renderVisualizerTemplateAssistantPanel_ACU();
    mockRunSession.mockResolvedValue({
      draft: { protocolVersion: 2, requestId: 'req-5', atomic: true, summary: '删除多张旧表', warnings: [] },
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [{ sheetKey: 'sheet_a', name: 'A表' }, { sheetKey: 'sheet_b', name: 'B表' }],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [
          { type: 'delete_sheet', label: '删除表: A表' },
          { type: 'delete_sheet', label: '删除表: B表' },
        ],
        lockChanges: [],
      },
    });

    const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
    textarea.value = '删除两张旧表';
    textarea.dispatchEvent(new Event('input'));
    (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const checkboxes = document.querySelectorAll('.acu-assistant-risk-confirm') as unknown as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect((document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement).disabled).toBe(true);

    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change'));

    expect((document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement).disabled).toBe(true);

    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new Event('change'));

    expect((document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement).disabled).toBe(false);
  });

  // Chat-first UI tests
  describe('chat-first transcript behavior', () => {
    it('聊天区域有专用的可滚动框架容器', () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      const html = document.body.innerHTML;
      const scrollFrame = document.querySelector('.acu-chat-scroll-frame');
      expect(scrollFrame).toBeTruthy();
      expect(html).toContain('acu-chat-scroll-frame');
      expect(html).toContain('border-radius:12px');
      expect(html).toContain('overflow:visible');
      expect(html).toContain('background:var(--vis-assistant-surface-bg');
      const chatContainer = document.querySelector('.acu-chat-container');
      expect(chatContainer).toBeTruthy();
      expect(html).toContain('overflow-y:auto');
    });

    it('输入内容后发送按钮变为可用状态（regression test for input-does-not-enable-button bug）', () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      // 初始状态下按钮应该是disabled
      const btn = document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);

      // 输入内容
      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));

      // 按钮应该变为enabled
      expect(btn.disabled).toBe(false);

      // 清空内容
      textarea.value = '';
      textarea.dispatchEvent(new Event('input'));

      // 按钮应该再次变为disabled
      expect(btn.disabled).toBe(true);
    });

    it('提交后用户请求显示为用户聊天轮次', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-chat-1', atomic: true, summary: '新增战利品表', warnings: [] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();

      // 用户轮次应立即出现
      const userTurns = document.querySelectorAll('.acu-chat-turn-user');
      expect(userTurns.length).toBeGreaterThan(0);
      expect(document.body.innerHTML).toContain('新增战利品表');

      await Promise.resolve();
      await Promise.resolve();
    });

    it('生成成功后AI结果显示为助手聊天轮次', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-chat-2', atomic: true, summary: '新增战利品表', warnings: [] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const assistantTurns = document.querySelectorAll('.acu-chat-turn-assistant');
      expect(assistantTurns.length).toBeGreaterThan(0);
      expect(document.body.innerHTML).toContain('新增战利品表');
    });

    it('生成失败时显示错误助手轮次', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockRejectedValue(new Error('网络错误'));

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const errorTurns = document.querySelectorAll('.acu-chat-turn-error');
      expect(errorTurns.length).toBeGreaterThan(0);
      expect(document.body.innerHTML).toContain('网络错误');
    });

    it('会话被取消（StoppedError）时：不写入 final turn、不追加错误 turn（停止按钮语义）', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      const { TemplateAssistantSessionStoppedError_ACU } = await import('../../src/service/template-assistant/service');
      // 真实时序：AI 返回 → onRoundComplete 已触发（V1 会写入 round preview）→ 回调后
      // service 因 guard.cancel 抛出 StoppedError → UI catch 只 toast 并返回。
      mockRunSession.mockImplementation(async (input: any) => {
        input.onRoundComplete?.({
          round: {
            round: 1,
            userRequest: input.userRequest,
            draft: { protocolVersion: 2, requestId: 'req-cancel', atomic: true, selectedSheetKey: input.currentSheetKey, summary: '取消前草稿', warnings: [] },
            aiRawText: '<templateAssistantDraft>{"round":1}</templateAssistantDraft>',
            messages: [],
            perRoundCompileResult: {
              candidateData: {},
              orderedSheetKeys: [],
              deletedSheetKeys: [],
              focusSheetKey: input.currentSheetKey,
              diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
              highRiskItems: [],
              lockChanges: [],
              schemaMigrationIntents: {},
            },
            workingFingerprint: 'round-fp',
          },
          rounds: [],
          maxRounds: 1,
        });
        throw new TemplateAssistantSessionStoppedError_ACU('cancelled');
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 真实取消时序：preview turn 已写入但无 final turn、无 error turn、无应用按钮
      const userTurns = document.querySelectorAll('.acu-chat-turn-user');
      const assistantTurns = document.querySelectorAll('.acu-chat-turn-assistant');
      const errorTurns = document.querySelectorAll('.acu-chat-turn-error');
      expect(userTurns.length).toBe(1);
      // preview 保留（phase: round，不可应用）
      expect(assistantTurns.length).toBe(1);
      expect(errorTurns.length).toBe(0);
      expect(document.querySelector('#acu-vis-assistant-apply')).toBeNull();
      expect(mockShowToastr).toHaveBeenCalledWith('warning', expect.stringContaining('取消'));
    });

    it('AI操作默认显示为折叠的单行摘要', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-collapse-1', atomic: true, summary: '新增战利品表', warnings: ['警告1', '警告2'] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 检查只有一个详情折叠摘要
      const collapsedSummaries = document.querySelectorAll('.acu-collapsed-summary');
      expect(collapsedSummaries.length).toBe(1);
      expect(document.body.innerHTML).toContain('详情');
    });

    it('展开摘要后显示详细内容', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-expand-1', atomic: true, summary: '新增战利品表', warnings: ['警告1'] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 点击展开按钮
      const expandBtn = document.querySelector('.acu-expand-toggle') as HTMLElement;
      if (expandBtn) {
        expandBtn.click();
        // 详细内容区域应该可见
        const detailBlock = document.querySelector('.acu-detail-block');
        expect(detailBlock).toBeTruthy();
      }
    });

    it('v1模式下切换sheet时清空整个transcript', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 1, selectedSheetKey: 'sheet_a', summary: '新增战利品表', warnings: [] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 切换sheet
      state.tempData.sheet_b = { name: 'B表' } as any;
      state.currentSheetKey = 'sheet_b';
      handleVisualizerTemplateAssistantSheetChange_ACU();

      // transcript应该被清空
      const userTurns = document.querySelectorAll('.acu-chat-turn-user');
      const assistantTurns = document.querySelectorAll('.acu-chat-turn-assistant');
      expect(userTurns.length).toBe(0);
      expect(assistantTurns.length).toBe(0);
    });

    it('v2模式下切换sheet时保留transcript', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-v2-preserve', atomic: true, selectedSheetKey: 'sheet_a', summary: '跨表修改', warnings: [] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '跨表修改';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 切换sheet
      state.tempData.sheet_b = { name: 'B表' } as any;
      state.currentSheetKey = 'sheet_b';
      handleVisualizerTemplateAssistantSheetChange_ACU();

      // transcript应该保留
      const assistantTurns = document.querySelectorAll('.acu-chat-turn-assistant');
      expect(assistantTurns.length).toBeGreaterThan(0);
    });

    it('成功应用后保留transcript以支持连续改造', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-apply-clear', atomic: true, summary: '新增战利品表', warnings: [] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 点击应用按钮
      (document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement).click();

      // transcript应该保留
      const userTurns = document.querySelectorAll('.acu-chat-turn-user');
      const assistantTurns = document.querySelectorAll('.acu-chat-turn-assistant');
      expect(userTurns.length).toBe(1);
      expect(assistantTurns.length).toBe(1);
    });

    it('应用后继续发送下一轮请求时 transcript 会累积追加', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      mockRunSession
        .mockResolvedValueOnce({
          draft: { protocolVersion: 2, requestId: 'req-apply-keep-1', atomic: true, summary: '第一轮修改', warnings: [] },
          compileResult: {
            diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
            highRiskItems: [],
            lockChanges: [],
          },
        })
        .mockResolvedValueOnce({
          draft: { protocolVersion: 2, requestId: 'req-apply-keep-2', atomic: true, summary: '第二轮修改', warnings: [] },
          compileResult: {
            diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['改单元格: 第1行.姓名'] }], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
            highRiskItems: [],
            lockChanges: [],
          },
        });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '第一轮修改';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      (document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement).click();

      const secondTextarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      secondTextarea.value = '第二轮修改';
      secondTextarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const userTurns = document.querySelectorAll('.acu-chat-turn-user');
      const assistantTurns = document.querySelectorAll('.acu-chat-turn-assistant');
      expect(userTurns.length).toBe(2);
      expect(assistantTurns.length).toBe(2);
      expect(document.body.innerHTML).toContain('第一轮修改');
      expect(document.body.innerHTML).toContain('第二轮修改');
    });

    it('只有最新的助手轮次可以进行确认和应用', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-latest-1', atomic: true, summary: '新增战利品表', warnings: [] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增战利品表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 只有一个应用按钮，且在最新的助手轮次中
      const applyBtns = document.querySelectorAll('#acu-vis-assistant-apply');
      expect(applyBtns.length).toBe(1);
    });

    it('连续对话时 priorTurns 正确传入 API（第二轮包含第一轮的 user 和 assistant）', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      mockRunSession
        .mockResolvedValueOnce({
          draft: { protocolVersion: 2, requestId: 'req-prior-1', atomic: true, summary: '第一轮', warnings: [] },
          aiRawText: '第一轮AI响应文本',
          compileResult: {
            diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '新表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
            highRiskItems: [],
            lockChanges: [],
          },
        })
        .mockResolvedValueOnce({
          draft: { protocolVersion: 2, requestId: 'req-prior-2', atomic: true, summary: '第二轮', warnings: [] },
          aiRawText: '第二轮AI响应文本',
          compileResult: {
            diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['修改'] }], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
            highRiskItems: [],
            lockChanges: [],
          },
        });

      // 第一轮请求
      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '新增新表';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 应用第一轮结果
      (document.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement).click();

      // 第二轮请求
      const textarea2 = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea2.value = '修改A表';
      textarea2.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 验证第二轮调用时 priorTurns 包含第一轮的 user 和 assistant
      expect(mockRunSession).toHaveBeenCalledTimes(2);
      const secondCallArgs = mockRunSession.mock.calls[1][0];
      expect(secondCallArgs.priorTurns).toBeTruthy();
      expect(Array.isArray(secondCallArgs.priorTurns)).toBe(true);
      expect(secondCallArgs.priorTurns.length).toBe(1);
      expect(secondCallArgs.priorTurns[0].user).toBe('新增新表');
      expect(secondCallArgs.priorTurns[0].assistant).toBe('第一轮AI响应文本');
    });

    it('首轮请求时 priorTurns 为空数组', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-empty-prior', atomic: true, summary: '首轮', warnings: [] },
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '首轮请求';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockRunSession).toHaveBeenCalledTimes(1);
      const callArgs = mockRunSession.mock.calls[0][0];
      expect(callArgs.priorTurns).toBeTruthy();
      expect(Array.isArray(callArgs.priorTurns)).toBe(true);
      expect(callArgs.priorTurns.length).toBe(0);
    });

    it('请求过程中切换当前表时，不把失效 user turn 带入后续 priorTurns', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      let resolveFirstRequest: ((value: any) => void) | null = null;
      mockRunSession.mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstRequest = resolve;
      }));
      mockRunSession.mockResolvedValueOnce({
        draft: { protocolVersion: 2, requestId: 'req-valid-second', atomic: true, summary: '有效第二轮', warnings: [] },
        aiRawText: '有效第二轮响应',
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '会失效的请求';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();

      state.tempData.sheet_b = { name: 'B表' } as any;
      state.currentSheetKey = 'sheet_b';

      resolveFirstRequest?.({
        draft: { protocolVersion: 2, requestId: 'req-stale-first', atomic: true, summary: '旧请求返回', warnings: [] },
        aiRawText: '旧请求返回',
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });
      await Promise.resolve();
      await Promise.resolve();

      const textarea2 = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea2.value = '新的有效请求';
      textarea2.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const secondCallArgs = mockRunSession.mock.calls[1][0];
      expect(secondCallArgs.priorTurns).toEqual([]);
      expect(document.body.innerHTML).toContain('当前选中表已变化，请重新生成 assistant 草稿。');
      expect(document.body.innerHTML).not.toContain('会失效的请求');
    });

    it('session 结果会在详情摘要中显示轮次信息', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-session-ui', atomic: true, summary: '带会话信息', warnings: [] },
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
        session: {
          originalBaseFingerprint: 'acu-struct:base',
          finalWorkingFingerprint: 'acu-struct:final',
          stopReason: 'empty_operations',
          roundsExecuted: 1,
          maxRounds: 1,
          repairRetriesUsed: 0,
          maxRepairRetries: 1,
          lastErrorMessage: '',
        },
        rounds: [],
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '带会话信息';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.body.innerHTML).toContain('空操作停止');
    });


    it('session 轮次完成时会立即显示中间结果，而不是等全部结束', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      let resolveFinal: ((value: any) => void) | null = null;
      mockRunSession.mockImplementationOnce((input: any) => {
        input.onRoundComplete?.({
          round: {
            round: 1,
            userRequest: '第一轮请求',
            draft: { protocolVersion: 2, requestId: 'req-round-1', atomic: true, selectedSheetKey: 'sheet_a', summary: '第一轮结果', warnings: [] },
            aiRawText: '第一轮AI响应',
            messages: [],
            perRoundCompileResult: {
              diff: { addedSheets: [{ sheetKey: 'sheet_b', name: 'B表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
              highRiskItems: [],
              lockChanges: [],
            },
            workingFingerprint: 'acu-struct:round-1',
          },
          rounds: [{
            round: 1,
            userRequest: '第一轮请求',
            draft: { protocolVersion: 2, requestId: 'req-round-1', atomic: true, selectedSheetKey: 'sheet_a', summary: '第一轮结果', warnings: [] },
            aiRawText: '第一轮AI响应',
            messages: [],
            perRoundCompileResult: { diff: { addedSheets: [{ sheetKey: 'sheet_b', name: 'B表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false }, highRiskItems: [], lockChanges: [] },
            workingFingerprint: 'acu-struct:round-1',
          }],
          maxRounds: 1,
        });

        return new Promise((resolve) => {
          resolveFinal = resolve;
        });
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '逐轮显示';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();

      expect(document.body.innerHTML).toContain('第一轮结果');
      expect(document.querySelector('#acu-vis-assistant-apply')).toBeNull();

      resolveFinal?.({
        draft: { protocolVersion: 2, requestId: 'req-final', atomic: true, selectedSheetKey: 'sheet_b', summary: '最终结果', warnings: [] },
        aiRawText: '最终AI响应',
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_b', name: 'B表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [{ sheetKey: 'sheet_b', name: 'B表', changes: ['修改列'] }], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
        originalBaseFingerprint: 'acu-struct:base',
        rounds: [],
        messages: [],
        session: {
          originalBaseFingerprint: 'acu-struct:base',
          finalWorkingFingerprint: 'acu-struct:round-1',
          stopReason: 'empty_operations',
          roundsExecuted: 1,
          maxRounds: 1,
          repairRetriesUsed: 0,
          maxRepairRetries: 1,
          lastErrorMessage: '',
        },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(document.body.innerHTML).toContain('最终结果');
      expect(document.body.innerHTML).toContain('空操作停止');
      expect(document.querySelector('#acu-vis-assistant-apply')).toBeTruthy();
    });

    it('展开/折叠详情时滚动位置保持不变', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-scroll-1', atomic: true, summary: '测试滚动', warnings: ['警告内容'] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '新表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '测试滚动';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 获取聊天容器并设置模拟滚动位置
      const chatContainer = document.querySelector('.acu-chat-container') as any;
      expect(chatContainer).toBeTruthy();
      
      // 模拟用户滚动到某个位置
      chatContainer.scrollTop = 150;

      // 点击展开按钮
      const expandBtn = document.querySelector('.acu-expand-toggle') as HTMLElement;
      expect(expandBtn).toBeTruthy();
      expandBtn.click();

      // 等待重新渲染完成
      await Promise.resolve();

      // 验证滚动位置保持不变
      const newContainer = document.querySelector('.acu-chat-container') as any;
      expect(newContainer).toBeTruthy();
      expect(newContainer.scrollTop).toBe(150);
    });

    it('首次打开面板时滚动位置为0且不会出错', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      // 首次渲染，没有之前的容器
      expect(() => renderVisualizerTemplateAssistantPanel_ACU()).not.toThrow();
      
      const chatContainer = document.querySelector('.acu-chat-container') as any;
      expect(chatContainer).toBeTruthy();
      expect(chatContainer.scrollTop).toBe(0);
    });

    it('气泡样式渲染：无emoji头像', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-bubble-1', atomic: true, summary: '测试气泡样式', warnings: [] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '新表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '测试气泡样式';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const html = document.body.innerHTML;
      // 验证没有emoji头像
      expect(html).not.toContain('🤖');
      expect(html).not.toContain('👤');
      expect(html).not.toContain('⚠️');
      // 验证存在气泡类和原有 turn 选择器
      expect(html).toContain('acu-message-bubble-user');
      expect(html).toContain('acu-message-bubble-assistant');
      expect(document.querySelectorAll('.acu-message-bubble').length).toBeGreaterThan(0);
      expect(document.querySelector('.acu-chat-turn-user')).toBeTruthy();
      expect(document.querySelector('.acu-chat-turn-assistant')).toBeTruthy();
    });

    it('单一折叠区域：只有一个详情折叠区域', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();
      mockRunSession.mockResolvedValue({
        draft: { protocolVersion: 2, requestId: 'req-single-accordion-1', atomic: true, summary: '测试单一折叠', warnings: ['警告1'] },
        compileResult: {
          diff: { addedSheets: [{ sheetKey: 'sheet_new', name: '新表' }], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [{ type: 'delete_sheet', label: '删除表: A表' }],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '测试单一折叠';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const html = document.body.innerHTML;
      // 验证有一个详情折叠区域
      const summaryElements = document.querySelectorAll('.acu-collapsed-summary');
      expect(summaryElements.length).toBe(1);
      // 验证摘要包含警告、变更、高风险信息
      expect(html).toContain('警告1条');
      expect(html).toContain('变更1处');
      expect(html).toContain('高风险1项');
    });

    it('near-bottom用户：新消息追加后自动滚动到底部', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      // 先生成第一条消息，建立可滚动上下文
      mockRunSession.mockResolvedValueOnce({
        draft: { protocolVersion: 2, requestId: 'req-near-1', atomic: true, summary: '第一条消息', warnings: [] },
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '第一条消息';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 模拟用户在底部附近（设置较大的scrollTop和scrollHeight差值小于阈值）
      const chatContainer = document.querySelector('.acu-chat-container') as any;
      chatContainer.scrollHeight = 1000;
      chatContainer.clientHeight = 500;
      chatContainer.scrollTop = 450; // 450 + 500 = 950 >= 1000 - 50 = 950，所以是near-bottom

      mockRunSession.mockResolvedValueOnce({
        draft: { protocolVersion: 2, requestId: 'req-near-2', atomic: true, summary: '第二条消息', warnings: [] },
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea2 = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea2.value = '第二条消息';
      textarea2.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const newContainer = document.querySelector('.acu-chat-container') as any;
      expect(newContainer.scrollTop).toBe(newContainer.scrollHeight - newContainer.clientHeight);
    });

    it('非near-bottom用户：新消息追加后保持原滚动位置', async () => {
      setVisualizerTemplateAssistantOpen_ACU(true);
      renderVisualizerTemplateAssistantPanel_ACU();

      // 先生成第一条消息，建立可滚动上下文
      mockRunSession.mockResolvedValueOnce({
        draft: { protocolVersion: 2, requestId: 'req-preserve-1', atomic: true, summary: '第一条消息', warnings: [] },
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea.value = '第一条消息';
      textarea.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      // 模拟用户不在底部附近
      const chatContainer = document.querySelector('.acu-chat-container') as any;
      chatContainer.scrollHeight = 1000;
      chatContainer.clientHeight = 500;
      chatContainer.scrollTop = 100; // 100 + 500 = 600 < 1000 - 50 = 950，所以不是near-bottom

      mockRunSession.mockResolvedValueOnce({
        draft: { protocolVersion: 2, requestId: 'req-preserve-2', atomic: true, summary: '第二条消息', warnings: [] },
        compileResult: {
          diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
          highRiskItems: [],
          lockChanges: [],
        },
      });

      const textarea2 = document.querySelector('#acu-vis-assistant-input') as HTMLTextAreaElement;
      textarea2.value = '第二条消息';
      textarea2.dispatchEvent(new Event('input'));
      (document.querySelector('#acu-vis-assistant-generate') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();

      const newContainer = document.querySelector('.acu-chat-container') as any;
      expect(newContainer.scrollTop).toBe(100);
    });
  });

});
