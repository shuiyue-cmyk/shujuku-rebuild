import { getHostRequestHeaders_ACU } from './ai-gateway';

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
    const rawScore = item.relevance_score ?? item.relevanceScore ?? item.score;
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

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildRerankHeaders_ACU(request.apiKey),
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Rerank 请求失败: ${response.status} ${await response.text()}`);
    }

    const responsePayload = await response.json();
    return extractRerankResults_ACU(responsePayload);
}
