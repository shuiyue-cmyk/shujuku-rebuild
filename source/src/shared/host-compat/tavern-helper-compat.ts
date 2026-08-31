/**
 * shared/host-compat/tavern-helper-compat.ts — TavernHelper 兼容适配器
 *
 * 对外暴露代码库消费的旧版扁平方法面（getLorebookEntries 等 13 个方法），
 * 内部逐方法按三级择优解析后端：
 * - passthrough：宿主对象上存在同名函数（旧版酒馆助手 iframe 全量 API，
 *   或新旧共用名如 getChatMessages/triggerSlash），直接透传——油猴模式行为零变化。
 * - mapped：宿主对象只有新版改名 API（getWorldbook/replaceWorldbook 系），
 *   包装参数与条目格式转换后调用。
 * - native：宿主完全没有酒馆助手，落到 SillyTavern 原生后端。
 *
 * generateRaw 没有原生等价实现：两级不中则不挂载该方法，
 * 保持"方法缺失"语义，让 isGenerateRawAvailable_ACU 等既有检查自然生效。
 */

import { logDebug_ACU } from '../utils';
import {
    newToOldEntry_ACU,
    oldPatchToNewPatch_ACU,
    type OldFlatLorebookEntry_ACU,
} from './entry-format';
import { createNativeStBackend_ACU, type GetStApi_ACU, type NativeStBackend_ACU } from './native-st-backend';

export type HostCapabilityBackend_ACU = 'passthrough' | 'mapped' | 'native' | 'missing';

export type HostCapabilityMap_ACU = Record<string, HostCapabilityBackend_ACU>;

export interface TavernHelperCompatResult_ACU {
    api: any;
    capabilities: HostCapabilityMap_ACU;
}

/** 最近一次构建的能力表，供初始化失败分支输出诊断 */
let lastCapabilities_ACU: HostCapabilityMap_ACU | null = null;

export function getLastHostCapabilities_ACU(): HostCapabilityMap_ACU | null {
    return lastCapabilities_ACU;
}

/** 生成人类可读的能力诊断文本（缺失项排前） */
export function formatHostCapabilities_ACU(capabilities: HostCapabilityMap_ACU | null): string {
    if (!capabilities) return '（能力表尚未生成）';
    const missing = Object.entries(capabilities).filter(([, backend]) => backend === 'missing').map(([name]) => name);
    const resolved = Object.entries(capabilities)
        .filter(([, backend]) => backend !== 'missing')
        .map(([name, backend]) => `${name}=${backend}`);
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`缺失: ${missing.join(', ')}`);
    if (resolved.length > 0) parts.push(`已解析: ${resolved.join(', ')}`);
    return parts.join('；') || '（空能力表）';
}

function hasFn_ACU(obj: any, name: string): boolean {
    return !!obj && typeof obj[name] === 'function';
}

/** 把新版嵌套 partial patch 合并进新版完整条目（保持未指定字段不变） */
function mergeNewEntryPatch_ACU(entry: any, patch: Record<string, any>): any {
    const merged: any = { ...entry };
    for (const [key, value] of Object.entries(patch)) {
        if (key === 'strategy' || key === 'position' || key === 'recursion' || key === 'effect') {
            const sub = { ...(entry?.[key] ?? {}), ...(value as Record<string, any>) };
            if (key === 'strategy' && (value as any)?.keys_secondary) {
                sub.keys_secondary = { ...(entry?.strategy?.keys_secondary ?? {}), ...(value as any).keys_secondary };
            }
            merged[key] = sub;
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/**
 * 构建 TavernHelper 兼容适配器。
 * @param rawTH 宿主环境探测到的原始 TavernHelper 对象（可能为 undefined）
 * @param getStApi 返回 SillyTavern context 的闭包（原生后端使用）
 */
export function buildTavernHelperCompat_ACU(rawTH: any, getStApi: GetStApi_ACU): TavernHelperCompatResult_ACU {
    const native: NativeStBackend_ACU = createNativeStBackend_ACU(getStApi);
    // 装配期一次性判定：resolve() 的挂载/删除决策与 capabilities 告警表同源，必须一致。
    // 前提是装配点在 ctx 就绪之后（entry-extension waitForAcuHostReady → mainInitialize 链已保证）。
    const nativeUsable = native.isUsable();
    const capabilities: HostCapabilityMap_ACU = {};

    // 先透传原始对象的全部属性（未在下方显式适配的方法保持原样）
    const api: any = { ...(rawTH && typeof rawTH === 'object' ? rawTH : {}) };

    /** 按 passthrough → mapped → native 择优挂载一个方法 */
    function resolve(
        name: string,
        mappedImpl: (() => (...args: any[]) => any) | null,
        nativeImpl: ((...args: any[]) => any) | null,
    ): void {
        if (hasFn_ACU(rawTH, name)) {
            api[name] = rawTH[name].bind(rawTH);
            capabilities[name] = 'passthrough';
            return;
        }
        if (mappedImpl) {
            const impl = mappedImpl();
            if (impl) {
                api[name] = impl;
                capabilities[name] = 'mapped';
                return;
            }
        }
        if (nativeImpl && nativeUsable) {
            api[name] = nativeImpl;
            capabilities[name] = 'native';
            return;
        }
        capabilities[name] = 'missing';
        delete api[name];
    }

    // ═══ 世界书条目 CRUD ═══

    resolve(
        'getLorebookEntries',
        () => hasFn_ACU(rawTH, 'getWorldbook')
            ? async (bookName: string): Promise<OldFlatLorebookEntry_ACU[]> => {
                const worldbook = await rawTH.getWorldbook(bookName);
                return (Array.isArray(worldbook) ? worldbook : []).map((entry: any, index: number) => newToOldEntry_ACU(entry, index));
            }
            : null,
        (bookName: string) => native.getLorebookEntries(bookName),
    );

    resolve(
        'setLorebookEntries',
        () => hasFn_ACU(rawTH, 'updateWorldbookWith')
            ? async (bookName: string, entries: Array<Record<string, any>>): Promise<void> => {
                if (!Array.isArray(entries) || entries.length === 0) return;
                const patchByUid = new Map<number, Record<string, any>>();
                for (const patch of entries) {
                    if (patch && patch.uid !== undefined && patch.uid !== null) {
                        patchByUid.set(Number(patch.uid), oldPatchToNewPatch_ACU(patch));
                    }
                }
                await rawTH.updateWorldbookWith(bookName, (worldbook: any[]) =>
                    worldbook.map(entry => {
                        const patch = patchByUid.get(Number(entry?.uid));
                        return patch ? mergeNewEntryPatch_ACU(entry, patch) : entry;
                    }),
                );
            }
            : null,
        (bookName: string, entries: Array<Record<string, any>>) => native.setLorebookEntries(bookName, entries),
    );

    resolve(
        'createLorebookEntries',
        () => hasFn_ACU(rawTH, 'createWorldbookEntries')
            ? async (bookName: string, entries: Array<Record<string, any>>): Promise<{ entries: OldFlatLorebookEntry_ACU[]; new_uids: number[] }> => {
                const payload = (Array.isArray(entries) ? entries : []).map(patch => oldPatchToNewPatch_ACU(patch ?? {}));
                const result = await rawTH.createWorldbookEntries(bookName, payload);
                const worldbook = Array.isArray(result?.worldbook) ? result.worldbook : [];
                const newEntries = Array.isArray(result?.new_entries) ? result.new_entries : [];
                return {
                    entries: worldbook.map((entry: any, index: number) => newToOldEntry_ACU(entry, index)),
                    new_uids: newEntries.map((entry: any) => Number(entry?.uid)).filter(Number.isFinite),
                };
            }
            : null,
        (bookName: string, entries: Array<Record<string, any>>) => native.createLorebookEntries(bookName, entries),
    );

    resolve(
        'deleteLorebookEntries',
        () => hasFn_ACU(rawTH, 'deleteWorldbookEntries')
            ? async (bookName: string, uids: number[]): Promise<{ entries: OldFlatLorebookEntry_ACU[]; delete_occurred: boolean }> => {
                const uidSet = new Set((Array.isArray(uids) ? uids : []).map(Number));
                const result = await rawTH.deleteWorldbookEntries(bookName, (entry: any) => uidSet.has(Number(entry?.uid)));
                const worldbook = Array.isArray(result?.worldbook) ? result.worldbook : [];
                const deleted = Array.isArray(result?.deleted_entries) ? result.deleted_entries : [];
                return {
                    entries: worldbook.map((entry: any, index: number) => newToOldEntry_ACU(entry, index)),
                    delete_occurred: deleted.length > 0,
                };
            }
            : null,
        (bookName: string, uids: number[]) => native.deleteLorebookEntries(bookName, uids),
    );

    // ═══ 世界书列表与角色绑定 ═══

    resolve(
        'getLorebooks',
        () => hasFn_ACU(rawTH, 'getWorldbookNames')
            ? () => rawTH.getWorldbookNames()
            : null,
        () => native.getLorebooks(),
    );

    resolve(
        'getCurrentCharPrimaryLorebook',
        () => hasFn_ACU(rawTH, 'getCharWorldbookNames')
            ? async (): Promise<string | null> => {
                const binding = await rawTH.getCharWorldbookNames('current');
                return typeof binding?.primary === 'string' && binding.primary ? binding.primary : null;
            }
            : null,
        () => native.getCurrentCharPrimaryLorebook(),
    );

    resolve(
        'getCharLorebooks',
        () => hasFn_ACU(rawTH, 'getCharWorldbookNames')
            ? async (options: { name?: string; type?: 'all' | 'primary' | 'additional' } = {}): Promise<{ primary: string | null; additional: string[] }> => {
                const binding = await rawTH.getCharWorldbookNames(options?.name ?? 'current');
                const primary = typeof binding?.primary === 'string' && binding.primary ? binding.primary : null;
                const additional = Array.isArray(binding?.additional) ? binding.additional : [];
                const type = options?.type ?? 'all';
                if (type === 'primary') return { primary, additional: [] };
                if (type === 'additional') return { primary: null, additional };
                return { primary, additional };
            }
            : null,
        (options?: { name?: string; type?: 'all' | 'primary' | 'additional' }) => native.getCharLorebooks(options),
    );

    resolve(
        'getCharWorldbookNames',
        // 宿主只有旧版 getCharLorebooks 时反向映射为新版签名
        () => hasFn_ACU(rawTH, 'getCharLorebooks')
            ? async (characterName: string): Promise<{ primary: string | null; additional: string[] }> => {
                const options = characterName && characterName !== 'current' ? { name: characterName, type: 'all' as const } : { type: 'all' as const };
                const binding = await rawTH.getCharLorebooks(options);
                return {
                    primary: typeof binding?.primary === 'string' && binding.primary ? binding.primary : null,
                    additional: Array.isArray(binding?.additional) ? binding.additional : [],
                };
            }
            : null,
        (characterName?: string) => native.getCharWorldbookNames(characterName),
    );

    // ═══ 聊天 / Slash / 角色数据（新旧酒馆助手同名，直接透传或原生兜底） ═══

    resolve('getChatMessages', null, (range?: string | number, options?: any) => native.getChatMessages(range, options));
    resolve('getLastMessageId', null, () => native.getLastMessageId());
    resolve('triggerSlash', null, (command: string) => native.triggerSlash(command));
    resolve('getCharData', null, (target?: string) => native.getCharData(target));

    // generateRaw：原生 context 无等价实现，仅透传，缺失时保持缺失语义
    resolve('generateRaw', null, null);

    lastCapabilities_ACU = capabilities;
    logDebug_ACU(`[HostCompat] TavernHelper 兼容适配器已构建：${formatHostCapabilities_ACU(capabilities)}`);
    return { api, capabilities };
}
