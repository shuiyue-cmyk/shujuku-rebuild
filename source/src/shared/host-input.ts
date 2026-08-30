import { jQuery_API_ACU } from './host-api';

/** 宿主发送框操作，不属于任何 V1 popup。 */
export function getSendTextareaValue_ACU(): string {
    try {
        return String(jQuery_API_ACU?.('#send_textarea').val() || '');
    } catch {
        return '';
    }
}

/** Writes the host textarea and reports availability instead of silently claiming success. */
export function setSendTextareaValue_ACU(text: string): boolean {
    try {
        const $textarea = jQuery_API_ACU?.('#send_textarea');
        // jQuery 空集上 .val/.trigger 依然存在且调用为 no-op——必须判 length，否则假成功。
        if (!$textarea || $textarea.length === 0 || typeof $textarea.val !== 'function' || typeof $textarea.trigger !== 'function') return false;
        $textarea?.val(text);
        $textarea?.trigger('input');
        return true;
    } catch {
        return false;
    }
}

/** Clicks the host send button and reports availability instead of swallowing it. */
export function clickSendButton_ACU(): boolean {
    try {
        const $button = jQuery_API_ACU?.('#send_but');
        if (!$button || $button.length === 0 || typeof $button.click !== 'function') return false;
        $button.click();
        return true;
    } catch {
        return false;
    }
}
