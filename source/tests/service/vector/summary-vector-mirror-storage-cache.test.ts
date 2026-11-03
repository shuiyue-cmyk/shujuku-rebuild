// @vitest-environment node
/**
 * 镜像 pack / checkpoint manifest 的内存缓存（移植上游 a43d0569，不含向量解码缓存）。
 * 路径主体即内容 sha256，命中无需失效；只缓存校验通过的结果；fresh 读取绕过缓存，
 * 供重建修复与状态展示如实反映盘上文件。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  reads: [] as string[],
  gate: null as Promise<void> | null,
}));

vi.mock('../../../src/data/storage/vector-index-st-files-storage', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    readVectorIndexJsonFile_ACU: async (path: string) => {
      h.reads.push(path);
      if (h.gate) await h.gate;
      return h.disk.has(path)
        ? { ok: true, data: JSON.parse(h.disk.get(path)!) }
        : { ok: false, status: 404, corrupted: false, error: '404' };
    },
  };
});

import { sha256Text_ACU } from '../../../src/data/storage/vector-index-st-files-storage';
import {
  clearSummaryVectorMirrorPackCache_ACU,
  loadSummaryVectorMirrorManifest_ACU,
  loadSummaryVectorMirrorPack_ACU,
} from '../../../src/service/vector/summary-vector-mirror-storage';
import { SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU } from '../../../src/service/vector/summary-vector-index-types';

function putPack(path: string, packKey: string, vector = 'AAAA', text = 't'): void {
  h.disk.set(path, JSON.stringify({
    schema: SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU,
    packKey,
    dimension: 1,
    chunks: [{ chunkIndex: 0, vector, text, textHash: 'h' }],
  }));
}

function packRef(path: string, packHash: string) {
  return { path, packHash, chunkCount: 1, byteLength: 0 };
}

async function putManifest(path: string): Promise<{ path: string; manifestHash: string; byteLength: number }> {
  const payload = { schema: 'summary_vector_mirror_manifest', version: 1, sourceTableKey: 'sheet_summary', rows: [{ rowId: 'r1', chunks: [] }] };
  h.disk.set(path, JSON.stringify(payload));
  return { path, manifestHash: await sha256Text_ACU(JSON.stringify(payload)), byteLength: 0 };
}

beforeEach(() => {
  clearSummaryVectorMirrorPackCache_ACU();
  h.disk.clear();
  h.reads = [];
  h.gate = null;
});

describe('镜像 pack 内存缓存', () => {
  it('同一内容寻址 pack 第二次读取直接命中缓存，不再读文件', async () => {
    putPack('pack/A', 'A');
    const first = await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'));
    const second = await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'));
    expect(h.reads).toEqual(['pack/A']);
    expect(second).toEqual(first);
  });

  it('返回值是副本外壳：调用方增删 chunks 不污染缓存', async () => {
    putPack('pack/A', 'A');
    const first = await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'));
    first!.chunks.length = 0;
    const second = await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A')); // 缓存命中
    expect(second!.chunks).toHaveLength(1);
    second!.chunks.length = 0;
    const third = await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'));
    expect(third!.chunks).toHaveLength(1);
  });

  it('读取失败不入缓存：文件之后出现时能正常读到', async () => {
    expect(await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'))).toBeNull();
    putPack('pack/A', 'A');
    expect(await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'))).not.toBeNull();
    expect(h.reads).toHaveLength(2);
  });

  it('packKey 与引用不符不入缓存', async () => {
    putPack('pack/A', 'OTHER');
    expect(await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'))).toBeNull();
    expect(await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'))).toBeNull();
    expect(h.reads).toHaveLength(2);
  });

  it('不带 packHash 的引用不是内容寻址，每次直读', async () => {
    putPack('pack/A', 'A');
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', ''));
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', ''));
    expect(h.reads).toHaveLength(2);
  });

  it('并发读取同一 pack 只读一次文件', async () => {
    putPack('pack/A', 'A');
    let release!: () => void;
    h.gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = Promise.all([
      loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A')),
      loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A')),
    ]);
    await Promise.resolve();
    release();
    const [a, b] = await pending;
    expect(h.reads).toEqual(['pack/A']);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('fresh 读取绕过缓存：盘上文件被删后如实返回 null，并清掉缓存条目', async () => {
    putPack('pack/A', 'A');
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'));
    h.disk.delete('pack/A');
    expect(await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'), { fresh: true })).toBeNull();
    // 之后的普通读取不能再从缓存拿到已不存在的文件
    expect(await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'))).toBeNull();
    expect(h.reads).toHaveLength(3);
  });

  it('按字符量有上限：超出后淘汰最久未用的 pack', async () => {
    const big = 'A'.repeat(3_000_000);
    putPack('pack/A', 'A', big);
    putPack('pack/B', 'B', big);
    putPack('pack/C', 'C', big);
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'));
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/B', 'B'));
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A')); // A 变为最近使用
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/C', 'C')); // 超限，淘汰 B
    h.reads = [];
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/A', 'A'));
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/C', 'C'));
    expect(h.reads).toEqual([]);
    await loadSummaryVectorMirrorPack_ACU(packRef('pack/B', 'B'));
    expect(h.reads).toEqual(['pack/B']);
  });
});

describe('checkpoint manifest 内存缓存', () => {
  it('哈希复核通过后缓存，第二次不再读文件；返回的 rows 是副本', async () => {
    const ref = await putManifest('manifest/M');
    const first = await loadSummaryVectorMirrorManifest_ACU(ref);
    first!.rows.length = 0;
    const second = await loadSummaryVectorMirrorManifest_ACU(ref);
    expect(h.reads).toEqual(['manifest/M']);
    expect(second!.rows).toHaveLength(1);
  });

  it('哈希不符不入缓存；不带 manifestHash 的引用每次直读', async () => {
    const ref = await putManifest('manifest/M');
    expect(await loadSummaryVectorMirrorManifest_ACU({ ...ref, manifestHash: 'bad' })).toBeNull();
    await loadSummaryVectorMirrorManifest_ACU({ ...ref, manifestHash: '' });
    await loadSummaryVectorMirrorManifest_ACU({ ...ref, manifestHash: '' });
    expect(h.reads).toHaveLength(3);
  });

  it('fresh 读取绕过缓存：盘上文件被删后如实返回 null', async () => {
    const ref = await putManifest('manifest/M');
    await loadSummaryVectorMirrorManifest_ACU(ref);
    h.disk.delete('manifest/M');
    expect(await loadSummaryVectorMirrorManifest_ACU(ref, { fresh: true })).toBeNull();
    expect(await loadSummaryVectorMirrorManifest_ACU(ref)).toBeNull();
  });
});
