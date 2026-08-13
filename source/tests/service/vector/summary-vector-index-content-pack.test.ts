import { describe, expect, it } from 'vitest';
import {
    SUMMARY_VECTOR_INDEX_CONTENT_PACK_MAX_CHUNKS_ACU,
    SUMMARY_VECTOR_INDEX_CONTENT_PACK_MIN_CHUNKS_ACU,
    buildContentPackBlob_ACU,
    buildContentPackKey_ACU,
    fnv1a32_ACU,
    isContentPackBoundary_ACU,
    planContentPackGroups_ACU,
    serializeContentPackForHash_ACU,
} from '../../../src/service/vector/summary-vector-index-content-pack';
import { SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU } from '../../../src/service/vector/summary-vector-index-types';

function makeChunkKeys(count: number): string[] {
    const keys: string[] = [];
    for (let index = 0; index < count; index += 1) {
        keys.push(`chunk_${index.toString(16).padStart(8, '0')}`);
    }
    return keys;
}

describe('fnv1a32_ACU', () => {
    it('对空串、非 base36、超长输入都返回确定的无符号 32 位整数', () => {
        for (const input of ['', 'abc', 'chunk_zzz_中文超长'.repeat(50), '!@#$%^&*()']) {
            const a = fnv1a32_ACU(input);
            const b = fnv1a32_ACU(input);
            expect(Number.isInteger(a)).toBe(true);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(0xffffffff);
            expect(a).toBe(b);
        }
    });

    it('不同输入大概率不同（抽样断言不相等）', () => {
        const seen = new Set<number>();
        for (let index = 0; index < 100; index += 1) {
            seen.add(fnv1a32_ACU(`key_${index}`));
        }
        expect(seen.size).toBe(100);
    });
});

describe('isContentPackBoundary_ACU 边界行为', () => {
    it('currentPackSize >= MAX_CHUNKS 恒为 true', () => {
        expect(isContentPackBoundary_ACU('any', SUMMARY_VECTOR_INDEX_CONTENT_PACK_MAX_CHUNKS_ACU)).toBe(true);
        expect(isContentPackBoundary_ACU('any', SUMMARY_VECTOR_INDEX_CONTENT_PACK_MAX_CHUNKS_ACU + 5)).toBe(true);
    });

    it('currentPackSize < MIN_CHUNKS 恒为 false', () => {
        expect(isContentPackBoundary_ACU('any', 0)).toBe(false);
        expect(isContentPackBoundary_ACU('any', 15)).toBe(false);
        expect(isContentPackBoundary_ACU('any', SUMMARY_VECTOR_INDEX_CONTENT_PACK_MIN_CHUNKS_ACU - 1)).toBe(false);
    });

    it('MIN_CHUNKS <= size < MAX_CHUNKS 时由 hash 决定（16/64/255 均返回布尔且确定）', () => {
        for (const size of [16, 64, 255]) {
            const result = isContentPackBoundary_ACU('chunk_some_key', size);
            expect(typeof result).toBe('boolean');
            expect(result).toBe(isContentPackBoundary_ACU('chunk_some_key', size));
        }
    });

    it('chunkKey 为空串/非 base36/超长时仍返回布尔且不抛', () => {
        for (const key of ['', '!!!', 'x'.repeat(10000), '中文键', 'pack_hash_abc']) {
            expect(typeof isContentPackBoundary_ACU(key, 32)).toBe('boolean');
            expect(typeof isContentPackBoundary_ACU(key, SUMMARY_VECTOR_INDEX_CONTENT_PACK_MIN_CHUNKS_ACU)).toBe('boolean');
        }
    });

    it('opts 覆盖 TARGET/MIN/MAX 生效', () => {
        expect(isContentPackBoundary_ACU('any', 299, { maxChunks: 300 })).toBe(false);
        expect(isContentPackBoundary_ACU('any', 300, { maxChunks: 300 })).toBe(true);
        expect(isContentPackBoundary_ACU('any', 301, { maxChunks: 300 })).toBe(true);
        expect(isContentPackBoundary_ACU('any', 2, { minChunks: 3 })).toBe(false);
        expect(isContentPackBoundary_ACU('any', 3, { minChunks: 3 })).toBe(false);
        expect(typeof isContentPackBoundary_ACU('any', 0, { minChunks: 0 })).toBe('boolean');
    });
});

describe('planContentPackGroups_ACU', () => {
    it('同输入分组完全一致', () => {
        const keys = makeChunkKeys(1000);
        expect(planContentPackGroups_ACU(keys)).toEqual(planContentPackGroups_ACU(keys));
    });

    it('空输入返回空数组', () => {
        expect(planContentPackGroups_ACU([])).toEqual([]);
        expect(planContentPackGroups_ACU(null as unknown as string[])).toEqual([]);
    });

    it('1000 个 key 分组后每组 <= MAX_CHUNKS，除末组外 >= MIN_CHUNKS', () => {
        const groups = planContentPackGroups_ACU(makeChunkKeys(1000));
        expect(groups.length).toBeGreaterThan(0);
        groups.forEach((group, groupIndex) => {
            expect(group.length).toBeLessThanOrEqual(SUMMARY_VECTOR_INDEX_CONTENT_PACK_MAX_CHUNKS_ACU);
            if (groupIndex < groups.length - 1) {
                expect(group.length).toBeGreaterThanOrEqual(SUMMARY_VECTOR_INDEX_CONTENT_PACK_MIN_CHUNKS_ACU);
            }
        });
    });

    it('尾部追加 1 个 key 只影响最后一组', () => {
        const base = makeChunkKeys(200);
        const extended = [...base, 'chunk_tail'];
        const baseGroups = planContentPackGroups_ACU(base);
        const extendedGroups = planContentPackGroups_ACU(extended);
        for (let index = 0; index < baseGroups.length - 1; index += 1) {
            expect(extendedGroups[index]).toEqual(baseGroups[index]);
        }
        const baseLast = baseGroups[baseGroups.length - 1];
        const extendedLast = extendedGroups[extendedGroups.length - 1];
        expect(extendedLast.slice(0, baseLast.length)).toEqual(baseLast);
    });

    it('头部删除 20 个 key 时后续分组的复用率 >70%', () => {
        const keys = makeChunkKeys(1000);
        const originalGroups = planContentPackGroups_ACU(keys);
        const originalChunks = new Set(originalGroups.flat());
        const trimmed = planContentPackGroups_ACU(keys.slice(20));
        const trimmedChunks = new Set(trimmed.flat());
        let retained = 0;
        trimmedChunks.forEach((key) => {
            if (originalChunks.has(key)) retained += 1;
        });
        expect(retained / trimmedChunks.size).toBeGreaterThan(0.7);
    });

    it('非 base36 chunkKey（含中文）不抛且分组确定', () => {
        const keys = ['中文一', '中文二', '!!!', '', 'chunk_abc', 'chunk_xyz'].concat(makeChunkKeys(100));
        expect(planContentPackGroups_ACU(keys)).toEqual(planContentPackGroups_ACU(keys));
        expect(planContentPackGroups_ACU(keys).flat().length).toBe(keys.length);
    });
});

describe('buildContentPackBlob_ACU / serializeContentPackForHash_ACU / buildContentPackKey_ACU', () => {
    it('buildContentPackBlob_ACU 字段顺序固定且 chunk 字段顺序固定', () => {
        const blob = buildContentPackBlob_ACU({
            packKey: 'pack_abc',
            packScope: 'scope_token',
            embeddingModel: 'model-x',
            dimension: 8,
            chunks: [
                {
                    chunkKey: 'chunk_a',
                    chunkId: 'id_a',
                    rowKey: 'row_a',
                    text: 'text a',
                    vector: 'AAAA',
                    vectorEncoding: 'f32b64',
                    sourceFingerprint: 'fp_a',
                    textHash: 'hash_a',
                },
                {
                    chunkKey: 'chunk_b',
                    chunkId: 'id_b',
                    rowKey: 'row_b',
                    text: 'text b',
                    vector: 'BBBB',
                    vectorEncoding: 'f32b64',
                },
            ],
        });
        const json = JSON.stringify(blob);
        expect(json).toContain('"version":1');
        expect(json).toContain('"schema":"content_addressed_vector_pack"');
        expect(json).toContain('"packKey":"pack_abc"');
        expect(json).toContain('"packScope":"scope_token"');
        expect(json).toContain('"embeddingModel":"model-x"');
        expect(json).toContain('"dimension":8');
        const chunkA = JSON.stringify(blob.chunks[0]);
        expect(chunkA.indexOf('"chunkKey"')).toBeLessThan(chunkA.indexOf('"chunkId"'));
        expect(chunkA.indexOf('"chunkId"')).toBeLessThan(chunkA.indexOf('"rowKey"'));
        expect(chunkA.indexOf('"rowKey"')).toBeLessThan(chunkA.indexOf('"text"'));
        expect(chunkA.indexOf('"text"')).toBeLessThan(chunkA.indexOf('"vector"'));
        expect(chunkA.indexOf('"vector"')).toBeLessThan(chunkA.indexOf('"vectorEncoding"'));
        expect(chunkA.indexOf('"vectorEncoding"')).toBeLessThan(chunkA.indexOf('"sourceFingerprint"'));
        expect(JSON.stringify(blob.chunks[1])).not.toContain('sourceFingerprint');
        expect(JSON.stringify(blob.chunks[1])).not.toContain('textHash');
    });

    it('serializeContentPackForHash_ACU 以 packKey 空串序列化', () => {
        const blob = buildContentPackBlob_ACU({
            packKey: 'pack_real',
            packScope: 'scope',
            embeddingModel: 'm',
            dimension: 4,
            chunks: [],
        });
        const serialized = serializeContentPackForHash_ACU(blob);
        expect(serialized).toContain('"packKey":""');
        expect(serialized).not.toContain('pack_real');
    });

    it('serializeContentPackForHash_ACU 同内容序列化一致（跨调用稳定）', () => {
        const blob = buildContentPackBlob_ACU({
            packKey: 'pack_x',
            packScope: 'scope_x',
            embeddingModel: 'm',
            dimension: 4,
            chunks: [{ chunkKey: 'c1', chunkId: 'i1', rowKey: 'r1', text: 't1', vector: 'V', vectorEncoding: 'f32b64' }],
        });
        expect(serializeContentPackForHash_ACU(blob)).toBe(serializeContentPackForHash_ACU(blob));
    });

    it('buildContentPackKey_ACU 返回 pack_ + hashHex', () => {
        expect(buildContentPackKey_ACU('a'.repeat(64))).toBe(`pack_${'a'.repeat(64)}`);
        expect(buildContentPackKey_ACU('')).toBe('pack_');
        expect(buildContentPackKey_ACU('ABC123')).toBe('pack_ABC123');
    });

    it('buildContentPackBlob_ACU 容错非法输入', () => {
        const blob = buildContentPackBlob_ACU({
            packKey: '',
            packScope: '',
            embeddingModel: '',
            dimension: -5,
            chunks: null as unknown as [],
        });
        expect(blob.dimension).toBe(0);
        expect(blob.chunks).toEqual([]);
        expect(blob.schema).toBe(SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU);
    });
});
