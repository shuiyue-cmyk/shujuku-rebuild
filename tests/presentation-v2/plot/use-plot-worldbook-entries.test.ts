/**
 * usePlotWorldbookEntries 单元测试
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeEntry(uid: number, comment: string, enabled = true) {
  return { uid, comment, name: comment, enabled };
}

function createSettings() {
  return {
    plotSettings: {
      plotWorldbookConfig: {
        source: 'character',
        manualSelection: [],
        enabledEntries: {},
      },
    },
  } as any;
}

let settings: ReturnType<typeof createSettings>;
const mockSaveSettings = vi.fn();
const mockGetEntries = vi.fn();
const mockGetAgentSnapshot = vi.fn(() => ({ active: false, selectionSignature: '', createdAt: 0, books: {} }));
const mockRefreshAgentSnapshot = vi.fn();
const mockSaveEntrySkillMeta = vi.fn();
const mockDeleteEntrySkillMeta = vi.fn();

async function getComposable(presetSettings?: ReturnType<typeof createSettings>, options: Record<string, any> = {}) {
  vi.resetModules();
  settings = presetSettings || createSettings();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
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
    deleteWorldbookEntrySkillMeta_ACU: mockDeleteEntrySkillMeta,
    parseWorldbookSkillMetaFromComment_ACU: (comment: unknown) => String(comment || '').includes('ACU_SKILL_META_START')
      ? { description: '已 Skill 化', triggerWhen: '测试触发', tk: 0, updatedBy: 'manual', updatedAt: 1 }
      : null,
    saveWorldbookEntrySkillMeta_ACU: mockSaveEntrySkillMeta,
    stripWorldbookSkillMetaBlock_ACU: (comment: unknown) => String(comment || '').replace(/\n?<!--\s*ACU_SKILL_META_START\s*\n[\s\S]*?\nACU_SKILL_META_END\s*-->\n?/g, '').trim(),
  }));
  vi.doMock('../../../src/service/agent/agent-skillify-service', () => ({
    getWorldbookEntryKeywordsForSkillify_ACU: vi.fn((entry: any) => Array.isArray(entry?.keys)
      ? entry.keys
      : (entry?.key ? [entry.key] : [])),
    isDatabaseGeneratedWorldbookEntryForAgent_ACU: vi.fn((entry: any) => /^(?:ACU-\[[^\]]+\]-)?(?:TavernDB-ACU-|重要人物条目|总结条目|小总结条目)/.test(String(entry?.comment || entry?.name || ''))
      && !String(entry?.comment || entry?.name || '').trim().startsWith('外部导入-')),
    isWorldbookEntrySkillifyCandidate_ACU: vi.fn((entry: any) => entry?.enabled !== false
      && String(entry?.type || '').trim().toLowerCase() !== 'constant'
      && !/^(?:ACU-\[[^\]]+\]-)?(?:TavernDB-ACU-|重要人物条目|总结条目|小总结条目)/.test(String(entry?.comment || entry?.name || ''))
      && !String(entry?.comment || entry?.name || '').trim().startsWith('AGENT_INTERNAL-')),
  }));

  const mod = await import('../../../src/presentation-v2/composables/usePlotWorldbookEntries');
  return mod.usePlotWorldbookEntries(options);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockSaveSettings.mockClear();
  mockGetEntries.mockClear();
  mockGetAgentSnapshot.mockReturnValue({ active: false, selectionSignature: '', createdAt: 0, books: {} });
  mockRefreshAgentSnapshot.mockReset();
  mockRefreshAgentSnapshot.mockImplementation(async () => mockGetAgentSnapshot());
  mockSaveEntrySkillMeta.mockReset();
  mockDeleteEntrySkillMeta.mockReset();
  mockSaveEntrySkillMeta.mockResolvedValue({ updated: false, reason: 'noop' });
  mockDeleteEntrySkillMeta.mockResolvedValue({ updated: false, reason: 'noop' });
});

describe('usePlotWorldbookEntries', () => {
  it('loadEntries 加载并过滤掉数据库生成条目', async () => {
    mockGetEntries.mockResolvedValue({
      'MyBook': [
        makeEntry(1, '角色设定'),
        makeEntry(2, 'TavernDB-ACU-OutlineTable'),
        makeEntry(3, 'TavernDB-ACU-CharTable'),
        makeEntry(4, '重要人物条目-xx'),
        makeEntry(5, '总结条目-xx'),
        makeEntry(6, '世界观'),
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

    expect(c.groups.value).toHaveLength(1);
    expect(c.groups.value[0].bookName).toBe('MyBook');
    const uids = c.groups.value[0].entries.map(e => e.uid);
    expect(uids).toContain(1);
    expect(uids).toContain(6);
    expect(uids).not.toContain(2);
    expect(uids).not.toContain(3);
    expect(uids).not.toContain(4);
    expect(uids).not.toContain(5);
  });

  it('loadEntries 显示 active snapshot 命中的 constant 受控条目并标记正文放行', async () => {
    mockGetAgentSnapshot.mockReturnValue({
      active: true,
      selectionSignature: 'test-selection',
      createdAt: Date.now(),
      books: {
        MyBook: [{ uid: 7, previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      },
    });
    mockGetEntries.mockResolvedValue({
      'MyBook': [
        { uid: 1, comment: '普通条目', name: '普通条目', enabled: true, type: 'selective', keys: ['普通'] },
        { uid: 7, comment: 'legacy snapshot 命中的常驻空关键词条目', name: 'legacy snapshot 命中的常驻空关键词条目', enabled: true, type: 'constant', keys: [] },
        { uid: 8, comment: '大写常量条目', name: '大写常量条目', enabled: true, type: 'CONSTANT', keys: ['常量'] },
        { uid: 9, comment: '带空格常量条目', name: '带空格常量条目', enabled: true, type: ' constant ', keys: ['常量'] },
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

    expect(c.groups.value[0].entries.map(e => ({ uid: e.uid, state: e.agentTakeoverState }))).toEqual([
      { uid: 1, state: 'native' },
      { uid: 7, state: 'final_greenlight' },
      { uid: 8, state: 'native' },
      { uid: 9, state: 'native' },
    ]);
    expect(c.groups.value[0].entries.filter(e => e.isConstant).map(e => e.uid)).toEqual([8, 9]);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries.MyBook).toEqual([1, 7, 8, 9]);
  });

  it('首次加载按接管前 enabled 初始化，而不把 live disabled 常量条目写入普通剧情配置', async () => {
    mockGetAgentSnapshot.mockReturnValue({
      active: true,
      selectionSignature: 'test-selection',
      createdAt: 1,
      books: {
        MyBook: [
          { uid: 1, previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' },
          { uid: 2, previousEnabled: false, previousKeys: ['关闭关键词'], previousType: 'selective' },
        ],
      },
    });
    mockGetEntries.mockResolvedValue({
      MyBook: [
        { uid: 1, comment: '接管前开启', name: '接管前开启', enabled: false, type: 'constant', keys: ['旧关键词'] },
        { uid: 2, comment: '接管前关闭', name: '接管前关闭', enabled: false, type: 'constant', keys: ['关闭关键词'] },
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

    expect(c.groups.value[0].entries.map(entry => ({ uid: entry.uid, disabled: entry.disabled, isConstant: entry.isConstant, checked: entry.checked }))).toEqual([
      { uid: 1, disabled: false, isConstant: false, checked: true },
      { uid: 2, disabled: true, isConstant: false, checked: false },
    ]);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries.MyBook).toEqual([1]);
  });

  it('已有空选择时按接管前状态展示受控条目，但不重新勾选用户取消的条目', async () => {
    settings = createSettings();
    settings.plotSettings.plotWorldbookConfig.enabledEntries = { MyBook: [] };
    mockGetAgentSnapshot.mockReturnValue({
      active: true,
      selectionSignature: 'test-selection',
      createdAt: 1,
      books: {
        MyBook: [
          { uid: 1, previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' },
          { uid: 2, previousEnabled: false, previousKeys: ['关闭关键词'], previousType: 'constant' },
        ],
      },
    });
    mockGetEntries.mockResolvedValue({
      MyBook: [
        { uid: 1, comment: '受控条目', name: '受控条目', enabled: false, type: 'selective', keys: [] },
        { uid: 2, comment: '原本关闭的受控条目', name: '原本关闭的受控条目', enabled: false, type: 'selective', keys: [] },
        makeEntry(3, 'TavernDB-ACU-应隐藏'),
        makeEntry(4, '外部导入-TavernDB-ACU-应显示'),
        makeEntry(5, 'ACU-[scope]-外部导入-TavernDB-ACU-应显示'),
        makeEntry(6, '普通规则条目'),
      ],
    });

    const c = await getComposable(settings);
    await c.loadEntries(['MyBook']);

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
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries.MyBook).toEqual([]);
    c.selectAll();
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries.MyBook).toEqual([1, 4, 5]);
  });

  it('loadEntries 显示并默认启用非 snapshot 命中的 constant 条目', async () => {
    mockGetEntries.mockResolvedValue({
      'MyBook': [
        { uid: 1, comment: '普通条目', name: '普通条目', enabled: true, type: 'selective', keys: ['普通'] },
        { uid: 8, comment: '大写常量条目', name: '大写常量条目', enabled: true, type: 'CONSTANT', keys: ['常量'] },
        { uid: 9, comment: '带空格常量条目', name: '带空格常量条目', enabled: true, type: ' constant ', keys: [] },
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

    expect(c.groups.value[0].entries.map(e => ({ uid: e.uid, isConstant: e.isConstant }))).toEqual([
      { uid: 1, isConstant: false },
      { uid: 8, isConstant: true },
      { uid: 9, isConstant: true },
    ]);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries.MyBook).toEqual([1, 8, 9]);
  });

  it('loadEntries 保留历史 enabledEntries 中仍可见的 constant 条目', async () => {
    settings = createSettings();
    settings.plotSettings.plotWorldbookConfig.enabledEntries = { MyBook: [1, 7, 8] };
    mockGetEntries.mockResolvedValue({
      'MyBook': [
        { uid: 1, comment: '普通条目', name: '普通条目', enabled: true, type: 'selective', keys: ['普通'] },
        { uid: 7, comment: '历史残留常量条目', name: '历史残留常量条目', enabled: true, type: 'constant', keys: [] },
        { uid: 8, comment: '历史残留大写常量条目', name: '历史残留大写常量条目', enabled: true, type: 'CONSTANT', keys: ['常量'] },
      ],
    });

    const c = await getComposable(settings);
    await c.loadEntries(['MyBook']);

    expect(c.groups.value[0].entries.map(e => e.uid)).toEqual([1, 7, 8]);
    expect(c.groups.value[0].entries.map(e => ({ uid: e.uid, checked: e.checked }))).toEqual([
      { uid: 1, checked: true },
      { uid: 7, checked: true },
      { uid: 8, checked: true },
    ]);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries.MyBook).toEqual([1, 7, 8]);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('loadEntries 过滤屏蔽词条目', async () => {
    mockGetEntries.mockResolvedValue({
      'B': [
        makeEntry(10, '角色规则'),
        makeEntry(11, '思维链说明'),
        makeEntry(12, '正常条目'),
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['B']);

    const uids = c.groups.value[0].entries.map(e => e.uid);
    expect(uids).toEqual([12]);
  });


  it('首次加载默认启用所有可见条目', async () => {
    mockGetEntries.mockResolvedValue({
      'X': [makeEntry(1, '好条目'), makeEntry(2, '也好')],
    });

    const c = await getComposable();
    await c.loadEntries(['X']);

    expect(c.groups.value[0].entries.every(e => e.checked)).toBe(true);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries['X']).toEqual([1, 2]);
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('已有 enabledEntries 时按已有值设置 checked', async () => {
    settings = createSettings();
    settings.plotSettings.plotWorldbookConfig.enabledEntries = { Y: [2] };

    mockGetEntries.mockResolvedValue({
      'Y': [makeEntry(1, '甲'), makeEntry(2, '乙'), makeEntry(3, '丙')],
    });

    const c = await getComposable(settings);
    await c.loadEntries(['Y']);

    const checks = c.groups.value[0].entries.map(e => ({ uid: e.uid, checked: e.checked }));
    expect(checks).toEqual([
      { uid: 1, checked: false },
      { uid: 2, checked: true },
      { uid: 3, checked: false },
    ]);
  });

  it('toggleEntry 更新 checked 和 enabledEntries', async () => {
    mockGetEntries.mockResolvedValue({
      'Z': [makeEntry(1, 'a'), makeEntry(2, 'b')],
    });

    const c = await getComposable();
    await c.loadEntries(['Z']);
    mockSaveSettings.mockClear();

    c.toggleEntry('Z', 2, false);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries['Z']).toEqual([1]);
    expect(c.groups.value[0].entries.find(e => e.uid === 2)?.checked).toBe(false);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);

    c.toggleEntry('Z', 2, true);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries['Z']).toContain(2);
    expect(c.groups.value[0].entries.find(e => e.uid === 2)?.checked).toBe(true);
  });

  it('selectAll 启用所有非 disabled 条目', async () => {
    mockGetEntries.mockResolvedValue({
      'W': [makeEntry(1, 'ok'), makeEntry(2, 'disabled', false), makeEntry(3, 'ok2')],
    });

    const c = await getComposable();
    settings.plotSettings.plotWorldbookConfig.enabledEntries = { W: [] };
    await c.loadEntries(['W']);
    mockSaveSettings.mockClear();

    c.selectAll();
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries['W']).toEqual([1, 3]);
    expect(c.groups.value[0].entries.find(e => e.uid === 2)?.checked).toBe(false);
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('deselectAll 清空所有条目', async () => {
    mockGetEntries.mockResolvedValue({
      'V': [makeEntry(1, 'a'), makeEntry(2, 'b')],
    });

    const c = await getComposable();
    await c.loadEntries(['V']);
    mockSaveSettings.mockClear();

    c.deselectAll();
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries['V']).toEqual([]);
    expect(c.groups.value[0].entries.every(e => !e.checked)).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalled();
  });



  it('空书名列表返回空 groups', async () => {
    const c = await getComposable();
    await c.loadEntries([]);
    expect(c.groups.value).toEqual([]);
    expect(c.status.value).toBe('success');
  });

  it('toggleGroupExpanded 切换展开状态', async () => {
    mockGetEntries.mockResolvedValue({
      'G': [makeEntry(1, 'x')],
    });

    const c = await getComposable();
    await c.loadEntries(['G']);
    expect(c.groups.value[0].expanded).toBe(false);

    c.toggleGroupExpanded('G');
    expect(c.groups.value[0].expanded).toBe(true);

    c.toggleGroupExpanded('G');
    expect(c.groups.value[0].expanded).toBe(false);
  });

  it('分类前刷新持久 snapshot，pending 条目不视为已接管', async () => {
    mockGetAgentSnapshot.mockReturnValue({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    mockRefreshAgentSnapshot.mockResolvedValue({
      active: true,
      selectionSignature: 'test-selection',
      createdAt: 1,
      books: {
        MyBook: [{ uid: 7, takeoverStatus: 'pending', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      },
    });
    mockGetEntries.mockResolvedValue({
      MyBook: [{ uid: 7, comment: '尚未完成接管', name: '尚未完成接管', enabled: false, type: 'selective', keys: [] }],
    });

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

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
        MyBook: [{ uid: 8, takeoverStatus: 'applied', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      },
    });
    mockGetEntries.mockResolvedValue({
      MyBook: [{ uid: 8, comment: '已接管条目', name: '已接管条目', enabled: false, type: 'constant', keys: [] }],
    });

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

    expect(mockGetAgentSnapshot).not.toHaveBeenCalled();
    expect(c.groups.value[0].entries[0]).toMatchObject({
      agentTakeoverState: 'taken_over',
      disabled: false,
      isConstant: false,
      checked: true,
    });
  });

  it('snapshot 刷新失败时中止加载，避免以陈旧 cache 分类', async () => {
    mockRefreshAgentSnapshot.mockRejectedValueOnce(new Error('刷新 snapshot 失败'));

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

    expect(mockGetEntries).not.toHaveBeenCalled();
    expect(c.groups.value).toEqual([]);
    expect(c.status.value).toBe('error');
    expect(c.error.value).toBe('刷新 snapshot 失败');
  });

  it('含 takeover meta 的条目渲染为纯净标题且不泄漏元数据', async () => {
    const takeoverBlock = '<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{"version":1,"kind":"agent_worldbook_takeover","selectionSignature":"sig","createdAt":1,"previousEnabled":true}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockGetEntries.mockResolvedValue({
      'MyBook': [
        { uid: 1, comment: `受控条目\n\n${takeoverBlock}`, name: `受控条目\n\n${takeoverBlock}`, enabled: false, type: 'selective', keys: ['钥匙'] },
      ],
    });

    const c = await getComposable();
    await c.loadEntries(['MyBook']);

    const entry = c.groups.value[0].entries[0];
    expect(entry.label).toBe('受控条目');
    expect(entry.label).not.toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META');
    expect(entry.label).not.toContain('\n');
  });
});
