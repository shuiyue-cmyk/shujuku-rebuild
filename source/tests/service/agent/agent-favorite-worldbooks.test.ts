/**
 * 常用世界书：名单维护、skill 化状态、复制并挂载到当前角色卡。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: {} as Record<string, any>,
  // 返回形状即 SaveSettingsResult_ACU；测试里按需要 mock 成功 / storage_error / 抛异常三档。
  save: vi.fn((): any => ({ saved: true })),
  character: { name: '艾琳', avatar: 'Erin.png' } as { name: string; avatar: string } | null,
  books: new Map<string, any>(),
  saved: [] as Array<{ name: string; data: any }>,
  bind: vi.fn(async (_character: any, _name: string) => 'bound' as string),
  flatEntries: new Map<string, any[]>(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({ get settings_ACU() { return h.settings; } }));
vi.mock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: () => h.save() }));
vi.mock('../../../src/data/gateways/worldbook-file-gateway', () => ({
  getCurrentSingleCharacter_ACU: () => h.character,
  listWorldbookNamesLive_ACU: async () => [...h.books.keys()],
  loadWorldbookFile_ACU: async (name: string) => (h.books.has(name) ? structuredClone(h.books.get(name)) : null),
  saveWorldbookFile_ACU: async (name: string, data: any) => {
    h.saved.push({ name, data });
    h.books.set(name, structuredClone(data));
  },
  addAuxWorldbookToCurrentCharacter_ACU: (character: any, name: string) => h.bind(character, name),
}));
vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getLorebookEntries_ACU: async (name: string) => h.flatEntries.get(name) || [],
}));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn(), logDebug_ACU: vi.fn() }));

import {
  buildMountedWorldbookName_ACU,
  mountFavoriteWorldbooksToCurrentCharacter_ACU,
  readFavoriteWorldbookNames_ACU,
  readFavoriteWorldbookSkillStatus_ACU,
  writeFavoriteWorldbookNames_ACU,
} from '../../../src/service/agent/agent-favorite-worldbooks';

const SKILL = '\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"战斗","triggerWhen":"打架时","tk":0,"updatedAt":1,"updatedBy":"ai"}\nACU_SKILL_META_END -->\n';

function book(entries: Record<string, any>) {
  return { entries };
}

beforeEach(() => {
  h.settings = {};
  h.save.mockClear();
  h.character = { name: '艾琳', avatar: 'Erin.png' };
  h.books.clear();
  h.saved.length = 0;
  h.bind.mockReset().mockResolvedValue('bound');
  h.flatEntries.clear();
});

describe('常用世界书名单', () => {
  it('去空白、去重后存进设置并保存', () => {
    expect(writeFavoriteWorldbookNames_ACU([' 战斗技能 ', '地理百科', '战斗技能', '', 3 as any])).toEqual({ names: ['战斗技能', '地理百科'], saved: true });
    expect(h.settings.agentFavoriteWorldbooks).toEqual(['战斗技能', '地理百科']);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(readFavoriteWorldbookNames_ACU()).toEqual(['战斗技能', '地理百科']);
  });

  it('设置里没有或格式不对时为空名单', () => {
    expect(readFavoriteWorldbookNames_ACU()).toEqual([]);
    h.settings.agentFavoriteWorldbooks = '战斗技能';
    expect(readFavoriteWorldbookNames_ACU()).toEqual([]);
  });

  it('落盘失败（storage_error）时回滚内存名单并如实返回原因', () => {
    writeFavoriteWorldbookNames_ACU(['战斗技能']);
    h.save.mockReturnValueOnce({ saved: false, storageType: 'memory', code: 'storage_error', error: '保存设置到存储失败。' });

    const result = writeFavoriteWorldbookNames_ACU(['战斗技能', '地理百科']);

    expect(result).toEqual({ names: ['战斗技能'], saved: false, error: '保存设置到存储失败。' });
    expect(h.settings.agentFavoriteWorldbooks).toEqual(['战斗技能']);
    expect(readFavoriteWorldbookNames_ACU()).toEqual(['战斗技能']);
  });

  it('保存抛异常时同样回滚，不留下「面板已改、刷新丢失」的脏写', () => {
    h.save.mockImplementationOnce(() => { throw new Error('宿主设置通道异常'); });

    const result = writeFavoriteWorldbookNames_ACU(['战斗技能']);

    expect(result).toEqual({ names: [], saved: false, error: '宿主设置通道异常' });
    expect(h.settings.agentFavoriteWorldbooks).toEqual([]);
  });
});

describe('副本命名', () => {
  it('角色卡名-原书名，去掉文件名不允许的字符', () => {
    expect(buildMountedWorldbookName_ACU('艾琳', '战斗技能')).toBe('艾琳-战斗技能');
    expect(buildMountedWorldbookName_ACU('A/B:C', '书*名?')).toBe('A_B_C-书_名_');
    expect(buildMountedWorldbookName_ACU('  艾琳.  ', '战斗技能.')).toBe('艾琳-战斗技能');
  });
});

describe('skill 化状态', () => {
  it('只统计可 skill 化的条目（排除关闭、常驻、数据库生成的），已带 skill 元数据的计入已完成', async () => {
    h.books.set('战斗技能', book({}));
    h.flatEntries.set('战斗技能', [
      { uid: 1, comment: `剑术${SKILL}`, type: 'selective', enabled: true },
      { uid: 2, comment: '弓术', type: 'selective', enabled: true },
      { uid: 3, comment: '常驻说明', type: 'constant', enabled: true },
      { uid: 4, comment: '关掉的', type: 'selective', enabled: false },
      { uid: 5, comment: 'TavernDB-ACU-CustomExport-纪要', type: 'selective', enabled: true },
    ]);
    expect(await readFavoriteWorldbookSkillStatus_ACU('战斗技能')).toEqual({ bookName: '战斗技能', exists: true, candidateCount: 2, skilledCount: 1 });
  });

  it('书已被删除时标记不存在', async () => {
    expect(await readFavoriteWorldbookSkillStatus_ACU('不存在的书')).toEqual({ bookName: '不存在的书', exists: false, candidateCount: 0, skilledCount: 0 });
  });
});

describe('挂载到当前角色卡', () => {
  it('复制成「角色卡名-原书名」并挂成附加世界书；数据库生成与 Agent 状态条目不复制', async () => {
    h.books.set('战斗技能', book({
      1: { uid: 1, comment: `剑术${SKILL}`, content: '剑术内容' },
      2: { uid: 2, comment: 'TavernDB-ACU-AgentWorldbookConfig', content: '{}' },
      3: { uid: 3, comment: 'TavernDB-ACU-AgentGreenlight-剑术', content: 'x' },
      4: { uid: 4, comment: '重要人物条目', content: 'y' },
    }));

    const result = await mountFavoriteWorldbooksToCurrentCharacter_ACU(['战斗技能'], { resolveExisting: vi.fn() });

    expect(result).toEqual({ ok: true, characterName: '艾琳', results: [
      { sourceName: '战斗技能', targetName: '艾琳-战斗技能', copy: 'created', binding: 'bound' },
    ] });
    expect(Object.keys(h.books.get('艾琳-战斗技能').entries)).toEqual(['1']);
    expect(h.books.get('战斗技能').entries[2]).toBeDefined();
    expect(h.bind).toHaveBeenCalledWith({ name: '艾琳', avatar: 'Erin.png' }, '艾琳-战斗技能');
  });

  it('源书正被别的卡 Agent 接管时，副本还原成接管前的样子：打开开关、去掉接管记录、放行留下的常驻改回', async () => {
    const takeover = (meta: Record<string, unknown>) => `<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n${JSON.stringify({
      version: 1, kind: 'agent_worldbook_takeover', selectionSignature: 'sig-card-a', createdAt: 1, previousKeys: ['剑'], ...meta,
    })}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`;
    h.books.set('战斗技能', book({
      1: { uid: 1, comment: `剑术${SKILL}\n\n${takeover({ previousEnabled: true, previousType: 'selective' })}`, disable: true, constant: false, content: '剑术内容' },
      2: { uid: 2, comment: `弓术\n\n${takeover({ previousEnabled: true, previousType: 'selective' })}`, disable: false, constant: true, content: '弓术内容' },
      3: { uid: 3, comment: `原本就关着\n\n${takeover({ previousEnabled: false, previousType: 'selective' })}`, disable: true, constant: false },
    }));

    await mountFavoriteWorldbooksToCurrentCharacter_ACU(['战斗技能'], { resolveExisting: vi.fn() });

    const copied = h.books.get('艾琳-战斗技能').entries;
    expect(copied[1]).toMatchObject({ disable: false, constant: false, content: '剑术内容' });
    expect(copied[1].comment).toBe(`剑术${SKILL}`.trim());
    expect(copied[2]).toMatchObject({ disable: false, constant: false });
    expect(copied[2].comment).toBe('弓术');
    expect(copied[3]).toMatchObject({ disable: true });
    for (const entry of Object.values<any>(copied)) expect(entry.comment).not.toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META');
    // 源书不动
    expect(h.books.get('战斗技能').entries[1].disable).toBe(true);
  });

  it('副本已存在时询问：保留则不改副本、只确保挂上；覆盖则用常用书重写；跳过则不复制也不挂', async () => {
    h.books.set('战斗技能', book({ 1: { uid: 1, comment: '新内容' } }));
    h.books.set('地理百科', book({ 1: { uid: 1, comment: '地理' } }));
    h.books.set('历史', book({ 1: { uid: 1, comment: '历史' } }));
    h.books.set('艾琳-战斗技能', book({ 9: { uid: 9, comment: '我改过的' } }));
    h.books.set('艾琳-地理百科', book({ 9: { uid: 9, comment: '旧地理' } }));
    h.books.set('艾琳-历史', book({ 9: { uid: 9, comment: '旧历史' } }));
    h.bind.mockResolvedValueOnce('already').mockResolvedValueOnce('bound');
    const resolveExisting = vi.fn(async (targetName: string) => (
      targetName === '艾琳-战斗技能' ? 'keep' : targetName === '艾琳-地理百科' ? 'overwrite' : 'skip'
    ));

    const result: any = await mountFavoriteWorldbooksToCurrentCharacter_ACU(['战斗技能', '地理百科', '历史'], { resolveExisting });

    expect(resolveExisting).toHaveBeenCalledTimes(3);
    expect(result.results).toEqual([
      { sourceName: '战斗技能', targetName: '艾琳-战斗技能', copy: 'kept', binding: 'already' },
      { sourceName: '地理百科', targetName: '艾琳-地理百科', copy: 'overwritten', binding: 'bound' },
      { sourceName: '历史', targetName: '艾琳-历史', copy: 'skipped', binding: 'not_attempted' },
    ]);
    expect(h.books.get('艾琳-战斗技能').entries[9].comment).toBe('我改过的');
    expect(h.books.get('艾琳-地理百科').entries).toEqual({ 1: { uid: 1, comment: '地理' } });
    expect(h.books.get('艾琳-历史').entries[9].comment).toBe('旧历史');
    expect(h.bind).toHaveBeenCalledTimes(2);
  });

  it('常用书已被删除时这一本记失败，其余照常', async () => {
    h.books.set('地理百科', book({ 1: { uid: 1, comment: '地理' } }));
    const result: any = await mountFavoriteWorldbooksToCurrentCharacter_ACU(['战斗技能', '地理百科'], { resolveExisting: vi.fn() });
    expect(result.results[0]).toMatchObject({ sourceName: '战斗技能', copy: 'failed', binding: 'not_attempted' });
    expect(result.results[0].reason).toContain('找不到');
    expect(result.results[1]).toMatchObject({ sourceName: '地理百科', copy: 'created', binding: 'bound' });
  });

  it('挂载接口不可用时副本照常建好，结果标明需要手动挂载', async () => {
    h.books.set('战斗技能', book({ 1: { uid: 1, comment: '剑术' } }));
    h.bind.mockResolvedValue('unavailable');
    const result: any = await mountFavoriteWorldbooksToCurrentCharacter_ACU(['战斗技能'], { resolveExisting: vi.fn() });
    expect(result.results[0]).toMatchObject({ copy: 'created', binding: 'unavailable' });
    expect(h.books.has('艾琳-战斗技能')).toBe(true);
  });

  it('挂载抛错时记为挂载失败并带原因，不影响下一本', async () => {
    h.books.set('战斗技能', book({ 1: { uid: 1, comment: '剑术' } }));
    h.books.set('地理百科', book({ 1: { uid: 1, comment: '地理' } }));
    h.bind.mockRejectedValueOnce(new Error('宿主拒绝')).mockResolvedValueOnce('bound');
    const result: any = await mountFavoriteWorldbooksToCurrentCharacter_ACU(['战斗技能', '地理百科'], { resolveExisting: vi.fn() });
    expect(result.results[0]).toMatchObject({ copy: 'created', binding: 'failed', reason: expect.stringContaining('宿主拒绝') });
    expect(result.results[1]).toMatchObject({ copy: 'created', binding: 'bound' });
  });

  it('群聊或没选角色卡时不做任何事', async () => {
    h.character = null;
    h.books.set('战斗技能', book({}));
    expect(await mountFavoriteWorldbooksToCurrentCharacter_ACU(['战斗技能'], { resolveExisting: vi.fn() })).toEqual({ ok: false, reason: 'no_character' });
    expect(h.saved).toHaveLength(0);
  });
});
