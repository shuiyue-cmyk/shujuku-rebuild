// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHandleSheetChange,
  mockInvalidateSession,
  mockRenderPanel,
  mockResetState,
  mockToggle,
  state,
} = vi.hoisted(() => {
  (globalThis as any).__ACU_DISABLE_TEMPLATE_ASSISTANT_ADDON_AUTO_INIT__ = true;
  return {
    mockHandleSheetChange: vi.fn(),
    mockInvalidateSession: vi.fn(),
    mockRenderPanel: vi.fn(),
    mockResetState: vi.fn(),
    mockToggle: vi.fn(),
    state: {
      currentSheetKey: 'sheet_a',
    } as any,
  };
});

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: globalThis.window,
}));

vi.mock('../../src/presentation/pages/visualizer', () => ({
  _acuVisState: state,
}));

vi.mock('../../src/presentation/pages/visualizer-template-assistant', () => ({
  handleVisualizerTemplateAssistantSheetChange_ACU: mockHandleSheetChange,
  invalidateVisualizerTemplateAssistantSession_ACU: mockInvalidateSession,
  renderVisualizerTemplateAssistantPanel_ACU: mockRenderPanel,
  resetVisualizerTemplateAssistantState_ACU: mockResetState,
  toggleVisualizerTemplateAssistant_ACU: mockToggle,
}));

import {
  ensureVisualizerTemplateAssistantAddonDom_ACU,
  syncVisualizerTemplateAssistantAddon_ACU,
} from '../../src/presentation/bootstrap/visualizer-template-assistant-addon';

describe('visualizer template assistant addon', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockHandleSheetChange.mockReset();
    mockInvalidateSession.mockReset();
    mockRenderPanel.mockReset();
    mockResetState.mockReset();
    mockToggle.mockReset();
    state.currentSheetKey = 'sheet_a';
  });

  it('向现有 visualizer DOM 注入按钮和 host', () => {
    document.body.innerHTML = `
      <div id="acu-visualizer-content">
        <div class="acu-vis-toolbar">
          <div class="acu-vis-actions">
            <button id="acu-vis-theme-btn"></button>
          </div>
        </div>
        <div class="acu-vis-content">
          <div id="acu-vis-assistant-dock"></div>
          <div id="acu-vis-main-area"></div>
        </div>
      </div>
    `;

    expect(ensureVisualizerTemplateAssistantAddonDom_ACU()).toBe(true);
    expect(document.querySelector('#acu-vis-assistant-btn')).toBeTruthy();
    expect(document.querySelector('#acu-vis-assistant-host')).toBeTruthy();
    expect(mockRenderPanel).toHaveBeenCalled();
  });

  it('首次检测到 visualizer 时重置状态，并在切表时通知 panel', () => {
    document.body.innerHTML = `
      <div id="acu-visualizer-content">
        <div class="acu-vis-toolbar">
          <div class="acu-vis-actions"></div>
        </div>
        <div class="acu-vis-content">
          <div id="acu-vis-assistant-dock"></div>
        </div>
      </div>
    `;

    syncVisualizerTemplateAssistantAddon_ACU(true);
    expect(mockResetState).toHaveBeenCalledTimes(1);
    expect(mockHandleSheetChange).toHaveBeenCalledTimes(1);

    state.currentSheetKey = 'sheet_b';
    syncVisualizerTemplateAssistantAddon_ACU();
    expect(mockHandleSheetChange).toHaveBeenCalledTimes(2);
  });

  it('点击外挂按钮时切换 assistant 面板', () => {
    document.body.innerHTML = `
      <div id="acu-visualizer-content">
        <div class="acu-vis-toolbar">
          <div class="acu-vis-actions"></div>
        </div>
        <div class="acu-vis-content">
          <div id="acu-vis-assistant-dock"></div>
        </div>
      </div>
    `;

    ensureVisualizerTemplateAssistantAddonDom_ACU();
    (document.querySelector('#acu-vis-assistant-btn') as HTMLButtonElement).click();

    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('assistant host 元素被正确注入到 visualizer 根节点中', () => {
    document.body.innerHTML = `
      <div id="acu-visualizer-content">
        <div class="acu-vis-toolbar">
          <div class="acu-vis-actions"></div>
        </div>
        <div class="acu-vis-content">
          <div class="acu-vis-sidebar"></div>
          <div id="acu-vis-assistant-dock"></div>
          <div class="acu-vis-main"></div>
        </div>
      </div>
    `;

    ensureVisualizerTemplateAssistantAddonDom_ACU();

    const root = document.querySelector('#acu-visualizer-content');
    const dock = document.querySelector('#acu-vis-assistant-dock');
    const host = document.querySelector('#acu-vis-assistant-host');

    expect(host).toBeTruthy();
    expect(root?.contains(host)).toBe(true);
    expect(host?.parentElement).toBe(dock);
    expect(dock?.lastElementChild).toBe(host);
  });

});
