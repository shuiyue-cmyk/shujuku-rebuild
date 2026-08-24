import { assertSafeHttpEndpoint_ACU } from '../../shared/utils';

export type VectorEmbeddingErrorKind_ACU =
    | 'credential' | 'request' | 'provider-contract' | 'retryable' | 'limited-retryable';
export interface VectorEmbeddingRequest_ACU {
    endpoint: string;
    apiKey?: string;
    model: string;
    input: string[];
}

export interface VectorEmbeddingResult_ACU {
    index: number;
    embedding: number[];
}

export class VectorEmbeddingError_ACU extends Error {
    readonly kind: VectorEmbeddingErrorKind_ACU;
    readonly httpStatus: number | null;
    readonly providerCode: string | null;
    readonly providerMessage: string | null;
    readonly retryAfterMs: number | null;
    readonly endpoint: string;
    readonly model: string;

    constructor(options: {
        kind: VectorEmbeddingErrorKind_ACU;
        message: string;
        httpStatus?: number | null;
        providerCode?: string | null;
        providerMessage?: string | null;
        retryAfterMs?: number | null;
        endpoint: string;
        model: string;
    }) {
        super(options.message);
        this.name = 'VectorEmbeddingError_ACU';
        this.kind = options.kind;
        this.httpStatus = options.httpStatus ?? null;
        this.providerCode = options.providerCode ?? null;
        this.providerMessage = options.providerMessage ?? null;
        this.retryAfterMs = options.retryAfterMs ?? null;
        this.endpoint = options.endpoint;
        this.model = options.model;
    }
}

export function isVectorEmbeddingError_ACU(value: unknown): value is VectorEmbeddingError_ACU {
    return value instanceof VectorEmbeddingError_ACU;
}

function normalizeEmbeddingVector_ACU(value: any): number[] {
    if (!Array.isArray(value)) return [];
    const vector = value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    return vector.length === value.length ? vector : [];
}

function normalizeEmbeddingResponse_ACU(payload: any): VectorEmbeddingResult_ACU[] {
    const data = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.embeddings)
            ? payload.embeddings
            : [];
    return data
        .map((item: any, fallbackIndex: number): VectorEmbeddingResult_ACU => ({
            index: Number.isInteger(item?.index) ? Number(item.index) : fallbackIndex,
            embedding: normalizeEmbeddingVector_ACU(item?.embedding ?? item),
        }))
        .filter((item: VectorEmbeddingResult_ACU) => item.embedding.length > 0);
}

/** 按分类表决定 HTTP 状态对应的错误种类（T3）。 */
function classifyEmbeddingHttpError_ACU(status: number): VectorEmbeddingErrorKind_ACU {
    switch (status) {
        case 401: return 'credential';
        case 403: return 'credential';
        case 400:
        case 404:
        case 422: return 'request';
        case 413: return 'limited-retryable';
        case 408:
        case 429: return 'retryable';
        default: return status >= 500 ? 'retryable' : 'request';
    }
}

/** 解析 Retry-After：秒（数字或 HTTP-date）→ ms。无法解析返回 null。 */
function parseRetryAfterMs_ACU(value: string | null | undefined): number | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
        const seconds = Number(trimmed);
        return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
        return Math.max(0, parsed - Date.now());
    }
    return null;
}

/** 解析错误响应体：优先 JSON 的 error.code / error.message，否则取原始文本。 */
function parseEmbeddingErrorBody_ACU(raw: string): { providerCode: string | null; providerMessage: string | null } {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { providerCode: null, providerMessage: null };
    try {
        const payload = JSON.parse(trimmed);
        const code = payload?.error?.code ?? payload?.code ?? null;
        const message = payload?.error?.message ?? payload?.message ?? null;
        return {
            providerCode: code != null ? String(code) : null,
            providerMessage: message != null ? String(message) : null,
        };
    } catch (_error) {
        return { providerCode: null, providerMessage: trimmed.slice(0, 500) };
    }
}

async function throwEmbeddingHttpErrorAsync_ACU(
    response: Response,
    endpoint: string,
    model: string,
): Promise<never> {
    const raw = await response.text().catch((): string => response.statusText);
    const { providerCode, providerMessage } = parseEmbeddingErrorBody_ACU(raw);
    const kind = classifyEmbeddingHttpError_ACU(response.status);
    const retryAfterMs = parseRetryAfterMs_ACU(response.headers.get('Retry-After'));
    const status = response.status;
    const detail = providerMessage || raw || response.statusText;
    throw new VectorEmbeddingError_ACU({
        kind,
        message: `Embedding 请求失败 ${status}: ${detail}`,
        httpStatus: status,
        providerCode,
        providerMessage: providerMessage || detail,
        retryAfterMs,
        endpoint,
        model,
    });
}

// [M5] Embedding fetch 防悬挂超时。目标运行环境（现代 WebView/Tauri）AbortSignal.timeout 可用性存疑，
// 用手动 AbortController+setTimeout 兜底；AbortController 不可用时退化为无超时（与旧行为一致）。
// 取 120s：本网关除 query 单条外还承载归档构建的批量 chunk 嵌入（summary-vector-index-archive-service），
// 30s 可能误杀原本能完成的大批量请求；120s 对悬挂仍是有效上界。
const EMBEDDING_FETCH_TIMEOUT_MS_ACU = 120000;

function createFetchAbortTimer_ACU(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } | null {
    if (typeof AbortController !== 'function') return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

export async function createEmbeddings_ACU(request: VectorEmbeddingRequest_ACU): Promise<VectorEmbeddingResult_ACU[]> {
    const endpoint = String(request.endpoint || '').trim();
    const model = String(request.model || '').trim();
    const input = Array.isArray(request.input) ? request.input.map((item) => String(item ?? '')) : [];
    if (!endpoint) {
        throw new Error('缺少 embeddingEndpoint，无法生成纪要向量索引。');
    }
    if (!model) {
        throw new Error('缺少 embeddingModel，无法生成纪要向量索引。');
    }
    if (input.length === 0) {
        return [];
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = String(request.apiKey || '').trim();
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    assertSafeHttpEndpoint_ACU(endpoint);
    // [M5] 挂超时：超时 abort 让 fetch 抛 AbortError 向上传播（运行时 T5 路径已有降级处理）。
    const abortTimer = createFetchAbortTimer_ACU(EMBEDDING_FETCH_TIMEOUT_MS_ACU);
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model, input }),
            redirect: 'error',
            ...(abortTimer ? { signal: abortTimer.signal } : {}),
        });
    } finally {
        abortTimer?.cleanup();
    }
    if (!response.ok) {
        await throwEmbeddingHttpErrorAsync_ACU(response, endpoint, model);
    }
    const payload = await response.json();
    const normalized = normalizeEmbeddingResponse_ACU(payload);
    if (normalized.length === 0) {
        throw new VectorEmbeddingError_ACU({
            kind: 'provider-contract',
            message: 'Embedding 响应中没有可用向量。',
            httpStatus: response.status,
            endpoint,
            model,
        });
    }
    return normalized;
}
