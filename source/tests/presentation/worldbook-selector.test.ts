// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: { plotSettings: { plotWorldbookConfig: { source: 'character', manualSelection: [], enabledEntries: {} } } } as any,
  getBinding: vi.fn(), getEntries: vi.fn(), logError: vi.fn(), save: vi.fn(),
}));

vi.mock('../../src/shared/defaults-json.js', () => ({ DEFAULT_PLOT_SETTINGS_ACU: {} }));
vi.mock('../../src/shared/defaults', () => ({ buildDefaultPlotWorldbookConfig_ACU: () => ({ source: 'character', manualSelection: [], enabledEntries: {} }) }));
vi.mock('../../src/service/settings/settings-readers', () => ({ getCurrentWorldbookConfig_ACU: vi.fn() }));
vi.mock('../../src/service/worldbook/worldbook-service', () => ({
  getCurrentCharacterWorldbookBinding_ACU: mocks.getBinding, getCharLorebooks_ACU: vi.fn(),
}));
vi.mock('../../src/service/runtime/state-manager', () => ({ settings_ACU: mocks.settings }));
vi.mock('../../src/presentation/components/settings-ui-helpers', () => ({ saveSettingsAndNotify_ACU: mocks.save }));
vi.mock('../../src/service/worldbook/pipeline', () => ({
  getLorebookEntriesByNames_ACU: mocks.getEntries, getWorldbookNames_ACU: vi.fn(),
}));
vi.mock('../../src/shared/utils', () => ({ logError_ACU: mocks.logError }));

import { _set_jQuery_API_ACU } from '../../src/shared/host-api';
import { _set_$popupInstance_ACU } from '../../src/presentation/state/ui-refs';
import { populatePlotWorldbookEntryList_ACU } from '../../src/presentation/components/worldbook-selector';

function createMiniJQuery_ACU() {
  const data = new WeakMap<HTMLElement, Record<string, unknown>>();
  class MiniJQ {
    constructor(readonly elements: HTMLElement[] = []) {}
    get length() { return this.elements.length; }
    find(selector: string) { return new MiniJQ(this.elements.flatMap(e => Array.from(e.querySelectorAll(selector)) as HTMLElement[])); }
    empty() { this.elements.forEach(e => { e.innerHTML = ''; }); return this; }
    html(value?: unknown) { if (value === undefined) return this.elements[0]?.innerHTML; this.elements.forEach(e => { e.innerHTML = String(value); }); return this; }
    text(value?: unknown) { if (value === undefined) return this.elements[0]?.textContent || ''; this.elements.forEach(e => { e.textContent = String(value); }); return this; }
    val() { return (this.elements[0] as HTMLInputElement | undefined)?.value; }
    data(key: string, value?: unknown): any { const e = this.elements[0]; if (!e) return value === undefined ? undefined : this; const values = data.get(e) || {}; if (value === undefined) return values[key] ?? e.getAttribute(`data-${key}`); values[key] = value; data.set(e, values); return this; }
    filter(callback: (this: HTMLElement) => boolean) { return new MiniJQ(this.elements.filter(e => callback.call(e))); }
    first() { return new MiniJQ(this.elements.slice(0, 1)); }
    toggle(show: boolean) { this.elements.forEach(e => { e.style.display = show ? '' : 'none'; }); return this; }
  }
  return ((input?: unknown) => input instanceof MiniJQ ? input : input instanceof HTMLElement ? new MiniJQ([input]) : typeof input === 'string' ? new MiniJQ(Array.from(document.querySelectorAll(input)) as HTMLElement[]) : new MiniJQ()) as any;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="popup-root"><div id="shujuku_v120-plot-worldbook-entry-list"></div></div>';
  const $ = createMiniJQuery_ACU();
  _set_jQuery_API_ACU($);
  _set_$popupInstance_ACU($(document.querySelector('#popup-root')));
  mocks.settings.plotSettings = { plotWorldbookConfig: { source: 'character', manualSelection: [], enabledEntries: {} } };
  mocks.getBinding.mockReset();
  mocks.getEntries.mockReset();
  mocks.logError.mockReset();
  mocks.save.mockReset();
});

describe('populatePlotWorldbookEntryList_ACU', () => {
  it('角色 binding resolver 失败时显示终态、不读取条目且不泄露异常内容', async () => {
    const sensitive = 'resolver-secret-stack-prompt';
    mocks.getBinding.mockRejectedValue(new Error(sensitive));

    await populatePlotWorldbookEntryList_ACU();

    const list = document.querySelector('#shujuku_v120-plot-worldbook-entry-list') as HTMLElement;
    expect(list.innerHTML).toBe('<em>加载条目失败。</em>');
    expect(mocks.getEntries).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith('[剧情推进] 读取角色绑定世界书失败:', {
      phase: 'plot_character_binding', error: { category: 'unknown' },
    });
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(sensitive);
  });

  it('条目读取失败时显示终态且不泄露异常内容', async () => {
    const sensitive = 'entries-secret-stack-prompt';
    mocks.getBinding.mockResolvedValue({ primary: '主书', additional: [], orderedNames: ['主书'], apiSource: 'getCharWorldbookNames' });
    mocks.getEntries.mockRejectedValue(new Error(sensitive));

    await populatePlotWorldbookEntryList_ACU();

    const list = document.querySelector('#shujuku_v120-plot-worldbook-entry-list') as HTMLElement;
    expect(mocks.getEntries).toHaveBeenCalledWith(['主书']);
    expect(list.innerHTML).toBe('<em>加载条目失败。</em>');
    expect(mocks.logError).toHaveBeenCalledWith('[剧情推进] 加载剧情世界书条目失败:', {
      phase: 'plot_worldbook_entries', error: { category: 'unknown' },
    });
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(sensitive);
  });

  it('按 binding orderedNames 顺序渲染分组，而非 entries map 的键顺序', async () => {
    mocks.getBinding.mockResolvedValue({ primary: '主书', additional: ['副书'], orderedNames: ['主书', '副书'], apiSource: 'getCharWorldbookNames' });
    mocks.getEntries.mockResolvedValue({
      副书: [{ uid: 202, comment: '副书条目', enabled: true }],
      主书: [{ uid: 101, comment: '主书条目', enabled: true }],
    });

    await populatePlotWorldbookEntryList_ACU();

    expect(mocks.getEntries).toHaveBeenCalledWith(['主书', '副书']);
    expect(Array.from(document.querySelectorAll('.qrf_worldbook_entry_header_text')).map(node => node.textContent?.trim())).toEqual(['主书', '副书']);
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

