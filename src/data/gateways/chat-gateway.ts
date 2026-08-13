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
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

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

/**
 * 触发聊天保存到宿主平台
 * 内置存在性检查，saveChat 不可用时静默跳过
 */
export async function saveChatToHost_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        logWarn_ACU('[ChatGateway] saveChat 不可用，跳过保存');
        return;
    }
    await SillyTavern_API_ACU.saveChat();
}

/**
 * 执行必须真实提交到宿主的聊天保存。
 * 仅适用于后续会触发不可逆外置副作用的事务；宿主保存能力缺失时必须失败，不能静默跳过。
 */
export async function saveChatToHostStrict_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        throw new Error('宿主 saveChat 不可用，无法提交破坏性聊天数据变更。');
    }
    await SillyTavern_API_ACU.saveChat();
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

/**
 * 触发消息更新事件通知宿主平台
 * 优先使用 eventTypes.MESSAGE_UPDATED，降级使用字符串 'MESSAGE_UPDATED'
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
        // 降级：直接使用字符串事件名
        SillyTavern_API_ACU.eventSource.emit('MESSAGE_UPDATED', messageIndex);
    }
}
