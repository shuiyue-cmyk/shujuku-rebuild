import type { ChatSummaryVectorIndexChunk_ACU, ChatSummaryVectorIndexRow_ACU } from './summary-vector-index-types';

export interface SummaryHybridCandidate_ACU {
    chunk: ChatSummaryVectorIndexChunk_ACU;
    row: ChatSummaryVectorIndexRow_ACU;
    score: number;
    denseScore?: number;
    bm25Score?: number;
    rrfScore?: number;
}

interface Bm25Document_ACU {
    candidate: SummaryHybridCandidate_ACU;
    tokens: string[];
    frequencies: Map<string, number>;
}

interface Bm25Corpus_ACU {
    documents: Bm25Document_ACU[];
    documentFrequency: Map<string, number>;
    averageDocumentLength: number;
    documentCount: number;
}

const BM25_K1_ACU = 1.5;
const BM25_B_ACU = 0.75;

function pushCjkTokens_ACU(tokens: string[], segment: string): void {
    for (const char of segment) tokens.push(char);
    for (let index = 0; index < segment.length - 1; index += 1) {
        tokens.push(segment.slice(index, index + 2));
    }
}

function collectBm25Tokens_ACU(text: string): string[] {
    const normalized = String(text || '').toLowerCase();
    const tokens: string[] = [];
    const pattern = /[a-z0-9_]+|[\u3400-\u9fff]+/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
        const part = match[0];
        if (!part) continue;
        if (/^[\u3400-\u9fff]+$/u.test(part)) {
            pushCjkTokens_ACU(tokens, part);
        } else {
            tokens.push(part);
        }
    }
    return tokens.filter((token) => token.length > 0);
}

export function tokenizeBm25Text_ACU(text: string): string[] {
    const tokens = collectBm25Tokens_ACU(text);
    return Array.from(new Set(tokens.filter((token) => token.length > 0)));
}

function buildCorpus_ACU(candidates: SummaryHybridCandidate_ACU[]): Bm25Corpus_ACU {
    const documentFrequency = new Map<string, number>();
    const documents = candidates.map((candidate) => {
        const tokens = collectBm25Tokens_ACU(candidate.chunk.text || '');
        const frequencies = new Map<string, number>();
        tokens.forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1));
        Array.from(frequencies.keys()).forEach((token) => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1));
        return { candidate, tokens, frequencies };
    });
    const totalLength = documents.reduce((sum, doc) => sum + doc.tokens.length, 0);
    return {
        documents,
        documentFrequency,
        averageDocumentLength: documents.length > 0 ? totalLength / documents.length : 0,
        documentCount: documents.length,
    };
}

// T10：BM25 语料缓存。键由调用方提供（runtime 用 indexId + writeGeneration + 候选 chunk 集合指纹），
// 索引切换 / 聊天切换 / 重新归档导致 chunk 集合变化时键自然变化，不会误用旧语料。
// 容量设上限：长期运行下 writeGeneration 每次归档都变，若无上限会累积旧键。
const BM25_CORPUS_CACHE_MAX_ACU = 4;
const bm25CorpusCache_ACU = new Map<string, Bm25Corpus_ACU>();

export function clearBm25CorpusCache_ACU(): void {
    bm25CorpusCache_ACU.clear();
}

function getOrBuildBm25Corpus_ACU(candidates: SummaryHybridCandidate_ACU[], cacheKey?: string): Bm25Corpus_ACU {
    if (cacheKey) {
        const cached = bm25CorpusCache_ACU.get(cacheKey);
        if (cached) return cached;
    }
    const built = buildCorpus_ACU(candidates);
    if (cacheKey) {
        bm25CorpusCache_ACU.set(cacheKey, built);
        // 超过上限时淘汰最旧键（Map 迭代顺序即插入顺序）。
        if (bm25CorpusCache_ACU.size > BM25_CORPUS_CACHE_MAX_ACU) {
            const oldestKey = bm25CorpusCache_ACU.keys().next().value as string | undefined;
            if (oldestKey !== undefined) bm25CorpusCache_ACU.delete(oldestKey);
        }
    }
    return built;
}

function scoreBm25Document_ACU(queryTokens: string[], document: Bm25Document_ACU, corpus: Bm25Corpus_ACU): number {
    if (queryTokens.length === 0 || corpus.documentCount === 0 || document.tokens.length === 0) return 0;
    let score = 0;
    for (const token of queryTokens) {
        const tf = document.frequencies.get(token) || 0;
        if (tf <= 0) continue;
        const df = corpus.documentFrequency.get(token) || 0;
        const idf = Math.log(1 + (corpus.documentCount - df + 0.5) / (df + 0.5));
        const lengthNorm = 1 - BM25_B_ACU + BM25_B_ACU * (document.tokens.length / Math.max(1, corpus.averageDocumentLength));
        score += idf * ((tf * (BM25_K1_ACU + 1)) / (tf + BM25_K1_ACU * lengthNorm));
    }
    return score;
}

export function sparseSearchBm25_ACU(query: string, candidates: SummaryHybridCandidate_ACU[], limit: number, cacheKey?: string): SummaryHybridCandidate_ACU[] {
    const queryTokens = tokenizeBm25Text_ACU(query);
    const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
    if (queryTokens.length === 0 || candidates.length === 0) return [];
    const corpus = getOrBuildBm25Corpus_ACU(candidates, cacheKey);
    return corpus.documents
        .map((document) => {
            const bm25Score = scoreBm25Document_ACU(queryTokens, document, corpus);
            return { ...document.candidate, score: bm25Score, bm25Score };
        })
        .filter((candidate) => candidate.bm25Score !== undefined && candidate.bm25Score > 0)
        .sort((left, right) => (right.bm25Score || 0) - (left.bm25Score || 0))
        .slice(0, normalizedLimit);
}

function getCandidateKey_ACU(candidate: SummaryHybridCandidate_ACU): string {
    const chunk = candidate.chunk;
    return chunk.chunkId || `${chunk.rowKey || candidate.row.rowKey}::${chunk.textHash || chunk.sequence || chunk.text}`;
}

export function reciprocalRankFusion_ACU(resultLists: SummaryHybridCandidate_ACU[][], rrfK: number, limit: number): SummaryHybridCandidate_ACU[] {
    const normalizedK = Math.max(1, Math.floor(Number(rrfK) || 60));
    const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
    const byKey = new Map<string, SummaryHybridCandidate_ACU>();
    resultLists.forEach((results) => {
        results.forEach((candidate, index) => {
            const key = getCandidateKey_ACU(candidate);
            const previous = byKey.get(key);
            const rrfScore = 1 / (normalizedK + index + 1);
            byKey.set(key, {
                ...(previous || candidate),
                denseScore: previous?.denseScore ?? candidate.denseScore,
                bm25Score: previous?.bm25Score ?? candidate.bm25Score,
                rrfScore: (previous?.rrfScore || 0) + rrfScore,
                score: (previous?.rrfScore || 0) + rrfScore,
            });
        });
    });
    return Array.from(byKey.values())
        .sort((left, right) => (right.rrfScore || 0) - (left.rrfScore || 0))
        .slice(0, normalizedLimit);
}
