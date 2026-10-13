/**
 * 整本世界书读写与角色卡附加世界书绑定。
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ctx: null as any, hostModule: null as any }));
vi.mock('../../../src/shared/host-api', () => ({ get SillyTavern_API_ACU() { return h.ctx; } }));
vi.mock('../../../src/shared/host-compat/host-world-info-module', () => ({ loadVerifiedHostWorldInfoModule_ACU: async () => h.hostModule }));
vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({ listLorebooks_ACU: async () => ['兜底列表'] }));

import {
  addAuxWorldbookToCurrentCharacter_ACU,
  getCurrentSingleCharacter_ACU,
  listWorldbookNamesLive_ACU,
  saveWorldbookFile_ACU,
} from '../../../src/data/gateways/worldbook-file-gateway';

const erin = { name: '艾琳', avatar: 'Erin.png' };

beforeEach(() => {
  h.ctx = {
    characters: [{ name: '艾琳', avatar: 'Erin.png' }],
    characterId: '0',
    getWorldInfoNames: () => ['战斗技能'],
    saveWorldInfo: vi.fn(async () => undefined),
    updateWorldInfoList: vi.fn(async () => undefined),
  };
  h.hostModule = null;
});
afterEach(() => { delete (window as any).TavernHelper; });

describe('当前角色卡', () => {
  it('单人聊天返回角色名与头像；群聊或未选角色返回 null', () => {
    expect(getCurrentSingleCharacter_ACU()).toEqual(erin);
    h.ctx.groupId = 'g1';
    expect(getCurrentSingleCharacter_ACU()).toBeNull();
    h.ctx.groupId = undefined;
    h.ctx.characterId = undefined;
    expect(getCurrentSingleCharacter_ACU()).toBeNull();
  });
});

describe('整本读写', () => {
  it('名单读宿主实时列表，缺接口时才用兼容层', async () => {
    expect(await listWorldbookNamesLive_ACU()).toEqual(['战斗技能']);
    delete h.ctx.getWorldInfoNames;
    expect(await listWorldbookNamesLive_ACU()).toEqual(['兜底列表']);
  });

  it('立即保存并刷新宿主世界书列表', async () => {
    await saveWorldbookFile_ACU('艾琳-战斗技能', { entries: {} });
    expect(h.ctx.saveWorldInfo).toHaveBeenCalledWith('艾琳-战斗技能', { entries: {} }, true);
    expect(h.ctx.updateWorldInfoList).toHaveBeenCalledTimes(1);
  });
});

describe('挂成附加世界书', () => {
  it('有酒馆助手时用它重新绑定，保留原主世界书与附加书', async () => {
    const helper = {
      getCharWorldbookNames: vi.fn(async () => ({ primary: '艾琳自带', additional: ['旧附加'] })),
      rebindCharWorldbooks: vi.fn(async () => undefined),
    };
    (window as any).TavernHelper = helper;
    expect(await addAuxWorldbookToCurrentCharacter_ACU(erin, '艾琳-战斗技能')).toBe('bound');
    expect(helper.rebindCharWorldbooks).toHaveBeenCalledWith('current', { primary: '艾琳自带', additional: ['旧附加', '艾琳-战斗技能'] });

    helper.getCharWorldbookNames.mockResolvedValueOnce({ primary: '艾琳自带', additional: ['艾琳-战斗技能'] });
    expect(await addAuxWorldbookToCurrentCharacter_ACU(erin, '艾琳-战斗技能')).toBe('already');
  });

  it('没有酒馆助手时经宿主世界书模块挂上，并核对确实挂上了', async () => {
    const charLore: any[] = [{ name: 'Erin', extraBooks: ['旧附加'] }];
    h.hostModule = {
      world_info: { charLore },
      charUpdateAddAuxWorld: vi.fn(async (_avatar: string, name: string) => { charLore[0].extraBooks.push(name); }),
    };
    expect(await addAuxWorldbookToCurrentCharacter_ACU(erin, '艾琳-战斗技能')).toBe('bound');
    expect(h.hostModule.charUpdateAddAuxWorld).toHaveBeenCalledWith('Erin.png', '艾琳-战斗技能');
    expect(await addAuxWorldbookToCurrentCharacter_ACU(erin, '艾琳-战斗技能')).toBe('already');
  });

  it('宿主模块调用后没真正挂上、或模块不可用时返回 unavailable', async () => {
    h.hostModule = { world_info: { charLore: [] }, charUpdateAddAuxWorld: vi.fn(async () => undefined) };
    expect(await addAuxWorldbookToCurrentCharacter_ACU(erin, '艾琳-战斗技能')).toBe('unavailable');
    h.hostModule = null;
    expect(await addAuxWorldbookToCurrentCharacter_ACU(erin, '艾琳-战斗技能')).toBe('unavailable');
  });
});
