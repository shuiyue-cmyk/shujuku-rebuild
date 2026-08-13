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

let isNotifyingTableUpdate_ACU = false;
let hasPendingTableUpdateNotification_ACU = false;

function notifyTableUpdateCallbacksOnce_ACU(ctx: ApiGroupContext): void {
    const callbacksSnapshot = [...ctx.tableUpdateCallbacks];
    const callbackCount = callbacksSnapshot.length;
    logDebug_ACU(`Notifying ${callbackCount} callbacks about table update.`);

    if (callbackCount === 0) return;

    // 修复：确保回调函数永远不会收到 null，而是收到一个空对象，增加稳健性。
    const dataToSend = currentJsonTableData_ACU || {};
    callbacksSnapshot.forEach((callback, callbackIndex) => {
        try {
            // 将最新的数据作为参数传给回调
            callback(dataToSend);
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

function notifyTableUpdateCallbacksSafely_ACU(ctx: ApiGroupContext): void {
    if (isNotifyingTableUpdate_ACU) {
        hasPendingTableUpdateNotification_ACU = true;
        logDebug_ACU('[回调管理] Table update notification is already running; queued one coalesced follow-up notification.');
        return;
    }

    isNotifyingTableUpdate_ACU = true;
    try {
        hasPendingTableUpdateNotification_ACU = false;
        notifyTableUpdateCallbacksOnce_ACU(ctx);

        if (hasPendingTableUpdateNotification_ACU) {
            hasPendingTableUpdateNotification_ACU = false;
            notifyTableUpdateCallbacksOnce_ACU(ctx);
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
        // 内部使用：通知更新
        _notifyTableUpdate: function() {
            notifyTableUpdateCallbacksSafely_ACU(ctx);
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
