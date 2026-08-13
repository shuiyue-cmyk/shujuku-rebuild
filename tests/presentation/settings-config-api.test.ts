import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUiSurface_ACU, resetUiSurfaceRegistryForTests_ACU } from '../../src/shared/ui-surface-registry';

const { mockGetPromptTemplates, mockReadControl, mockSetPromptTemplates, mockWriteControl, mockSaveSettings, mockSetUpdateNumberFields } = vi.hoisted(() => ({
  mockGetPromptTemplates: vi.fn(),
  mockReadControl: vi.fn(),
  mockSetPromptTemplates: vi.fn(),
  mockWriteControl: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockSetUpdateNumberFields: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn() }));
vi.mock('../../src/service/runtime/state-manager', () => ({
  settings_ACU: { plotSettings: { agentWorldbookControl: { contextSettings: { skillifyMaxEntries: 99 } } } },
  currentJsonTableData_ACU: {},
}));
vi.mock('../../src/service/template/chat-scope', () => ({ getSortedSheetKeys_ACU: vi.fn(() => ['sheetA']) }));
vi.mock('../../src/presentation/triggers/update-process', () => ({ handleManualUpdate_ACU: vi.fn() }));
vi.mock('../../src/presentation/triggers/settings-ui-sync', () => ({ deleteApiPreset_ACU: vi.fn(), loadApiPreset_ACU: vi.fn() }));
vi.mock('../../src/presentation/components/settings-ui-helpers', () => ({ saveSettingsAndNotify_ACU: mockSaveSettings }));
vi.mock('../../src/service/settings/settings-write-service', () => ({ setUpdateNumberFields_ACU: mockSetUpdateNumberFields }));
vi.mock('../../src/service/agent/agent-worldbook-config-meta', () => ({
  getAgentPromptTemplateDefaults_ACU: mockGetPromptTemplates,
  readAgentWorldbookControlFromWorldbooks_ACU: mockReadControl,
  setAgentPromptTemplateDefaults_ACU: mockSetPromptTemplates,
  writeAgentWorldbookControlToWorldbook_ACU: mockWriteControl,
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import { createSettingsConfigApi } from '../../src/presentation/bootstrap/api-groups/settings-config-api';

const context = {
  decisionRecentContextCharLimit: 6,
  decisionPreviousPlotCharLimit: 7,
  decisionWorldbookContentPreviewLimit: 8,
  decisionWorldbookCandidateLimit: 9,
  skillifyContentPreviewLimit: 10,
  skillifyMaxEntries: 11,
  plotWorldbookScanMessageLimit: 12,
  agentAiMaxRetries: 2,
  greenlightMinTkBudget: 100,
  greenlightMaxTkBudget: 200,
};
const decisionSegments = [{ role: 'system', content: 'decide', deletable: false }];
const skillifySegments = [{ role: 'user', content: 'skill', deletable: true }];
const control = { contextSettings: context, agentDecisionPromptSegments: decisionSegments, agentSkillifyPromptSegments: skillifySegments };

describe('createSettingsConfigApi Agent config source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUiSurfaceRegistryForTests_ACU();
    (settings_ACU as any).plotSettings = { agentWorldbookControl: { contextSettings: { skillifyMaxEntries: 99 } } };
    mockReadControl.mockResolvedValue({ control, source: 'worldbook', writableBookName: '主世界书' });
    mockGetPromptTemplates.mockReturnValue({
      agentDecisionPromptSegments: [{ role: 'system', content: 'global decision', deletable: false }],
      agentSkillifyPromptSegments: [{ role: 'user', content: 'global skillify', deletable: true }],
    });
    mockSetPromptTemplates.mockReturnValue(true);
    mockWriteControl.mockResolvedValue({ updated: true, control });
    mockSetUpdateNumberFields.mockReturnValue({ ok: true, code: 'ok', changed: true });
  });

  it('openSettings 与 openVisualizer 委派到已注册的 V2 surface', async () => {
    const openSettings = vi.fn(async () => true);
    const openVisualizer = vi.fn(async () => true);
    registerUiSurface_ACU({ openSettings, openVisualizer, refreshVisualizer: vi.fn(async () => undefined) });
    const api = createSettingsConfigApi({} as any);

    await expect(api.openSettings()).resolves.toBe(true);
    await expect(api.openVisualizer()).resolves.toBe(true);

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(openVisualizer).toHaveBeenCalledTimes(1);
  });

  it('V2 surface 未注册时公开 UI API 返回 false', async () => {
    const api = createSettingsConfigApi({} as any);

    await expect(api.openSettings()).resolves.toBe(false);
    await expect(api.openVisualizer()).resolves.toBe(false);
  });

  it('getAgentPromptConfig 从世界书状态条目读取，不创建或改写 legacy settings', async () => {
    const api = createSettingsConfigApi({} as any);

    const result = await api.getAgentPromptConfig();

    expect(result.contextSettings.skillifyMaxEntries).toBe(11);
    expect(result.agentDecisionPromptSegments).toEqual(decisionSegments);
    expect(result.agentSkillifyPromptSegments).toEqual(skillifySegments);
    expect(mockReadControl).toHaveBeenCalledTimes(1);
    expect((settings_ACU as any).plotSettings.agentWorldbookControl.contextSettings.skillifyMaxEntries).toBe(99);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });


  it('setAgentContextSettings 合并当前世界书 context 并只写世界书状态条目', async () => {
    const api = createSettingsConfigApi({} as any);

    const result = await api.setAgentContextSettings({ skillifyMaxEntries: 22, agentAiMaxRetries: 3 });

    expect(result).toBe(true);
    expect(mockReadControl).toHaveBeenCalledTimes(1);
    expect(mockWriteControl).toHaveBeenCalledWith({
      contextSettings: expect.objectContaining({
        skillifyMaxEntries: 22,
        agentAiMaxRetries: 3,
        decisionRecentContextCharLimit: 6,
      }),
      contextSettingsConfigured: true,
    });
    expect((settings_ACU as any).plotSettings.agentWorldbookControl.contextSettings.skillifyMaxEntries).toBe(99);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('setAgentContextSettings 拒绝非法 patch 且不写世界书或 legacy settings', async () => {
    const api = createSettingsConfigApi({} as any);

    const result = await api.setAgentContextSettings({ skillifyMaxEntries: Number.NaN });

    expect(result).toBe(false);
    expect(mockReadControl).toHaveBeenCalledTimes(1);
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect((settings_ACU as any).plotSettings.agentWorldbookControl.contextSettings.skillifyMaxEntries).toBe(99);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('setAgentContextSettings 在世界书写入失败时返回 false 且不保存 legacy settings', async () => {
    mockWriteControl.mockResolvedValue({ updated: false, reason: 'no_config_host_book', control });
    const api = createSettingsConfigApi({} as any);

    const result = await api.setAgentContextSettings({ skillifyMaxEntries: 22 });

    expect(result).toBe(false);
    expect(mockWriteControl).toHaveBeenCalledTimes(1);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('setAgentDecisionPromptSegments 写入世界书状态条目并保留 normalized segments', async () => {
    const api = createSettingsConfigApi({} as any);
    const segments = [{ role: 'ASSISTANT', content: 'next decision', deletable: true }];

    const result = await api.setAgentDecisionPromptSegments(segments);

    expect(result).toBe(true);
    expect(mockWriteControl).toHaveBeenCalledWith({
      agentDecisionPromptSegments: [{ role: 'assistant', content: 'next decision', deletable: true }],
    });
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('setAgentSkillifyPromptSegments 拒绝非数组且不写入世界书', async () => {
    const api = createSettingsConfigApi({} as any);

    const result = await api.setAgentSkillifyPromptSegments({ role: 'user' });

    expect(result).toBe(false);
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('resetAgentDecisionPromptSegments 和 resetAgentSkillifyPromptSegments 写默认片段到世界书状态条目', async () => {
    const api = createSettingsConfigApi({} as any);

    expect(await api.resetAgentDecisionPromptSegments()).toBe(true);
    expect(await api.resetAgentSkillifyPromptSegments()).toBe(true);

    expect(mockWriteControl).toHaveBeenNthCalledWith(1, {
      agentDecisionPromptSegments: expect.arrayContaining([expect.objectContaining({ role: expect.any(String), content: expect.any(String) })]),
    });
    expect(mockWriteControl).toHaveBeenNthCalledWith(2, {
      agentSkillifyPromptSegments: expect.arrayContaining([expect.objectContaining({ role: expect.any(String), content: expect.any(String) })]),
    });
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('全局模板 API 读取、保存和重置均不触碰当前世界书或 saveSettingsAndNotify', () => {
    const api = createSettingsConfigApi({} as any);
    const templates = {
      agentDecisionPromptSegments: [{ role: 'ASSISTANT', content: 'global decision', deletable: false }],
      agentSkillifyPromptSegments: [],
    };

    expect(api.getAgentPromptTemplates()).toEqual({
      agentDecisionPromptSegments: [{ role: 'system', content: 'global decision', deletable: false }],
      agentSkillifyPromptSegments: [{ role: 'user', content: 'global skillify', deletable: true }],
    });
    expect(api.setAgentPromptTemplates(templates)).toBe(true);
    expect(api.resetAgentPromptTemplates()).toBe(true);

    expect(mockSetPromptTemplates).toHaveBeenNthCalledWith(1, {
      agentDecisionPromptSegments: [{ role: 'assistant', content: 'global decision', deletable: false }],
      agentSkillifyPromptSegments: [],
    });
    expect(mockSetPromptTemplates).toHaveBeenNthCalledWith(2, expect.objectContaining({
      agentDecisionPromptSegments: expect.any(Array),
      agentSkillifyPromptSegments: expect.any(Array),
    }));
    expect(mockReadControl).not.toHaveBeenCalled();
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('全局模板 API 拒绝缺失提示词字段的输入且不调用 service', () => {
    const api = createSettingsConfigApi({} as any);

    expect(api.setAgentPromptTemplates({ agentDecisionPromptSegments: [] })).toBe(false);
    expect(mockSetPromptTemplates).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('getAgentContextSettings 在读取失败时返回默认 context', async () => {
    mockReadControl.mockRejectedValue(new Error('read failed'));
    const api = createSettingsConfigApi({} as any);

    const result = await api.getAgentContextSettings();

    expect(result.skillifyMaxEntries).not.toBe(99);
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('setUpdateConfigParams 将数值 patch 委托给 service 事务写入', () => {
    const api = createSettingsConfigApi({} as any);

    const result = api.setUpdateConfigParams({
      autoUpdateThreshold: 3.9,
      autoUpdateFrequency: 2.1,
      updateBatchSize: 4,
      autoUpdateTokenThreshold: 0.5,
    });

    expect(result).toBe(true);
    expect(mockSetUpdateNumberFields).toHaveBeenCalledWith({
      autoUpdateThreshold: 3,
      autoUpdateFrequency: 2,
      updateBatchSize: 4,
      autoUpdateTokenThreshold: 0,
    });
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('setUpdateConfigParams 在 service 写入失败时返回 false 且不保存 legacy settings', () => {
    mockSetUpdateNumberFields.mockReturnValue({ ok: false, code: 'invalid_input', changed: false, message: '字段 autoUpdateThreshold 数值无效。' });
    const api = createSettingsConfigApi({} as any);

    const result = api.setUpdateConfigParams({ autoUpdateThreshold: -1 });

    expect(result).toBe(false);
    expect(mockSetUpdateNumberFields).toHaveBeenCalledWith({});
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});
