/**
 * 常用世界书面板逻辑：名单增删、状态刷新、挂载时逐本询问已存在的副本、汇总提示。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  favorites: [] as string[],
  allNames: [] as string[],
  character: { name: '艾琳', avatar: 'Erin.png' } as any,
  mount: vi.fn(),
  status: vi.fn(async (bookName: string) => ({ bookName, exists: true, candidateCount: 3, skilledCount: 3 })),
  choose: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../src/service/agent/agent-favorite-worldbooks', () => ({
  readFavoriteWorldbookNames_ACU: () => [...h.favorites],
  writeFavoriteWorldbookNames_ACU: (names: string[]) => { h.favorites = [...new Set(names)]; return [...h.favorites]; },
  readFavoriteWorldbookSkillStatus_ACU: (name: string) => h.status(name),
  mountFavoriteWorldbooksToCurrentCharacter_ACU: (...args: any[]) => h.mount(...args),
  buildMountedWorldbookName_ACU: (c: string, b: string) => `${c}-${b}`,
}));
vi.mock('../../../src/data/gateways/worldbook-file-gateway', () => ({
  getCurrentSingleCharacter_ACU: () => h.character,
  listWorldbookNamesLive_ACU: async () => [...h.allNames],
}));
vi.mock('../../../src/presentation-v2/stores/dialog-store', () => ({ useDialogStore: () => ({ choose: h.choose }) }));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({ useToastStore: () => h.toast }));

import { useFavoriteWorldbooks } from '../../../src/presentation-v2/composables/useFavoriteWorldbooks';

beforeEach(() => {
  h.favorites = ['战斗技能'];
  h.allNames = ['战斗技能', '地理百科', '艾琳自带'];
  h.character = { name: '艾琳', avatar: 'Erin.png' };
  h.mount.mockReset();
  h.status.mockClear();
  h.choose.mockReset();
  Object.values(h.toast).forEach(fn => fn.mockClear());
});

describe('useFavoriteWorldbooks', () => {
  it('刷新：读名单、当前角色卡、各本 skill 状态；可添加的书排除已在名单里的', async () => {
    const fav = useFavoriteWorldbooks({ skillifyBooks: vi.fn() });
    await fav.refresh();
    expect(fav.favorites.value).toEqual(['战斗技能']);
    expect(fav.characterName.value).toBe('艾琳');
    expect(fav.statuses.value['战斗技能']).toMatchObject({ candidateCount: 3, skilledCount: 3 });
    expect(fav.addableNames.value).toEqual(['地理百科', '艾琳自带']);
  });

  it('添加与移出常用书；移出时也从待挂载勾选里去掉', async () => {
    const fav = useFavoriteWorldbooks({ skillifyBooks: vi.fn() });
    await fav.refresh();
    await fav.add('地理百科');
    expect(h.favorites).toEqual(['战斗技能', '地理百科']);
    expect(fav.statuses.value['地理百科']).toBeDefined();
    fav.toggleSelected('地理百科', true);
    fav.remove('地理百科');
    expect(h.favorites).toEqual(['战斗技能']);
    expect(fav.selected.value).toEqual([]);
  });

  it('挂载：副本已存在时弹三选一，取消按跳过；全部挂上后提示成功并清空勾选', async () => {
    h.choose.mockResolvedValueOnce(null);
    h.mount.mockImplementation(async (_names: string[], options: any) => {
      expect(await options.resolveExisting('艾琳-战斗技能', '战斗技能')).toBe('skip');
      return { ok: true, characterName: '艾琳', results: [
        { sourceName: '战斗技能', targetName: '艾琳-战斗技能', copy: 'created', binding: 'bound' },
      ] };
    });
    const fav = useFavoriteWorldbooks({ skillifyBooks: vi.fn() });
    await fav.refresh();
    fav.toggleSelected('战斗技能', true);

    expect(await fav.mountSelected()).toBe(true);

    const dialogArg = h.choose.mock.calls[0][0];
    expect(dialogArg.message).toContain('艾琳-战斗技能');
    expect(dialogArg.actions.map((action: any) => action.value)).toEqual(['keep', 'overwrite', 'skip']);
    expect(h.toast.success).toHaveBeenCalledWith(expect.stringContaining('艾琳-战斗技能'), expect.anything());
    expect(fav.selected.value).toEqual([]);
  });

  it('挂载接口不可用或失败时如实提示需要手动挂载 / 失败原因', async () => {
    h.mount.mockResolvedValue({ ok: true, characterName: '艾琳', results: [
      { sourceName: '战斗技能', targetName: '艾琳-战斗技能', copy: 'created', binding: 'unavailable' },
      { sourceName: '地理百科', targetName: '艾琳-地理百科', copy: 'failed', binding: 'not_attempted', reason: '找不到常用世界书「地理百科」' },
    ] });
    const fav = useFavoriteWorldbooks({ skillifyBooks: vi.fn() });
    await fav.refresh();
    fav.toggleSelected('战斗技能', true);
    fav.toggleSelected('地理百科', true);

    await fav.mountSelected();

    const text = h.toast.warning.mock.calls.map(call => call[0]).join('\n');
    expect(text).toContain('手动');
    expect(text).toContain('艾琳-战斗技能');
    expect(text).toContain('找不到常用世界书「地理百科」');
  });

  it('没勾选或不是单人角色卡时不挂载', async () => {
    const fav = useFavoriteWorldbooks({ skillifyBooks: vi.fn() });
    await fav.refresh();
    expect(await fav.mountSelected()).toBe(false);
    expect(h.mount).not.toHaveBeenCalled();

    h.character = null;
    await fav.refresh();
    fav.toggleSelected('战斗技能', true);
    expect(fav.canMount.value).toBe(false);
    expect(await fav.mountSelected()).toBe(false);
    expect(h.mount).not.toHaveBeenCalled();
  });

  it('skill 化一本常用书后刷新它的状态', async () => {
    const skillifyBooks = vi.fn(async () => true);
    const fav = useFavoriteWorldbooks({ skillifyBooks });
    await fav.refresh();
    h.status.mockClear();
    await fav.skillify('战斗技能');
    expect(skillifyBooks).toHaveBeenCalledWith(['战斗技能']);
    expect(h.status).toHaveBeenCalledWith('战斗技能');
  });
});
