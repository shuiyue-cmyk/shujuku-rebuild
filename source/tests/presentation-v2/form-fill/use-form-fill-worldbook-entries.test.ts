/**
 * useFormFillWorldbookEntries 单元测试
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeEntry(uid: number, comment: string, enabled = true, type = 'selective') {
  return { uid, comment, name: comment, enabled, type };
}

function createWorldbookConfig() {
  return {
    source: 'character',
    manualSelection: [],
    enabledEntries: {},
  } as any;
}

let worldbookConfig: ReturnType<typeof createWorldbookConfig>;
const mockSaveSettings = vi.fn();
const mockGetEntries = vi.fn();
const mockGetAgentSnapshot = vi.fn(() => ({ active: false, selectionSignature: '', createdAt: 0, books: {} }));
const mockRefreshAgentSnapshot = vi.fn();

async function getComposable(presetConfig?: ReturnType<typeof createWorldbookConfig>) {
  vi.resetModules();
  worldbookConfig = presetConfig || createWorldbookConfig();

  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentWorldbookConfig_ACU: () => worldbookConfig,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: mockSaveSettings,
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    getLorebookEntriesByNames_ACU: mockGetEntries,
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-takeover', () => ({
    getPlotAgentWorldbookSnapshot_ACU: mockGetAgentSnapshot,
    refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: mockRefreshAgentSnapshot,
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-skill-meta', () => ({
    parseWorldbookSkillMetaFromComment_ACU: (comment: unknown) => String(comment || '').includes('ACU_SKILL_META_START')
      ? { description: '已 Skill 化', triggerWhen: '测试触发', tk: 0, updatedBy: 'manual', updatedAt: 1 }
      : null,
    stripWorldbookSkillMetaBlock_ACU: (comment: unknown) => String(comment || '').replace(/\n?<!--\s*ACU_SKILL_META_START\s*\n[\s\S]*?\nACU_SKILL_META_END\s*-->\n?/g, '').trim(),
  }));

  const mod = await import('../../../src/presentation-v2/composables/useFormFillWorldbookEntries');
  return mod.useFormFillWorldbookEntries();
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockSaveSettings.mockClear();
  mockGetEntries.mockClear();
  mockGetAgentSnapshot.mockReturnValue({ active: false, selectionSignature: '', createdAt: 0, books: {} });
  mockRefreshAgentSnapshot.mockReset();
  mockRefreshAgentSnapshot.mockImplementation(async () => mockGetAgentSnapshot());
});

describe('useFormFillWorldbookEntries', () => {
  it('首次加载默认全不选但分组保持折叠', async () => {
    mockGetEntries.mockResolvedValue({
      'CharBook': [makeEntry(1, '人物'), makeEntry(2, '地点')],
    });

    const c = await getComposable();
    await c.loadEntries(['CharBook']);

    expect(c.groups.value).toHaveLength(1);
    expect(c.groups.value[0].expanded).toBe(false);
    expect(c.groups.value[0].entries.every(entry => entry.checked)).toBe(false);
    expect(worldbookConfig.enabledEntries['CharBook']).toEqual([]);
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('显示并标记 constant 条目，首次加载默认全不选', async () => {
    mockGetEntries.mockResolvedValue({
      'CharBook': [
        makeEntry(1, '人物'),
        makeEntry(2, '常驻设定', true, ' CONSTANT '),
        makeEntry(3, '关闭常驻', false, 'constant'),
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['CharBook']);

    expect(c.groups.value[0].entries.map(entry => ({
      uid: entry.uid,
      checked: entry.checked,
      disabled: entry.disabled,
      isConstant: entry.isConstant,
    }))).toEqual([
      { uid: 1, checked: false, disabled: false, isConstant: false },
      { uid: 2, checked: false, disabled: false, isConstant: true },
      { uid: 3, checked: false, disabled: true, isConstant: true },
    ]);
    expect(worldbookConfig.enabledEntries.CharBook).toEqual([]);
  });

  it('已有空选择时按接管前状态展示受控条目，但不重新勾选用户取消的条目', async () => {
    worldbookConfig = createWorldbookConfig();
    worldbookConfig.enabledEntries = { CharBook: [] };
    mockGetAgentSnapshot.mockReturnValue({
      active: true,
      selectionSignature: 'test-selection',
      createdAt: 1,
      books: {
        CharBook: [
          { uid: 1, previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' },
          { uid: 2, previousEnabled: false, previousKeys: ['关闭关键词'], previousType: 'constant' },
        ],
      },
    });
    mockGetEntries.mockResolvedValue({
      CharBook: [
        { uid: 1, comment: '受控条目', name: '受控条目', enabled: false, type: 'selective', keys: [] },
        { uid: 2, comment: '原本关闭的受控条目', name: '原本关闭的受控条目', enabled: false, type: 'selective', keys: [] },
        makeEntry(3, 'TavernDB-ACU-应隐藏'),
        makeEntry(4, '外部导入-TavernDB-ACU-应显示'),
        makeEntry(5, 'ACU-[scope]-外部导入-TavernDB-ACU-应显示'),
        makeEntry(6, '普通规则条目'),
      ],
    });

    const c = await getComposable(worldbookConfig);
    await c.loadEntries(['CharBook']);

    expect(c.groups.value[0].entries.map(entry => ({
      uid: entry.uid,
      disabled: entry.disabled,
      isConstant: entry.isConstant,
      agentTakeoverState: entry.agentTakeoverState,
      checked: entry.checked,
    }))).toEqual([
      { uid: 1, disabled: false, isConstant: false, agentTakeoverState: 'taken_over', checked: false },
      { uid: 2, disabled: true, isConstant: true, agentTakeoverState: 'taken_over', checked: false },
      { uid: 4, disabled: false, isConstant: false, agentTakeoverState: 'native', checked: false },
      { uid: 5, disabled: false, isConstant: false, agentTakeoverState: 'native', checked: false },
    ]);
    expect(worldbookConfig.enabledEntries.CharBook).toEqual([]);
    c.selectAll();
    expect(worldbookConfig.enabledEntries.CharBook).toEqual([1, 4, 5]);
  });

  it('分类前刷新持久 snapshot，pending 条目不视为已接管', async () => {
    mockGetAgentSnapshot.mockReturnValue({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    mockRefreshAgentSnapshot.mockResolvedValue({
      active: true,
      selectionSignature: 'test-selection',
      createdAt: 1,
      books: {
        CharBook: [{ uid: 7, takeoverStatus: 'pending', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      },
    });
    mockGetEntries.mockResolvedValue({
      CharBook: [{ uid: 7, comment: '尚未完成接管', name: '尚未完成接管', enabled: false, type: 'selective', keys: [] }],
    });

    const c = await getComposable();
    await c.loadEntries(['CharBook']);

    expect(mockRefreshAgentSnapshot).toHaveBeenCalledTimes(1);
    expect(mockRefreshAgentSnapshot.mock.invocationCallOrder[0]).toBeLessThan(mockGetEntries.mock.invocationCallOrder[0]);
    expect(c.groups.value[0].entries[0]).toMatchObject({
      agentTakeoverState: 'initial_disabled',
      disabled: true,
    });
  });

  it('分类使用 refresh 返回的 applied snapshot，不读取陈旧 getter cache', async () => {
    mockGetAgentSnapshot.mockReturnValue({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    mockRefreshAgentSnapshot.mockResolvedValue({
      active: true,
      selectionSignature: 'fresh-selection',
      createdAt: 2,
      books: {
        CharBook: [{ uid: 8, takeoverStatus: 'applied', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      },
    });
    mockGetEntries.mockResolvedValue({
      CharBook: [{ uid: 8, comment: '已接管条目', name: '已接管条目', enabled: false, type: 'constant', keys: [] }],
    });

    const c = await getComposable();
    await c.loadEntries(['CharBook']);

    expect(mockGetAgentSnapshot).not.toHaveBeenCalled();
    expect(c.groups.value[0].entries[0]).toMatchObject({
      agentTakeoverState: 'taken_over',
      disabled: false,
      isConstant: false,
      checked: false,
    });
  });

  it('snapshot 刷新失败时中止加载，避免以陈旧 cache 分类', async () => {
    mockRefreshAgentSnapshot.mockRejectedValueOnce(new Error('刷新 snapshot 失败'));

    const c = await getComposable();
    await c.loadEntries(['CharBook']);

    expect(mockGetEntries).not.toHaveBeenCalled();
    expect(c.groups.value).toEqual([]);
    expect(c.status.value).toBe('error');
    expect(c.error.value).toBe('刷新 snapshot 失败');
  });

  it('含 takeover meta 的条目渲染为纯净标题且不泄漏元数据', async () => {
    const takeoverBlock = '<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{"version":1,"kind":"agent_worldbook_takeover","selectionSignature":"sig","createdAt":1,"previousEnabled":true}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockGetEntries.mockResolvedValue({
      'CharBook': [
        { uid: 1, comment: `受控条目\n\n${takeoverBlock}`, name: `受控条目\n\n${takeoverBlock}`, enabled: false, type: 'selective', keys: ['钥匙'] },
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['CharBook']);

    const entry = c.groups.value[0].entries[0];
    expect(entry.label).toBe('受控条目');
    expect(entry.label).not.toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META');
    expect(entry.label).not.toContain('\n');
  });
});
