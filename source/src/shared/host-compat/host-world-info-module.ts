/**
 * shared/host-compat/host-world-info-module.ts — 宿主内部世界书模块（scripts/world-info.js）加载器
 *
 * 角色卡「附加世界书」的绑定（world_info.charLore）不在 getContext() 里，只能经宿主内部模块的
 * charUpdateAddAuxWorld 写入。TT 的核心脚本不打包、按原路径直接提供（rspack 只打包第三方库），
 * 所以按宿主实际加载的同一地址 import 会拿到同一个模块实例（模块按 URL 只执行一次）。
 *
 * 安全约束：
 * - 只在插件与宿主同一窗口时加载（不同窗口 import 会再执行一份宿主模块）；
 * - 地址优先取宿主真实加载过的资源地址，取不到再按页面基址拼；
 * - 加载后必须与 getContext().loadWorldInfo 是同一个函数，否则视为不是宿主那份实例，弃用。
 * 任一条件不满足都返回 null，由调用方降级（例如提示用户手动挂载）。
 *
 * 与 worldbook-gateway 里读激活世界书用的 loadHostWorldInfoModule_ACU 是同一宿主模块；
 * 那边只读、失败可降级，这里要写宿主状态，所以多一道身份核对，两者不合并。
 */
import { getHostWindow } from '../runtime-env';
import { logWarn_ACU } from '../utils';

export interface HostWorldInfoModule_ACU {
    world_info: { charLore?: Array<{ name: string; extraBooks?: string[] }> } & Record<string, any>;
    charUpdateAddAuxWorld: (characterKey: string, nameOrNames: string | string[]) => Promise<void> | void;
    loadWorldInfo: (...args: any[]) => any;
}

const MODULE_PATH_ACU = 'scripts/world-info.js';

let loadingPromise_ACU: Promise<HostWorldInfoModule_ACU | null> | null = null;
let verifiedModule_ACU: HostWorldInfoModule_ACU | null = null;

/** 供测试替换真实的动态 import。 */
let importModule_ACU: (url: string) => Promise<any> = url => import(/* webpackIgnore: true */ url);

export function __setHostWorldInfoModuleImporterForTests_ACU(importer: ((url: string) => Promise<any>) | null): void {
    importModule_ACU = importer || (url => import(/* webpackIgnore: true */ url));
    loadingPromise_ACU = null;
    verifiedModule_ACU = null;
}

/** 宿主实际加载 world-info.js 用的地址：先查资源加载记录，没有再按页面基址拼。 */
export function resolveHostWorldInfoModuleUrl_ACU(win: any): string | null {
    try {
        const entries = typeof win?.performance?.getEntriesByType === 'function'
            ? win.performance.getEntriesByType('resource')
            : [];
        const loaded = (Array.isArray(entries) ? entries : [])
            .map((entry: any) => String(entry?.name || ''))
            .find(name => /\/scripts\/world-info\.js(?:[?#]|$)/.test(name));
        if (loaded) return loaded;
        const base = win?.document?.baseURI;
        return base ? new URL(MODULE_PATH_ACU, base).href : null;
    } catch {
        return null;
    }
}

function isSameRealmAsHost_ACU(): boolean {
    try {
        return typeof window !== 'undefined' && getHostWindow() === window;
    } catch {
        return false;
    }
}

/** 加载并校验宿主世界书模块；不满足安全约束或加载失败返回 null（失败后允许下次重试）。 */
export function loadVerifiedHostWorldInfoModule_ACU(): Promise<HostWorldInfoModule_ACU | null> {
    if (verifiedModule_ACU) return Promise.resolve(verifiedModule_ACU);
    if (loadingPromise_ACU) return loadingPromise_ACU;
    loadingPromise_ACU = (async (): Promise<HostWorldInfoModule_ACU | null> => {
        if (!isSameRealmAsHost_ACU()) {
            logWarn_ACU('[HostWorldInfoModule] 插件与宿主不在同一窗口，不加载宿主世界书模块。');
            return null;
        }
        const win: any = getHostWindow();
        const url = resolveHostWorldInfoModuleUrl_ACU(win);
        if (!url) return null;
        const mod = await importModule_ACU(url);
        const contextLoad = win?.SillyTavern?.getContext?.()?.loadWorldInfo;
        const valid = mod && typeof mod.charUpdateAddAuxWorld === 'function'
            && mod.world_info && typeof mod.world_info === 'object'
            && typeof mod.loadWorldInfo === 'function'
            && mod.loadWorldInfo === contextLoad;
        if (!valid) {
            logWarn_ACU('[HostWorldInfoModule] 加载到的世界书模块不是宿主正在使用的那一份，弃用。');
            return null;
        }
        verifiedModule_ACU = mod as HostWorldInfoModule_ACU;
        return verifiedModule_ACU;
    })().catch((error): null => {
        logWarn_ACU('[HostWorldInfoModule] 加载宿主世界书模块失败：', error);
        return null;
    }).then((result): HostWorldInfoModule_ACU | null => {
        if (!result) loadingPromise_ACU = null;
        return result;
    });
    return loadingPromise_ACU;
}

/** 已加载并校验过的宿主模块（同步读取，未加载过返回 null）。 */
export function getVerifiedHostWorldInfoModule_ACU(): HostWorldInfoModule_ACU | null {
    return verifiedModule_ACU;
}
