/**
 * service/vector/summary-vector-mirror-storage.ts — 镜像 pack / checkpoint manifest 的 content-addressed 读写
 *
 * pack 路径沿用现有族：TavernDB_ACU_vector_v2pack_<scopeToken>_<packKey>
 * checkpoint manifest 新路径：TavernDB_ACU_vector_v2vcp_<scopeToken>_<sha256>
 * 文件名保留 scope token，供 GC 按 scope 前缀筛选。写入走 prepared → published。
 */

import {
    buildVectorIndexContentPackPathV2_ACU,
    buildVectorIndexMirrorManifestPathV2_ACU,
    buildVectorIndexSingleSnapshotV2ScopeToken_ACU,
    deleteVectorIndexFile_ACU,
    readVectorIndexJsonFile_ACU,
    registerVectorIndexFiles_ACU,
    unregisterVectorIndexFiles_ACU,
    sha256Text_ACU,
    uploadVectorIndexJsonFile_ACU,
} from '../../data/storage/vector-index-st-files-storage';
import { logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import type { SummaryVectorManifestRef_ACU, SummaryVectorPackRef_ACU } from '../table/storage-frame-v2-types';
import {
    buildContentPackBlob_ACU,
    serializeContentPackForHash_ACU,
} from './summary-vector-index-content-pack';
import type {
    SummaryVectorIndexContentPackBlob_ACU,
    SummaryVectorIndexContentPackChunk_ACU,
    SummaryVectorIndexExternalFileRef_ACU,
    SummaryVectorMirrorManifestRows_ACU,
} from './summary-vector-index-types';
import { SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU } from './summary-vector-index-types';

export interface PersistSummaryVectorMirrorPackParams_ACU {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    embeddingModel: string;
    dimension: number;
    chunks: SummaryVectorIndexContentPackChunk_ACU[];
}

export interface PersistSummaryVectorMirrorFileResult_ACU<TRef> {
    ref: TRef;
    file: SummaryVectorIndexExternalFileRef_ACU;
    /** true=本事务新建，失败时可安全 discard；false=复用既有内容寻址对象。 */
    createdNew?: boolean;
}

function encodeVectorToF32B64_ACU(vector: number[]): string {
    const bytes = new Uint8Array(vector.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < vector.length; index += 1) {
        const numeric = Number(vector[index]);
        if (!Number.isFinite(numeric)) {
            throw new Error(`镜像向量包含非有限数值，拒绝编码: index=${index}`);
        }
        view.setFloat32(index * 4, numeric, true);
    }
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 1) {
        binary += String.fromCharCode(bytes[offset]);
    }
    if (typeof globalThis.btoa !== 'function') throw new Error('当前环境缺少 btoa，无法编码镜像向量。');
    return globalThis.btoa(binary);
}

export function encodeSummaryVectorMirrorVector_ACU(vector: number[]): string {
    return encodeVectorToF32B64_ACU(vector);
}

export function decodeSummaryVectorMirrorVector_ACU(encoded: string): Float32Array {
    if (typeof globalThis.atob !== 'function') throw new Error('当前环境缺少 atob，无法解码镜像向量。');
    const binary = globalThis.atob(String(encoded || ''));
    if (binary.length % 4 !== 0) {
        throw new Error(`镜像向量 f32b64 字节长度非法: bytes=${binary.length}`);
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    const view = new DataView(bytes.buffer);
    const vector = new Float32Array(bytes.length / 4);
    for (let offset = 0; offset < bytes.length; offset += 4) {
        vector[offset / 4] = view.getFloat32(offset, true);
    }
    return vector;
}

async function registerPrepared_ACU(file: SummaryVectorIndexExternalFileRef_ACU): Promise<void> {
    await registerVectorIndexFiles_ACU([{ ...file, publicationState: 'prepared' }]);
}

/**
 * 失败/放弃路径显式回收未引用的 prepared 文件：GC 为护 finalize 窗口对 prepared 一律 retain，
 * 不主动删即永久累积；删除成功后同步注销 registry，避免「文件已删、registry 仍挂着 prepared」的幽灵条目。
 */
export async function discardSummaryVectorMirrorPreparedFiles_ACU(
    files: SummaryVectorIndexExternalFileRef_ACU[],
    context: string,
): Promise<void> {
    const deletedPaths: string[] = [];
    for (const file of files) {
        if (!file?.path) continue;
        try {
            // delete 返回 {ok:false} 不抛错：只有 ok:true（已删或确认不存在）才能注销 registry，
            // 否则 registry 丢跟踪、文件仍在盘上，变成 GC 永久不可见的孤儿。
            const deleted = await deleteVectorIndexFile_ACU(file.path);
            if (deleted?.ok) {
                deletedPaths.push(file.path);
            } else {
                logWarn_ACU(`[向量镜像] ${context}：丢弃未引用 prepared 文件未成功（交由 GC 保留，需人工关注）：${file.path}`, deleted?.error || '');
            }
        } catch (error: any) {
            logWarn_ACU(`[向量镜像] ${context}：丢弃未引用 prepared 文件失败（交由 GC 保留，需人工关注）：${file.path}`, error?.message || error);
        }
    }
    if (deletedPaths.length > 0) {
        try {
            await unregisterVectorIndexFiles_ACU(deletedPaths);
        } catch (error: any) {
            logWarn_ACU(`[向量镜像] ${context}：registry 注销已删文件失败：${deletedPaths.join(',')}`, error?.message || error);
        }
    }
}

export async function finalizeSummaryVectorMirrorFiles_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): Promise<void> {
    const published = files
        .filter((file) => !!file?.path)
        .map((file) => ({ ...file, publicationState: 'published' as const }));
    if (published.length === 0) return;
    await registerVectorIndexFiles_ACU(published);
}

export async function persistSummaryVectorMirrorPackPrepared_ACU(
    params: PersistSummaryVectorMirrorPackParams_ACU,
): Promise<PersistSummaryVectorMirrorFileResult_ACU<SummaryVectorPackRef_ACU>> {
    const scope = normalizeSummaryVectorIndexScope_ACU(params);
    const packScope = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
    const blobDraft = buildContentPackBlob_ACU({
        packKey: '',
        packScope,
        embeddingModel: params.embeddingModel,
        dimension: params.dimension,
        chunks: params.chunks,
    });
    const packHash = await sha256Text_ACU(serializeContentPackForHash_ACU(blobDraft));
    const path = buildVectorIndexContentPackPathV2_ACU({
        ...scope,
        packKey: packHash,
    });
    const blob = buildContentPackBlob_ACU({
        packKey: packHash,
        packScope,
        embeddingModel: params.embeddingModel,
        dimension: params.dimension,
        chunks: params.chunks,
    });
    const existing = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(path);
    if (existing.ok && existing.data) {
        if (existing.data.schema !== SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU || String(existing.data.packKey || '') !== packHash) {
            throw new Error(`镜像 pack 路径冲突：path=${path} 已存在但内容与 packHash=${packHash} 不一致。`);
        }
        const json = JSON.stringify(existing.data);
        const file: SummaryVectorIndexExternalFileRef_ACU = {
            role: 'vector_pack',
            path,
            byteSize: json.length,
            checksum: await sha256Text_ACU(json),
            chunkCount: blob.chunks.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'ready',
            scope,
            publicationState: 'prepared',
        };
        // 内容寻址路径已经存在：复用对象，不得把它降级成当前事务的 prepared。
        // 当前聊天是否可达由 commit/rollback 决定，失败路径也不能删除该既有对象。
        return {
            ref: { packHash, path, chunkCount: blob.chunks.length, byteLength: json.length },
            file,
            createdNew: false,
        };
    }
    const uploaded = await uploadVectorIndexJsonFile_ACU({
        path,
        role: 'vector_pack',
        data: blob,
        chunkCount: blob.chunks.length,
        rowCount: blob.chunks.length,
        status: 'ready',
    });
    if (!uploaded.ok || !uploaded.ref) {
        throw new Error(uploaded.error || `镜像 pack 上传失败: ${path}`);
    }
    uploaded.ref.scope = scope;
    uploaded.ref.publicationState = 'prepared';
    await registerPrepared_ACU(uploaded.ref);
    return {
        ref: {
            packHash,
            path,
            chunkCount: blob.chunks.length,
            byteLength: Number(uploaded.ref.byteSize) || JSON.stringify(blob).length,
        },
        file: uploaded.ref,
        createdNew: true,
    };
}

export async function persistSummaryVectorMirrorManifestPrepared_ACU(params: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    rows: SummaryVectorMirrorManifestRows_ACU;
}): Promise<PersistSummaryVectorMirrorFileResult_ACU<SummaryVectorManifestRef_ACU>> {
    const scope = normalizeSummaryVectorIndexScope_ACU(params);
    const payload: SummaryVectorMirrorManifestRows_ACU = {
        schema: 'summary_vector_mirror_manifest',
        version: 1,
        sourceTableKey: scope.sourceTableKey,
        rows: Array.isArray(params.rows.rows) ? params.rows.rows : [],
    };
    const manifestHash = await sha256Text_ACU(JSON.stringify(payload));
    const path = buildVectorIndexMirrorManifestPathV2_ACU({
        ...scope,
        manifestHash,
    });
    // 与 pack 同口径：内容寻址路径已存在且内容一致时复用既有对象（R5-03）。
    // 不得重新上传并降级成 prepared，失败回收也不能删除它——旧 checkpoint 可能正引用这份 manifest。
    const existing = await readVectorIndexJsonFile_ACU<SummaryVectorMirrorManifestRows_ACU>(path);
    if (existing.ok && existing.data) {
        const existingJson = JSON.stringify({
            schema: existing.data.schema,
            version: existing.data.version,
            sourceTableKey: existing.data.sourceTableKey,
            rows: existing.data.rows,
        });
        if (await sha256Text_ACU(existingJson) !== manifestHash) {
            throw new Error(`镜像 manifest 路径冲突：path=${path} 已存在但内容与 manifestHash=${manifestHash} 不一致。`);
        }
        const now = new Date().toISOString();
        return {
            ref: { manifestHash, path, byteLength: existingJson.length },
            file: {
                role: 'manifest',
                path,
                byteSize: existingJson.length,
                checksum: await sha256Text_ACU(existingJson),
                rowCount: payload.rows.length,
                createdAt: now,
                updatedAt: now,
                status: 'ready',
                scope,
                publicationState: 'prepared',
            },
            createdNew: false,
        };
    }
    const uploaded = await uploadVectorIndexJsonFile_ACU({
        path,
        role: 'manifest',
        data: payload,
        rowCount: payload.rows.length,
        status: 'ready',
    });
    if (!uploaded.ok || !uploaded.ref) {
        throw new Error(uploaded.error || `镜像 checkpoint manifest 上传失败: ${path}`);
    }
    uploaded.ref.scope = scope;
    uploaded.ref.publicationState = 'prepared';
    await registerPrepared_ACU(uploaded.ref);
    return {
        ref: {
            manifestHash,
            path,
            byteLength: Number(uploaded.ref.byteSize) || JSON.stringify(payload).length,
        },
        file: uploaded.ref,
        createdNew: true,
    };
}

/**
 * 镜像文件读取选项。fresh：绕过内存缓存直读盘上文件（读到则刷新缓存，读不到则清掉缓存条目）。
 * 重建修复与状态展示必须 fresh：缓存会让外部删掉的文件在本次会话里看起来仍可读，
 * 修复据此「复用」一个盘上已不存在的 pack，刷新后召回就会缺块。
 */
export interface LoadSummaryVectorMirrorFileOptions_ACU {
    fresh?: boolean;
}

/**
 * 内容寻址 pack 的内存缓存（移植上游 a43d0569）。
 * pack 路径主体即内容 sha256，写入端对同路径不同内容直接抛错，读取端复核 packKey，
 * 因此「路径 + packHash」唯一确定内容，命中无需失效。只缓存校验通过的结果；读取失败、
 * schema/packKey 不符都不入缓存，下次照常重读（不把失败伪装成空索引）。按字符量做 LRU 上限，
 * 避免手机端内存膨胀。上游同时加的向量解码缓存不跟：实测解码只占几毫秒，不值得再占一份内存。
 */
const MIRROR_PACK_CACHE_MAX_CHARS_ACU = 8_000_000;
/** 召回 / 折叠并行读取 pack 的上限：兼顾手机端读取耗时与瞬时内存、本机服务压力。 */
export const SUMMARY_VECTOR_MIRROR_PACK_READ_CONCURRENCY_ACU = 4;
interface MirrorPackCacheEntry_ACU {
    blob: SummaryVectorIndexContentPackBlob_ACU;
    chars: number;
}
const mirrorPackCache_ACU = new Map<string, MirrorPackCacheEntry_ACU>();
const mirrorPackInflight_ACU = new Map<string, Promise<SummaryVectorIndexContentPackBlob_ACU | null>>();
let mirrorPackCacheChars_ACU = 0;
let mirrorPackCacheHits_ACU = 0;

/**
 * checkpoint manifest 缓存：路径含 manifestHash，读取时已按 manifestHash 复核 sha256，
 * 只缓存复核通过的结果；未带 manifestHash 的引用不缓存。条目数有界（LRU）。
 */
const MIRROR_MANIFEST_CACHE_MAX_ENTRIES_ACU = 16;
const mirrorManifestCache_ACU = new Map<string, SummaryVectorMirrorManifestRows_ACU>();

function estimatePackChars_ACU(blob: SummaryVectorIndexContentPackBlob_ACU): number {
    let total = 256;
    for (const chunk of blob.chunks) {
        total += 128 + String(chunk?.vector || '').length + String(chunk?.text || '').length;
    }
    return total;
}

function dropMirrorPack_ACU(key: string): void {
    const previous = mirrorPackCache_ACU.get(key);
    if (!previous) return;
    mirrorPackCacheChars_ACU -= previous.chars;
    mirrorPackCache_ACU.delete(key);
}

function storeMirrorPack_ACU(key: string, blob: SummaryVectorIndexContentPackBlob_ACU): void {
    dropMirrorPack_ACU(key);
    const chars = estimatePackChars_ACU(blob);
    if (chars > MIRROR_PACK_CACHE_MAX_CHARS_ACU) return;
    mirrorPackCache_ACU.set(key, { blob, chars });
    mirrorPackCacheChars_ACU += chars;
    while (mirrorPackCacheChars_ACU > MIRROR_PACK_CACHE_MAX_CHARS_ACU && mirrorPackCache_ACU.size > 0) {
        const oldestKey = mirrorPackCache_ACU.keys().next().value as string;
        dropMirrorPack_ACU(oldestKey);
    }
}

/** 返回浅副本：调用方可重排/增删 chunks 数组而不影响缓存；chunk 对象按只读约定共享。 */
function clonePackShell_ACU(blob: SummaryVectorIndexContentPackBlob_ACU): SummaryVectorIndexContentPackBlob_ACU {
    return { ...blob, chunks: blob.chunks.slice() };
}

/** 仅供测试隔离：清空 pack / manifest 内存缓存。 */
export function clearSummaryVectorMirrorPackCache_ACU(): void {
    mirrorPackCache_ACU.clear();
    mirrorPackInflight_ACU.clear();
    mirrorPackCacheChars_ACU = 0;
    mirrorPackCacheHits_ACU = 0;
    mirrorManifestCache_ACU.clear();
}

/** 累计 pack 缓存命中次数（性能诊断用：调用方前后取差得到本轮命中数）。 */
export function getSummaryVectorMirrorPackCacheHitCount_ACU(): number {
    return mirrorPackCacheHits_ACU;
}

async function readSummaryVectorMirrorPackUncached_ACU(
    ref: SummaryVectorPackRef_ACU,
): Promise<SummaryVectorIndexContentPackBlob_ACU | null> {
    const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(ref.path);
    if (!loaded.ok || !loaded.data) return null;
    if (loaded.data.schema !== SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU || !Array.isArray(loaded.data.chunks)) {
        return null;
    }
    if (ref.packHash && String(loaded.data.packKey || '') !== ref.packHash) return null;
    return loaded.data;
}

export async function loadSummaryVectorMirrorPack_ACU(
    ref: SummaryVectorPackRef_ACU,
    options: LoadSummaryVectorMirrorFileOptions_ACU = {},
): Promise<SummaryVectorIndexContentPackBlob_ACU | null> {
    if (!ref?.path) return null;
    // 只有带 packHash 的引用才是内容寻址的，可安全缓存；其余保持每次直读。
    if (!ref.packHash) return readSummaryVectorMirrorPackUncached_ACU(ref);
    const key = `${ref.path}\u0000${ref.packHash}`;
    if (options.fresh === true) {
        const blob = await readSummaryVectorMirrorPackUncached_ACU(ref);
        if (blob) storeMirrorPack_ACU(key, blob);
        else dropMirrorPack_ACU(key);
        return blob ? clonePackShell_ACU(blob) : null;
    }
    const cached = mirrorPackCache_ACU.get(key);
    if (cached) {
        mirrorPackCache_ACU.delete(key);
        mirrorPackCache_ACU.set(key, cached);
        mirrorPackCacheHits_ACU += 1;
        return clonePackShell_ACU(cached.blob);
    }
    let pending = mirrorPackInflight_ACU.get(key);
    if (!pending) {
        pending = readSummaryVectorMirrorPackUncached_ACU(ref)
            .then((blob) => {
                if (blob) storeMirrorPack_ACU(key, blob);
                return blob;
            })
            .finally(() => { mirrorPackInflight_ACU.delete(key); });
        mirrorPackInflight_ACU.set(key, pending);
    }
    const blob = await pending;
    return blob ? clonePackShell_ACU(blob) : null;
}

export async function loadSummaryVectorMirrorManifest_ACU(
    ref: SummaryVectorManifestRef_ACU,
    options: LoadSummaryVectorMirrorFileOptions_ACU = {},
): Promise<SummaryVectorMirrorManifestRows_ACU | null> {
    if (!ref?.path) return null;
    const cacheKey = ref.manifestHash ? `${ref.path}\u0000${ref.manifestHash}` : '';
    if (cacheKey && options.fresh === true) mirrorManifestCache_ACU.delete(cacheKey);
    const cached = cacheKey ? mirrorManifestCache_ACU.get(cacheKey) : undefined;
    if (cached) {
        mirrorManifestCache_ACU.delete(cacheKey);
        mirrorManifestCache_ACU.set(cacheKey, cached);
        return { ...cached, rows: cached.rows.slice() };
    }
    const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorMirrorManifestRows_ACU>(ref.path);
    if (!loaded.ok || !loaded.data) return null;
    if (loaded.data.schema !== 'summary_vector_mirror_manifest' || !Array.isArray(loaded.data.rows)) return null;
    if (ref.manifestHash) {
        const actualHash = await sha256Text_ACU(JSON.stringify({
            schema: loaded.data.schema,
            version: loaded.data.version,
            sourceTableKey: loaded.data.sourceTableKey,
            rows: loaded.data.rows,
        }));
        if (actualHash !== ref.manifestHash) return null;
        mirrorManifestCache_ACU.set(cacheKey, loaded.data);
        while (mirrorManifestCache_ACU.size > MIRROR_MANIFEST_CACHE_MAX_ENTRIES_ACU) {
            const oldestKey = mirrorManifestCache_ACU.keys().next().value;
            if (oldestKey === undefined) break;
            mirrorManifestCache_ACU.delete(oldestKey);
        }
        return { ...loaded.data, rows: loaded.data.rows.slice() };
    }
    return loaded.data;
}
