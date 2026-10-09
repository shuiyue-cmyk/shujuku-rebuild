/**
 * tests/service/plot/plot-logic.test.ts
 * 剧情推进纯逻辑函数 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings } = vi.hoisted(() => {
  const mockSettings: any = {
    plotSettings: {
      promptPresets: [],
      lastUsedPresetName: '',
      globalRevision: 0,
      loopSettings: { quickReplyContent: [], currentPromptIndex: 0, maxRetries: 3 },
      prompts: [],
      plotTasks: [],
      plotPresetBindings: {},
    },
    plotPresetBindings: {},
  };
  return { mockSettings };
});

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_PLOT_SETTINGS_ACU: {
    contextExtractRules: [],
    contextExcludeRules: [{ start: '<disclaimer>', end: '</disclaimer>' }],
    contextExtractTags: '',
    contextExcludeTags: '',
    loopSettings: { maxRetries: 3, quickReplyContent: [] },
    prompts: [
      { id: 'mainPrompt', content: '默认主提示词' },
      { id: 'systemPrompt', content: '默认系统提示词' },
    ],
  },
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentChatFileIdentifier_ACU: 'test-chat',
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  cleanChatName_ACU: vi.fn((name: string) => {
    if (!name || typeof name !== 'string') return 'unknown_chat_source';
    return name.replace(/\.(jsonl|json)$/, '').replace(/^.*[/\\]/, '') || 'unknown_chat_source';
  }),
  normalizeExcludeRules_ACU: vi.fn((rules: any) => Array.isArray(rules) ? rules : []),
  normalizeExtractRules_ACU: vi.fn((rules: any) => Array.isArray(rules) ? rules : []),
  normalizeNonNegativeInteger_ACU: vi.fn((v: any, fb = 0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  }),
  normalizePositiveInteger_ACU: vi.fn((v: any, fb = 1) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fb;
  }),
}));

const { mockPlotState } = vi.hoisted(() => {
  const mockPlotState: any = {
    activePlotEditorSettings_ACU: null,
    currentEditablePlotPresetState_ACU: { initialized: false, presetName: '', scope: 'resolved', source: '' },
  };
  return { mockPlotState };
});

vi.mock('../../../src/service/plot/plot-state', () => ({
  get activePlotEditorSettings_ACU() { return mockPlotState.activePlotEditorSettings_ACU; },
  buildDefaultPlotPromptGroup_ACU: vi.fn(({ mainAContent = '', mainBContent = '' } = {}) => [
    { role: 'SYSTEM', content: mainAContent, mainSlot: 'A', isMain: true, deletable: false },
    { role: 'USER', content: mainBContent, mainSlot: 'B', isMain2: true, deletable: false },
  ]),
  get currentEditablePlotPresetState_ACU() { return mockPlotState.currentEditablePlotPresetState_ACU; },
  ensurePlotPromptGroup_ACU: vi.fn(),
  _set_currentEditablePlotPresetState_ACU: vi.fn((v: any) => { mockPlotState.currentEditablePlotPresetState_ACU = v; }),
  _set_activePlotEditorSettings_ACU: vi.fn((v: any) => { mockPlotState.activePlotEditorSettings_ACU = v; }),
  _set_currentPlotTaskEditorId_ACU: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
  saveChatToHost_ACU: vi.fn(),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: vi.fn(),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatPlotScopeStateFromSettings_ACU: vi.fn(() => null),
  clearCurrentChatPlotScopeState_ACU: vi.fn(),
  getCurrentChatPlotScopeState_ACU: vi.fn(() => null),
  sanitizePlotSettingsSnapshotForChat_ACU: vi.fn((s: any) => s),
  setCurrentChatPlotScopeState_ACU: vi.fn(),
}));

vi.mock('../../../src/service/optimization/content-optimization', () => ({
  getLastOptimizationBase_ACU: vi.fn(() => null),
  setLastOptimizationBase_ACU: vi.fn(),
}));

import {
  ensureLoopPromptsArray_ACU,
  ensureTagRulesCompat_ACU,
  normalizePlotTask_ACU,
  normalizePlotTasks_ACU,
  normalizePlotPresetSelectionValue_ACU,
  resolveActivePlotPresetName_ACU,
  ensurePlotPromptsArray_ACU,
  normalizePlotPresetExcludeRules_ACU,
  stripPlotPresetWorldbookEntrySelectionForExport_ACU,
  getLastOptimizedMessageIndex_ACU,
  getActivePlotEditorSettings_ACU,
  setActivePlotEditorSettings_ACU,
  applyPlotPresetToSettings_ACU,
  resetPlotSettingsToDefault_ACU,
  replaceCurrentPlotSettingsWithSnapshot_ACU,
  persistPlotPresetSelectionState_ACU,
  switchCurrentChatPlotPreset_ACU,
  clearCurrentChatPlotPresetOverride_ACU,
} from '../../../src/service/plot/plot-logic';

import { saveSettings_ACU } from '../../../src/service/settings/settings-service';
import { saveChatToHost_ACU } from '../../../src/data/gateways/chat-gateway';
import { getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU, buildChatPlotScopeStateFromSettings_ACU, setCurrentChatPlotScopeState_ACU, clearCurrentChatPlotScopeState_ACU } from '../../../src/service/template/chat-scope';
import { _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU } from '../../../src/service/plot/plot-state';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.plotSettings = {
    promptPresets: [],
    lastUsedPresetName: '',
    globalRevision: 0,
    loopSettings: { quickReplyContent: [], currentPromptIndex: 0, maxRetries: 3 },
    prompts: [],
    plotTasks: [],
  };
  mockSettings.plotPresetBindings = {};
});

// ═══ ensureLoopPromptsArray_ACU ═══
describe('ensureLoopPromptsArray_ACU', () => {
  it('字符串迁移为数组', () => {
    const ps: any = { loopSettings: { quickReplyContent: '提示词' } };
    ensureLoopPromptsArray_ACU(ps);
    expect(ps.loopSettings.quickReplyContent).toEqual(['提示词']);
    expect(ps.loopSettings.currentPromptIndex).toBe(0);
  });
  it('空字符串迁移为空数组', () => {
    const ps: any = { loopSettings: { quickReplyContent: '  ' } };
    ensureLoopPromptsArray_ACU(ps);
    expect(ps.loopSettings.quickReplyContent).toEqual([]);
  });
  it('已是数组不变', () => {
    const ps: any = { loopSettings: { quickReplyContent: ['a', 'b'], currentPromptIndex: 1 } };
    ensureLoopPromptsArray_ACU(ps);
    expect(ps.loopSettings.quickReplyContent).toEqual(['a', 'b']);
  });
});

// ═══ normalizePlotTask_ACU ═══
describe('normalizePlotTask_ACU', () => {
  it('id 中的特殊字符被替换', () => {
    const task = normalizePlotTask_ACU({ id: 'task 1!@#' });
    expect(task.id).not.toContain(' ');
    expect(task.id).not.toContain('!');
  });
});

// ═══ normalizePlotTasks_ACU ═══
describe('normalizePlotTasks_ACU', () => {
  it('按 order 排序', () => {
    const source = { plotTasks: [{ id: 'a', order: 2 }, { id: 'b', order: 0 }] };
    const tasks = normalizePlotTasks_ACU(source);
    expect(tasks[0].order).toBeLessThanOrEqual(tasks[1].order);
  });
});

// ═══ normalizePlotPresetSelectionValue_ACU ═══
describe('normalizePlotPresetSelectionValue_ACU', () => {
  it('正常预设名原样返回', () => {
    expect(normalizePlotPresetSelectionValue_ACU('预设A')).toBe('预设A');
  });
});

// ═══ ensurePlotPromptsArray_ACU ═══
describe('ensurePlotPromptsArray_ACU', () => {
  it('对象格式迁移为数组', () => {
    const ps: any = { prompts: { mainPrompt: '主', systemPrompt: '系统' } };
    ensurePlotPromptsArray_ACU(ps);
    expect(Array.isArray(ps.prompts)).toBe(true);
    expect(ps.prompts.find((p: any) => p.id === 'mainPrompt')?.content).toBe('主');
  });
});

// ═══ normalizePlotPresetExcludeRules_ACU ═══
describe('normalizePlotPresetExcludeRules_ACU', () => {
  it('删除旧标签字段', () => {
    const preset = { name: 'A', contextExtractTags: 'tag1', contextExcludeTags: 'tag2' };
    const result = normalizePlotPresetExcludeRules_ACU(preset);
    expect(result.contextExtractTags).toBeUndefined();
    expect(result.contextExcludeTags).toBeUndefined();
  });
});

// ═══ stripPlotPresetWorldbookEntrySelectionForExport_ACU ═══
describe('stripPlotPresetWorldbookEntrySelectionForExport_ACU', () => {
  it('移除世界书条目选择', () => {
    const preset = {
      name: '预设A',
      plotWorldbookConfig: { enabledEntries: ['entry1'], otherField: true },
    };
    const result = stripPlotPresetWorldbookEntrySelectionForExport_ACU(preset);
    expect(result.plotWorldbookConfig.enabledEntries).toBeUndefined();
    expect(result.plotWorldbookConfig.otherField).toBe(true);
  });
});

// ═══ getLastOptimizedMessageIndex_ACU ═══
describe('getLastOptimizedMessageIndex_ACU', () => {

  it('R8-09：缓存记录的 messageId 已不在聊天里时不按楼号回退到别的楼层', async () => {
    const chatService = await import('../../../src/data/gateways/chat-gateway');
    const cache = await import('../../../src/service/optimization/content-optimization');
    vi.mocked(chatService.getChatArray_ACU).mockReturnValueOnce([
      { is_user: false, mes: '楼0', message_id: 'a' },
      { is_user: false, mes: '别的楼', message_id: 'c' },
    ] as any);
    vi.mocked(cache.getLastOptimizationBase_ACU).mockReturnValueOnce({ messageIndex: 1, messageId: 'b-deleted' } as any);
    expect(getLastOptimizedMessageIndex_ACU()).toBe(-1);
  });
});

// ═══ ensureTagRulesCompat_ACU ═══
describe('ensureTagRulesCompat_ACU', () => {
  it('R8-06：用户清空的排除规则（空数组）保持为空；字段缺失才补默认规则', () => {
    const cleared: any = { plotSettings: { contextExcludeRules: [], contextExcludeTags: '' } };
    ensureTagRulesCompat_ACU(cleared);
    expect(cleared.plotSettings.contextExcludeRules).toEqual([]);
    const missing: any = { plotSettings: { contextExcludeTags: '' } };
    ensureTagRulesCompat_ACU(missing);
    expect(missing.plotSettings.contextExcludeRules).toEqual([{ start: '<disclaimer>', end: '</disclaimer>' }]);
  });
});

// ═══ resolveActivePlotPresetName_ACU ═══
describe('resolveActivePlotPresetName_ACU', () => {
  it('fallbackToGlobal=false 时不回退到全局', () => {
    mockSettings.plotSettings.lastUsedPresetName = '全局预设';
    expect(resolveActivePlotPresetName_ACU({ fallbackToGlobal: false })).toBe('');
  });
});

// ═══ getActivePlotEditorSettings_ACU ═══
describe('getActivePlotEditorSettings_ACU', () => {
  it('activePlotEditorSettings 为 null 时回退到 settings.plotSettings', () => {
    const result = getActivePlotEditorSettings_ACU();
    expect(result).toBe(mockSettings.plotSettings);
  });
});

// ═══ setActivePlotEditorSettings_ACU ═══
describe('setActivePlotEditorSettings_ACU', () => {
  it('设置有效对象时调用兼容性处理', () => {
    const ps: any = { prompts: [], loopSettings: { quickReplyContent: [] } };
    setActivePlotEditorSettings_ACU(ps);
    expect(_set_activePlotEditorSettings_ACU).toHaveBeenCalledWith(ps);
  });
});

// ═══ applyPlotPresetToSettings_ACU ═══
describe('applyPlotPresetToSettings_ACU', () => {
  it('预设的 loopSettings 合并到 plotSettings', () => {
    const plotSettings: any = { prompts: [], loopSettings: { maxRetries: 3 } };
    const preset = { name: 'A', loopSettings: { maxRetries: 5 } };
    applyPlotPresetToSettings_ACU(plotSettings, preset);
    expect(plotSettings.loopSettings.maxRetries).toBe(5);
  });
});

// ═══ resetPlotSettingsToDefault_ACU ═══
describe('resetPlotSettingsToDefault_ACU', () => {
  it('重置后保留 promptPresets 和 lastUsedPresetName', () => {
    const plotSettings: any = {
      prompts: [],
      promptPresets: [{ name: '保留预设' }],
      lastUsedPresetName: '保留名称',
      globalRevision: 5,
      rateMain: 0.5,
    };
    const result = resetPlotSettingsToDefault_ACU(plotSettings);
    expect(result).not.toBeNull();
    expect(result!.promptPresets).toEqual([{ name: '保留预设' }]);
    expect(result!.lastUsedPresetName).toBe('保留名称');
    expect(result!.globalRevision).toBe(5);
  });
  it('重置后保留剧情世界书选择（以角色卡为单位，不属于预设）', () => {
    const plotSettings: any = {
      prompts: [],
      plotWorldbookConfig: { source: 'manual', manualSelection: ['手动书'], enabledEntries: { 手动书: [1] } },
    };
    const result = resetPlotSettingsToDefault_ACU(plotSettings);
    expect(result!.plotWorldbookConfig).toEqual({ source: 'manual', manualSelection: ['手动书'], enabledEntries: { 手动书: [1] } });
  });
});

// ═══ replaceCurrentPlotSettingsWithSnapshot_ACU ═══
describe('replaceCurrentPlotSettingsWithSnapshot_ACU', () => {
  it('用快照替换当前设置并保留 promptPresets', () => {
    vi.mocked(sanitizePlotSettingsSnapshotForChat_ACU).mockReturnValueOnce({ rateMain: 0.9 } as any);
    const plotSettings: any = {
      prompts: [],
      promptPresets: [{ name: '保留' }],
      lastUsedPresetName: '保留名',
      globalRevision: 3,
    };
    const result = replaceCurrentPlotSettingsWithSnapshot_ACU(plotSettings, { rateMain: 0.9 });
    expect(result).not.toBeNull();
    expect(result!.promptPresets).toEqual([{ name: '保留' }]);
    expect(result!.lastUsedPresetName).toBe('保留名');
    expect(result!.globalRevision).toBe(3);
  });
  it('快照中的旧剧情世界书选择不覆盖当前角色卡的选择', () => {
    vi.mocked(sanitizePlotSettingsSnapshotForChat_ACU).mockReturnValueOnce({
      rateMain: 0.9,
      plotWorldbookConfig: { source: 'character', manualSelection: [] },
    } as any);
    const plotSettings: any = {
      prompts: [],
      plotWorldbookConfig: { source: 'manual', manualSelection: ['当前卡的书'], enabledEntries: {} },
    };
    const result = replaceCurrentPlotSettingsWithSnapshot_ACU(plotSettings, { rateMain: 0.9 });
    expect(result!.rateMain).toBe(0.9);
    expect(result!.plotWorldbookConfig).toEqual({ source: 'manual', manualSelection: ['当前卡的书'], enabledEntries: {} });
  });
});

// ═══ persistPlotPresetSelectionState_ACU ═══
describe('persistPlotPresetSelectionState_ACU', () => {
  it('updateGlobal=true 时更新全局 lastUsedPresetName', () => {
    persistPlotPresetSelectionState_ACU('新预设', { updateGlobal: true });
    expect(mockSettings.plotSettings.lastUsedPresetName).toBe('新预设');
  });
  it('persistChatScope 时写入当前聊天预设绑定', () => {
    vi.mocked(buildChatPlotScopeStateFromSettings_ACU).mockReturnValueOnce({ presetName: 'A' } as any);
    persistPlotPresetSelectionState_ACU('预设A', { updateGlobal: false, persistChatScope: true });
    expect(mockSettings.plotPresetBindings?.['test-chat']).toMatchObject({
      presetName: '预设A',
      source: 'ui',
      isExplicit: true,
    });
    expect(setCurrentChatPlotScopeState_ACU).not.toHaveBeenCalled();
  });
});

// ═══ switchCurrentChatPlotPreset_ACU ═══
describe('switchCurrentChatPlotPreset_ACU', () => {
  it('切换到默认预设时清除绑定并重置', () => {
    mockSettings.plotSettings.promptPresets = [];
    mockSettings.plotSettings.lastUsedPresetName = '';
    const result = switchCurrentChatPlotPreset_ACU('');
    expect(result).toBeTruthy();
    if (result && typeof result === 'object') {
      expect(result.isDefault).toBe(true);
      expect(result.followsGlobal).toBe(true);
    }
  });
  it('有旧 chatScope 时先清除', () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU).mockReturnValueOnce({ presetName: '旧' } as any);
    mockSettings.plotSettings.promptPresets = [{ name: '预设A', contextExtractRules: [], contextExcludeRules: [] }];
    mockSettings.plotSettings.prompts = [];
    mockSettings.plotSettings.loopSettings = { quickReplyContent: [], maxRetries: 3 };
    switchCurrentChatPlotPreset_ACU('预设A');
    expect(clearCurrentChatPlotScopeState_ACU).toHaveBeenCalled();
  });
});

// ═══ clearCurrentChatPlotPresetOverride_ACU ═══
describe('clearCurrentChatPlotPresetOverride_ACU', () => {
  it('清理当前聊天剧情快照和绑定，并切回跟随全局', async () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any);
    mockSettings.plotSettings.promptPresets = [{ name: '全局预设', contextExtractRules: [], contextExcludeRules: [] }];
    mockSettings.plotSettings.lastUsedPresetName = '全局预设';
    mockSettings.plotSettings.prompts = [];
    mockSettings.plotSettings.loopSettings = { quickReplyContent: [], maxRetries: 3 };
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: '聊天预设', source: 'ui', isExplicit: true } };

    const result = await clearCurrentChatPlotPresetOverride_ACU({ source: 'test_reset' });

    expect(result.changed).toBe(true);
    expect(result.clearedChatScope).toBe(true);
    expect(result.clearedBinding).toBe(true);
    expect(result.activePresetName).toBe('全局预设');
    expect(result.followsGlobal).toBe(true);
    expect(clearCurrentChatPlotScopeState_ACU).toHaveBeenCalled();
    expect(mockSettings.plotPresetBindings['test-chat']).toBeUndefined();
    expect(mockSettings.plotSettings.promptPresets.map((preset: any) => preset.name)).toContain('全局预设');
    expect(saveSettings_ACU).toHaveBeenCalled();
    expect(saveChatToHost_ACU).toHaveBeenCalled();
  });

  it('saveSettings=false 时不立即保存设置，但仍可保存聊天快照清理', async () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any);
    mockSettings.plotSettings.promptPresets = [];
    mockSettings.plotSettings.lastUsedPresetName = '';
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: '聊天预设', source: 'ui', isExplicit: true } };

    await clearCurrentChatPlotPresetOverride_ACU({
      source: 'test_reset',
      saveSettings: false,
      saveChat: true,
    });

    expect(saveSettings_ACU).not.toHaveBeenCalled();
    expect(saveChatToHost_ACU).toHaveBeenCalled();
  });

  it('没有 plotSettings 时返回未变更结果', async () => {
    mockSettings.plotSettings = null;

    const result = await clearCurrentChatPlotPresetOverride_ACU();

    expect(result.changed).toBe(false);
    expect(result.followsGlobal).toBe(false);
  });
});
