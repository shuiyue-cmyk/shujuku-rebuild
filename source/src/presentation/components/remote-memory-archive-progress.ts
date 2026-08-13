import { jQuery_API_ACU } from '../dom-utils';

const REMOTE_MEMORY_ARCHIVE_OVERLAY_ID_ACU = 'acu-remote-memory-archive-overlay';
const REMOTE_MEMORY_ARCHIVE_STYLE_ID_ACU = 'acu-remote-memory-archive-overlay-style';
const REMOTE_MEMORY_ARCHIVE_TITLE_ID_ACU = 'acu-remote-memory-archive-overlay-title';
const REMOTE_MEMORY_ARCHIVE_MESSAGE_ID_ACU = 'acu-remote-memory-archive-overlay-message';
const REMOTE_MEMORY_ARCHIVE_CANCEL_ID_ACU = 'acu-remote-memory-archive-overlay-cancel';

export interface ShowRemoteMemoryArchiveProgressOptions_ACU {
    title?: string;
    message?: string;
    cancelLabel?: string;
    onCancel?: (() => void) | null;
}

function escapeHtml_ACU(value: string): string {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function ensureOverlayStyle_ACU(): void {
    if (jQuery_API_ACU(`#${REMOTE_MEMORY_ARCHIVE_STYLE_ID_ACU}`).length > 0) {
        return;
    }
    jQuery_API_ACU('body').append(`
        <style id="${REMOTE_MEMORY_ARCHIVE_STYLE_ID_ACU}">
            @keyframes acu-remote-memory-archive-spin {
                to { transform: rotate(360deg); }
            }
        </style>
    `);
}

export function showRemoteMemoryArchiveProgressOverlay_ACU(
    options: ShowRemoteMemoryArchiveProgressOptions_ACU = {},
): void {
    const title = String(options.title || '远记忆归档进行中').trim() || '远记忆归档进行中';
    const message = String(options.message || '正在准备执行远记忆归档...').trim() || '正在准备执行远记忆归档...';
    const cancelLabel = String(options.cancelLabel || '终止归档').trim() || '终止归档';

    hideRemoteMemoryArchiveProgressOverlay_ACU();
    ensureOverlayStyle_ACU();

    const html = `
        <div id="${REMOTE_MEMORY_ARCHIVE_OVERLAY_ID_ACU}" style="
            position: fixed;
            inset: 0;
            z-index: 100001;
            background: rgba(0, 0, 0, 0.58);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        ">
            <div style="
                width: min(460px, calc(100vw - 32px));
                border-radius: 14px;
                border: 1px solid var(--acu-border, rgba(255,255,255,0.16));
                background: var(--acu-bg-1, rgba(18, 24, 38, 0.96));
                color: var(--acu-text-1, #f3f4f6);
                box-shadow: 0 24px 72px rgba(0, 0, 0, 0.38);
                padding: 22px 22px 18px;
                display: flex;
                flex-direction: column;
                gap: 14px;
            ">
                <div style="display:flex; align-items:center; gap:14px;">
                    <div aria-hidden="true" style="
                        width: 34px;
                        height: 34px;
                        border-radius: 50%;
                        border: 3px solid rgba(123, 183, 255, 0.24);
                        border-top-color: var(--acu-accent, #7bb7ff);
                        animation: acu-remote-memory-archive-spin 1s linear infinite;
                        flex: 0 0 auto;
                    "></div>
                    <div style="min-width:0; display:flex; flex-direction:column; gap:6px;">
                        <div id="${REMOTE_MEMORY_ARCHIVE_TITLE_ID_ACU}" style="font-size:15px; font-weight:600; letter-spacing:0.2px; color: var(--acu-text-1, #f3f4f6);">${escapeHtml_ACU(title)}</div>
                        <div id="${REMOTE_MEMORY_ARCHIVE_MESSAGE_ID_ACU}" style="font-size:13px; line-height:1.7; color: var(--acu-text-2, rgba(243,244,246,0.82)); word-break:break-word;">${escapeHtml_ACU(message)}</div>
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
                    <button id="${REMOTE_MEMORY_ARCHIVE_CANCEL_ID_ACU}" type="button" style="
                        padding: 9px 16px;
                        border-radius: 8px;
                        border: 1px solid rgba(255, 193, 7, 0.45);
                        background: rgba(255, 193, 7, 0.08);
                        color: #ffd76a;
                        cursor: pointer;
                        font-size: 13px;
                        font-weight: 600;
                    ">${escapeHtml_ACU(cancelLabel)}</button>
                </div>
            </div>
        </div>
    `;

    jQuery_API_ACU('body').append(html);

    const onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
    if (onCancel) {
        jQuery_API_ACU(`#${REMOTE_MEMORY_ARCHIVE_CANCEL_ID_ACU}`)
            .off('click.acu_remote_memory_archive')
            .on('click.acu_remote_memory_archive', function(e) {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            });
    }
}

export function updateRemoteMemoryArchiveProgressOverlay_ACU(message: string, title?: string): void {
    if (title !== undefined) {
        jQuery_API_ACU(`#${REMOTE_MEMORY_ARCHIVE_TITLE_ID_ACU}`).text(String(title || '').trim());
    }
    jQuery_API_ACU(`#${REMOTE_MEMORY_ARCHIVE_MESSAGE_ID_ACU}`).text(String(message || '').trim());
}

export function markRemoteMemoryArchiveCancelling_ACU(message?: string, cancelLabel?: string): void {
    if (message) {
        updateRemoteMemoryArchiveProgressOverlay_ACU(message);
    }
    const $cancel = jQuery_API_ACU(`#${REMOTE_MEMORY_ARCHIVE_CANCEL_ID_ACU}`);
    if ($cancel.length) {
        $cancel.prop('disabled', true);
        $cancel.text(String(cancelLabel || '正在终止...').trim() || '正在终止...');
        $cancel.css({
            opacity: '0.72',
            cursor: 'not-allowed',
        });
    }
}

export function hideRemoteMemoryArchiveProgressOverlay_ACU(): void {
    jQuery_API_ACU(`#${REMOTE_MEMORY_ARCHIVE_OVERLAY_ID_ACU}`).remove();
}
