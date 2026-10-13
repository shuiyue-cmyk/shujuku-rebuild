/**
 * data/gateways/worldbook-file-gateway.ts — 整本世界书读写与角色卡附加世界书绑定（常用世界书挂载用）
 *
 * - 整本读写走 getContext().loadWorldInfo / saveWorldInfo（新名字保存即新建文件），保存后刷新宿主列表；
 * - 世界书名单读宿主实时列表（兼容层的设置快照带缓存，刚建的书会读不到）；
 * - 附加世界书绑定：有酒馆助手时用它的 rebindCharWorldbooks；否则经宿主内部世界书模块
 *   charUpdateAddAuxWorld 写入（见 host-world-info-module）。两条都走不通返回 'unavailable'，
 *   由调用方提示用户手动挂载。
 */
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { getHostWindow } from '../../shared/runtime-env';
import { loadVerifiedHostWorldInfoModule_ACU } from '../../shared/host-compat/host-world-info-module';
import { listLorebooks_ACU } from './worldbook-gateway';

export interface CurrentSingleCharacter_ACU {
    name: string;
    /** 角色头像文件名（宿主用它定位角色卡附加世界书）。 */
    avatar: string;
}

export type AuxWorldbookBindResult_ACU = 'bound' | 'already' | 'unavailable';

function context_ACU(): any {
    return SillyTavern_API_ACU as any;
}

/** 当前单人角色卡；群聊或未选角色返回 null。 */
export function getCurrentSingleCharacter_ACU(): CurrentSingleCharacter_ACU | null {
    const ctx = context_ACU();
    if (!ctx || (ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '')) return null;
    const character = Array.isArray(ctx.characters) ? ctx.characters[Number(ctx.characterId)] : null;
    const name = typeof character?.name === 'string' ? character.name.trim() : '';
    const avatar = typeof character?.avatar === 'string' ? character.avatar : '';
    return name && avatar ? { name, avatar } : null;
}

export async function listWorldbookNamesLive_ACU(): Promise<string[]> {
    const live = context_ACU()?.getWorldInfoNames?.();
    if (Array.isArray(live)) return live.map((name: unknown) => String(name));
    return listLorebooks_ACU();
}

/** 读整本世界书；不存在或宿主接口缺失返回 null。 */
export async function loadWorldbookFile_ACU(name: string): Promise<Record<string, any> | null> {
    const ctx = context_ACU();
    if (typeof ctx?.loadWorldInfo !== 'function') throw new Error('宿主不支持读取整本世界书。');
    const data = await ctx.loadWorldInfo(name);
    return data && typeof data === 'object' ? data : null;
}

/** 整本写入（同名覆盖，新名字即新建），并刷新宿主世界书列表。 */
export async function saveWorldbookFile_ACU(name: string, data: Record<string, any>): Promise<void> {
    const ctx = context_ACU();
    if (typeof ctx?.saveWorldInfo !== 'function') throw new Error('宿主不支持写入整本世界书。');
    await ctx.saveWorldInfo(name, data, true);
    if (typeof ctx.updateWorldInfoList === 'function') await ctx.updateWorldInfoList();
}

/** 把世界书挂成当前角色卡的附加世界书。 */
export async function addAuxWorldbookToCurrentCharacter_ACU(
    character: CurrentSingleCharacter_ACU,
    bookName: string,
): Promise<AuxWorldbookBindResult_ACU> {
    const helper: any = (getHostWindow() as any)?.TavernHelper;
    if (helper && typeof helper.rebindCharWorldbooks === 'function' && typeof helper.getCharWorldbookNames === 'function') {
        const current = await helper.getCharWorldbookNames('current');
        const additional: string[] = Array.isArray(current?.additional) ? current.additional : [];
        if (current?.primary === bookName || additional.includes(bookName)) return 'already';
        await helper.rebindCharWorldbooks('current', { primary: current?.primary ?? null, additional: [...additional, bookName] });
        return 'bound';
    }

    const mod = await loadVerifiedHostWorldInfoModule_ACU();
    if (!mod) return 'unavailable';
    const avatarBase = character.avatar.replace(/\.[^.]+$/, '');
    const readExtraBooks = (): string[] => {
        const charLore = Array.isArray(mod.world_info.charLore) ? mod.world_info.charLore : [];
        const entry = charLore.find(item => item?.name === avatarBase);
        return Array.isArray(entry?.extraBooks) ? entry!.extraBooks! : [];
    };
    if (readExtraBooks().includes(bookName)) return 'already';
    await mod.charUpdateAddAuxWorld(character.avatar, bookName);
    return readExtraBooks().includes(bookName) ? 'bound' : 'unavailable';
}
