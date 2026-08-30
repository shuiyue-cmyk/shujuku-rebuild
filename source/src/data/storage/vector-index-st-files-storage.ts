import { SillyTavern_API_ACU } from '../../shared/host-api';
import { logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import type {
    SummaryVectorIndexExternalFileRef_ACU,
    SummaryVectorIndexExternalFileRole_ACU,
    SummaryVectorIndexRegistryFile_ACU,
} from '../../service/vector/summary-vector-index-types';
import { SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU } from '../../service/vector/summary-vector-index-types';

export interface VectorIndexFileWriteResult_ACU {
    ok: boolean;
    ref?: SummaryVectorIndexExternalFileRef_ACU;
    error?: string;
}

export interface VectorIndexFileDeleteResult_ACU {
    ok: boolean;
    path: string;
    error?: string;
}

function getRequestHeaders_ACU(): Record<string, string> {
    const contextHeaders = (SillyTavern_API_ACU as any)?.getRequestHeaders?.();
    const headers: Record<string, string> = {
        ...(contextHeaders && typeof contextHeaders === 'object' ? contextHeaders : {}),
    };
    if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

function normalizeError_ACU(error: any): string {
    return String(error?.message || error || '未知错误');
}

/** V1-h：外置文件 fetch 统一超时上界。 */
const VECTOR_INDEX_FETCH_TIMEOUT_MS_ACU = 30_000;

/**
 * V1-h：所有外置文件请求必须可超时中断。采用 setTimeout+AbortController 模式
 * （与 vector-rerank-gateway 既有实践一致；AbortSignal.timeout 依赖较新宿主 API，
 * 本插件目标环境不保证可用）。错误信息区分超时与网络失败。
 */
async function fetchWithTimeout_ACU(input: string, init: RequestInit, label: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VECTOR_INDEX_FETCH_TIMEOUT_MS_ACU);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error(`${label}超时（${VECTOR_INDEX_FETCH_TIMEOUT_MS_ACU}ms），已中断`);
        }
        throw new Error(`${label}网络失败：${normalizeError_ACU(error)}`);
    } finally {
        clearTimeout(timer);
    }
}

const VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU = 240;

function normalizeFileNamePart_ACU(value: string): string {
    return String(value || 'default')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96) || 'default';
}

function normalizePathSegment_ACU(value: string): string {
    return normalizeFileNamePart_ACU(value);
}

/**
 * [spv3.6.12] 角色名路径段规范化
 * SillyTavern 文件上传 API 仅接受 [a-zA-Z0-9_-]，
 * 因此必须使用 ASCII-only 规范化（与 normalizeFileNamePart_ACU 同策略）。
 * 非 ASCII 角色名（中文、日文等）清洗后为空则返回空字符串，
 * 调用方据此降级到无角色名格式（spv3.6.7 格式）。
 */
function normalizeChatNameSegment_ACU(value: string): string {
    return String(value || '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || '';
}

export function buildVectorIndexFileName_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    indexId: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    shardId?: string;
}): string {
    const scope = normalizeSummaryVectorIndexScope_ACU(parts);
    const chatKey = normalizeFileNamePart_ACU(scope.chatKey);
    const isolationKey = normalizeFileNamePart_ACU(scope.isolationKey);
    const indexId = normalizeFileNamePart_ACU(parts.indexId);
    const role = normalizeFileNamePart_ACU(parts.role);
    const shardId = parts.shardId ? `_${normalizeFileNamePart_ACU(parts.shardId)}` : '';
    return `TavernDB_ACU_vector_${chatKey}_${isolationKey}_${indexId}_${role}${shardId}`;
}

export function buildVectorIndexStableDirectory_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    const scope = normalizeSummaryVectorIndexScope_ACU(parts);
    return [
        'TavernDB_ACU_vector',
        normalizePathSegment_ACU(scope.chatKey),
        normalizePathSegment_ACU(scope.isolationKey),
        normalizePathSegment_ACU(scope.sourceTableKey),
    ].join('_');
}

export function buildVectorIndexStableFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    shardId?: string;
}): string {
    const scope = buildVectorIndexStableDirectory_ACU(parts);
    const role = normalizePathSegment_ACU(parts.role || 'manifest');
    if (parts.role === 'base_shard' || parts.role === 'delta_shard' || parts.role === 'vector_pack') {
        const shardName = normalizePathSegment_ACU(parts.shardId || (parts.role === 'vector_pack' ? 'pack_0001' : 'shard_0001'));
        return `${scope}_${role}_${shardName}`;
    }
    return `${scope}_${role}`;
}

export function buildVectorIndexSnapshotFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    indexId: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    shardId?: string;
}): string {
    const scope = buildVectorIndexStableDirectory_ACU(parts);
    const indexId = normalizePathSegment_ACU(parts.indexId || 'snapshot');
    const role = normalizePathSegment_ACU(parts.role || 'manifest');
    if (parts.role === 'base_shard' || parts.role === 'delta_shard' || parts.role === 'vector_pack') {
        const shardName = normalizePathSegment_ACU(parts.shardId || (parts.role === 'vector_pack' ? 'pack_0001' : 'shard_0001'));
        return `${scope}_${indexId}_${role}_${shardName}`;
    }
    return `${scope}_${indexId}_${role}`;
}

/**
 * V2 单文件快照必须是 immutable object path。角色名只是展示信息，绝不能参与寻址；
 * 否则改名会把同一逻辑 scope 分裂成不同文件。scope token 是完整 JSON tuple 的 UTF-8
 * base64url 编码，而不是短哈希；不能拿 32 位散列充当生产级唯一标识，碰撞后仍会覆盖对象。
 */
export function buildVectorIndexSingleSnapshotV2ScopeToken_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    const scope = normalizeSummaryVectorIndexScope_ACU(parts);
    const scopeJson = JSON.stringify([scope.chatKey, scope.isolationKey, scope.sourceTableKey]);
    const bytes = new TextEncoder().encode(scopeJson);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

export function buildVectorIndexSingleSnapshotV2FilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    indexId: string;
    writeGeneration: string;
    /** 仅为调用端兼容；V2 path 不使用该字段。 */
    chatName?: string;
}): string {
    const scopeToken = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(parts);
    const indexId = normalizePathSegment_ACU(parts.indexId || 'snapshot');
    const writeGeneration = normalizePathSegment_ACU(parts.writeGeneration || 'write');
    const path = `TavernDB_ACU_vector_v2_${scopeToken}_${indexId}_${writeGeneration}_snapshot`;
    if (path.length > VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU) {
        const excess = path.length - VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU;
        // 每个中文 UTF-8 编码占 3 字节，经 base64 后约 4 字符；ASCII 每字符 1 字节 → base64 约 1.33 字符。
        const chineseCharsToShorten = Math.ceil(excess / 4);
        throw new Error(
            `[纪要向量索引] V2 快照对象路径超长: length=${path.length}, max=${VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU}，`
            + `超出 ${excess} 字符。其中 scopeToken 占用 ${scopeToken.length} 字符，`
            + `indexId 占用 ${indexId.length} 字符，writeGeneration 占用 ${writeGeneration.length} 字符，其余固定前缀/后缀共 ${path.length - scopeToken.length - indexId.length - writeGeneration.length} 字符。`
            + `请缩短当前聊天名约 ${chineseCharsToShorten} 个中文字（或缩短数据隔离码），使路径回到上限内。`
            + '仅在当前没有任何已建成的纪要向量索引时，重命名聊天才不会使旧索引失联；'
            + '若已有索引，请勿直接改名，否则旧索引将无法再被寻址。'
            + '禁止截断 canonical scope 后继续写入。',
        );
    }
    return path;
}

/**
 * P4 内容寻址 pack 路径（T10）。
 * 用 V2 scope token（完整 JSON tuple base64url 编码）替代 buildVectorPackPath_ACU 走的
 * buildVectorIndexStableDirectory_ACU —— 后者会把中文 chatKey 清成 default，导致不同聊天共享路径。
 * 路径刻意不含 indexId/revision，这是跨 revision 复用 pack 的前提。
 * 前缀用 v2pack_ 而非 v2_，避免与 snapshot 前缀 TavernDB_ACU_vector_v2_ 互相误判。
 */
export function buildVectorIndexContentPackPathV2_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    packKey: string;
}): string {
    const scopeToken = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(parts);
    const packKey = normalizePathSegment_ACU(parts.packKey || 'pack_unknown');
    const path = `TavernDB_ACU_vector_v2pack_${scopeToken}_${packKey}`;
    if (path.length > VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU) {
        const excess = path.length - VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU;
        const chineseCharsToShorten = Math.ceil(excess / 4);
        throw new Error(
            `[纪要向量索引] 内容寻址 pack 对象路径超长: length=${path.length}, max=${VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU}，`
            + `超出 ${excess} 字符。其中 scopeToken 占用 ${scopeToken.length} 字符，`
            + `packKey 占用 ${packKey.length} 字符，其余固定前缀共 ${path.length - scopeToken.length - packKey.length} 字符。`
            + `请缩短当前聊天名约 ${chineseCharsToShorten} 个中文字（或缩短数据隔离码），使路径回到上限内。`
            + 'pack 路径不含 indexId/revision，跨 revision 复用；若仍超长，请检查 scope 是否过大。',
        );
    }
    return path;
}

const VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU = 'TavernDB_ACU_vector_v2pack_';

/** 判断路径是否为 P4 内容寻址 pack 路径（前缀判断，不解析内容）。 */
export function isVectorIndexContentPackPathV2_ACU(path: string): boolean {
    return String(path || '').startsWith(VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU);
}

/**
 * 从 pack 路径提取 scope token。非 pack 路径返回 null。
 * scopeToken 是 base64url 编码，只含 [A-Za-z0-9_-]，可用首个下划线之前的部分提取。
 */
export interface VectorIndexDecodedScope_ACU {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}

/**
 * 尝试把 base64url token 解码回 [chatKey, isolationKey, sourceTableKey] 三元组。
 * 解码失败或形状不符（非长度 3 的字符串数组）返回 null。
 */
function tryDecodeVectorIndexScopeToken_ACU(token: string): VectorIndexDecodedScope_ACU | null {
    if (!token || /[^A-Za-z0-9_-]/.test(token)) return null;
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    try {
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((item) => typeof item === 'string')) {
            return { chatKey: parsed[0], isolationKey: parsed[1], sourceTableKey: parsed[2] };
        }
    } catch (_error) {
        // 候选分割点不是完整 token 时解码/JSON 解析必然失败，继续尝试下一个。
    }
    return null;
}

/**
 * 从 V2 快照 / v2pack 对象路径反解 canonical scope。
 * 注意：scopeToken 的 base64url 字母表包含 `_`（来自 base64 的 `/` 替换），
 * 不能用"首个下划线"切分；这里逐个 `_` 候选分割点（含全串）尝试解码，
 * 只有 JSON 三元组解析成功才算命中。截断的 base64 无法解析出完整 JSON
 * 数组，因此不存在提前误命中的可能。
 */
export function decodeVectorIndexScopeFromPath_ACU(path: string): VectorIndexDecodedScope_ACU | null {
    const normalized = String(path || '');
    const prefixes = [VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU, 'TavernDB_ACU_vector_v2_'];
    for (const prefix of prefixes) {
        if (!normalized.startsWith(prefix)) continue;
        const remainder = normalized.slice(prefix.length);
        for (let index = 0; index <= remainder.length; index += 1) {
            if (index < remainder.length && remainder[index] !== '_') continue;
            const decoded = tryDecodeVectorIndexScopeToken_ACU(remainder.slice(0, index));
            if (decoded) return decoded;
        }
        return null;
    }
    return null;
}

export function extractVectorIndexContentPackScopeTokenFromPath_ACU(path: string): string | null {
    const normalized = String(path || '');
    if (!isVectorIndexContentPackPathV2_ACU(normalized)) return null;
    const remainder = normalized.slice(VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU.length);
    const separatorIndex = remainder.indexOf('_');
    if (separatorIndex < 0) return null;
    const scopeToken = remainder.slice(0, separatorIndex);
    return scopeToken || null;
}

export function buildVectorIndexSingleSnapshotFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    /** [spv3.6.8] 可选角色名前缀，用于提高文件可读性。为空时降级到 chatKey-only 格式 */
    chatName?: string;
}): string {
    const chatKey = normalizePathSegment_ACU(parts.chatKey);
    // [spv3.6.8] 角色名前缀：清洗后非空则加入路径，提高文件可识别性
    const chatName = normalizeChatNameSegment_ACU(parts.chatName || '');
    if (chatName) {
        return `TavernDB_ACU_vector_${chatName}_${chatKey}_snapshot`;
    }
    // [spv3.6.7] 无角色名时降级到只用 chatKey 的格式
    return `TavernDB_ACU_vector_${chatKey}_snapshot`;
}

/**
 * [spv3.6.7] 构建旧版外置快照路径（含 isolationKey + sourceTableKey）
 * 仅用于向后兼容：读取旧版文件时回退尝试
 */
export function buildLegacyVectorIndexSingleSnapshotFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    return `${buildVectorIndexStableDirectory_ACU(parts)}_snapshot`;
}

function encodeUserFilePath_ACU(path: string): string {
    const raw = String(path || '').trim();
    if (raw.includes('..') || raw.includes('\\') || raw.includes('\0')) {
      throw new Error('文件路径不能包含 .. 或反斜杠');
    }
    return raw
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => {
          if (segment === '..' || segment.includes('\\')) throw new Error('文件路径不能包含 .. 或反斜杠');
          return encodeURIComponent(segment);
        })
        .join('/');
}

function getUserFileUrl_ACU(path: string): string {
    const raw = String(path || '').trim();
    if (raw.includes('..') || raw.includes('\\') || raw.includes('\0')) {
      throw new Error('文件路径不能包含 .. 或反斜杠');
    }
    return `/user/files/${encodeUserFilePath_ACU(path)}?t=${Date.now()}`;
}

async function encodeBase64_ACU(text: string): Promise<string> {
    const blob = new Blob([text], { type: 'application/json' });
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64);
        };
        reader.onerror = () => reject(new Error('Base64 encoding failed'));
        reader.readAsDataURL(blob);
    });
}

export async function sha256Text_ACU(text: string): Promise<string> {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.subtle) {
        const data = new TextEncoder().encode(text);
        const digest = await cryptoApi.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 0;
    for (let index = 0; index < text.length; index++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(index);
        hash |= 0;
    }
    return `fallback-${Math.abs(hash)}`;
}

export async function uploadVectorIndexJsonFile_ACU(params: {
    path: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    data: any;
    shardId?: string;
    chunkCount?: number;
    rowCount?: number;
    status?: SummaryVectorIndexExternalFileRef_ACU['status'];
}): Promise<VectorIndexFileWriteResult_ACU> {
    try {
        const json = JSON.stringify(params.data);
        const checksum = await sha256Text_ACU(json);
        const base64Data = await encodeBase64_ACU(json);
        const response = await fetchWithTimeout_ACU('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders_ACU(),
            body: JSON.stringify({
                name: params.path,
                data: base64Data,
            }),
        }, '上传交火向量文件');
        if (!response.ok) {
            const detail = await response.text().catch(() => response.statusText);
            return { ok: false, error: `上传失败 ${response.status}: ${detail}` };
        }
        const now = new Date().toISOString();
        return {
            ok: true,
            ref: {
                role: params.role,
                path: params.path,
                shardId: params.shardId,
                byteSize: new Blob([json]).size,
                checksum,
                chunkCount: params.chunkCount,
                rowCount: params.rowCount,
                createdAt: now,
                updatedAt: now,
                status: params.status || 'ready',
            },
        };
    } catch (error) {
        return { ok: false, error: normalizeError_ACU(error) };
    }
}

export async function readVectorIndexJsonFile_ACU<T = any>(path: string): Promise<{ ok: boolean; data?: T; error?: string; status?: number; corrupted?: boolean }> {
    try {
        const response = await fetchWithTimeout_ACU(getUserFileUrl_ACU(path), { method: 'GET' }, '读取交火向量文件');
        if (!response.ok) {
            // V1-d：404 是唯一能证明「文件不存在」的响应；其余状态码（5xx/403 等）
            // 只能证明「读取失败」，标记 corrupted 供上层区分，不得被当成空文件吞掉。
            return {
                ok: false,
                status: response.status,
                corrupted: response.status !== 404,
                error: `读取失败 ${response.status}: ${response.statusText}`,
            };
        }
        return { ok: true, data: await response.json() as T };
    } catch (error: any) {
        // V1-d：JSON 解析异常/超时/网络失败同样标记 corrupted——读取结果无法证明文件不存在。
        // 注意 response.json() 抛错发生在 fetchWithTimeout 之外，这里按错误形态细分。
        const message = error?.name === 'SyntaxError'
            ? `JSON 解析失败：${normalizeError_ACU(error)}`
            : normalizeError_ACU(error);
        return { ok: false, corrupted: true, error: message };
    }
}

interface VectorIndexFileDeleteRequestCandidate_ACU {
    label: string;
    body: Record<string, string>;
}

let preferredDeletePrefixLabel_ACU: string | null = null;

function normalizeDeletePathInput_ACU(path: string): string {
    return String(path || '')
        .trim()
        .replace(/^\/+/, '')
        .replace(/^user\/files\//, '')
        .replace(/^files\//, '');
}

function buildDeleteRequestCandidates_ACU(path: string): VectorIndexFileDeleteRequestCandidate_ACU[] {
    const fileName = normalizeDeletePathInput_ACU(path);
    const candidates: VectorIndexFileDeleteRequestCandidate_ACU[] = [];
    const seen = new Set<string>();
    const addCandidate = (label: string, body: Record<string, string>): void => {
        const key = JSON.stringify(body);
        if ((body.path || body.name) && !seen.has(key)) {
            seen.add(key);
            candidates.push({ label, body });
        }
    };

    // SillyTavern exposes uploaded files as /user/files/<name>. Different builds have accepted
    // different relative roots for /api/files/delete, so keep candidates explicit and verify after
    // a 404 instead of pretending the delete succeeded. 能跑不等于能删干净。
    addCandidate('path:user-files-prefix', { path: `user/files/${fileName}` });
    addCandidate('path:absolute-user-files-prefix', { path: `/user/files/${fileName}` });
    addCandidate('path:files-prefix', { path: `files/${fileName}` });
    addCandidate('path:filename', { path: fileName });

    if (!preferredDeletePrefixLabel_ACU) return candidates;
    const preferred = candidates.find((candidate) => candidate.label === preferredDeletePrefixLabel_ACU);
    if (!preferred) return candidates;
    return [preferred, ...candidates.filter((candidate) => candidate.label !== preferredDeletePrefixLabel_ACU)];
}

async function vectorIndexFileExists_ACU(path: string): Promise<boolean> {
    try {
        const response = await fetchWithTimeout_ACU(getUserFileUrl_ACU(path), { method: 'GET' }, '探测交火向量文件存在性');
        if (response.status === 404) return false;
        return response.ok;
    } catch (_) {
        return false;
    }
}

export async function deleteVectorIndexFile_ACU(path: string): Promise<VectorIndexFileDeleteResult_ACU> {
    const normalizedPath = normalizeDeletePathInput_ACU(path);
    if (!normalizedPath) {
        return { ok: false, path, error: '删除失败：文件路径为空' };
    }

    const attempts: string[] = [];
    let notFoundSeen = false;
    for (const candidate of buildDeleteRequestCandidates_ACU(normalizedPath)) {
        try {
            const response = await fetchWithTimeout_ACU('/api/files/delete', {
                method: 'POST',
                headers: getRequestHeaders_ACU(),
                body: JSON.stringify(candidate.body),
            }, '删除交火向量文件');
            if (response.ok) {
                preferredDeletePrefixLabel_ACU = candidate.label;
                return { ok: true, path: normalizedPath };
            }
            const detail = await response.text().catch(() => response.statusText);
            if (response.status === 404) {
                notFoundSeen = true;
            }
            attempts.push(`${candidate.label} -> ${response.status}: ${detail || response.statusText}`);
        } catch (error) {
            attempts.push(`${candidate.label} -> ${normalizeError_ACU(error)}`);
        }
    }

    if (notFoundSeen && !(await vectorIndexFileExists_ACU(normalizedPath))) {
        return { ok: true, path: normalizedPath };
    }

    return {
        ok: false,
        path: normalizedPath,
        error: `删除失败，已尝试 ${attempts.length} 种 path 请求体: ${attempts.join('；')}`,
    };
}

export async function loadVectorIndexRegistry_ACU(): Promise<SummaryVectorIndexRegistryFile_ACU> {
    const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexRegistryFile_ACU>(SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU);
    if (!loaded.ok) {
        // V1-d：只有明确 404 才能证明 registry 不存在（真空库 → 返回空 store）。
        // 其余失败（损坏/非 404/超时/网络）一律抛错中断 load→merge→save，
        // 防止半截损坏的 registry 被空 store 覆盖写造成不可逆缩库。
        if (loaded.status === 404 && !loaded.corrupted) {
            return { version: 1, updatedAt: new Date().toISOString(), files: [] };
        }
        throw new Error(`[交火向量索引] registry 读取失败且无法证明文件不存在，中断合并写入: ${loaded.error || '未知错误'}`);
    }
    if (!loaded.data || typeof loaded.data !== 'object' || !Array.isArray(loaded.data.files)) {
        // 能解析但不是合法 registry（缺 files 数组）同样是损坏证据，不能当成空库。
        throw new Error('[交火向量索引] registry 内容不符合 schema（缺 files 数组），中断合并写入防止缩库');
    }
    return {
        version: 1,
        updatedAt: String(loaded.data.updatedAt || new Date().toISOString()),
        files: loaded.data.files,
    };
}

export async function saveVectorIndexRegistry_ACU(registry: SummaryVectorIndexRegistryFile_ACU): Promise<void> {
    const next: SummaryVectorIndexRegistryFile_ACU = {
        version: 1,
        updatedAt: new Date().toISOString(),
        files: Array.isArray(registry.files) ? registry.files : [],
    };
    const saved = await uploadVectorIndexJsonFile_ACU({
        path: SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU,
        role: 'registry',
        data: next,
        status: 'ready',
    });
    if (!saved.ok) {
        const detail = saved.error || '未知上传失败';
        logWarn_ACU('[交火向量索引] registry 保存失败:', detail);
        throw new Error(`[交火向量索引] registry 保存失败: path=${SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU}; error=${detail}`);
    }
}

export async function registerVectorIndexFiles_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): Promise<void> {
    if (!Array.isArray(files) || files.length === 0) return;
    const registry = await loadVectorIndexRegistry_ACU();
    const byPath = new Map(registry.files.map((file) => [file.path, file]));
    files.forEach((file) => byPath.set(file.path, file));
    registry.files = Array.from(byPath.values());
    await saveVectorIndexRegistry_ACU(registry);
}

export async function unregisterVectorIndexFiles_ACU(paths: string[]): Promise<void> {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const pathSet = new Set(paths);
    const registry = await loadVectorIndexRegistry_ACU();
    registry.files = registry.files.filter((file) => !pathSet.has(file.path));
    await saveVectorIndexRegistry_ACU(registry);
}

export async function deleteRegisteredVectorIndexFilesWhere_ACU(
    predicate: (file: SummaryVectorIndexExternalFileRef_ACU) => boolean,
): Promise<string[]> {
    const registry = await loadVectorIndexRegistry_ACU();
    const removableFiles = registry.files.filter((file) => file?.path && predicate(file));
    const removablePaths = Array.from(new Set(removableFiles.map((file) => file.path).filter(Boolean)));
    if (removablePaths.length === 0) return [];

    const deletedPaths: string[] = [];
    for (const path of removablePaths) {
        const result = await deleteVectorIndexFile_ACU(path);
        if (result.ok) {
            deletedPaths.push(result.path);
        } else {
            logWarn_ACU('[交火向量索引] registry 作用域清理外置文件失败:', path, result.error);
        }
    }
    await unregisterVectorIndexFiles_ACU(deletedPaths);
    return deletedPaths;
}
