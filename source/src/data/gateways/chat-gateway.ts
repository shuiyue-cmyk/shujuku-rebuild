/**
 * data/gateways/chat-gateway.ts — 聊天数组访问网关
 *
 * 封装 SillyTavern_API_ACU.chat、saveChat()、stopGeneration()、
 * deleteLastMessage()、setChatMessages()、eventSource.emit() 等聊天相关操作。
 * service / presentation 层通过本模块访问聊天数组和触发宿主动作，不再直接调用宿主 API。
 *
 * 所有方法内置空值防御，宿主 API 不可用时返回安全默认值或静默跳过。
 */

import { SillyTavern_API_ACU } from '../../shared/host-api';
import { cleanChatName_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getHostRequestHeaders_ACU } from './ai-gateway';

/**
 * 获取当前聊天数组的引用
 * @returns 聊天消息数组，不可用时返回 []
 */
export function getChatArray_ACU(): any[] {
    return SillyTavern_API_ACU?.chat || [];
}

/**
 * 获取当前聊天数组的长度
 * @returns 消息数量
 */
export function getChatLength_ACU(): number {
    return SillyTavern_API_ACU?.chat?.length || 0;
}

/**
 * 获取最后一条消息的索引
 * @returns 最后消息索引，空聊天返回 0
 */
export function getLastMessageIndex_ACU(): number {
    return Math.max(0, getChatLength_ACU() - 1);
}

/** 插件保存成功后的监听回调（如删楼守卫的保管库同步）。 */
const postChatSaveListeners_ACU: Array<() => void> = [];

/**
 * 注册插件聊天保存成功后的回调。
 * 回调同步执行，异常被吞掉并记录，不影响保存契约本身。
 */
export function registerPostChatSaveListener_ACU(listener: () => void): void {
    postChatSaveListeners_ACU.push(listener);
}

function notifyPostChatSaveListeners_ACU(): void {
    for (const listener of postChatSaveListeners_ACU) {
        try {
            listener();
        } catch (error: any) {
            logWarn_ACU('[ChatGateway] post-save 监听回调异常:', error?.message || error);
        }
    }
}

/**
 * ═══ 填表运行期的宿主全量存盘合并 ═══（参考上游 PR #70，按我方口径重写）
 *
 * 宿主 saveChat 每次都把整个聊天序列化后写盘，并排进宿主的串行保存队列。前端美化让楼层体积很大时，
 * 一次存盘就要好几秒；填表一轮 N 批就是 N 次全量存盘，期间用户发消息（宿主自己也要存一次）只能排队等。
 * 批与批之间隔着 AI 请求（远长于存盘），在途合并命中不了，所以在填表运行窗口内：
 * - 非 strict 的填表批存盘只记下「有改动待存」立即返回，窗口结束（最外层）时补存一次；
 * - 我方任何一次全量存盘（strict 或普通）成功都覆盖已记下的改动，之后不再重复存；
 * - 用改动计数判定覆盖范围：存盘进行中才记下的改动不算被那次存盘覆盖（宿主可能已在序列化），之后仍会补存；
 * - 兜底：窗口持续超过上限没有真存盘时强制补存一次；页面转入后台 / 关闭时立即补存；
 * - 改动归属聊天：宿主 saveChat 只能存当前聊天，冲洗时已切到别的聊天就作废旧改动（不把新聊天白存一遍）。
 * 白名单制：只有填表批持久化的非 strict 分支走这里；strict 存盘、回滚对、其余存盘点一律照旧直存。
 * 代价：窗口内的改动在补存前只在内存里，此时应用被杀掉或中途切换聊天，要重新填这几批
 * （不会留下半截数据：盘上仍是上一次完整存盘）。不可逆外置副作用一律在 strict 存盘之后，而 strict 会一并写盘暂缓的改动。
 */

/** 窗口持续超过这个时长没有真存盘时，兜底定时器强制补存一次。 */
export const CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU = 120_000;

let chatSaveCoalesceDepth_ACU = 0;
/** 记下的改动计数；已被成功存盘覆盖到的计数。前者大于后者即有改动待存。 */
let chatSaveDirtySeq_ACU = 0;
let chatSaveCoveredSeq_ACU = 0;
/** 待存改动归属的聊天（null=宿主不暴露聊天 id，按同一聊天处理）。 */
let chatSaveDirtyChatKey_ACU: string | null = null;
let chatSaveInFlight_ACU: Promise<void> | null = null;
let chatSaveLastRealSaveAt_ACU = 0;
let chatSaveDeferTimer_ACU: ReturnType<typeof setTimeout> | null = null;

function currentChatSaveKey_ACU(): string | null {
    const api = SillyTavern_API_ACU as any;
    try {
        const viaGetter = typeof api?.getCurrentChatId === 'function' ? api.getCurrentChatId() : undefined;
        const key = viaGetter ?? api?.chatId ?? api?.this_chid;
        return key === undefined || key === null || String(key) === '' ? null : String(key);
    } catch {
        return null;
    }
}

function hasChatSaveDirty_ACU(): boolean {
    return chatSaveDirtySeq_ACU > chatSaveCoveredSeq_ACU;
}

function clearChatSaveDirty_ACU(): void {
    chatSaveCoveredSeq_ACU = chatSaveDirtySeq_ACU;
    chatSaveDirtyChatKey_ACU = null;
}

function markChatSaveDirty_ACU(): void {
    const key = currentChatSaveKey_ACU();
    if (hasChatSaveDirty_ACU() && chatSaveDirtyChatKey_ACU !== null && key !== null && key !== chatSaveDirtyChatKey_ACU) {
        logWarn_ACU('[ChatGateway] 存盘合并：聊天已切换，上一聊天尚未补存的改动作废。');
        clearChatSaveDirty_ACU();
    }
    if (!hasChatSaveDirty_ACU()) chatSaveDirtyChatKey_ACU = key;
    chatSaveDirtySeq_ACU += 1;
}

/** 待存改动仍属当前聊天则返回 true；已切到别的聊天就作废旧改动并返回 false。 */
function keepChatSaveDirtyIfSameChat_ACU(scene: string): boolean {
    if (chatSaveDirtyChatKey_ACU === null) return true;
    const key = currentChatSaveKey_ACU();
    if (key === null || key === chatSaveDirtyChatKey_ACU) return true;
    logWarn_ACU(`[ChatGateway] 存盘合并：${scene}时聊天已切换，上一聊天尚未补存的改动作废。`);
    clearChatSaveDirty_ACU();
    return false;
}

/**
 * 一次我方全量存盘：开始前记下改动计数，成功后只把这之前的改动记为已覆盖。
 * 存的是当前聊天：待存改动属于别的聊天时不算覆盖（交给冲洗点作废）。
 */
async function runTrackedFullChatSave_ACU(save: () => Promise<void>): Promise<void> {
    const coveredSeq = chatSaveDirtySeq_ACU;
    const sameChat = chatSaveDirtyChatKey_ACU === null || currentChatSaveKey_ACU() === null
        || currentChatSaveKey_ACU() === chatSaveDirtyChatKey_ACU;
    await save();
    chatSaveLastRealSaveAt_ACU = Date.now();
    if (sameChat && coveredSeq > chatSaveCoveredSeq_ACU) {
        chatSaveCoveredSeq_ACU = coveredSeq;
        if (!hasChatSaveDirty_ACU()) chatSaveDirtyChatKey_ACU = null;
    }
}

async function saveChatToHostRaw_ACU(): Promise<void> {
    await SillyTavern_API_ACU.saveChat();
    notifyPostChatSaveListeners_ACU();
}

/**
 * 触发聊天保存到宿主平台
 * 内置存在性检查，saveChat 不可用时静默跳过
 */
export async function saveChatToHost_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        logWarn_ACU('[ChatGateway] saveChat 不可用，跳过保存');
        return;
    }
    await runTrackedFullChatSave_ACU(saveChatToHostRaw_ACU);
}

/** 合并真存盘环：存到没有新改动为止；整环只排一次宿主队列入口，重复调用复用在途的环。失败时改动保留。 */
function startCoalescedRealChatSave_ACU(): Promise<void> {
    if (chatSaveInFlight_ACU) return chatSaveInFlight_ACU;
    const run: Promise<void> = (async () => {
        while (hasChatSaveDirty_ACU()) {
            if (!keepChatSaveDirtyIfSameChat_ACU('补存')) break;
            await runTrackedFullChatSave_ACU(saveChatToHostRaw_ACU);
        }
    })().finally(() => {
        if (chatSaveInFlight_ACU === run) chatSaveInFlight_ACU = null;
    });
    chatSaveInFlight_ACU = run;
    return run;
}

function armChatSaveDeferTimer_ACU(): void {
    if (chatSaveDeferTimer_ACU !== null) return;
    const delay = Math.max(0, CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU - (Date.now() - chatSaveLastRealSaveAt_ACU));
    chatSaveDeferTimer_ACU = setTimeout(() => {
        chatSaveDeferTimer_ACU = null;
        if (!hasChatSaveDirty_ACU() || chatSaveInFlight_ACU) return;
        if (!keepChatSaveDirtyIfSameChat_ACU('兜底定时器')) return;
        void startCoalescedRealChatSave_ACU().catch((error: any) => {
            logWarn_ACU('[ChatGateway] 存盘合并兜底补存失败:', error?.message || error);
        });
    }, delay);
}

/**
 * 开启填表运行窗口（可嵌套：并发分组、外层编排各开一层）。开窗时把节流时钟拨到当前，
 * 窗口内的第一批也走延迟，而不是因为距上次存盘已久立刻真存。
 */
export function beginChatSaveCoalescing_ACU(): void {
    if (chatSaveCoalesceDepth_ACU === 0) chatSaveLastRealSaveAt_ACU = Math.max(chatSaveLastRealSaveAt_ACU, Date.now());
    chatSaveCoalesceDepth_ACU += 1;
}

/** 结束一层运行窗口；最外层结束时补存窗口内记下的改动（永不抛）。 */
export async function endChatSaveCoalescing_ACU(): Promise<void> {
    if (chatSaveCoalesceDepth_ACU > 0) chatSaveCoalesceDepth_ACU -= 1;
    if (chatSaveCoalesceDepth_ACU === 0) await forceFlushChatSave_ACU();
}

/**
 * 填表批持久化专用的合并存盘：
 * - 宿主 saveChat 不可用 → 与 saveChatToHost_ACU 同样静默跳过并告警；
 * - 运行窗口内且距上次真存盘未到上限 → 记下改动、挂兜底定时器、立即返回（不占批与批之间的时间；
 *   此时若恰有兜底 / 隐藏补存在途，那个补存环会循环到没有新改动为止，把这次也存上）；
 * - 其余情况 → 立即真存并等待完成；已有补存环在途时复用它（失败会抛给调用方，与直接存盘一致）。
 */
export async function saveChatToHostCoalesced_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        logWarn_ACU('[ChatGateway] saveChat 不可用，跳过保存');
        return;
    }
    markChatSaveDirty_ACU();
    if (chatSaveCoalesceDepth_ACU > 0 && Date.now() - chatSaveLastRealSaveAt_ACU < CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU) {
        armChatSaveDeferTimer_ACU();
        return;
    }
    await startCoalescedRealChatSave_ACU();
}

/**
 * 冲洗点：等在途的环；仍有属于当前聊天的待存改动就真存一次。永不抛——冲洗点在用户路径上
 * （运行收尾、页面隐藏），失败只告警，改动留给下一个冲洗点。
 */
export async function forceFlushChatSave_ACU(): Promise<void> {
    try {
        if (chatSaveDeferTimer_ACU !== null) {
            clearTimeout(chatSaveDeferTimer_ACU);
            chatSaveDeferTimer_ACU = null;
        }
        if (chatSaveInFlight_ACU) {
            try { await chatSaveInFlight_ACU; } catch { /* 下面按剩余改动重试 */ }
        }
        if (hasChatSaveDirty_ACU() && keepChatSaveDirtyIfSameChat_ACU('冲洗') && typeof SillyTavern_API_ACU?.saveChat === 'function') {
            await startCoalescedRealChatSave_ACU();
        }
    } catch (error: any) {
        logWarn_ACU('[ChatGateway] 存盘合并补存失败，改动保留到下一次:', error?.message || error);
    }
}

/** 是否还有运行窗口里记下、尚未存盘的改动（诊断 / 测试用）。 */
export function hasPendingCoalescedChatSave_ACU(): boolean {
    return hasChatSaveDirty_ACU();
}

/**
 * 页面转入后台（visibilitychange→hidden）或关闭（pagehide）时尽力补存。
 * 手机上切到后台是应用最常被系统杀掉的时刻；没有待存改动时什么都不做。
 */
export async function flushChatSaveOnPageHidden_ACU(reason: 'visibilitychange' | 'pagehide'): Promise<void> {
    if (!hasChatSaveDirty_ACU() && !chatSaveInFlight_ACU) return;
    logDebug_ACU(`[ChatGateway] 页面${reason === 'pagehide' ? '关闭' : '转入后台'}，补存填表运行中记下的改动。`);
    await forceFlushChatSave_ACU();
}

let chatSavePageHideFlushInstalled_ACU = false;

/**
 * 注册页面转入后台 / 关闭时的补存（幂等）。visibilitychange 只在转为 hidden 时触发补存；
 * pagehide 覆盖桌面端关页 / 刷新。宿主环境缺 document / window 时静默跳过。
 */
export function installChatSavePageHideFlush_ACU(): void {
    if (chatSavePageHideFlushInstalled_ACU) return;
    const g: any = globalThis as any;
    const doc = g?.document;
    const win = g?.window;
    let installed = false;
    try {
        if (typeof doc?.addEventListener === 'function') {
            doc.addEventListener('visibilitychange', () => {
                if (doc.visibilityState === 'hidden') void flushChatSaveOnPageHidden_ACU('visibilitychange');
            });
            installed = true;
        }
        if (typeof win?.addEventListener === 'function') {
            win.addEventListener('pagehide', () => { void flushChatSaveOnPageHidden_ACU('pagehide'); });
            installed = true;
        }
    } catch (error: any) {
        logWarn_ACU('[ChatGateway] 注册页面隐藏补存失败:', error?.message || error);
    }
    chatSavePageHideFlushInstalled_ACU = installed;
}

/** 仅供测试隔离：清空合并调度的全部状态。 */
export function resetChatSaveCoalescerForTests_ACU(): void {
    if (chatSaveDeferTimer_ACU !== null) clearTimeout(chatSaveDeferTimer_ACU);
    chatSaveDeferTimer_ACU = null;
    chatSaveCoalesceDepth_ACU = 0;
    chatSaveDirtySeq_ACU = 0;
    chatSaveCoveredSeq_ACU = 0;
    chatSaveDirtyChatKey_ACU = null;
    chatSaveInFlight_ACU = null;
    chatSaveLastRealSaveAt_ACU = 0;
    chatSavePageHideFlushInstalled_ACU = false;
}

/**
 * 执行必须真实提交到宿主的聊天保存。
 * 仅适用于后续会触发不可逆外置副作用的事务；宿主保存能力缺失时必须失败，不能静默跳过。
 */
export async function saveChatToHostStrict_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        throw new Error('宿主 saveChat 不可用，无法提交破坏性聊天数据变更。');
    }
    // TT 的 integrity 冲突未确认路径不抛错：confirm 弹窗选否 → window.location.reload() 后 promise 照常 resolve，
    // resolve 本身不能当落盘证据。若返回时本页已开始卸载，后续 publish/GC 会把注册表写成与盘上旧数据错配的状态——直接失败。
    // 注：读回比对不可行——getContext 暴露的是 chatMetadata（非 chat_metadata），且 integrity 是只 mint 一次、
    // 永不轮转的 uuid，前后比对恒相等；saveChat 全路径 resolve undefined，返回值亦无信号。
    let unloading = false;
    const markUnloading = () => { unloading = true; };
    const listenTargets: Array<{ addEventListener: Function; removeEventListener: Function }> = [];
    try {
        const g: any = globalThis as any;
        const wins: any[] = [];
        if (g?.window) wins.push(g.window);
        if (g?.window?.parent && g.window.parent !== g.window) wins.push(g.window.parent);
        for (const win of wins) {
            if (typeof win?.addEventListener === 'function' && typeof win?.removeEventListener === 'function') {
                listenTargets.push(win);
            }
        }
    } catch { /* 取 parent 失败即只听本窗（下面 windows 为空则跳过） */ }
    for (const win of listenTargets) {
        try { win.addEventListener('pagehide', markUnloading); } catch { /* 忽略 */ }
    }
    try {
        // strict 全量存盘同样覆盖填表运行窗口里记下的改动（见上方合并调度）
        await runTrackedFullChatSave_ACU(() => SillyTavern_API_ACU.saveChat());
    } finally {
        for (const win of listenTargets) {
            try { win.removeEventListener('pagehide', markUnloading); } catch { /* 忽略 */ }
        }
    }
    if (unloading) {
        throw new Error('宿主页面在保存返回时已开始卸载（疑似 integrity 冲突未确认覆盖），中止本事务的破坏性变更。');
    }
    notifyPostChatSaveListeners_ACU();
}

// ═══ 宿主动作 ═══

/**
 * 停止当前正在进行的 AI 生成
 * 内置存在性检查，stopGeneration 不可用时静默跳过
 */
export function stopGeneration_ACU(): void {
    if (typeof SillyTavern_API_ACU?.stopGeneration !== 'function') {
        logWarn_ACU('[ChatGateway] stopGeneration 不可用，跳过');
        return;
    }
    SillyTavern_API_ACU.stopGeneration();
    logDebug_ACU('[ChatGateway] 已调用 stopGeneration');
}

/**
 * 删除最后一条聊天消息
 * 内置存在性检查，deleteLastMessage 不可用时静默跳过
 */
export async function deleteLastMessage_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.deleteLastMessage !== 'function') {
        logWarn_ACU('[ChatGateway] deleteLastMessage 不可用，跳过');
        return;
    }
    await SillyTavern_API_ACU.deleteLastMessage();
}

/**
 * 通过宿主 API 更新聊天消息内容
 * @param messages 要更新的消息数组（包含 message_id、mes、extra 等字段）
 * @param options 更新选项（如 { refresh: 'affected' }）
 * 内置存在性检查，setChatMessages 不可用时返回 false
 * @returns 是否成功调用了 setChatMessages
 */
export async function setChatMessages_ACU(
    messages: any[],
    options?: { refresh?: string; [key: string]: any }
): Promise<boolean> {
    if (typeof SillyTavern_API_ACU?.setChatMessages !== 'function') {
        logWarn_ACU('[ChatGateway] setChatMessages 不可用');
        return false;
    }
    await SillyTavern_API_ACU.setChatMessages(messages, options);
    return true;
}

// ═══ 全量聊天枚举 ═══

/**
 * 枚举宿主上全部存活聊天的归一化名称（角色聊天 + 群组聊天）。
 *
 * 用于向量存档孤儿判定：只有确认某个 chatKey 在全酒馆范围内不存在同名存活聊天
 * （聊天文件名不含角色作用域，跨角色可重名），才允许删除其向量数据。
 *
 * fail-safe 契约：任一环节无法保证枚举完整性（characters 列表不可用、任一角色的
 * 聊天列表请求失败、响应形状非预期）时返回 null，调用方必须视为"无法判定"并跳过
 * 删除，绝不能把残缺枚举当成完整集合使用。
 */
export async function listAllHostChatNames_ACU(): Promise<Set<string> | null> {
    const characters = SillyTavern_API_ACU?.characters;
    if (!Array.isArray(characters)) {
        logWarn_ACU('[ChatGateway] characters 列表不可用，无法枚举全部聊天');
        return null;
    }
    const names = new Set<string>();
    // 拷贝一份再补 Content-Type，不改宿主请求头对象本身
    const headers = { ...getHostRequestHeaders_ACU() };
    if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }
    for (const character of characters) {
        // 缺头像标识就查不到这个角色的聊天，按枚举残缺处理，不能当成它没有聊天（上游 #39 修法）
        const avatar = typeof character?.avatar === 'string' ? character.avatar.trim() : '';
        if (!avatar) {
            logWarn_ACU('[ChatGateway] 角色条目缺少头像标识，无法证明枚举完整');
            return null;
        }
        try {
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers,
                body: JSON.stringify({ avatar_url: avatar, simple: true }),
            });
            if (!response.ok) {
                logWarn_ACU(`[ChatGateway] 枚举角色聊天失败（HTTP ${response.status}）：${avatar}`);
                return null;
            }
            const payload = await response.json();
            // TT character-routes.js 的完整响应契约是数组（无角色/无聊天均为 []）。
            // 2xx error 对象、旧版对象形态或畸形 entry 都不能证明枚举完整，否则 GC
            // 会把「无法枚举」误判成「没有存活聊天」并删除向量。
            if (!Array.isArray(payload)) {
                logWarn_ACU(`[ChatGateway] 角色聊天响应不是数组，无法证明枚举完整：${avatar}`);
                return null;
            }
            for (const entry of payload) {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof (entry as any).file_name !== 'string') {
                    logWarn_ACU(`[ChatGateway] 角色聊天响应包含畸形 entry，无法证明枚举完整：${avatar}`);
                    return null;
                }
                const fileName = (entry as any).file_name.trim();
                if (!fileName) {
                    logWarn_ACU(`[ChatGateway] 角色聊天响应包含空 file_name，无法证明枚举完整：${avatar}`);
                    return null;
                }
                const normalized = cleanChatName_ACU(fileName);
                if (!normalized) {
                    logWarn_ACU(`[ChatGateway] 角色聊天名无法归一化，无法证明枚举完整：${avatar}`);
                    return null;
                }
                names.add(normalized);
            }
        } catch (error: any) {
            logWarn_ACU(`[ChatGateway] 枚举角色聊天异常：${avatar}: ${error?.message || error}`);
            return null;
        }
    }
    try {
        const groups = (globalThis as any).SillyTavern?.getContext?.()?.groups
            ?? (SillyTavern_API_ACU as any)?.groups;
        // fail-safe 契约：群组列表不可用（老宿主 / 派生 context 缺 groups 字段）时
        // 枚举必然残缺，必须返回 null 让调用方跳过删除；否则存活群组聊天会被误判为
        // 孤儿，其向量外置文件会被聊天删除 GC 误删。
        // 注意：groups 是数组但为空属合法「无群组聊天」，仍应返回完整枚举结果。
        if (!Array.isArray(groups)) {
            logWarn_ACU('[ChatGateway] groups 列表不可用，无法枚举群组聊天');
            return null;
        }
        for (const group of groups) {
            // 宿主的群组恒带 chats 数组；不是数组就无法知道这个群有哪些聊天，按枚举残缺处理（上游 #39）
            if (!Array.isArray(group?.chats)) {
                logWarn_ACU('[ChatGateway] 群组聊天列表不是数组，无法证明枚举完整');
                return null;
            }
            for (const chatId of group.chats) {
                // 兼容宿主历史数字标识；对象、布尔、空值、空串都认不出是哪条聊天，按枚举残缺处理
                const raw = typeof chatId === 'string' ? chatId.trim()
                    : (typeof chatId === 'number' && Number.isFinite(chatId) ? String(chatId) : '');
                const normalized = raw ? cleanChatName_ACU(raw) : '';
                if (!normalized) {
                    logWarn_ACU('[ChatGateway] 群组聊天标识无效，无法证明枚举完整');
                    return null;
                }
                names.add(normalized);
            }
        }
    } catch (error: any) {
        logWarn_ACU(`[ChatGateway] 枚举群组聊天异常：${error?.message || error}`);
        return null;
    }
    return names;
}

/**
 * 触发消息更新事件通知宿主平台
 * 优先使用 eventTypes.MESSAGE_UPDATED，降级使用字符串 'message_updated'
 * （TT events.js:12 `MESSAGE_UPDATED: 'message_updated'`：事件名字面量为小写）
 * @param messageIndex 更新的消息索引
 */
export function emitMessageUpdated_ACU(messageIndex: number): void {
    if (!SillyTavern_API_ACU?.eventSource?.emit) {
        logWarn_ACU('[ChatGateway] eventSource.emit 不可用，跳过事件通知');
        return;
    }
    if (SillyTavern_API_ACU?.eventTypes?.MESSAGE_UPDATED) {
        SillyTavern_API_ACU.eventSource.emit(
            SillyTavern_API_ACU.eventTypes.MESSAGE_UPDATED,
            messageIndex
        );
    } else {
        // 降级：直接使用字符串事件名（必须与 TT 注册名一致的小写形式，
        // 'MESSAGE_UPDATED' 大写形态 TT 从未注册，emit 等于空放）。
        SillyTavern_API_ACU.eventSource.emit('message_updated', messageIndex);
    }
}
