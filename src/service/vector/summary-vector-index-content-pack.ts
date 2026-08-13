import type {
    SummaryVectorIndexContentPackBlob_ACU,
    SummaryVectorIndexContentPackChunk_ACU,
} from './summary-vector-index-types';
import { SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU } from './summary-vector-index-types';

/**
 * P4 内容寻址 pack 纯函数模块（T9）。
 * 无 I/O、无全局状态，便于单测。
 *
 * 分界策略：pack 大小目标 TARGET_CHUNKS，最小 MIN_CHUNKS，上限 MAX_CHUNKS。
 * 分界位置由 chunkKey 的 FNV-1a 32 位散列决定，保证：
 * - 任意 chunkKey（含空串、非 base36、超长）都得到确定数值，不会退化为"只在 256 处切"；
 * - 同一输入集合的分组结果完全确定；
 * - 头部删除少量 key 时，后续分组边界基本不变，最大化跨 revision 复用。
 */

export const SUMMARY_VECTOR_INDEX_CONTENT_PACK_TARGET_CHUNKS_ACU = 64;
export const SUMMARY_VECTOR_INDEX_CONTENT_PACK_MIN_CHUNKS_ACU = 16;
export const SUMMARY_VECTOR_INDEX_CONTENT_PACK_MAX_CHUNKS_ACU = 256;

/**
 * FNV-1a 32 位散列（同步、无依赖）。
 * 输入任意字符串（UTF-16 code unit 序列），输出 [0, 2^32) 无符号整数。
 */
export function fnv1a32_ACU(input: string): number {
    const text = String(input ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/**
 * 判断当前 chunkKey 是否应作为新 pack 的边界。
 *
 * @param chunkKey 当前（即将追加的）chunk 的 key
 * @param currentPackSize 当前 pack 已积累的 chunk 数
 * @param opts 可选覆盖 TARGET/MIN/MAX，测试用
 */
export function isContentPackBoundary_ACU(
    chunkKey: string,
    currentPackSize: number,
    opts: {
        targetChunks?: number;
        minChunks?: number;
        maxChunks?: number;
    } = {},
): boolean {
    const targetChunks = Math.max(1, Math.floor(Number(opts.targetChunks) || SUMMARY_VECTOR_INDEX_CONTENT_PACK_TARGET_CHUNKS_ACU));
    const minChunks = Math.max(0, Math.floor(Number(opts.minChunks) || SUMMARY_VECTOR_INDEX_CONTENT_PACK_MIN_CHUNKS_ACU));
    const maxChunks = Math.max(targetChunks, Math.floor(Number(opts.maxChunks) || SUMMARY_VECTOR_INDEX_CONTENT_PACK_MAX_CHUNKS_ACU));
    const size = Math.max(0, Math.floor(Number(currentPackSize) || 0));

    if (size >= maxChunks) return true;
    if (size < minChunks) return false;
    return fnv1a32_ACU(String(chunkKey ?? '')) % targetChunks === 0;
}

/**
 * 顺序扫描 chunkKeys，按 isContentPackBoundary_ACU 切成 pack 分组。
 * 返回的每个组都非空；最后一个组可以小于 MIN_CHUNKS。
 */
export function planContentPackGroups_ACU(chunkKeys: string[]): string[][] {
    const keys = Array.isArray(chunkKeys) ? chunkKeys : [];
    const groups: string[][] = [];
    let current: string[] = [];
    for (let index = 0; index < keys.length; index += 1) {
        const key = String(keys[index] ?? '');
        if (current.length > 0 && isContentPackBoundary_ACU(key, current.length)) {
            groups.push(current);
            current = [];
        }
        current.push(key);
    }
    if (current.length > 0) groups.push(current);
    return groups;
}

/**
 * 构建 content pack blob。字段固定书写顺序，chunk 内字段固定顺序，
 * 保证同一逻辑内容序列化后逐字节一致（跨 revision 复用 pack 的前提）。
 */
export function buildContentPackBlob_ACU(params: {
    packKey: string;
    packScope: string;
    embeddingModel: string;
    dimension: number;
    chunks: SummaryVectorIndexContentPackChunk_ACU[];
}): SummaryVectorIndexContentPackBlob_ACU {
    const chunks = (Array.isArray(params.chunks) ? params.chunks : []).map((chunk) => ({
        chunkKey: String(chunk.chunkKey ?? ''),
        chunkId: String(chunk.chunkId ?? ''),
        rowKey: String(chunk.rowKey ?? ''),
        text: String(chunk.text ?? ''),
        vector: String(chunk.vector ?? ''),
        vectorEncoding: 'f32b64' as const,
        ...(chunk.sourceFingerprint ? { sourceFingerprint: String(chunk.sourceFingerprint) } : {}),
        ...(chunk.textHash ? { textHash: String(chunk.textHash) } : {}),
    }));
    return {
        version: 1,
        schema: SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU,
        packKey: String(params.packKey ?? ''),
        packScope: String(params.packScope ?? ''),
        embeddingModel: String(params.embeddingModel ?? ''),
        dimension: Math.max(0, Math.floor(Number(params.dimension) || 0)),
        chunks,
    };
}

/**
 * 以 packKey 为空串序列化 blob，保证 packKey 不参与自身 hash。
 * 返回 JSON 字符串（与 sha256Text_ACU 组合使用）。
 */
export function serializeContentPackForHash_ACU(blob: SummaryVectorIndexContentPackBlob_ACU): string {
    return JSON.stringify({
        ...blob,
        packKey: '',
    });
}

/**
 * 由 64 位十六进制 SHA-256 构造 pack key。
 */
export function buildContentPackKey_ACU(hashHex: string): string {
    return `pack_${String(hashHex ?? '')}`;
}
