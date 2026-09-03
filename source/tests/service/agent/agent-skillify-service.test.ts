import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetLorebookEntriesByNames } = vi.hoisted(() => ({
  mockGetLorebookEntriesByNames: vi.fn(async () => ({})),
}));

const { mockCallAIWithPreset, mockSettings, mockParseWorldbookSkillMeta, mockSaveWorldbookEntrySkillMeta, mockReadAgentWorldbookControl } = vi.hoisted(() => ({
  mockCallAIWithPreset: vi.fn(),
  mockReadAgentWorldbookControl: vi.fn(),
  mockSaveWorldbookEntrySkillMeta: vi.fn(),
  mockParseWorldbookSkillMeta: vi.fn(() => null),
  mockSettings: {
    plotSettings: {
      plotWorldbookConfig: {},
      agentWorldbookControl: { maxSkillifyConcurrency: 3 } as any,
    },
  },
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: mockCallAIWithPreset,
  isRetryableAiRequestError_ACU: (error: any) => {
    const status = Number(error?.status);
    if (String(error?.name || '') === 'AbortError') return false;
    if (Number.isFinite(status)) return status === 429 || (status >= 500 && status <= 599);
    return error instanceof TypeError || /network|timeout/i.test(String(error?.message || ''));
  },
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  getCharLorebooks_ACU: vi.fn(async () => ({ primary: '', additional: [] })),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  getLorebookEntriesByNames_ACU: mockGetLorebookEntriesByNames,
}));

vi.mock('../../../src/service/agent/agent-worldbook-skill-meta', () => ({
  parseWorldbookSkillMetaFromComment_ACU: mockParseWorldbookSkillMeta,
  saveWorldbookEntrySkillMeta_ACU: mockSaveWorldbookEntrySkillMeta,
  stripWorldbookSkillMetaBlock_ACU: vi.fn((comment: unknown) => String(comment || '').replace(/\n?<!--\s*ACU_SKILL_META_START\s*\n[\s\S]*?\nACU_SKILL_META_END\s*-->\n?/g, '\n').trim()),
}));

vi.mock('../../../src/service/agent/agent-worldbook-config-meta', () => ({
  readAgentWorldbookControlFromWorldbooks_ACU: mockReadAgentWorldbookControl,
}));

import {
  buildWorldbookSkillifyPrompt_ACU,
  collectWorldbookSkillifyCandidates_ACU,
  isDatabaseGeneratedWorldbookEntryForAgent_ACU,
  isWorldbookEntrySkillifyCandidate_ACU,
  parseAgentSkillifyResponse_ACU,
  skillifyWorldbookEntries_ACU,
} from '../../../src/service/agent/agent-skillify-service';

describe('agent worldbook skillify candidate filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.plotSettings.agentWorldbookControl = {
      maxSkillifyConcurrency: 3,
      agentSkillApiPreset: '',
      contextSettings: {},
      agentSkillifyPromptSegments: undefined,
    };
    mockGetLorebookEntriesByNames.mockResolvedValue({});
    mockParseWorldbookSkillMeta.mockReturnValue(null);
    mockCallAIWithPreset.mockResolvedValue('');
    mockSaveWorldbookEntrySkillMeta.mockResolvedValue({ updated: true });
    mockReadAgentWorldbookControl.mockImplementation(async () => ({
      control: mockSettings.plotSettings.agentWorldbookControl,
      source: 'legacy_settings',
      bookName: '',
      duplicateCount: 0,
      writableBookName: '',
      reason: 'legacy_settings_fallback',
    }));
  });

  it('excludes database-generated TavernDB entries from Agent candidates', () => {
    expect(isDatabaseGeneratedWorldbookEntryForAgent_ACU({ comment: 'TavernDB-ACU-ReadableDataTable', keys: ['db'] })).toBe(true);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: 'TavernDB-ACU-ReadableDataTable', keys: ['db'] })).toBe(false);
  });

  it('excludes isolated internal database-generated entries', () => {
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: 'ACU-[role-a]-TavernDB-ACU-WrapperStart', keys: ['wrap'] })).toBe(false);
  });

  it('keeps external import entries as normal keyword candidates', () => {
    const importedEntry = {
      comment: '外部导入-TavernDB-ACU-CustomExport-关系档案\n<!-- ACU_CUSTOM_TABLE_EXPORT_V1 {"version":1,"kind":"custom_table_export","sheetKey":"sheet_people","tableName":"人物关系表","entryName":"关系档案","role":"main"} -->',
      keys: ['艾琳'],
      type: 'keyword',
    };
    expect(isDatabaseGeneratedWorldbookEntryForAgent_ACU(importedEntry)).toBe(false);
    expect(isWorldbookEntrySkillifyCandidate_ACU(importedEntry)).toBe(true);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ ...importedEntry, type: 'constant' })).toBe(false);
  });

  it('excludes Chinese summary and person database entries', () => {
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: '重要人物条目-张三', keys: ['张三'] })).toBe(false);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: '外部导入-总结条目-1', keys: ['总结'] })).toBe(true);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: 'ACU-[role-a]-小总结条目-2', keys: ['小总结'] })).toBe(false);
  });

  it('keeps normal keyed user entries as Agent candidates', () => {
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: '用户自定义地点', keys: ['酒馆'] })).toBe(true);
  });

  it('does not treat Agent-managed greenlight entries as database-generated entries', () => {
    expect(isDatabaseGeneratedWorldbookEntryForAgent_ACU({ comment: 'TavernDB-ACU-AgentGreenlight-plot', keys: ['agent'] })).toBe(false);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: 'TavernDB-ACU-AgentGreenlight-plot', keys: ['agent'] })).toBe(true);
  });

  it('always excludes Agent final generation greenlight internal entries from Agent candidates', () => {
    const entry = { comment: 'TavernDB-ACU-AgentFinalGenerationGreenlights', keys: ['异常关键词'], enabled: true, type: 'selective' };
    expect(isDatabaseGeneratedWorldbookEntryForAgent_ACU(entry)).toBe(true);
    expect(isWorldbookEntrySkillifyCandidate_ACU(entry)).toBe(false);
  });

  it('always excludes Agent worldbook config/state internal entries from Agent candidates', () => {
    const entry = { comment: 'TavernDB-ACU-AgentWorldbookConfig', keys: ['异常关键词'], enabled: true, type: 'selective' };
    expect(isDatabaseGeneratedWorldbookEntryForAgent_ACU(entry)).toBe(true);
    expect(isWorldbookEntrySkillifyCandidate_ACU(entry)).toBe(false);
  });

  it('keeps disabled and constant checks while allowing entries without keywords', () => {
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: '用户自定义地点', keys: ['酒馆'], enabled: false })).toBe(false);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: '用户自定义地点', keys: ['酒馆'], type: 'constant' })).toBe(false);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: '用户自定义地点', keys: ['酒馆'], type: ' CONSTANT ' })).toBe(false);
    expect(isWorldbookEntrySkillifyCandidate_ACU({ comment: '用户自定义地点', keys: [] })).toBe(true);
  });

  it('excludes Agent worldbook snapshot internal entries from collect candidates', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [
        {
          uid: 'snapshot',
          comment: 'TavernDB-ACU-AgentWorldbookSnapshot',
          content: '{"version":1}',
          enabled: true,
          keys: ['异常快照关键词'],
        },
        {
          uid: 'normal',
          comment: '用户自定义地点',
          content: '酒馆内容',
          enabled: true,
          keys: ['酒馆'],
        },
      ],
    });

    const candidates = await collectWorldbookSkillifyCandidates_ACU(['剧情书']);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ uid: 'normal', bookName: '剧情书' });
    expect(candidates[0].tk).toBe(3);
  });

  it('filters skillify candidates by selectedEntries after hard candidate filtering', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [
        { uid: 'a', comment: '地点A', content: 'A'.repeat(20), enabled: true, keys: ['A'] },
        { uid: 'b', comment: '地点B', content: 'B'.repeat(20), enabled: true, keys: ['B'] },
        { uid: 'disabled-selected', comment: '禁用但被选择', content: 'D'.repeat(20), enabled: false, keys: ['D'] },
        { uid: 'constant-selected', comment: '常驻但被选择', content: 'C'.repeat(20), enabled: true, type: 'constant', keys: ['C'] },
      ],
      '资料书': [
        { uid: 7, comment: '资料地点', content: 'Z'.repeat(20), enabled: true, keys: ['Z'] },
      ],
    });

    const candidates = await collectWorldbookSkillifyCandidates_ACU(['剧情书', '资料书'], {
      selectedEntries: [
        { bookName: '剧情书', uid: 'b' },
        { bookName: '剧情书', uid: 'disabled-selected' },
        { bookName: '剧情书', uid: 'constant-selected' },
        { bookName: '资料书', uid: 7 },
        { bookName: '剧情书', uid: 'missing' },
      ],
    });

    expect(candidates.map(candidate => ({ bookName: candidate.bookName, uid: candidate.uid }))).toEqual([
      { bookName: '剧情书', uid: 'b' },
      { bookName: '资料书', uid: 7 },
    ]);
  });

  it('returns no skillify candidates when selectedEntries is an empty array', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [
        { uid: 'a', comment: '地点A', content: 'A'.repeat(20), enabled: true, keys: ['A'] },
      ],
    });

    const candidates = await collectWorldbookSkillifyCandidates_ACU(['剧情书'], { selectedEntries: [] });

    expect(candidates).toEqual([]);
  });


  it('renders editable skillify prompt placeholders', () => {
    mockSettings.plotSettings.agentWorldbookControl.agentSkillifyPromptSegments = [
      { role: 'user', deletable: true, content: 'B={{agent.skillify.bookName}};U={{agent.skillify.uid}};K={{agent.skillify.keysText}};TK={{agent.skillify.tk}};C={{agent.skillify.contentPreview}};M={{agent.skillify.existingSkillMetaJson}}' },
    ];

    const messages = buildWorldbookSkillifyPrompt_ACU({
      bookName: '剧情书',
      uid: 7,
      comment: '酒馆地点',
      content: '灯火昏暗，吧台后藏着通往地下室的暗门。',
      keys: ['酒馆', '夜晚'],
      existingSkillMeta: { version: 1, description: '旧描述', triggerWhen: '旧触发', updatedAt: 1, updatedBy: 'manual' },
      tk: 42,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('B=剧情书');
    expect(messages[0].content).toContain('U=7');
    expect(messages[0].content).toContain('K=酒馆、夜晚');
    expect(messages[0].content).toContain('TK=42');
    expect(messages[0].content).toContain('C=灯火昏暗，吧台后藏着通往地下室的暗门。');
    expect(messages[0].content).toContain('旧描述');
  });

  it('renders original worldbook content in default skillify prompt', () => {
    mockSettings.plotSettings.agentWorldbookControl.agentSkillifyPromptSegments = undefined;

    const messages = buildWorldbookSkillifyPrompt_ACU({
      bookName: '剧情书',
      uid: 8,
      comment: '酒馆地点',
      content: '灯火昏暗，吧台后藏着通往地下室的暗门。',
      keys: ['酒馆'],
      existingSkillMeta: null,
      tk: 7,
    });

    const rendered = messages.map(message => message.content).join('\n');
    expect(rendered).not.toContain('contentPreview');
    expect(rendered).toContain('条目正文');
    expect(rendered).toContain('灯火昏暗，吧台后藏着通往地下室的暗门。');
    expect(rendered).toContain('描述与触发时机');
    expect(rendered).toContain('禁止输出或改写 tk 字段');
    expect(rendered).toContain('酒馆地点');
    expect(rendered).toContain('条目 TK: 7');
  });


  it('uses context settings for default skillify max entries while keeping original content', async () => {
    mockSettings.plotSettings.agentWorldbookControl.contextSettings = {
      skillifyContentPreviewLimit: 1,
      skillifyMaxEntries: 1,
    };
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [
        { uid: 'a', comment: '地点A', content: 'A'.repeat(250), enabled: true, keys: ['A'] },
        { uid: 'b', comment: '地点B', content: 'B'.repeat(250), enabled: true, keys: ['B'] },
      ],
    });

    const candidates = await collectWorldbookSkillifyCandidates_ACU(['剧情书']);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].uid).toBe('a');
    expect(candidates[0]).not.toHaveProperty('contentPreview');
    expect(candidates[0].content).toBe('A'.repeat(250));
    expect(candidates[0].tk).toBe(167);
  });

  it('recomputes existing skill meta tk locally when overwrite is enabled', async () => {
    mockParseWorldbookSkillMeta.mockReturnValueOnce({ version: 1, description: '旧描述', triggerWhen: '旧触发', tk: 12, updatedAt: 1, updatedBy: 'agent-skillify' });
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'a', comment: '地点A', content: 'A'.repeat(250), enabled: true, keys: ['A'] }],
    });

    const candidates = await collectWorldbookSkillifyCandidates_ACU(['剧情书'], { overwriteManual: true });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].tk).toBe(167);
  });

  it('strips existing skill meta block from skillify summary comment', async () => {
    const metaBlock = '<!-- ACU_SKILL_META_START\n{"version":1,"description":"旧描述","triggerWhen":"旧触发","tk":12,"updatedAt":1,"updatedBy":"agent-skillify"}\nACU_SKILL_META_END -->';
    mockParseWorldbookSkillMeta.mockReturnValueOnce({ version: 1, description: '旧描述', triggerWhen: '旧触发', tk: 12, updatedAt: 1, updatedBy: 'agent-skillify' });
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'a', comment: `地点A\n\n${metaBlock}`, content: 'A'.repeat(20), enabled: true, keys: ['A'] }],
    });

    const candidates = await collectWorldbookSkillifyCandidates_ACU(['剧情书'], { overwriteManual: true });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].comment).toBe('地点A');
    expect(candidates[0].existingSkillMeta?.description).toBe('旧描述');
    expect(JSON.stringify(candidates[0])).not.toContain('ACU_SKILL_META_START');
  });

  it('excludes entries that already have AI-generated skill meta before batch selection', async () => {
    mockParseWorldbookSkillMeta.mockReturnValueOnce({
      version: 1,
      description: 'AI 已生成描述',
      triggerWhen: 'AI 已生成触发条件',
      tk: 12,
      updatedAt: 1,
      updatedBy: 'agent-skillify',
    });
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'existing-ai', comment: '地点A', content: 'A'.repeat(20), enabled: true, keys: ['A'] }],
    });

    const result = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(mockCallAIWithPreset).not.toHaveBeenCalled();
    expect(mockSaveWorldbookEntrySkillMeta).not.toHaveBeenCalled();
    expect(result).toMatchObject({ totalCandidates: 0, totalMatched: 0, selectedForRun: 0, remaining: 0, updated: 0, skipped: 0, failed: 0 });
    expect(result.results).toEqual([]);
  });

  it('excludes entries that already have manually edited skill meta before batch selection', async () => {
    mockParseWorldbookSkillMeta.mockReturnValueOnce({
      version: 1,
      description: '用户手写描述',
      triggerWhen: '用户手写触发条件',
      tk: 16,
      updatedAt: 1,
      updatedBy: 'manual',
    });
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'existing-manual', comment: '地点Manual', content: 'M'.repeat(20), enabled: true, keys: ['M'] }],
    });

    const result = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(mockCallAIWithPreset).not.toHaveBeenCalled();
    expect(mockSaveWorldbookEntrySkillMeta).not.toHaveBeenCalled();
    expect(result).toMatchObject({ totalCandidates: 0, totalMatched: 0, selectedForRun: 0, remaining: 0, updated: 0, skipped: 0, failed: 0 });
    expect(result.results).toEqual([]);
  });

  it('regenerates entries whose existing skill meta has no usable description or trigger', async () => {
    mockParseWorldbookSkillMeta.mockReturnValueOnce({
      version: 1,
      description: '',
      triggerWhen: '',
      tk: 0,
      updatedAt: 1,
      updatedBy: 'agent-skillify',
    });
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'empty-meta', comment: '地点B', content: 'B'.repeat(20), enabled: true, keys: ['B'] }],
    });
    mockCallAIWithPreset.mockResolvedValueOnce('{"description":"新描述","triggerWhen":"新触发","tk":8}');

    const result = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    expect(mockSaveWorldbookEntrySkillMeta).toHaveBeenCalledWith('剧情书', 'empty-meta', { description: '新描述', triggerWhen: '新触发', tk: 14 }, 'agent-skillify');
    expect(result).toMatchObject({ totalCandidates: 1, updated: 1, skipped: 0, failed: 0 });
  });

  it('parses description and triggerWhen while ignoring AI-provided tk', () => {
    expect(parseAgentSkillifyResponse_ACU('{"description":"描述","triggerWhen":"触发","tk":88}')).toEqual({
      description: '描述',
      triggerWhen: '触发',
    });

    expect(parseAgentSkillifyResponse_ACU('{"description":"描述","triggerWhen":"触发"}')).toEqual({
      description: '描述',
      triggerWhen: '触发',
    });
  });

  it('ignores AI-provided tk and saves the locally counted value', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'a', comment: '地点A', content: 'A'.repeat(100), enabled: true, keys: ['A'] }],
    });
    mockCallAIWithPreset.mockResolvedValueOnce('{"description":"新描述","triggerWhen":"新触发","tk":64}');
    mockSaveWorldbookEntrySkillMeta.mockResolvedValueOnce({ updated: true });

    const result = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(mockSaveWorldbookEntrySkillMeta).toHaveBeenCalledWith('剧情书', 'a', {
      description: '新描述',
      triggerWhen: '新触发',
      tk: 67,
    }, 'agent-skillify');
    expect(result).toMatchObject({ totalCandidates: 1, updated: 1, skipped: 0, failed: 0 });
  });

  it('retries AI skillify responses beyond the former retry limit before saving', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'retry', comment: '地点Retry', content: 'R'.repeat(20), enabled: true, keys: [] }],
    });
    let attempts = 0;
    mockCallAIWithPreset.mockImplementation(async () => {
      attempts += 1;
      return attempts === 11 ? '{"description":"新描述","triggerWhen":"新触发","tk":9}' : '';
    });
    mockSaveWorldbookEntrySkillMeta.mockResolvedValueOnce({ updated: true });
    const progress = vi.fn();

    const result = await skillifyWorldbookEntries_ACU(['剧情书'], { maxAiRetries: 11, onProgress: progress });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(11);
    expect(mockCallAIWithPreset.mock.calls[1][0]).toBe(mockCallAIWithPreset.mock.calls[0][0]);
    expect(mockSaveWorldbookEntrySkillMeta).toHaveBeenCalledWith('剧情书', 'retry', { description: '新描述', triggerWhen: '新触发', tk: 14 }, 'agent-skillify');
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'retry', attempt: 10, maxAttempts: 11, uid: 'retry' }));
    expect(result).toMatchObject({ totalCandidates: 1, updated: 1, skipped: 0, failed: 0 });
  });

  it('does not retry non-retryable AI HTTP failures', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'unauthorized', comment: '受保护地点', content: '内容', enabled: true, keys: [] }],
    });
    const unauthorized = Object.assign(new Error('API 请求失败: 401'), { status: 401, name: 'AgentApiHttpError_ACU' });
    mockCallAIWithPreset.mockRejectedValueOnce(unauthorized);

    const result = await skillifyWorldbookEntries_ACU(['剧情书'], { maxAiRetries: 3 });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    expect(mockSaveWorldbookEntrySkillMeta).not.toHaveBeenCalled();
    expect(result).toMatchObject({ totalCandidates: 1, updated: 0, skipped: 0, failed: 1 });
    expect(result.results[0].reason).toContain('401');
  });

  it('用户 Abort 先行：以 aborted 码终止整批，不落 failed', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'stopped', comment: '中断地点', content: '内容', enabled: true, keys: [] }],
    });
    mockCallAIWithPreset.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(skillifyWorldbookEntries_ACU(['剧情书'], { maxAiRetries: 3 })).rejects.toThrow('agent_skillify_entry_aborted');
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    expect(mockSaveWorldbookEntrySkillMeta).not.toHaveBeenCalled();
  });

  it('retries rate-limited AI HTTP failures before saving', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'rate-limited', comment: '限流地点', content: '内容', enabled: true, keys: [] }],
    });
    const rateLimited = Object.assign(new Error('API 请求失败: 429'), { status: 429, name: 'AgentApiHttpError_ACU' });
    mockCallAIWithPreset
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce('{"description":"新描述","triggerWhen":"新触发"}');
    mockSaveWorldbookEntrySkillMeta.mockResolvedValueOnce({ updated: true });

    const result = await skillifyWorldbookEntries_ACU(['剧情书'], { maxAiRetries: 2 });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(2);
    expect(mockSaveWorldbookEntrySkillMeta).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ totalCandidates: 1, updated: 1, skipped: 0, failed: 0 });
  });

  it('runs skillify API calls above the former concurrency limit without exceeding candidates', async () => {
    mockSettings.plotSettings.agentWorldbookControl.maxSkillifyConcurrency = 9;
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': ['a', 'b', 'c', 'd', 'e', 'f'].map(uid => ({
        uid,
        comment: `地点${uid}`,
        content: uid.repeat(20),
        enabled: true,
        keys: [uid],
      })),
    });
    let active = 0;
    let maxActive = 0;
    mockCallAIWithPreset.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return '{"description":"新描述","triggerWhen":"新触发","tk":4}';
    });

    const result = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(6);
    expect(maxActive).toBe(6);
    expect(result).toMatchObject({ totalCandidates: 6, updated: 6, skipped: 0, failed: 0 });
  });

  it('uses the locally counted tk when the AI response omits tk', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'a', comment: '地点A', content: 'A'.repeat(100), enabled: true, keys: ['A'] }],
    });
    mockCallAIWithPreset.mockResolvedValueOnce('{"description":"新描述","triggerWhen":"新触发"}');
    mockSaveWorldbookEntrySkillMeta.mockResolvedValueOnce({ updated: false, reason: '世界书 Skill 元数据未变化' });

    const result = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(mockSaveWorldbookEntrySkillMeta).toHaveBeenCalledWith('剧情书', 'a', {
      description: '新描述',
      triggerWhen: '新触发',
      tk: 67,
    }, 'agent-skillify');
    expect(result).toMatchObject({ totalCandidates: 1, updated: 0, skipped: 1, failed: 0 });
  });

  it('reports invalid skillify response and save errors as failed results', async () => {
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'invalid', comment: '无效', content: 'X', enabled: true, keys: ['X'] }],
    });
    mockCallAIWithPreset.mockResolvedValueOnce('{"description":"","triggerWhen":""}');

    const invalidResult = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(invalidResult).toMatchObject({ totalCandidates: 1, updated: 0, skipped: 0, failed: 1 });
    expect(mockSaveWorldbookEntrySkillMeta).not.toHaveBeenCalled();

    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'save-failed', comment: '保存失败', content: 'Y', enabled: true, keys: ['Y'] }],
    });
    mockCallAIWithPreset.mockResolvedValueOnce('{"description":"新描述","triggerWhen":"新触发","tk":1}');
    mockSaveWorldbookEntrySkillMeta.mockResolvedValueOnce({ updated: false, reason: '写入失败' });

    const saveFailedResult = await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(saveFailedResult).toMatchObject({ totalCandidates: 1, updated: 0, skipped: 0, failed: 1 });
    expect(saveFailedResult.results[0].reason).toBe('写入失败');
  });

  it('uses worldbook card config before legacy settings for skillify prompt and preset', async () => {
    mockSettings.plotSettings.agentWorldbookControl = {
      agentSkillApiPreset: 'legacy-preset',
      maxSkillifyConcurrency: 3,
      contextSettings: { agentAiMaxRetries: 1, skillifyMaxEntries: 5 },
      agentSkillifyPromptSegments: [
        { role: 'user', deletable: true, content: 'LEGACY={{agent.skillify.bookName}}' },
      ],
    };
    mockReadAgentWorldbookControl.mockResolvedValueOnce({
      control: {
        ...mockSettings.plotSettings.agentWorldbookControl,
        agentSkillApiPreset: 'worldbook-preset',
        contextSettings: { agentAiMaxRetries: 1, skillifyMaxEntries: 5 },
        agentSkillifyPromptSegments: [
          { role: 'user', deletable: true, content: 'WB={{agent.skillify.bookName}};UID={{agent.skillify.uid}}' },
        ],
      },
      source: 'worldbook',
      bookName: '角色A世界书',
      duplicateCount: 0,
      writableBookName: '角色A世界书',
    });
    mockGetLorebookEntriesByNames.mockResolvedValueOnce({
      '剧情书': [{ uid: 'wb-first', comment: '地点A', content: 'A'.repeat(20), enabled: true, keys: ['A'] }],
    });
    mockCallAIWithPreset.mockResolvedValueOnce('{"description":"新描述","triggerWhen":"新触发","tk":4}');

    await skillifyWorldbookEntries_ACU(['剧情书']);

    expect(mockCallAIWithPreset).toHaveBeenCalledWith([
      { role: 'user', content: 'WB=剧情书;UID=wb-first' },
    ], 'worldbook-preset');
  });

  it('advances the cursor after failed entries without repeating the processed batch', async () => {
    const entries = ['a', 'b', 'c'].map(uid => ({
      uid,
      comment: `地点${uid}`,
      content: `内容${uid}`,
      enabled: true,
      keys: [uid],
    }));
    mockGetLorebookEntriesByNames.mockResolvedValue({ '剧情书': entries });
    const unauthorized = Object.assign(new Error('API 请求失败: 401'), { status: 401, name: 'AgentApiHttpError_ACU' });
    mockCallAIWithPreset
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce('{"description":"描述B","triggerWhen":"触发B"}')
      .mockResolvedValueOnce('{"description":"描述C","triggerWhen":"触发C"}');

    const first = await skillifyWorldbookEntries_ACU(['剧情书'], { maxEntries: 2, maxAiRetries: 2 });
    const second = await skillifyWorldbookEntries_ACU(['剧情书'], { maxEntries: 2, cursor: first.nextCursor });

    expect(first.results.map(result => result.uid)).toEqual(['a', 'b']);
    expect(first).toMatchObject({ totalMatched: 3, selectedForRun: 2, remaining: 1, truncated: true, failed: 1 });
    expect(first.nextCursor).toEqual({ bookName: '剧情书', uid: 'b' });
    expect(second.results.map(result => result.uid)).toEqual(['c']);
    expect(second).toMatchObject({ totalMatched: 1, selectedForRun: 1, remaining: 0, truncated: false, failed: 0 });
    expect(second.nextCursor).toEqual({ bookName: '剧情书', uid: 'c' });
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(3);
  });
});
