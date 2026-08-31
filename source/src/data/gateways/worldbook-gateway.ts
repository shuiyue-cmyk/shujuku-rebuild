/**
 * data/gateways/worldbook-gateway.ts — 世界书 CRUD 操作网关
 *
 * 封装 TavernHelper_API_ACU / SillyTavern_API_ACU 的世界书相关方法。
 * service 层通过本模块访问世界书，不再直接调用宿主 API。
 *
 * 所有方法内置存在性检查，宿主 API 不可用时返回安全默认值。
 */

import { TavernHelper_API_ACU, SillyTavern_API_ACU } from '../../shared/host-api';
import { getCharLorebooks_ACU, getCurrentCharacterWorldbookBinding_ACU } from './character-gateway';
import { logWarn_ACU } from '../../shared/utils';
import { isExtensionMode } from '../../shared/runtime-env';
import { classifyLorebookReadError_ACU } from '../../shared/lorebook-read-error';
import { nativeToOldEntry_ACU } from '../../shared/host-compat/entry-format';

// ═══ 可用性检查 ═══

/**
 * 检查 TavernHelper 世界书 API 是否可用
 */
export function isWorldbookApiAvailable_ACU(): boolean {
    return !!(TavernHelper_API_ACU && typeof TavernHelper_API_ACU.getLorebookEntries === 'function');
}

// ═══ 条目 CRUD ═══

// 不可见格式字符：零宽/方向控制/连接符/BOM + 变体选择器（U+FE00–U+FE0F）
// 与补充变体选择器（U+E0100–U+E01EF，UTF-16 下为 \uDB40\uDD00–\uDB40\uDDEF）。
const LOREBOOK_NAME_IGNORABLE_CHARS_ACU =
  /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uFE00-\uFE0F]|\uDB40[\uDD00-\uDDEF]/g;

/**
 * 仅用于世界书名称比对，不可替代宿主保存的原始名称。
 * 兼容复制粘贴常见的全角字符、组合字符、不可见控制字符与异常空白。
 */
export function normalizeLorebookNameForMatch_ACU(value: unknown): string {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(LOREBOOK_NAME_IGNORABLE_CHARS_ACU, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getLorebookListItemRawName_ACU(item: unknown): string {
    if (item && typeof item === 'object') return String((item as any).name ?? '');
    return String(item ?? '');
}

/**
 * 将配置/绑定中的名称解析为宿主列表里的真实名称。
 *
 * 必须返回宿主列表中的原始名称（不 trim、不归一化）：宿主按原始名索引世界书，
 * 名称带首尾空格或不可见字符时，返回 trim 结果会导致后续宿主调用 not-found。
 * trim/归一化只用于构造匹配键。多个名称在同一匹配通道冲突时拒绝猜测，
 * 避免读写到错误世界书。
 */
export function resolveLorebookNameFromList_ACU(requestedName: unknown, bookList: unknown): string | null {
    const requestedRaw = String(requestedName ?? '');
    const requested = requestedRaw.trim();
    if (!requested || !Array.isArray(bookList)) return null;
    const availableNames = bookList.map(getLorebookListItemRawName_ACU).filter(name => name.trim());
    // 字节级精确命中：请求本身就是宿主列表里的原始名
    if (availableNames.includes(requestedRaw)) return requestedRaw;
    // trim 精确命中：返回宿主原始名；trim 后同名的多本书属于歧义，拒绝猜测
    const trimmedMatches = availableNames.filter(name => name.trim() === requested);
    if (trimmedMatches.length === 1) return trimmedMatches[0];
    if (trimmedMatches.length > 1) return null;

    const matchKey = normalizeLorebookNameForMatch_ACU(requested);
    if (!matchKey) return null;
    const normalizedMatches = availableNames.filter(name => normalizeLorebookNameForMatch_ACU(name) === matchKey);
    return normalizedMatches.length === 1 ? normalizedMatches[0] : null;
}

function normalizeLorebookEntryTextField_ACU(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * 归一化宿主读取到的世界书条目文本字段。
 *
 * 宿主数据属于不受信输入：非字符串 comment/name 必须按既有 agent 元数据逻辑
 * 收敛为空串，而不是 String(value)。后者会让读取侧的异常值进入后续写回路径。
 * 仅在实际需要修正时浅拷贝，避免修改宿主可能复用的原始对象。
 */
export function normalizeLorebookEntriesForRead_ACU(entries: unknown, bookName = ''): any[] {
    if (!Array.isArray(entries)) return [];
    const normalizedFields: Array<{ uid: unknown; field: 'comment' | 'name'; sourceType: string }> = [];
    const normalizedEntries = entries.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const source = entry as Record<string, any>;
        const patch: Record<string, string> = {};
        for (const field of ['comment', 'name'] as const) {
            if (!(field in source) || typeof source[field] === 'string') continue;
            patch[field] = normalizeLorebookEntryTextField_ACU(source[field]);
            normalizedFields.push({ uid: source.uid, field, sourceType: typeof source[field] });
        }
        return Object.keys(patch).length > 0 ? { ...source, ...patch } : entry;
    });

    if (normalizedFields.length > 0) {
        logWarn_ACU('[WorldbookGateway] 已归一化宿主返回的非字符串世界书条目文本字段。', {
            phase: 'normalize_entry_text_field',
            bookName,
            normalizedFields,
        });
    }
    return normalizedEntries;
}

/**
 * 获取指定世界书的所有条目
 * @param bookName 世界书名称
 * @returns 条目数组，API 不可用时返回 []
 */
export async function getLorebookEntries_ACU(bookName: string): Promise<any[]> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] getLorebookEntries 不可用，返回空数组');
        return [];
    }
    try {
        return normalizeLorebookEntriesForRead_ACU(await TavernHelper_API_ACU.getLorebookEntries(bookName), bookName);
    } catch (error) {
        if (!isLorebookNotFoundError_ACU(error)) throw error;
        let resolvedName: string | null = null;
        try {
            resolvedName = resolveLorebookNameFromList_ACU(bookName, await listLorebooks_ACU());
        } catch {
            // 名称恢复是补救路径；列表读取失败时必须保留原始宿主错误。
        }
        if (!resolvedName || resolvedName === bookName) throw error;
        logWarn_ACU('[WorldbookGateway] 世界书名称存在 Unicode 或不可见字符差异，使用宿主真实名称重试读取。', {
            phase: 'resolve_lorebook_name',
            requestedName: bookName,
            resolvedName,
        });
        try {
            return normalizeLorebookEntriesForRead_ACU(await TavernHelper_API_ACU.getLorebookEntries(resolvedName), resolvedName);
        } catch (retryError) {
            // 保留第一次宿主 not-found 错误的分类与堆栈，同时附带恢复失败证据。
            // 直接抛 retryError 会让调用方误以为首次故障就是网络/权限问题。
            try {
                Object.defineProperties(error as object, {
                    lorebookResolvedName: { value: resolvedName, configurable: true },
                    lorebookRetryError: { value: retryError, configurable: true },
                });
            } catch {
                // 极少数不可扩展错误对象无法附加诊断；输出脱敏结构化日志并保留原始错误。
                logWarn_ACU('[WorldbookGateway] 世界书真实名称重试失败，原始错误对象不可扩展。', {
                    phase: 'retry_resolved_lorebook_name',
                    requestedName: bookName,
                    resolvedName,
                    error: { category: 'read_failed' },
                });
            }
            throw error;
        }
    }
}

export function isLorebookNotFoundError_ACU(error: unknown): boolean {
    return classifyLorebookReadError_ACU(error) === 'lorebook_not_found';
}

/**
 * 关键路径（strict/preflight）专用：宿主 API 缺失时必须失败关闭，不允许静默成功。
 * 仅 strict pipeline 与清绿灯预检使用；不改变现有宽松 CRUD 语义。
 */
export class WorldbookHostApiUnavailableError_ACU extends Error {
    readonly operation: 'get_entries' | 'set_entries' | 'delete_entries';
    constructor(operation: 'get_entries' | 'set_entries' | 'delete_entries') {
        super(`WorldbookHostApiUnavailable:${operation}`);
        this.name = 'WorldbookHostApiUnavailableError_ACU';
        this.operation = operation;
    }
}

function requireTavernHelperApi_ACU(operation: 'get_entries' | 'set_entries' | 'delete_entries', method: 'getLorebookEntries' | 'setLorebookEntries' | 'deleteLorebookEntries'): void {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU[method] !== 'function') {
        throw new WorldbookHostApiUnavailableError_ACU(operation);
    }
}

/**
 * required read：宿主 API 缺失抛命名错误；仍复用 Unicode/不可见字符真实名称恢复逻辑。
 */
export async function getLorebookEntriesRequired_ACU(bookName: string): Promise<any[]> {
    requireTavernHelperApi_ACU('get_entries', 'getLorebookEntries');
    try {
        return normalizeLorebookEntriesForRead_ACU(await TavernHelper_API_ACU.getLorebookEntries(bookName), bookName);
    } catch (error) {
        if (!isLorebookNotFoundError_ACU(error)) throw error;
        let resolvedName: string | null = null;
        try {
            resolvedName = resolveLorebookNameFromList_ACU(bookName, await listLorebooks_ACU());
        } catch {
            // 名称恢复是补救路径；列表读取失败时必须保留原始宿主错误。
        }
        if (!resolvedName || resolvedName === bookName) throw error;
        try {
            return normalizeLorebookEntriesForRead_ACU(await TavernHelper_API_ACU.getLorebookEntries(resolvedName), resolvedName);
        } catch (retryError) {
            try {
                Object.defineProperties(error as object, {
                    lorebookResolvedName: { value: resolvedName, configurable: true },
                    lorebookRetryError: { value: retryError, configurable: true },
                });
            } catch {
                logWarn_ACU('[WorldbookGateway] required 世界书真实名称重试失败，原始错误对象不可扩展。', {
                    phase: 'retry_resolved_lorebook_name',
                    requestedName: bookName,
                    resolvedName,
                    error: { category: 'read_failed' },
                });
            }
            throw error;
        }
    }
}

/**
 * required set/delete：宿主 API 缺失抛命名错误，不允许静默成功。
 */
export async function setLorebookEntriesRequired_ACU(bookName: string, entries: any[]): Promise<void> {
    requireTavernHelperApi_ACU('set_entries', 'setLorebookEntries');
    await TavernHelper_API_ACU.setLorebookEntries(bookName, entries);
}

export async function deleteLorebookEntriesRequired_ACU(bookName: string, uids: any[]): Promise<void> {
    requireTavernHelperApi_ACU('delete_entries', 'deleteLorebookEntries');
    await TavernHelper_API_ACU.deleteLorebookEntries(bookName, uids);
}

/**
 * 更新指定世界书中的条目
 * @param bookName 世界书名称
 * @param entries 要更新的条目数组（需包含 uid）
 */
export async function setLorebookEntries_ACU(bookName: string, entries: any[]): Promise<void> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.setLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] setLorebookEntries 不可用，跳过');
        return;
    }
    await TavernHelper_API_ACU.setLorebookEntries(bookName, entries);
}

/**
 * 在指定世界书中创建新条目
 * @param bookName 世界书名称
 * @param entries 要创建的条目数组
 */
export async function createLorebookEntries_ACU(bookName: string, entries: any[]): Promise<void> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.createLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] createLorebookEntries 不可用，跳过');
        return;
    }
    await TavernHelper_API_ACU.createLorebookEntries(bookName, entries);
}

/**
 * 删除指定世界书中的条目
 * @param bookName 世界书名称
 * @param uids 要删除的条目 UID 数组
 */
export async function deleteLorebookEntries_ACU(bookName: string, uids: any[]): Promise<void> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.deleteLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] deleteLorebookEntries 不可用，跳过');
        return;
    }
    await TavernHelper_API_ACU.deleteLorebookEntries(bookName, uids);
}

// ═══ 世界书列表 ═══

/**
 * 获取所有可用的世界书列表
 * 优先使用 TavernHelper_API_ACU.getLorebooks()，
 * 降级使用 SillyTavern_API_ACU.getWorldBooks()
 * @returns 世界书名称数组，不可用时返回 []
 */
export async function listLorebooks_ACU(): Promise<string[]> {
    // 优先尝试 TavernHelper（无酒馆助手时由 host-compat 适配器提供原生实现）
    if (TavernHelper_API_ACU && typeof TavernHelper_API_ACU.getLorebooks === 'function') {
        return await TavernHelper_API_ACU.getLorebooks();
    }
    // 降级到 SillyTavern_API
    if (SillyTavern_API_ACU && typeof SillyTavern_API_ACU.getWorldBooks === 'function') {
        return await SillyTavern_API_ACU.getWorldBooks();
    }
    // 第三级：TT/ST 原生 context.getWorldInfoNames()（st-context.js 直接返回 string[] 快照）。
    // 油猴模式下 SillyTavern_API_ACU 是酒馆助手扁平 API，无此方法时自然跳过。
    try {
        const nativeNames = (SillyTavern_API_ACU as any)?.getWorldInfoNames?.();
        if (Array.isArray(nativeNames)) {
            return nativeNames.map((name: unknown) => String(name));
        }
    } catch (error) {
        logWarn_ACU('[WorldbookGateway] 原生 getWorldInfoNames 调用失败，世界书列表降级为空');
    }
    logWarn_ACU('[WorldbookGateway] listLorebooks 不可用，返回空数组');
    return [];
}

/**
 * 获取所有可用的世界书列表（SillyTavern_API_ACU.getWorldBooks 的直接封装）
 * 用于需要明确调用 SillyTavern 侧 API 的场景
 * @returns 世界书名称数组，不可用时返回 []
 */
export async function getWorldBooks_ACU(): Promise<string[]> {
    if (SillyTavern_API_ACU && typeof SillyTavern_API_ACU.getWorldBooks === 'function') {
        return await SillyTavern_API_ACU.getWorldBooks();
    }
    logWarn_ACU('[WorldbookGateway] getWorldBooks 不可用，返回空数组');
    return [];
}

/**
 * 无酒馆助手时的原生条目读取：经 SillyTavern context.loadWorldInfo 逐本读整本书，
 * 返回 {name, entries} 形状（entries 为旧版扁平条目，与 TavernHelper.getLorebookEntries 一致）。
 *
 * getWorldBooks_ACU 在 TT 裸环境恒为 []（getContext 不导出 getWorldBooks），且返回的是
 * string[] 名称列表而非 {name, entries}，不能作为条目来源；本函数补上真正的读取通道。
 * loadWorldInfo 不可用或单本读取失败时跳过该书，不影响其它书。
 */
export async function getWorldBooksWithEntriesViaNative_ACU(bookNames: string[]): Promise<Array<{ name: string; entries: any[] }>> {
    const loadWorldInfo = (SillyTavern_API_ACU as any)?.loadWorldInfo;
    if (typeof loadWorldInfo !== 'function') {
        logWarn_ACU('[WorldbookGateway] 原生 loadWorldInfo 不可用，世界书条目无可用来源');
        return [];
    }
    // 宿主书名不得 trim（:50-57 契约）：带首尾空格的真实书名 trim 后 loadWorldInfo 必 not-found 静默丢书
    const names = (Array.isArray(bookNames) ? bookNames : [])
        .map(name => String(name ?? ''))
        .filter(name => name !== '');
    const books: Array<{ name: string; entries: any[] }> = [];
    for (const name of [...new Set(names)]) {
        try {
            const data = await loadWorldInfo(name);
            const entriesDict = data?.entries;
            if (!entriesDict || typeof entriesDict !== 'object') continue;
            books.push({
                name,
                entries: Object.keys(entriesDict).map(uid => nativeToOldEntry_ACU({ uid, ...entriesDict[uid] })),
            });
        } catch (error) {
            logWarn_ACU('[WorldbookGateway] 原生 loadWorldInfo 读取单本世界书失败，跳过该书。', {
                phase: 'native_load_worldbook',
                bookName: name,
                error: { category: 'read_failed' },
            });
        }
    }
    return books;
}

// ═══ 角色绑定世界书 ═══

/**
 * 获取当前角色的主绑定世界书名称
 * @returns 世界书名称，不可用时返回 null
 */
/**
 * 获取「正文实际能接收到的」激活世界书名称（聊天级全局激活书，不依赖角色卡绑定）。
 * 激活书探测口径（源自 biotracker 插件时代的探测链，vendor 已删除、语义保留）：
 * selected_world_info + world_info.globalSelect +
 * 页面 #world_info 多选框 + TavernHelper.getLorebookSettings。
 * 填表「正文接收」来源（active）用；正文生成时这些书会被注入，角色卡绑定关系读不到。
 *
 * 注意：这四条全局探测只对 ST 时代环境（window 上确有这些全局）有效；
 * TT 裸环境下它们是 ES module 导出，只能经 getActiveGlobalWorldbookNamesAsync_ACU 的动态 import 读到。
 * @returns 去重后的激活世界书名称数组
 */
export function getActiveGlobalWorldbookNames_ACU(): string[] {
  const names: string[] = [];
  const push = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const name = String(item ?? '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
  };
  const g = globalThis as any;
  try { push(g?.selected_world_info); } catch { /* ignore */ }
  try { push(g?.world_info?.globalSelect); } catch { /* ignore */ }
  try { push(g?.world_info_settings?.world_info?.globalSelect); } catch { /* ignore */ }
  try { push(g?.power_user?.world_info?.globalSelect); } catch { /* ignore */ }
  try {
    const select: any = typeof document !== 'undefined' ? document.querySelector?.('#world_info') : null;
    if (select?.selectedOptions) {
      push(Array.from(select.selectedOptions).map((o: any) => o.textContent || o.label || o.value));
    }
  } catch { /* ignore */ }
  return [...new Set(names.filter(Boolean))];
}

// ═══ 激活世界书：宿主 ES module 通道（TT/ST 裸环境） ═══

/**
 * 宿主 world-info 模块 URL。
 * 用变量说明符而非字面量：rollup/vite 无法静态分析，保留为运行时原生 dynamic import，
 * 避免打包器把酒馆宿主模块当成本地依赖去解析（构建期必然找不到该路径）。
 */
const WORLD_INFO_MODULE_URL_ACU = '/scripts/' + 'world-info.js';

/** 已解析的宿主 world-info 模块命名空间；模块内 selected_world_info 是 live binding，缓存模块本身即可读到最新值 */
let worldInfoModulePromise_ACU: Promise<any> | null = null;

/**
 * 动态 import 宿主 world-info 模块（带缓存）。
 * 失败时清空缓存，让宿主尚未加载完的早期调用有机会重试。
 *
 * 只在插件模式（宿主主窗口）下尝试：油猴模式跑在酒馆助手创建的 iframe 里，
 * 同一 URL 在 iframe realm 会加载出「第二个」world-info 实例（selected_world_info 恒为空，
 * 且会把 script.js/power-user.js 整条宿主模块图在 iframe 里重新执行一遍），既读不到真值又有副作用。
 * 油猴模式下 window 全局链与 TavernHelper 通道仍然有效，这里直接返回 null 走既有降级。
 */
export function loadHostWorldInfoModule_ACU(): Promise<any> {
  if (!isExtensionMode()) return Promise.resolve(null);
  if (!worldInfoModulePromise_ACU) {
    const loadModule = async (): Promise<any> => {
      try {
        // 变量说明符 + @vite-ignore：保留运行时原生 dynamic import，不让打包器静态解析宿主模块
        return (await import(/* @vite-ignore */ WORLD_INFO_MODULE_URL_ACU)) ?? null;
      } catch (error) {
        worldInfoModulePromise_ACU = null;
        logWarn_ACU('[WorldbookGateway] 动态 import 宿主 world-info 模块失败，激活世界书宿主模块通道降级为空', error);
        return null;
      }
    };
    worldInfoModulePromise_ACU = loadModule();
  }
  return worldInfoModulePromise_ACU;
}

/** 供测试与宿主热重载后重新探测使用 */
export function resetHostWorldInfoModuleCache_ACU(): void {
  worldInfoModulePromise_ACU = null;
}

/**
 * 从宿主 world-info 模块命名空间读取激活世界书名。
 * 两条来源（dev world-info.js 实证）：
 * - selected_world_info（:71-72 export let，UI 勾选的当前真值，live binding）
 * - getWorldInfoSettings().world_info.globalSelect（:890 导出，保存设置时同步的持久化副本）
 */
export function collectActiveWorldbookNamesFromModule_ACU(mod: any): string[] {
  const names: string[] = [];
  const push = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const name = String(item ?? '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
  };
  if (!mod) return names;
  try { push(mod.selected_world_info); } catch { /* ignore */ }
  try { push(mod.getWorldInfoSettings?.()?.world_info?.globalSelect); } catch { /* ignore */ }
  return names;
}

/**
 * 异步版激活世界书探测：同步全局链 + 宿主 world-info 模块链。
 * TT dev 的 getContext() 不导出 world_info / selected_world_info（全是 ES module export），
 * 裸环境下四条死全局必然落空，只有动态 import 能读到当前激活书。
 * 油猴/旧 ST 时代环境全局可见时，模块通道只会补充去重后的同名结果，不改变既有行为。
 * @param loadModule 模块提供者，默认走运行时动态 import；测试与非标准宿主可注入替代实现
 */
export async function getActiveGlobalWorldbookNamesAsync_ACU(
  loadModule: () => Promise<any> = loadHostWorldInfoModule_ACU,
): Promise<string[]> {
  const names = getActiveGlobalWorldbookNames_ACU();
  const push = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const name = String(item ?? '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
  };
  try {
    push(collectActiveWorldbookNamesFromModule_ACU(await loadModule()));
  } catch { /* 宿主模块不可用时保留全局链结果 */ }
  return names;
}

/**
 * 获取「正文实际能接收到的」世界书名称全集：激活全局书 + 角色卡绑定书（primary+additional）。
 * 填表「正文接收」来源的书列表真源（UI 与运行时共用）。
 * @param worldInfoModuleLoader 激活书宿主模块提供者注入点，默认走运行时动态 import
 */
export async function getActiveWorldbookNamesForFill_ACU(
  worldInfoModuleLoader?: () => Promise<any>,
): Promise<string[]> {
  const names = await getActiveGlobalWorldbookNamesAsync_ACU(
    worldInfoModuleLoader ?? loadHostWorldInfoModule_ACU,
  );
  for (const fn of [(globalThis as any).getLorebookSettings, (globalThis as any).TavernHelper?.getLorebookSettings] as Array<(() => any) | undefined>) {
    if (typeof fn !== 'function') continue;
    try {
      const cfg = await Promise.resolve(fn());
      const list = cfg?.selected_global_lorebooks ?? cfg?.selected_world_info ?? [];
      if (Array.isArray(list)) {
        for (const item of list) {
          const n = String(item ?? '').trim();
          if (n && !names.includes(n)) names.push(n);
        }
      }
    } catch { /* ignore */ }
  }
  try {
    const charLorebooks = await getCharLorebooks_ACU({ type: 'all' });
    if (charLorebooks?.primary) {
      const p = String(charLorebooks.primary).trim();
      if (p && !names.includes(p)) names.push(p);
    }
    if (Array.isArray(charLorebooks?.additional)) {
      for (const b of charLorebooks.additional) {
        const n = String(b ?? '').trim();
        if (n && !names.includes(n)) names.push(n);
      }
    }
  } catch { /* 角色书读取失败不影响激活书 */ }
  return names;
}

export async function getCurrentCharPrimaryLorebook_ACU(): Promise<string | null> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getCurrentCharPrimaryLorebook !== 'function') {
        logWarn_ACU('[WorldbookGateway] getCurrentCharPrimaryLorebook 不可用，返回 null');
        return null;
    }
    return await TavernHelper_API_ACU.getCurrentCharPrimaryLorebook();
}

/**
 * 获取角色关联的世界书列表
 * @param options 查询选项（如 { type: 'all' }）
 * @returns 角色世界书结构，不可用时返回空结构
 */
export { getCharLorebooks_ACU, getCurrentCharacterWorldbookBinding_ACU };
