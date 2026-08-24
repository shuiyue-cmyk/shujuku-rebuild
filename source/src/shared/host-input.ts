import { jQuery_API_ACU } from './host-api';
import { logWarn_ACU } from './utils';

/** 宿主发送框操作，不属于任何 V1 popup。 */
export function getSendTextareaValue_ACU(): string {
    try {
        return String(jQuery_API_ACU?.('#send_textarea').val() || '');
    } catch (e) {
        logWarn_ACU('[HostInput] 读取 #send_textarea 值失败（宿主输入框可能暂不可用）:', e);
        return '';
    }
}

export function setSendTextareaValue_ACU(text: string): void {
    try {
        const $textarea = jQuery_API_ACU?.('#send_textarea');
        $textarea?.val(text);
        $textarea?.trigger('input');
    } catch (e) {
        // 宿主输入框在页面切换期间可能暂时不存在。
        logWarn_ACU('[HostInput] 写入 #send_textarea 失败（宿主输入框可能暂不可用）:', e);
    }
}

export function clickSendButton_ACU(): void {
    try {
        jQuery_API_ACU?.('#send_but').click();
    } catch (e) {
        // 宿主发送按钮在页面切换期间可能暂时不存在。
        logWarn_ACU('[HostInput] 点击 #send_but 失败（宿主发送按钮可能暂不可用）:', e);
    }
}
