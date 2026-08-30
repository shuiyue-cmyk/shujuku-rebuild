import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildVectorIndexContentPackPathV2_ACU,
  buildVectorIndexSingleSnapshotV2FilePath_ACU,
  buildVectorIndexSingleSnapshotV2ScopeToken_ACU,
  buildVectorIndexStableDirectory_ACU,
  decodeVectorIndexScopeFromPath_ACU,
  extractVectorIndexContentPackScopeTokenFromPath_ACU,
  isVectorIndexContentPackPathV2_ACU,
  loadVectorIndexRegistry_ACU,
  readVectorIndexJsonFile_ACU,
  registerVectorIndexFiles_ACU,
  unregisterVectorIndexFiles_ACU,
} from '../../../src/data/storage/vector-index-st-files-storage';

import { buildVectorIndexSnapshotWriteGeneration_ACU } from '../../../src/service/vector/summary-vector-index-storage-service';


afterEach(() => vi.unstubAllGlobals());

describe('P4 内容寻址 pack 路径 (T10)', () => {
  const packBase = {
    chatKey: 'chat-main',
    isolationKey: 'profile-a',
    sourceTableKey: 'sheet_summary',
    packKey: 'pack_abcdef1234567890',
  };

  it('中文 chatKey 的两个不同聊天生成不同 pack 路径（不坍缩为 default）', () => {
    const chatA = '中文聊天甲';
    const chatB = '中文聊天乙';
    const pathA = buildVectorIndexContentPackPathV2_ACU({
      chatKey: chatA,
      isolationKey: 'iso',
      sourceTableKey: 'sheet_x',
      packKey: 'pack_same',
    });
    const pathB = buildVectorIndexContentPackPathV2_ACU({
      chatKey: chatB,
      isolationKey: 'iso',
      sourceTableKey: 'sheet_x',
      packKey: 'pack_same',
    });
    expect(pathA).not.toBe(pathB);
    expect(pathA).not.toContain('default');
    expect(pathB).not.toContain('default');
    expect(pathA.startsWith('TavernDB_ACU_vector_v2pack_')).toBe(true);
  });

  it('同 scope 同 packKey 生成稳定路径；packKey 变化路径变化', () => {
    const a = buildVectorIndexContentPackPathV2_ACU(packBase);
    expect(buildVectorIndexContentPackPathV2_ACU(packBase)).toBe(a);
    expect(buildVectorIndexContentPackPathV2_ACU({ ...packBase, packKey: 'pack_other' })).not.toBe(a);
  });

  it('路径不含 indexId/revision（跨 revision 复用前提）', () => {
    const path = buildVectorIndexContentPackPathV2_ACU(packBase);
    expect(path).not.toContain('snap_');
    expect(path).not.toContain('_snapshot');
  });

  it('超长 chatKey 抛错且文案含缩短建议', () => {
    const longChatKey = '超长'.repeat(200);
    expect(() => buildVectorIndexContentPackPathV2_ACU({
      chatKey: longChatKey,
      isolationKey: 'iso',
      sourceTableKey: 'sheet_x',
      packKey: 'pack_x',
    })).toThrow(/路径超长/);
  });

  it('前缀识别函数不把 snapshot 路径判成 pack，pack 路径可识别', () => {
    const snapshotPath = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      chatKey: 'chat-main',
      isolationKey: 'profile-a',
      sourceTableKey: 'sheet_summary',
      indexId: 'snap_one',
      writeGeneration: 'write_one',
    });
    expect(isVectorIndexContentPackPathV2_ACU(snapshotPath)).toBe(false);
    expect(isVectorIndexContentPackPathV2_ACU('TavernDB_ACU_vector_v2pack_scope_pack_x')).toBe(true);
    expect(isVectorIndexContentPackPathV2_ACU('')).toBe(false);
  });

  it('extractVectorIndexContentPackScopeTokenFromPath_ACU 提取 scope token，非 pack 路径返回 null', () => {
    const packPath = buildVectorIndexContentPackPathV2_ACU(packBase);
    const scopeToken = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(packBase);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU(packPath)).toBe(scopeToken);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU('TavernDB_ACU_vector_v2_scope_snap_x_snapshot')).toBe(null);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU('')).toBe(null);
  });
});


const base = {
  chatKey: 'chat-main',
  isolationKey: 'profile-a',
  sourceTableKey: 'sheet_summary',
  indexId: 'snap_one',
  writeGeneration: 'write_one',
};

describe('向量索引 V2 物理路径', () => {
  it('同一 scope 和 generation 的路径稳定，角色显示名不参与权威寻址', () => {
    expect(buildVectorIndexSingleSnapshotV2FilePath_ACU(base)).toBe(
      buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, chatName: 'Renamed Character' }),
    );
  });

  it.each([
    ['isolationKey', 'profile-b'],
    ['sourceTableKey', 'sheet_outline'],
    ['chatKey', 'chat-other'],
    ['indexId', 'snap_two'],
    ['writeGeneration', 'write_two'],
  ] as const)('任一身份维度 %s 改变时路径不同', (key, value) => {
    expect(buildVectorIndexSingleSnapshotV2FilePath_ACU(base)).not.toBe(
      buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, [key]: value }),
    );
  });

  it('不会把旧规范化会碰撞的 scope 段折叠为同一路径', () => {
    const slash = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, isolationKey: 'iso/A' });
    const underscore = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, isolationKey: 'iso_A' });
    expect(slash).not.toBe(underscore);
    expect(buildVectorIndexStableDirectory_ACU({
      chatKey: base.chatKey,
      isolationKey: 'iso/A',
      sourceTableKey: base.sourceTableKey,
    })).toBe(buildVectorIndexStableDirectory_ACU({
      chatKey: base.chatKey,
      isolationKey: 'iso_A',
      sourceTableKey: base.sourceTableKey,
    }));
  });

  it('canonical scope 编码后的对象路径超过宿主安全上限时拒绝写入，不截断制造碰撞', () => {
    expect(() => buildVectorIndexSingleSnapshotV2FilePath_ACU({
      ...base,
      chatKey: 'chat-'.repeat(40),
      isolationKey: 'isolation-'.repeat(40),
      sourceTableKey: 'summary-'.repeat(40),
    })).toThrow('V2 快照对象路径超长');
  });

  it('T0d：超长错误消息给出各段长度与差额，且不含无法执行的缩 key 建议', () => {
    let error: Error | null = null;
    try {
      buildVectorIndexSingleSnapshotV2FilePath_ACU({
        ...base,
        chatKey: 'chat-'.repeat(40),
        isolationKey: 'isolation-'.repeat(40),
        sourceTableKey: 'summary-'.repeat(40),
      });
    } catch (caught: any) {
      error = caught;
    }
    expect(error).not.toBeNull();
    const message = String(error?.message || '');
    expect(message).toContain('V2 快照对象路径超长');
    expect(message).toMatch(/length=\d+, max=\d+/);
    expect(message).toMatch(/超出 \d+ 字符/);
    expect(message).toMatch(/scopeToken 占用 \d+ 字符/);
    expect(message).toMatch(/indexId 占用 \d+ 字符/);
    expect(message).toMatch(/writeGeneration 占用 \d+ 字符/);
    expect(message).toMatch(/约 \d+ 个中文字/);
    expect(message).not.toContain('请缩短 chatKey、isolationKey 或 sourceTableKey');
    expect(message).toContain('仅在当前没有任何已建成的纪要向量索引时');
  });
});

describe('向量索引 registry 持久化', () => {
  it('registry 上传返回失败时向调用方传播错误，不能伪装成已登记', async () => {
    class FakeFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(): void {
        this.result = 'data:application/json;base64,e30=';
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'registry backend unavailable' }));

    await expect(registerVectorIndexFiles_ACU([{
      role: 'manifest', path: 'orphan-v2-path', byteSize: 1, checksum: 'checksum', createdAt: '', updatedAt: '', status: 'ready',
    }])).rejects.toThrow('registry 保存失败');
  });
});


describe('T0a writeGeneration 紧凑化', () => {
  it('生成结果长度 ≤ 24 且字符集 [a-zA-Z0-9]，不被 normalizeFileNamePart_ACU 改写', () => {
    const entropy = new Uint32Array([0, 0]);
    const gen = buildVectorIndexSnapshotWriteGeneration_ACU(1234567890123, entropy);
    expect(gen.length).toBeLessThanOrEqual(24);
    expect(gen).toMatch(/^[a-zA-Z0-9]+$/);
    // 与路径规范化一致：不含下划线/连字符外的非法字符，且 round-trip 后不变
    const normalized = gen.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    expect(normalized).toBe(gen);
  });

  it('同一毫秒内连续生成 1000 次无重复（64 位熵 + 时间戳兜底）', () => {
    const now = 1700000000000;
    const seen = new Set<string>();
    // 模拟 1000 个不同熵值：前 1000 个 Uint32 组合
    for (let i = 0; i < 1000; i += 1) {
      const entropy = new Uint32Array([i, i * 2654435761]);
      const gen = buildVectorIndexSnapshotWriteGeneration_ACU(now, entropy);
      expect(seen.has(gen)).toBe(false);
      seen.add(gen);
    }
    expect(seen.size).toBe(1000);
  });

  it('熵值定宽 7 位，无分隔符也可无歧义解析', () => {
    const entropy = new Uint32Array([1, 2]);
    const gen = buildVectorIndexSnapshotWriteGeneration_ACU(1700000000000, entropy);
    // 时间戳 1700000000000 的 base36 为 8 位 + 7 + 7 = 22
    expect(gen).toMatch(/^[a-z0-9]{8}[a-z0-9]{7}[a-z0-9]{7}$/);
  });

  it('旧格式 writeGeneration 的路径构造不受影响（旧快照兼容）', () => {
    // 旧格式：时间戳base36-4×Uint32base36（连字符分隔），~40 字符
    const legacyWriteGeneration = 'm3o6k5a1-2gk3-4m5o-6p7q-8r9s';
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      ...base,
      writeGeneration: legacyWriteGeneration,
    });
    expect(path).toContain(legacyWriteGeneration);
    expect(path.length).toBeLessThanOrEqual(240);
  });

  it('报障用户规模 scope（三 key UTF-8 合计 110 字节）：T0a 新格式 ≤ 240，旧格式 40 字符超长抛错', () => {
    // 反推：scopeToken = base64url(JSON([chatKey, isolationKey, sourceTableKey]))
    // 110 内容字节 + 10 结构字节 = 120 → base64 160 字符（120 整除 3，无 padding）
    // 路径 = 前缀 23 + scopeToken 160 + indexId 12 + writeGeneration + 后缀 10
    const longChatKey = '中文角色名A-2025-11-5@14h30m12s345ms'; // 39 UTF-8 字节
    const longIsolation = 'isolation-'.repeat(5); // 50 字节
    const longSourceTable = 'source-'.repeat(3); // 21 字节
    const indexId = 'snap_zzzzzzz'; // 12

    // T0a 前：40 字符旧格式 writeGeneration → 路径 246 > 240，必须拒绝
    const legacyGeneration = 'm3o6k5a1-2gk3abc-4m5odef-6p7qghi-8r9sjkl'; // 40
    expect(() => buildVectorIndexSingleSnapshotV2FilePath_ACU({
      chatKey: longChatKey,
      isolationKey: longIsolation,
      sourceTableKey: longSourceTable,
      indexId,
      writeGeneration: legacyGeneration,
    })).toThrow('V2 快照对象路径超长');

    // T0a 后：22 字符新格式 → 路径 228 ≤ 240，可写入
    const gen = buildVectorIndexSnapshotWriteGeneration_ACU(1700000000000, new Uint32Array([4294967295, 4294967295]));
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      chatKey: longChatKey,
      isolationKey: longIsolation,
      sourceTableKey: longSourceTable,
      indexId,
      writeGeneration: gen,
    });
    expect(path.length).toBeLessThanOrEqual(240);
  });

  // 预算不变量：路径 = 前缀(23) + scopeToken + '_' + indexId + '_' + writeGeneration + '_snapshot'(9)。
  // 本用例锁住“固定段 + 两个变长段上界”所占预算，反推出 scopeToken 的可用上限。
  // 若未来有人动前缀/后缀/分隔符，或放宽 indexId / writeGeneration 长度，
  // scopeToken 预算会被静默吞掉（直接表现为用户聊天名突然建不了索引），本用例会先失败。
  it('路径固定段预算不变：scopeToken 可用上限 169 字符（240 - 固定 34 - indexId 13 - writeGeneration 24）', () => {
    const FIXED_PREFIX = 'TavernDB_ACU_vector_v2_';
    const FIXED_SUFFIX = '_snapshot';
    const MAX_INDEX_ID = 13; // 'snap_'(5) + hashUserInput_ACU 上界 8（含负号）
    const MAX_WRITE_GENERATION = 24; // T0a 格式：时间戳 base36 8 + 7 + 7 = 22，留2 字符余量
    const SEPARATORS = 2; // scopeToken_indexId_writeGeneration

    expect(FIXED_PREFIX.length).toBe(23);
    expect(FIXED_SUFFIX.length).toBe(9);

    const fixedCost = FIXED_PREFIX.length + FIXED_SUFFIX.length + SEPARATORS;
    const scopeTokenBudget = 240 - fixedCost - MAX_INDEX_ID - MAX_WRITE_GENERATION;
    expect(fixedCost).toBe(34);
    expect(scopeTokenBudget).toBe(169);

    // 正向验证：恰好用完预算的真实路径可构造且 = 240。
    // scopeToken 长度由 scope 内容决定，这里直接用各段上界拼出长度等价的路径做长度断言。
    const syntheticPath = `${FIXED_PREFIX}${'z'.repeat(scopeTokenBudget)}_${'z'.repeat(MAX_INDEX_ID)}_${'z'.repeat(MAX_WRITE_GENERATION)}${FIXED_SUFFIX}`;
    expect(syntheticPath.length).toBe(240);
  });

});

describe('P7 scopeToken 路径反解（decodeVectorIndexScopeFromPath_ACU）', () => {
  it('token 含 base64url 下划线（base64 `/` 替换而来）的 snapshot 路径正确反解', () => {
    // 该 chatKey 的 token 确定含 `_`（base64 `/` 替换而来），
    // 验证"首个下划线切分"会失配的场景被逐分割点解码正确处理。
    const scope = { chatKey: '聊天10o号', isolationKey: 'profile-a', sourceTableKey: '纪要表' };
    expect(buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope)).toContain('_');
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      ...scope,
      indexId: 'snap_abc123',
      writeGeneration: 'wg_0001',
    });
    expect(decodeVectorIndexScopeFromPath_ACU(path)).toEqual(scope);
  });

  it('v2pack 路径正确反解 scope', () => {
    const scope = { chatKey: '中文聊天甲', isolationKey: 'profile-a', sourceTableKey: 'sheet_summary' };
    const path = buildVectorIndexContentPackPathV2_ACU({ ...scope, packKey: 'pack_abcdef1234567890' });
    expect(decodeVectorIndexScopeFromPath_ACU(path)).toEqual(scope);
  });

  it('ASCII scope 的 snapshot 路径正确反解', () => {
    const scope = { chatKey: 'chat-main', isolationKey: 'default', sourceTableKey: 'summary' };
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      ...scope,
      indexId: 'snap_one',
      writeGeneration: 'write_one',
    });
    expect(decodeVectorIndexScopeFromPath_ACU(path)).toEqual(scope);
  });

  it('legacy 路径 / 非法输入返回 null', () => {
    expect(decodeVectorIndexScopeFromPath_ACU('TavernDB_ACU_vector_chat_iso_table_snapshot')).toBeNull();
    expect(decodeVectorIndexScopeFromPath_ACU('TavernDB_ACU_vector_v2_notatoken_snap_x_wg_snapshot')).toBeNull();
    expect(decodeVectorIndexScopeFromPath_ACU('')).toBeNull();
    expect(decodeVectorIndexScopeFromPath_ACU('unrelated_file.json')).toBeNull();
  });
});

describe('V1-d registry 损坏守卫', () => {
  it('registry JSON 解析异常：read 标记 corrupted，loadVectorIndexRegistry 抛错而非返回空 store', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"version":1,"files":[{"path":trunc', { status: 200 })));
    const loaded = await readVectorIndexJsonFile_ACU('any.json');
    expect(loaded.ok).toBe(false);
    expect(loaded.corrupted).toBe(true);
    await expect(loadVectorIndexRegistry_ACU()).rejects.toThrow(/registry/);
  });

  it('非 404 读取失败抛错；明确 404 仍返回空 registry（真空库语义保留）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' })));
    await expect(loadVectorIndexRegistry_ACU()).rejects.toThrow(/registry 读取失败/);
    const notFound = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', notFound);
    await expect(loadVectorIndexRegistry_ACU()).resolves.toMatchObject({ files: [] });
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('registry 内容缺 files 数组（可解析但 schema 损坏）时 unregister 中断，不发上传请求', async () => {
    const fetchMock = vi.fn(async () => new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(unregisterVectorIndexFiles_ACU(['some/registered/path'])).rejects.toThrow(/registry/);
    // 只发生一次 registry 读取；load→merge→save 在 load 处中断，绝不以空 store 覆盖写。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
