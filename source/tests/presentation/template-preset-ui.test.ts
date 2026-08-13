// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  globalNames: [] as string[],
  globalPresetName: '',
  activePresetName: '',
  chatScopeState: null as any,
  chatEntries: [] as any[],
}));

vi.mock('../../src/shared/template-preset-utils', () => ({
  DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU: '__default__',
  getCurrentTemplatePresetName_ACU: () => mockState.globalPresetName,
  isDefaultTemplatePresetSelection_ACU: (value: unknown) => {
    const normalized = String(value ?? '').trim();
    return !normalized || normalized === '__default__';
  },
  normalizeTemplatePresetSelectionValue_ACU: (value: unknown) => {
    const normalized = String(value ?? '').trim();
    return !normalized || normalized === '__default__' ? '' : normalized;
  },
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: {},
}));

vi.mock('../../src/service/template/chat-scope', () => ({
  getCurrentChatTemplateScopeState_ACU: () => mockState.chatScopeState,
  listChatTemplatePresetEntries_ACU: () => mockState.chatEntries,
  migrateLegacyTemplateScopeForCurrentChat_ACU: () => null,
  normalizeTemplateScopeMode_ACU: (mode: unknown) => {
    const normalized = String(mode ?? '').trim();
    if (normalized === 'chat_override' || normalized === 'preset_link') return normalized;
    return 'inherit_global';
  },
}));

vi.mock('../../src/service/template/template-preset-service', () => ({
  getTemplatePresetDisplayName_ACU: (name: unknown) => String(name ?? '').trim() || '默认预设',
  getTemplatePreset_ACU: () => null,
  listTemplatePresetNames_ACU: () => mockState.globalNames,
  resolveActiveTemplatePresetName_ACU: () => mockState.activePresetName,
}));

import { _set_jQuery_API_ACU } from '../../src/shared/host-api';
import { _set_$popupInstance_ACU } from '../../src/presentation/state/ui-refs';
import { loadTemplatePresetSelect_ACU } from '../../src/presentation/components/template-preset-ui';

function createMiniJQuery_ACU() {
  class MiniJQ_ACU {
    elements: HTMLElement[];

    constructor(elements: HTMLElement[] = []) {
      this.elements = elements;
    }

    get length() {
      return this.elements.length;
    }

    find(selector: string) {
      return new MiniJQ_ACU(this.elements.flatMap((element) => Array.from(element.querySelectorAll(selector)) as HTMLElement[]));
    }

    empty() {
      this.elements.forEach((element) => {
        element.innerHTML = '';
      });
      return this;
    }

    append(child: any) {
      const childElements = child instanceof MiniJQ_ACU ? child.elements : [];
      this.elements.forEach((element) => {
        childElements.forEach((childElement) => {
          element.appendChild(childElement.cloneNode(true));
        });
      });
      return this;
    }

    val(value?: unknown) {
      if (typeof value === 'undefined') {
        const first = this.elements[0] as HTMLInputElement | HTMLSelectElement | HTMLOptionElement | undefined;
        return first?.value;
      }
      this.elements.forEach((element) => {
        (element as HTMLInputElement | HTMLSelectElement | HTMLOptionElement).value = String(value ?? '');
      });
      return this;
    }

    text(value?: unknown) {
      if (typeof value === 'undefined') {
        return this.elements[0]?.textContent || '';
      }
      this.elements.forEach((element) => {
        element.textContent = String(value ?? '');
      });
      return this;
    }

    toggle(show: boolean) {
      this.elements.forEach((element) => {
        element.style.display = show ? '' : 'none';
      });
      return this;
    }

    toArray() {
      return [...this.elements];
    }
  }

  const miniFactory = ((input: unknown) => {
    if (input instanceof MiniJQ_ACU) return input;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        const tagName = trimmed.replace(/[</>]/g, '').trim() || 'div';
        return new MiniJQ_ACU([document.createElement(tagName)]);
      }
      return new MiniJQ_ACU(Array.from(document.querySelectorAll(trimmed)) as HTMLElement[]);
    }
    if (input instanceof HTMLElement) {
      return new MiniJQ_ACU([input]);
    }
    if (input && typeof input === 'object' && 'length' in (input as any)) {
      return new MiniJQ_ACU(Array.from(input as ArrayLike<HTMLElement>));
    }
    return new MiniJQ_ACU([]);
  }) as any;

  return miniFactory;
}

describe('loadTemplatePresetSelect_ACU', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="popup-root">
        <select id="shujuku_v120-template-preset-select"></select>
        <select id="shujuku_v120-template-chat-preset-select"></select>
        <div id="shujuku_v120-template-global-scope-status"></div>
        <div id="shujuku_v120-template-chat-scope-status"></div>
        <div id="shujuku_v120-template-chat-origin-status"></div>
        <button id="shujuku_v120-template-preset-delete"></button>
      </div>
    `;

    const $ = createMiniJQuery_ACU();
    _set_jQuery_API_ACU($ as any);
    _set_$popupInstance_ACU($(document.querySelector('#popup-root')) as any);

    mockState.globalNames = [];
    mockState.globalPresetName = '';
    mockState.activePresetName = '';
    mockState.chatScopeState = null;
    mockState.chatEntries = [];
  });

  it('全局预设名包含 selector 特殊字符时不抛错', () => {
    mockState.globalNames = ['全局预设[1]'];
    mockState.globalPresetName = '全局预设[1]';

    expect(() => loadTemplatePresetSelect_ACU()).not.toThrow();
    expect((document.querySelector('#shujuku_v120-template-preset-select') as HTMLSelectElement).value).toBe('全局预设[1]');
  });

  it('聊天预设名包含 selector 特殊字符时不抛错', () => {
    mockState.activePresetName = '聊天快照[alpha]';
    mockState.chatScopeState = {
      mode: 'preset_link',
      presetName: '聊天快照[alpha]',
      updatedAt: 0,
      source: 'ui',
    };
    mockState.chatEntries = [{ presetName: '聊天快照[alpha]', updatedAt: 0 }];

    expect(() => loadTemplatePresetSelect_ACU()).not.toThrow();
    expect((document.querySelector('#shujuku_v120-template-chat-preset-select') as HTMLSelectElement).value).toBe('聊天快照[alpha]');
  });
});
