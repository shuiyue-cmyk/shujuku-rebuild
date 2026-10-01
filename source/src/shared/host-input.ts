import { jQuery_API_ACU, SillyTavern_API_ACU } from './host-api';

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
        notifySendTextareaInput_ACU($textarea);
        return true;
    } catch {
        return false;
    }
}

/**
 * 通知宿主发送框「内容变了」。
 *
 * 宿主的发送框自适应高度与输入暂存是用原生 addEventListener('input') 监听的，
 * 而 jQuery 的 trigger('input') 只调用 jQuery 自己的处理器，原生监听器收不到事件
 * ——剧情推进伪装清空发送框后高度不会收缩，窄屏输入框上移、点击区域错位。
 *
 * 原生事件 bubbles，jQuery 处理器同样会收到，因此这不替代 jQuery 触发；
 * 只有拿不到原生元素时才回落到 trigger。
 */
function notifySendTextareaInput_ACU($textarea: JQuery<HTMLElement>): void {
    const el = $textarea[0];
    if (el && typeof el.dispatchEvent === 'function') {
        const EventCtor = el.ownerDocument?.defaultView?.Event ?? Event;
        el.dispatchEvent(new EventCtor('input', { bubbles: true }));
        return;
    }
    $textarea.trigger('input');
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

/**
 * 触发酒馆「重新生成」。优先点 #option_regenerate（与用户点击同一条链路，会自动删除最近一层 AI 楼），
 * 按钮不可用时回落到宿主 Generate('regenerate')。
 */
export function clickRegenerateButton_ACU(): boolean {
    try {
        const $button = jQuery_API_ACU?.('#option_regenerate');
        // 同 setSendTextareaValue_ACU：jQuery 空集上 .trigger 是 no-op，必须判 length，否则假成功。
        if ($button && typeof $button.length === 'number' && $button.length > 0 && typeof $button.trigger === 'function') {
            $button.trigger('click');
            return true;
        }
    } catch { /* 按钮路径失败时走 Generate 回落 */ }
    return triggerHostGenerate_ACU('regenerate');
}

/**
 * 直接调用宿主 Generate。无新楼层的失败重试用 'normal'：针对已有用户楼生成回复，不会删上一轮 AI 楼。
 */
export function triggerHostGenerate_ACU(type: 'regenerate' | 'normal'): boolean {
    try {
        const fromApi = (SillyTavern_API_ACU as { generate?: unknown } | undefined)?.generate;
        const fromWindow = (globalThis as { Generate?: unknown }).Generate;
        const generate = typeof fromApi === 'function' ? fromApi : typeof fromWindow === 'function' ? fromWindow : null;
        if (!generate) return false;
        void generate.call(typeof fromApi === 'function' ? SillyTavern_API_ACU : globalThis, type);
        return true;
    } catch {
        return false;
    }
}
