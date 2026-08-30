import { getHostRequestHeaders_ACU } from './ai-gateway';

/** Rerank 请求超时上界；超时抛错由调用方回退到 embedding 排序。 */
const VECTOR_RERANK_TIMEOUT_MS_ACU = 30_000;

export interface VectorRerankResult_ACU {
    index: number;
    relevanceScore: number;
}

export interface VectorRerankRequest_ACU {
    endpoint: string;
    apiKey?: string;
    model: string;
    query: string;
    documents: string[];
    instruction?: string;
}

function normalizeEndpoint_ACU(endpoint: string): string {
    return String(endpoint || '').trim().replace(/\/+$/, '');
}

function buildRerankHeaders_ACU(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
        ...getHostRequestHeaders_ACU(),
        'Content-Type': 'application/json',
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

function normalizeRerankItem_ACU(item: any, fallbackIndex: number): VectorRerankResult_ACU | null {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const rawIndex = item.index ?? item.document_index ?? item.documentIndex;
    const rawScore = item.relevance_score ?? item.relevanceScore ?? item.score ?? item.rerank_score;
    const index = Number.isFinite(Number(rawIndex)) ? Math.floor(Number(rawIndex)) : fallbackIndex;
    const relevanceScore = Number(rawScore);


    if (!Number.isFinite(index) || index < 0 || !Number.isFinite(relevanceScore)) {
        return null;
    }

    return {
        index,
        relevanceScore,
    };
}

function extractRerankResults_ACU(payload: any): VectorRerankResult_ACU[] {
    const rawResults = Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.data?.results)
            ? payload.data.results
            : Array.isArray(payload?.data)
                ? payload.data
                : [];

    return rawResults
        .map((item: any, index: number) => normalizeRerankItem_ACU(item, index))
        .filter((item: VectorRerankResult_ACU | null): item is VectorRerankResult_ACU => !!item);
}

export async function createRerankScores_ACU(request: VectorRerankRequest_ACU): Promise<VectorRerankResult_ACU[]> {
    const endpoint = normalizeEndpoint_ACU(request.endpoint);
    const model = String(request.model || '').trim();
    const query = String(request.query || '').trim();
    const documents = Array.isArray(request.documents)
        ? request.documents.map((item) => String(item ?? '').trim())
        : [];

    if (!endpoint) {
        throw new Error('Rerank endpoint 为空。');
    }
    if (!model) {
        throw new Error('Rerank model 为空。');
    }
    if (!query) {
        return [];
    }
    if (documents.length === 0 || documents.every((item) => !item)) {
        return [];
    }

    const instruction = String(request.instruction ?? '').trim();
    const payload: Record<string, any> = { model, query, documents };
    if (instruction) payload.instruction = instruction;

    // 超时可中断：rerank 在发送前同步链路上，挂起的上游不允许无限阻塞生成。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VECTOR_RERANK_TIMEOUT_MS_ACU);
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: buildRerankHeaders_ACU(request.apiKey),
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } catch (error: any) {
        throw new Error(error?.name === 'AbortError'
            ? `Rerank 请求超时（${VECTOR_RERANK_TIMEOUT_MS_ACU}ms），已中断。`
            : `Rerank 请求网络失败：${error?.message || String(error || '未知错误')}`);
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`Rerank 请求失败: ${response.status} ${detail}`);
    }

    const rawBody = await response.text().catch((): string => '');
    let responsePayload: any;
    try {
        responsePayload = JSON.parse(rawBody);
    } catch (_error) {
        throw new Error(`Rerank 响应不是合法 JSON（前 200 字符：${rawBody.slice(0, 200)}）。`);
    }
    const results = extractRerankResults_ACU(responsePayload);
    // V1-f：provider 可能按 top_n 截断返回。部分打分若直接交给调用方，
    // 未命中候选会拿 embedding score 与 rerankScore 混排（runtime 混排点），
    // 产生系统性错序且难以察觉。条数或覆盖度不足即显式抛错，
    // 让调用方整批回退 embedding 排序（回退路径保持全量同尺度）。
    const coveredIndexes = new Set(results.map((item) => item.index));
    if (results.length !== documents.length || coveredIndexes.size !== documents.length) {
        throw new Error(`Rerank 返回条数不完整：期望 ${documents.length} 条，实际 ${results.length} 条（可能被供应商 top_n 截断），回退整批 embedding 排序。`);
    }
    return results;
}
