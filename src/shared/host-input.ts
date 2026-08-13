import { jQuery_API_ACU } from './host-api';

/** 宿主发送框操作，不属于任何 V1 popup。 */
export function getSendTextareaValue_ACU(): string {
    try {
        return String(jQuery_API_ACU?.('#send_textarea').val() || '');
    } catch {
        return '';
    }
}

export function setSendTextareaValue_ACU(text: string): void {
    try {
        const $textarea = jQuery_API_ACU?.('#send_textarea');
        $textarea?.val(text);
        $textarea?.trigger('input');
    } catch {
        // 宿主输入框在页面切换期间可能暂时不存在。
    }
}

export function clickSendButton_ACU(): void {
    try {
        jQuery_API_ACU?.('#send_but').click();
    } catch {
        // 宿主发送按钮在页面切换期间可能暂时不存在。
    }
}
