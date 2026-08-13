/**
 * tests/service/plot/plot-state.test.ts
 * 剧情推进运行时状态 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_PLOT_SETTINGS_ACU: {
    plotPromptGroups: [{ name: '默认组', prompts: [] }],
    loopSettings: { loopTotalDuration: 5, loopDelay: 5, retryDelay: 3, maxRetries: 3 },
  },
  DEFAULT_PLOT_PROMPT_GROUP_ACU: [
    { name: '默认提示词组', prompts: [{ role: 'system', content: '默认内容' }] },
  ],
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: {
    plotSettings: {
      plotPromptGroups: null,
    },
  },
}));

import {
  buildDefaultPlotPromptGroup_ACU,
  ensurePlotPromptGroup_ACU,
  _set_activePlotEditorSettings_ACU,
  _set_currentEditablePlotPresetState_ACU,
  _set_currentPlotTaskEditorId_ACU,
  activePlotEditorSettings_ACU,
  currentEditablePlotPresetState_ACU,
  currentPlotTaskEditorId_ACU,
} from '../../../src/service/plot/plot-state';

describe('buildDefaultPlotPromptGroup_ACU', () => {
  it('返回数组结构', () => {
    const group = buildDefaultPlotPromptGroup_ACU();
    expect(Array.isArray(group)).toBe(true);
    expect(group.length).toBeGreaterThan(0);
  });
  it('包含 mainSlot A 和 B', () => {
    const group = buildDefaultPlotPromptGroup_ACU();
    const hasA = group.some((s: any) => s.mainSlot === 'A');
    const hasB = group.some((s: any) => s.mainSlot === 'B');
    expect(hasA).toBe(true);
    expect(hasB).toBe(true);
  });
  it('可以传入 mainAContent', () => {
    const group = buildDefaultPlotPromptGroup_ACU({ mainAContent: '自定义A' });
    const slotA = group.find((s: any) => s.mainSlot === 'A');
    expect(slotA?.content).toBe('自定义A');
  });
  it('可以传入 mainBContent', () => {
    const group = buildDefaultPlotPromptGroup_ACU({ mainBContent: '自定义B' });
    const slotB = group.find((s: any) => s.mainSlot === 'B');
    expect(slotB?.content).toBe('自定义B');
  });
});

describe('ensurePlotPromptGroup_ACU', () => {
  it('promptGroup 为 null 时初始化', () => {
    const plotSettings: any = { promptGroup: null };
    ensurePlotPromptGroup_ACU(plotSettings);
    expect(Array.isArray(plotSettings.promptGroup)).toBe(true);
    expect(plotSettings.promptGroup.length).toBeGreaterThan(0);
  });
  it('promptGroup 为空数组时添加默认组', () => {
    const plotSettings: any = { promptGroup: [] };
    ensurePlotPromptGroup_ACU(plotSettings);
    expect(plotSettings.promptGroup.length).toBeGreaterThan(0);
  });
  it('promptGroup 已有数据时不修改', () => {
    const existing = [{ role: 'SYSTEM', content: 'test', mainSlot: 'A', isMain: true }];
    const plotSettings: any = { promptGroup: existing };
    ensurePlotPromptGroup_ACU(plotSettings);
    expect(plotSettings.promptGroup).toBe(existing);
  });
  it('null plotSettings 不报错', () => {
    expect(() => ensurePlotPromptGroup_ACU(null)).not.toThrow();
  });
});

// ═══ _set_activePlotEditorSettings_ACU ═══
describe('_set_activePlotEditorSettings_ACU', () => {
  it('设置后 activePlotEditorSettings 更新', () => {
    const newSettings = { rateMain: 0.5 };
    _set_activePlotEditorSettings_ACU(newSettings);
    expect(activePlotEditorSettings_ACU).toBe(newSettings);
  });
  it('设置为 null', () => {
    _set_activePlotEditorSettings_ACU(null);
    expect(activePlotEditorSettings_ACU).toBeNull();
  });
});

// ═══ _set_currentEditablePlotPresetState_ACU ═══
describe('_set_currentEditablePlotPresetState_ACU', () => {
  it('设置预设编辑状态', () => {
    const state = { initialized: true, presetName: '预设A', scope: 'chat', source: 'ui' };
    _set_currentEditablePlotPresetState_ACU(state);
    expect(currentEditablePlotPresetState_ACU).toBe(state);
  });
});

// ═══ _set_currentPlotTaskEditorId_ACU ═══
describe('_set_currentPlotTaskEditorId_ACU', () => {
  it('设置任务编辑器 ID', () => {
    _set_currentPlotTaskEditorId_ACU('task1');
    expect(currentPlotTaskEditorId_ACU).toBe('task1');
  });
  it('设置为空字符串', () => {
    _set_currentPlotTaskEditorId_ACU('');
    expect(currentPlotTaskEditorId_ACU).toBe('');
  });
});
