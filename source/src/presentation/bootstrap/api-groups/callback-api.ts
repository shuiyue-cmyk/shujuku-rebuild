/**
 * presentation/bootstrap/api-groups/callback-api.ts
 * 回调管理 API — 表格更新和填表开始的回调注册/注销/通知
 */

import { currentJsonTableData_ACU } from '../../../service/runtime/state-manager';
import { logDebug_ACU, logError_ACU } from '../../../shared/utils';

export interface ApiGroupContext {
    /** 表格更新回调列表 */
    tableUpdateCallbacks: Function[];
    /** 填表开始回调列表 */
    tableFillStartCallbacks: Function[];
    /** 获取完整 API 对象的引用（解决 this 引用） */
    getApi: () => any;
}

/**
 * 表格更新通知元信息（S2-1 契约收紧）。
 * persisted=false 表示本次更新仅改写了内存运行时（如 skipChatSave 提交、运行时恢复导入），
 * 尚未写入聊天消息的 V2 存储帧——重开聊天/冷回放后这些改动会丢失。
 */
export interface TableUpdateNotifyMeta_ACU {
    persisted: boolean;
}

let isNotifyingTableUpdate_ACU = false;
let hasPendingTableUpdateNotification_ACU = false;
// 合并窗口内只要出现过一次未落盘通知，跟发就按未落盘告知（宁可保守，不虚报已落盘）。
let pendingNotificationHasUnpersisted_ACU = false;

function notifyTableUpdateCallbacksOnce_ACU(ctx: ApiGroupContext, meta: TableUpdateNotifyMeta_ACU): void {
    const callbacksSnapshot = [...ctx.tableUpdateCallbacks];
    const callbackCount = callbacksSnapshot.length;
    logDebug_ACU(`Notifying ${callbackCount} callbacks about table update (persisted=${meta.persisted}).`);

    if (callbackCount === 0) return;

    // 修复：确保回调函数永远不会收到 null，而是收到一个空对象，增加稳健性。
    const dataToSend = currentJsonTableData_ACU || {};
    callbacksSnapshot.forEach((callback, callbackIndex) => {
        try {
            // 将最新的数据与元信息作为参数传给回调；旧回调只声明一个参数时第二参数被自然忽略。
            callback(dataToSend, meta);
        } catch (e) {
            logError_ACU('[回调管理] Error executing a table update callback:', {
                callbackIndex,
                callbackName: callback?.name || 'anonymous',
                callbackCount,
                error: e,
            });
        }
    });
}

function notifyTableUpdateCallbacksSafely_ACU(ctx: ApiGroupContext, meta: TableUpdateNotifyMeta_ACU): void {
    if (isNotifyingTableUpdate_ACU) {
        hasPendingTableUpdateNotification_ACU = true;
        if (!meta.persisted) pendingNotificationHasUnpersisted_ACU = true;
        logDebug_ACU('[回调管理] Table update notification is already running; queued one coalesced follow-up notification.');
        return;
    }

    isNotifyingTableUpdate_ACU = true;
    try {
        hasPendingTableUpdateNotification_ACU = false;
        pendingNotificationHasUnpersisted_ACU = false;
        notifyTableUpdateCallbacksOnce_ACU(ctx, meta);

        if (hasPendingTableUpdateNotification_ACU) {
            hasPendingTableUpdateNotification_ACU = false;
            const followUpMeta: TableUpdateNotifyMeta_ACU = { persisted: !pendingNotificationHasUnpersisted_ACU };
            pendingNotificationHasUnpersisted_ACU = false;
            notifyTableUpdateCallbacksOnce_ACU(ctx, followUpMeta);
        }
    } finally {
        isNotifyingTableUpdate_ACU = false;
    }
}

export function createCallbackApi(ctx: ApiGroupContext): Record<string, Function> {
    return {
        // 注册表格更新回调
        registerTableUpdateCallback: function(callback: Function) {
            if (typeof callback === 'function' && !ctx.tableUpdateCallbacks.includes(callback)) {
                ctx.tableUpdateCallbacks.push(callback);
                logDebug_ACU('A new table update callback has been registered.');
            }
        },
        // 注销表格更新回调
        unregisterTableUpdateCallback: function(callback: Function) {
            const index = ctx.tableUpdateCallbacks.indexOf(callback);
            if (index > -1) {
                ctx.tableUpdateCallbacks.splice(index, 1);
                logDebug_ACU('A table update callback has been unregistered.');
            }
        },
        // 内部使用：通知更新；meta.persisted=false 表示本次更新未写入聊天持久化（默认按已落盘处理）
        _notifyTableUpdate: function(meta?: Partial<TableUpdateNotifyMeta_ACU>) {
            notifyTableUpdateCallbacksSafely_ACU(ctx, { persisted: meta?.persisted !== false });
        },
        // 注册"填表开始"回调
        registerTableFillStartCallback: function(callback: Function) {
            if (typeof callback === 'function' && !ctx.tableFillStartCallbacks.includes(callback)) {
                ctx.tableFillStartCallbacks.push(callback);
                logDebug_ACU('A new table fill start callback has been registered.');
            }
        },
        // 内部使用：通知"填表开始"
        _notifyTableFillStart: function() {
            const callbackCount = ctx.tableFillStartCallbacks.length;
            logDebug_ACU(`Notifying ${callbackCount} callbacks about table fill start.`);
            ctx.tableFillStartCallbacks.forEach((callback, callbackIndex) => {
                try {
                    callback();
                } catch (e) {
                    logError_ACU('[回调管理] Error executing a table fill start callback:', {
                        callbackIndex,
                        callbackName: callback?.name || 'anonymous',
                        callbackCount,
                        error: e,
                    });
                }
            });
        },
    };
}
