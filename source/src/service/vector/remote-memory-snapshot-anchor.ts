import type { ACUMessage } from '../../shared/host-api';
import { hashUserInput_ACU } from '../../shared/utils';

export interface RemoteMemorySnapshotAnchor_ACU {
    anchor: string;
    messageIndex: number;
    role: 'assistant' | 'user' | 'system';
    createdAt: string;
}

const ANCHOR_FIELD_ACU = '_acu_remote_memory_snapshot_anchor';

function normalizeMessageText_ACU(message: any): string {
    return String(message?.mes ?? message?.text ?? message?.content ?? '').trim();
}

function resolveMessageRole_ACU(message: any): RemoteMemorySnapshotAnchor_ACU['role'] {
    if (message?.is_user) return 'user';
    if (message?.is_system) return 'system';
    return 'assistant';
}

function buildAnchorFromMessage_ACU(message: any, messageIndex: number): string {
    const messageId = String(message?.id ?? message?.send_date ?? message?.extra?.gen_id ?? '').trim();
    if (messageId) return `chat-message:${hashUserInput_ACU(`${messageIndex}:${messageId}`)}`;
    const text = normalizeMessageText_ACU(message).slice(0, 2048);
    return `chat-message:${hashUserInput_ACU(`${messageIndex}:${resolveMessageRole_ACU(message)}:${text}`)}`;
}

export function resolveRemoteMemorySnapshotAnchor_ACU(chat: any[], messageIndex: number): RemoteMemorySnapshotAnchor_ACU | null {
    if (!Array.isArray(chat) || messageIndex < 0 || messageIndex >= chat.length) return null;
    const message = chat[messageIndex] as ACUMessage & Record<string, any>;
    if (!message) return null;
    const persisted = message[ANCHOR_FIELD_ACU];
    if (persisted && typeof persisted === 'object' && typeof persisted.anchor === 'string' && persisted.anchor.trim()) {
        return {
            anchor: persisted.anchor,
            messageIndex: Number.isInteger(persisted.messageIndex) ? persisted.messageIndex : messageIndex,
            role: persisted.role === 'user' || persisted.role === 'system' ? persisted.role : 'assistant',
            createdAt: typeof persisted.createdAt === 'string' ? persisted.createdAt : new Date().toISOString(),
        };
    }
    const text = normalizeMessageText_ACU(message);
    if (!text && !message?.id && !message?.send_date) return null;
    return {
        anchor: buildAnchorFromMessage_ACU(message, messageIndex),
        messageIndex,
        role: resolveMessageRole_ACU(message),
        createdAt: new Date().toISOString(),
    };
}

export function persistRemoteMemorySnapshotAnchorIfNeeded_ACU(message: any, anchor: RemoteMemorySnapshotAnchor_ACU): void {
    if (!message || !anchor?.anchor) return;
    const existing = message[ANCHOR_FIELD_ACU];
    if (existing && typeof existing === 'object' && existing.anchor === anchor.anchor) return;
    message[ANCHOR_FIELD_ACU] = {
        anchor: anchor.anchor,
        messageIndex: anchor.messageIndex,
        role: anchor.role,
        createdAt: anchor.createdAt || new Date().toISOString(),
    };
}
