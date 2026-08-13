/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetEntries = vi.fn();
const mockResolveScope = vi.fn();
const mockSaveSkill = vi.fn();
const mockDeleteSkill = vi.fn();
const mockSnapshot = vi.fn(() => ({ active: false, books: {} }));
const mockRefreshSnapshot = vi.fn(async () => mockSnapshot());

const skillMetaBlock = '<!-- ACU_SKILL_META_START\n{"version":1,"description":"已有","triggerWhen":"测试","tk":0,"updatedAt":1,"updatedBy":"manual"}\nACU_SKILL_META_END -->';

function withSkill(comment: string): string {
  return `${comment}\n\n${skillMetaBlock}`;
}

async function getComposable(onSkillMetaChanged?: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({ getLorebookEntriesByNames_ACU: mockGetEntries }));
  vi.doMock('../../../src/service/agent/agent-worldbook-config-meta', () => ({ resolveAgentWorldbookScopeBookNames_ACU: mockResolveScope }));
  vi.doMock('../../../src/service/agent/agent-worldbook-takeover', () => ({
    refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: mockRefreshSnapshot,
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-skill-meta', () => ({
    parseWorldbookSkillMetaFromComment_ACU: (comment: string) => comment.includes('ACU_SKILL_META_START') ? { description: '已有', triggerWhen: '测试' } : null,
    saveWorldbookEntrySkillMeta_ACU: mockSaveSkill,
    deleteWorldbookEntrySkillMeta_ACU: mockDeleteSkill,
  }));
  vi.doMock('../../../src/service/agent/agent-skillify-service', () => ({
    isWorldbookEntrySkillifyCandidate_ACU: (entry: any) => entry.enabled !== false && String(entry.type || '').trim().toLowerCase() !== 'constant'
      && !String(entry.comment || '').startsWith('internal') && !String(entry.comment || '').startsWith('database'),
  }));
  const mod = await import('../../../src/presentation-v2/composables/useAgentWorldbookEntries');
  return mod.useAgentWorldbookEntries({ onSkillMetaChanged });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockGetEntries.mockReset();
  mockResolveScope.mockReset();
  mockSaveSkill.mockReset();
  mockDeleteSkill.mockReset();
  mockSnapshot.mockReturnValue({ active: false, books: {} });
  mockRefreshSnapshot.mockImplementation(async () => mockSnapshot());
});

describe('useAgentWorldbookEntries', () => {
  it('无 Skill 且无 snapshot 时，仅展示可再次 Skill 化的 Agent scope 条目', async () => {
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockGetEntries.mockResolvedValue({ AgentBook: [
      { uid: 1, comment: '角色', name: '角色', enabled: true, type: 'selective' },
      { uid: 2, comment: '常驻', name: '常驻', enabled: true, type: 'constant' },
      { uid: 4, comment: '带空格常驻', name: '带空格常驻', enabled: true, type: ' CONSTANT ' },
      { uid: 3, comment: '关闭', name: '关闭', enabled: false, type: 'selective' },
    ] });
    const c = await getComposable();

    await c.loadEntries();

    expect(mockResolveScope).toHaveBeenCalledTimes(1);
    expect(mockGetEntries).toHaveBeenCalledWith(['AgentBook']);
    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(1);
    expect(c.groups.value[0].entries.map(entry => entry.uid)).toEqual([1]);
    expect(c.groups.value[0].entries[0].checked).toBe(false);
  });

  it('保留已接管或已有 Skill 元数据的非候选条目，但不允许再次 Skill 化', async () => {
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockSnapshot.mockReturnValue({ active: true, books: { AgentBook: [{ uid: 2 }, { uid: 4 }] } });
    mockGetEntries.mockResolvedValue({ AgentBook: [
      { uid: 1, comment: '原生', enabled: true, type: 'selective' },
      { uid: 2, comment: '已接管', enabled: true, type: 'constant' },
      { uid: 3, comment: withSkill('已 Skill'), enabled: false, type: 'selective' },
      { uid: 4, comment: 'database 已接管', enabled: true, type: 'selective' },
      { uid: 5, comment: 'database 无关', enabled: true, type: 'selective' },
    ] });
    const c = await getComposable();

    await c.loadEntries();

    const entries = c.groups.value[0].entries;
    expect(entries.map(entry => entry.uid)).toEqual([1, 2, 3, 4]);
    expect(entries.map(entry => entry.skillifySelectable)).toEqual([true, false, false, false]);
    expect(entries[1]).toMatchObject({ agentTakeoverState: 'final_greenlight', hasSkill: false });
    expect(entries[2]).toMatchObject({ agentTakeoverState: 'initial_disabled', hasSkill: true });
    expect(entries[3]).toMatchObject({ agentTakeoverState: 'taken_over', hasSkill: false });
    c.toggleSkillifyEntry('AgentBook', 2, true);
    c.toggleSkillifyEntry('AgentBook', 3, true);
    c.toggleSkillifyEntry('AgentBook', 4, true);
    expect(c.getSelectedSkillifyEntries()).toEqual([]);
  });

  it('加载前刷新持久 snapshot，使 state 缺失但 meta 重建出的 disabled 条目显示为 taken_over', async () => {
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockRefreshSnapshot.mockResolvedValue({
      active: true,
      books: {
        AgentBook: [{ uid: 7, previousEnabled: true, previousKeys: ['原关键词'], previousType: 'selective' }],
      },
    });
    mockGetEntries.mockResolvedValue({ AgentBook: [
      { uid: 7, comment: withSkill('分享后重建的接管条目'), enabled: false, type: 'selective', keys: ['原关键词'] },
      { uid: 8, comment: withSkill('用户手动关闭'), enabled: false, type: 'selective', keys: ['手动关键词'] },
    ] });
    const c = await getComposable();

    await c.loadEntries();

    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(1);
    expect(c.groups.value[0].entries).toMatchObject([
      { uid: 7, agentTakeoverState: 'taken_over', skillifySelectable: false },
      { uid: 8, agentTakeoverState: 'initial_disabled', skillifySelectable: false },
    ]);
  });

  it('snapshot 明确记录 previousEnabled=false 时仍视为已接管，且不允许 Skill 化', async () => {
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockRefreshSnapshot.mockResolvedValue({
      active: true,
      books: {
        AgentBook: [{ uid: 9, previousEnabled: false, previousKeys: ['手动关键词'], previousType: 'selective' }],
      },
    });
    mockGetEntries.mockResolvedValue({ AgentBook: [
      { uid: 9, comment: withSkill('历史快照条目'), enabled: false, type: 'selective', keys: ['手动关键词'] },
    ] });
    const c = await getComposable();

    await c.loadEntries();

    expect(c.groups.value[0].entries[0]).toMatchObject({
      uid: 9,
      agentTakeoverState: 'taken_over',
      skillifySelectable: false,
    });
  });

  it('空 scope 清空列表和选择状态', async () => {
    mockResolveScope.mockResolvedValueOnce(['AgentBook']).mockResolvedValueOnce([]);
    mockGetEntries.mockResolvedValue({ AgentBook: [{ uid: 1, comment: '角色', enabled: true, type: 'selective' }] });
    const c = await getComposable();
    await c.loadEntries();
    c.toggleSkillifyEntry('AgentBook', 1, true);

    await c.loadEntries();

    expect(c.groups.value).toEqual([]);
    expect(c.getSelectedSkillifyEntries()).toEqual([]);
    expect(c.status.value).toBe('success');
  });

  it('Skill 元数据写入成功后更新本地状态并通知接管同步', async () => {
    const notify = vi.fn(async () => undefined);
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockGetEntries.mockResolvedValue({ AgentBook: [{ uid: 1, comment: '角色', enabled: true, type: 'selective' }] });
    mockSaveSkill.mockResolvedValue({ updated: true, entry: { uid: 1, comment: withSkill('角色') } });
    const c = await getComposable(notify);
    await c.loadEntries();

    await c.saveEntrySkillMeta('AgentBook', 1, { description: '描述' }, 'manual');

    expect(notify).toHaveBeenCalledTimes(1);
    expect(c.groups.value[0].entries[0]).toMatchObject({ hasSkill: true, label: '角色' });
  });

  it('对已有 Skill 的非候选条目保存和删除元数据时保持本地状态与同步契约', async () => {
    const notify = vi.fn(async () => undefined);
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockGetEntries.mockResolvedValue({ AgentBook: [{ uid: 2, comment: withSkill('关闭'), enabled: false, type: 'selective' }] });
    mockSaveSkill.mockResolvedValue({ updated: false, entry: { uid: 2, comment: withSkill('关闭') } });
    mockDeleteSkill.mockResolvedValue({ updated: true, entry: { uid: 2, comment: '关闭' } });
    const c = await getComposable(notify);
    await c.loadEntries();

    await c.saveEntrySkillMeta('AgentBook', 2, { description: '新描述' }, 'manual');
    expect(notify).not.toHaveBeenCalled();
    expect(c.groups.value[0].entries[0]).toMatchObject({ hasSkill: true, skillifySelectable: false });

    await c.deleteEntrySkillMeta('AgentBook', 2);
    expect(mockDeleteSkill).toHaveBeenCalledWith('AgentBook', 2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(c.groups.value[0].entries[0]).toMatchObject({ hasSkill: false, label: '关闭' });
  });

  it('接管同步失败不会回滚已写入的 Skill 元数据', async () => {
    const notify = vi.fn(async () => { throw new Error('sync failed'); });
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockGetEntries.mockResolvedValue({ AgentBook: [{ uid: 1, comment: '角色', enabled: true, type: 'selective' }] });
    mockSaveSkill.mockResolvedValue({ updated: true, entry: { uid: 1, comment: withSkill('角色') } });
    const c = await getComposable(notify);
    await c.loadEntries();

    await expect(c.saveEntrySkillMeta('AgentBook', 1, { description: '描述' }, 'manual')).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(c.groups.value[0].entries[0]).toMatchObject({ hasSkill: true, label: '角色' });
  });

  it('接管同步返回 false 不会回滚已写入的 Skill 元数据', async () => {
    const notify = vi.fn(async () => false);
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockGetEntries.mockResolvedValue({ AgentBook: [{ uid: 1, comment: '角色', enabled: true, type: 'selective' }] });
    mockSaveSkill.mockResolvedValue({ updated: true, entry: { uid: 1, comment: withSkill('角色') } });
    const c = await getComposable(notify);
    await c.loadEntries();

    await expect(c.saveEntrySkillMeta('AgentBook', 1, { description: '描述' }, 'manual')).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(c.groups.value[0].entries[0]).toMatchObject({ hasSkill: true, label: '角色' });
  });

  it('含 takeover meta 的条目渲染为纯净标题且不泄漏元数据', async () => {
    mockResolveScope.mockResolvedValue(['AgentBook']);
    mockSnapshot.mockReturnValue({ active: true, books: { AgentBook: [{ uid: 5, previousEnabled: true, previousKeys: ['钥匙'], previousType: 'selective' }] } });
    const takeoverBlock = '<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{"version":1,"kind":"agent_worldbook_takeover","selectionSignature":"sig","createdAt":1,"previousEnabled":true}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockGetEntries.mockResolvedValue({ AgentBook: [
      { uid: 5, comment: `已接管条目\n\n${takeoverBlock}`, enabled: false, type: 'selective', keys: ['钥匙'] },
    ] });
    const c = await getComposable();

    await c.loadEntries();

    const entry = c.groups.value[0].entries[0];
    expect(entry.label).toBe('已接管条目');
    expect(entry.label).not.toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META');
    expect(entry.label).not.toContain('\n');
  });
});
