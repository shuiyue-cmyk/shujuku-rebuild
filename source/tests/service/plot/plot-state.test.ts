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
  ensurePlotPromptGroup_ACU,
  _set_activePlotEditorSettings_ACU,
  _set_currentEditablePlotPresetState_ACU,
  _set_currentPlotTaskEditorId_ACU,
  activePlotEditorSettings_ACU,
} from '../../../src/service/plot/plot-state';

describe('ensurePlotPromptGroup_ACU', () => {
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
});

// ═══ _set_activePlotEditorSettings_ACU ═══
describe('_set_activePlotEditorSettings_ACU', () => {
  it('设置后 activePlotEditorSettings 更新', () => {
    const newSettings = { rateMain: 0.5 };
    _set_activePlotEditorSettings_ACU(newSettings);
    expect(activePlotEditorSettings_ACU).toBe(newSettings);
  });
});
