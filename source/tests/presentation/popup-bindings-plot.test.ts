// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: { plotSettings: { plotWorldbookConfig: { source: 'character', enabledEntries: { 保留书: [9] } } } } as any,
  binding: vi.fn(), catalog: vi.fn(), entries: vi.fn(), save: vi.fn(), populate: vi.fn(), update: vi.fn(), logError: vi.fn(), toast: vi.fn(),
  noop: vi.fn(),
}));
vi.mock('../../src/shared/defaults-json.js', () => ({ DEFAULT_PLOT_SETTINGS_ACU: {} }));
vi.mock('../../src/presentation/theme/toast', () => ({ showToastr_ACU: mocks.toast }));
vi.mock('../../src/shared/constants', () => ({ SCRIPT_ID_PREFIX_ACU: 'shujuku_v120' }));
vi.mock('../../src/shared/utils', () => ({ logDebug_ACU: mocks.noop, logError_ACU: mocks.logError, logWarn_ACU: mocks.noop, normalizeExcludeRules_ACU: () => [], normalizeExtractRules_ACU: () => [] }));
vi.mock('../../src/service/worldbook/worldbook-service', () => ({ getCurrentCharacterWorldbookBinding_ACU: mocks.binding, getLorebookEntries_ACU: mocks.entries }));
vi.mock('../../src/service/runtime/state-manager', () => ({ settings_ACU: mocks.settings, currentChatFileIdentifier_ACU: '' }));
vi.mock('../../src/service/settings/settings-service', () => ({ setGlobalPlotEnabled_ACU: mocks.noop }));
vi.mock('../../src/presentation/components/settings-ui-helpers', () => ({ saveSettingsAndNotify_ACU: mocks.save }));
vi.mock('../../src/service/worldbook/pipeline', () => ({ getLorebookEntriesByNames_ACU: mocks.noop, getWorldBooks_ACU: mocks.catalog }));
vi.mock('../../src/presentation/components/worldbook-selector', () => ({
  applyWorldbookEntryFilter_ACU: mocks.noop, applyWorldbookListFilter_ACU: mocks.noop,
  getPlotWorldbookConfig_ACU: () => mocks.settings.plotSettings.plotWorldbookConfig,
  isEntryBlocked_ACU: () => false, populatePlotWorldbookEntryList_ACU: mocks.populate,
  renderLazyWorldbookEntryItems_ACU: mocks.noop, toggleLazyWorldbookEntryGroup_ACU: mocks.noop,
  updateLazyWorldbookEntryCheckedState_ACU: mocks.noop, updatePlotWorldbookSourceView_ACU: mocks.update,
}));
vi.mock('../../src/presentation/components/plot-editors', () => ({ addPlotTaskFromUI_ACU: mocks.noop, deleteCurrentPlotTaskFromUI_ACU: mocks.noop, flushCurrentPlotTaskEditorState_ACU: mocks.noop, getPlotPromptGroupFromUI_ACU: mocks.noop, loadCurrentPlotTaskToUI_ACU: mocks.noop, moveCurrentPlotTask_ACU: mocks.noop, renderPlotPromptSegments_ACU: mocks.noop, renderPlotTaskList_ACU: mocks.noop, saveCurrentPlotTaskApiPresetFromUI_ACU: mocks.noop, saveCurrentPlotTaskFromUI_ACU: mocks.noop, schedulePlotTaskAutoSave_ACU: mocks.noop, selectPlotTaskForEditing_ACU: mocks.noop }));
vi.mock('../../src/service/plot/plot-state', () => ({ buildDefaultPlotPromptGroup_ACU: mocks.noop }));
vi.mock('../../src/service/template/chat-scope', () => ({ getCurrentChatPlotScopeState_ACU: mocks.noop }));
vi.mock('../../src/presentation/pages/popup-helpers', () => ({ getCurrentPlotSettingsFromUI_ACU: mocks.noop, loadPlotPresetSelect_ACU: mocks.noop, loadPlotSettingsToUI_ACU: mocks.noop, savePlotPresetAsNew_ACU: mocks.noop }));
vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshPresetUIAfterSwitch_ACU: mocks.noop }));
vi.mock('../../src/presentation/components/optimization-ui', () => ({
  appendExcludeRuleRow_ACU: mocks.noop, applyGlobalPlotPresetSelectionForEditor_ACU: mocks.noop, applyPlotPresetToSettings_ACU: mocks.noop,
  clearPlotPresetBindingForChat_ACU: mocks.noop, ensureLoopPromptsArray_ACU: mocks.noop, ensurePlotTasksCompat_ACU: mocks.noop,
  getActivePlotEditorSettings_ACU: mocks.noop, getCurrentRuntimePlotPresetName_ACU: mocks.noop, getPlotPresetBindingForChat_ACU: mocks.noop,
  isDefaultPlotPresetSelection_ACU: mocks.noop, normalizePlotPresetExcludeRules_ACU: mocks.noop, normalizePlotPresetSelectionValue_ACU: mocks.noop,
  persistPlotPresetSelectionState_ACU: mocks.noop, readExcludeRulesFromRows_ACU: mocks.noop,
  setActivePlotEditorSettings_ACU: mocks.noop, setCurrentEditablePlotPresetState_ACU: mocks.noop,
  setPlotPromptContentByIdForSettings_ACU: mocks.noop, stripPlotPresetWorldbookEntrySelectionForExport_ACU: mocks.noop,
  switchCurrentChatPlotPreset_ACU: mocks.noop,
}));

import { _set_jQuery_API_ACU } from '../../src/shared/host-api';
import { _set_$popupInstance_ACU } from '../../src/presentation/state/ui-refs';
import { bindPlotEvents_ACU } from '../../src/presentation/pages/popup-bindings-plot';

function createMiniJQuery_ACU() {
  const data = new WeakMap<HTMLElement, Record<string, unknown>>();
  class MiniJQ {
    constructor(readonly elements: HTMLElement[] = []) {}
    get length() { return this.elements.length; }
    find(selector: string) { return new MiniJQ(this.elements.flatMap(e => Array.from(e.querySelectorAll(selector)) as HTMLElement[])); }
    off() { return this; }
    on(event: string, selectorOrHandler: string | ((this: HTMLElement, event: Event) => unknown), maybeHandler?: (this: HTMLElement, event: Event) => unknown) {
      const type = event.split('.')[0];
      const selector = typeof selectorOrHandler === 'string' ? selectorOrHandler : null;
      const handler = (typeof selectorOrHandler === 'function' ? selectorOrHandler : maybeHandler)!;
      this.elements.forEach(element => element.addEventListener(type, eventObject => {
        const target = eventObject.target as HTMLElement;
        if (selector && !target.closest(selector)) return;
        void handler.call((selector ? target.closest(selector) : element) as HTMLElement, eventObject);
      }));
      return this;
    }
    filter(selector: string | ((this: HTMLElement) => boolean)) { return new MiniJQ(typeof selector === 'string' ? this.elements.filter(e => e.matches(selector)) : this.elements.filter(e => selector.call(e))); }
    prop(_name: string, _value?: unknown) { return this; }
    val(value?: unknown): any { if (value === undefined) return (this.elements[0] as HTMLInputElement | undefined)?.value; this.elements.forEach(e => { (e as HTMLInputElement).value = String(value); }); return this; }
    data(key: string, value?: unknown): any { const element = this.elements[0]; if (!element) return value === undefined ? undefined : this; const values = data.get(element) || {}; if (value === undefined) return values[key] ?? element.getAttribute(`data-${key}`); values[key] = value; data.set(element, values); return this; }
    is(selector: string) { return this.elements[0]?.matches(selector) ?? false; }
    closest(selector: string) { const element = this.elements[0]?.closest(selector); return new MiniJQ(element ? [element as HTMLElement] : []); }
    hide() { return this; } show() { return this; } css() { return this; } empty() { return this; } html() { return this; }
  }
  return ((input?: unknown) => input instanceof MiniJQ ? input : input instanceof HTMLElement ? new MiniJQ([input]) : typeof input === 'string' ? new MiniJQ(Array.from(document.querySelectorAll(input)) as HTMLElement[]) : new MiniJQ()) as any;
}

async function clickWorldbookSelectionAction_ACU(actionId: string) {
  (document.querySelector(`#shujuku_v120-${actionId}`) as HTMLButtonElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(async () => {
  document.body.innerHTML = '<div id="popup-root"><button id="shujuku_v120-plot-worldbook-select-all"></button><button id="shujuku_v120-plot-worldbook-deselect-all"></button><button id="shujuku_v120-plot-worldbook-select-none"></button></div>';
  const $ = createMiniJQuery_ACU();
  _set_jQuery_API_ACU($);
  _set_$popupInstance_ACU($(document.querySelector('#popup-root')));
  mocks.settings.plotSettings = { plotWorldbookConfig: { source: 'character', enabledEntries: { 保留书: [9] } } };
  for (const mock of [mocks.binding, mocks.catalog, mocks.entries, mocks.save, mocks.populate, mocks.update, mocks.logError, mocks.toast]) mock.mockReset();
  mocks.binding.mockResolvedValue({ primary: '主书', additional: [], orderedNames: ['主书'], apiSource: 'getCharWorldbookNames' });
  mocks.catalog.mockResolvedValue([{ name: '主书', entries: [{ uid: 1, comment: '普通条目', enabled: true }] }]);
  mocks.populate.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
  await bindPlotEvents_ACU();
});

describe('剧情世界书批量选择失败边界', () => {
  const actions = [
    ['plot-worldbook-select-all', true],
    ['plot-worldbook-deselect-all', false],
    ['plot-worldbook-select-none', false],
  ] as const;

  it.each(actions.flatMap(([actionId]) => [
    [actionId, '角色 binding', () => mocks.binding.mockRejectedValue(new Error('binding-secret-stack')), 'plot_character_binding'],
    [actionId, '世界书目录', () => mocks.catalog.mockRejectedValue(new Error('catalog-secret-stack')), 'plot_worldbook_selection_catalog'],
    [actionId, '单书条目', () => { mocks.catalog.mockResolvedValue([]); mocks.entries.mockRejectedValue(new Error('entries-secret-stack')); }, 'plot_worldbook_selection_entries'],
  ]))('%s 在 %s 读取失败时不保存配置且日志脱敏', async (actionId, _label, configure, phase) => {
    configure();
    await clickWorldbookSelectionAction_ACU(actionId);

    expect(mocks.settings.plotSettings.plotWorldbookConfig.enabledEntries).toEqual({ 保留书: [9] });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.populate).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith('[剧情推进] Plot worldbook action failed:', { phase, error: { category: 'unknown' } });
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain('secret-stack');
    expect(mocks.toast).toHaveBeenCalledWith('error', '剧情世界书操作失败，请重试。');
  });

  it.each(actions)('%s 所有读取成功时才提交新的选择并刷新条目面板', async (actionId, selected) => {
    await clickWorldbookSelectionAction_ACU(actionId);

    expect(mocks.settings.plotSettings.plotWorldbookConfig.enabledEntries).toEqual({ 保留书: [9], 主书: selected ? [1] : [] });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.populate).toHaveBeenCalledTimes(1);
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

