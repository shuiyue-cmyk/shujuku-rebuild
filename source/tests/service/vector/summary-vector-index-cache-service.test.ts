import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  clearLayer: vi.fn(),
  deleteTemp: vi.fn(),
  deleteHot: vi.fn(),
  clearFlush: vi.fn(),
  clearFlushCurrentScope: vi.fn(),
  resolveScope: vi.fn(),
  listFlushTasks: vi.fn(),
  deleteFlushTask: vi.fn(),
  loadChunks: vi.fn(),
  snapshot: null as any,
  buildScope: vi.fn(),
  runExclusive: vi.fn(),
  logWarn: vi.fn(),
  chatKey: 'chat-a',
  isolationKey: 'iso-a',
  tables: null as any,
}));

vi.mock('../../../src/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/shared/utils')>()),
  logDebug_ACU: vi.fn(),
  logWarn_ACU: (...args: any[]) => h.logWarn(...args),
}));
vi.mock('../../../src/data/storage/vector-index-temp-cache', () => ({
  clearVectorIndexTempCache_ACU: vi.fn(),
  deleteVectorIndexCacheByIndex_ACU: (...args: any[]) => h.deleteTemp(...args),
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  clearSummaryVectorHotCache_ACU: vi.fn(),
  deleteSummaryVectorHotCacheByIndex_ACU: (...args: any[]) => h.deleteHot(...args),
  listSummaryVectorFlushTasks_ACU: (...args: any[]) => h.listFlushTasks(...args),
  deleteSummaryVectorFlushTask_ACU: (...args: any[]) => h.deleteFlushTask(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  clearSummaryVectorIndexFlushQueueForCurrentScopeUnlocked_ACU: (...args: any[]) => h.clearFlush(...args),
  clearSummaryVectorIndexFlushQueueForCurrentScope_ACU: (...args: any[]) => h.clearFlushCurrentScope(...args),
  resolveCurrentSummaryVectorFlushScope_ACU: (...args: any[]) => h.resolveScope(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: () => h.snapshot,
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  loadSummaryVectorIndexChunksFromManifest_ACU: (...args: any[]) => h.loadChunks(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-chat-service', () => ({
  clearSummaryVectorIndexLayerFromChat_ACU: (...args: any[]) => h.clearLayer(...args),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return h.chatKey; },
  get currentJsonTableData_ACU() { return h.tables; },
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  buildSummaryVectorIndexArchiveScopeKey_ACU: (...args: any[]) => h.buildScope(...args),
  runSummaryVectorIndexArchiveScopeMutationExclusive_ACU: (...args: any[]) => h.runExclusive(...args),
  findSummaryTable_ACU: () => {
    const tables = h.tables;
    if (!tables || typeof tables !== 'object') return null;
    const key = Object.keys(tables).find((name) => !!tables[name]?.name);
    return key ? { summaryKey: key, table: tables[key] } : null;
  },
}));

import {
  clearAllSummaryVectorIndexFlushQueues_ACU,
  clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU,
  clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU,
  isMissingExternalVectorFileError_ACU,
  preloadSummaryVectorIndexCacheForCurrentChat_ACU,
} from '../../../src/service/vector/summary-vector-index-cache-service';

const CURRENT_SCOPE_KEY = 'scope-current';


describe('summary vector missing external file recovery helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.clearLayer.mockResolvedValue(true);
    h.deleteTemp.mockResolvedValue(true);
    h.deleteHot.mockResolvedValue(true);
    h.clearFlush.mockResolvedValue(2);
    h.loadChunks.mockResolvedValue([]);
    h.snapshot = null;
    h.buildScope.mockImplementation((scope: any) => JSON.stringify(scope));
    h.runExclusive.mockImplementation(async (_scope: string, task: () => Promise<any>) => task());
    h.resolveScope.mockImplementation((params: any) => ({
      scopeKey: JSON.stringify({ chatKey: 'chat-a', isolationKey: params.isolationKey, sourceTableKey: params.sourceTableKey }),
      chatKey: 'chat-a',
      isolationKey: params.isolationKey,
      sourceTableKey: params.sourceTableKey,
    }));
  });

  it.each([
    '交火向量单文件快照读取失败: file 读取失败 404: Not Found',
    '交火向量索引分片读取失败: file 读取失败 404: Not Found',
    '交火向量索引内容块读取失败: file 读取失败 404: Not Found',
  ])('只识别 reader 明确返回的 404: %s', (message) => {
    expect(isMissingExternalVectorFileError_ACU(message)).toBe(true);
  });

  it.each([
    '交火向量单文件快照读取失败: file404 Failed to fetch',
    '交火向量单文件快照读取失败: file 读取失败 500: Internal Server Error',
    '交火向量单文件快照读取失败: file Not Found',
    '普通业务 not found',
  ])('拒绝非明确 404 的删除判定: %s', (message) => {
    expect(isMissingExternalVectorFileError_ACU(message)).toBe(false);
  });

  it('指针提交成功后缓存清理失败仍返回已安全删除', async () => {
    h.deleteTemp.mockRejectedValue(new Error('temp cache down'));
    h.deleteHot.mockRejectedValue(new Error('hot cache down'));

    await expect(clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU({
      messageIndex: 2,
      isolationKey: 'alpha',
      indexId: 'idx-missing',
      sourceTableKey: 'summary-source',
    })).resolves.toEqual({ chatStateCleared: true, cacheCleared: false, flushTaskCountCleared: 2 });

    expect(h.clearLayer).toHaveBeenCalledWith({ messageIndex: 2, isolationKey: 'alpha', indexId: 'idx-missing' });
    expect(h.clearFlush).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'alpha',
      sourceTableKey: 'summary-source',
    }));
    expect(h.deleteTemp).toHaveBeenCalledWith('idx-missing');
    expect(h.deleteHot).toHaveBeenCalledWith('idx-missing');
    expect(h.runExclusive).toHaveBeenCalledWith(
      JSON.stringify({ chatKey: 'chat-a', isolationKey: 'alpha', sourceTableKey: 'summary-source' }),
      expect.any(Function),
    );
  });

  it('缓存清理 helper 未显式返回 true 时逐处记录警告且不报告清理干净', async () => {
    // 喂 undefined（而非显式 false）：`undefined === false` 为假，故若告警判据被改回 `=== false`
    // 则本用例的告警断言失败；同时锚定 cacheCleared 的严格 `=== true` 聚合（undefined 不算成功）。
    h.deleteTemp.mockResolvedValue(undefined);
    h.deleteHot.mockResolvedValue(undefined);

    await expect(clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU({
      messageIndex: 2,
      isolationKey: 'alpha',
      indexId: 'idx-missing',
      sourceTableKey: 'summary-source',
    })).resolves.toEqual({ chatStateCleared: true, cacheCleared: false, flushTaskCountCleared: 2 });

    expect(h.logWarn).toHaveBeenCalledWith(expect.stringContaining('临时缓存清理失败，将继续重建'));
    expect(h.logWarn).toHaveBeenCalledWith(expect.stringContaining('热缓存清理失败，将继续重建'));
  });

  it('预热时严格删除抛错会返回稳定原因且不入队', async () => {
    const manifest = { status: 'ready', indexId: 'idx', sourceTableKey: 'summary-source' };
    h.snapshot = {
      summaryVectorIndexState: { manifest },
      layers: [{ messageIndex: 1, isolationKey: 'iso-source' }],
    };
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照读取失败: file 读取失败 404: Not Found'));
    h.clearLayer.mockRejectedValue(new Error('save failed'));

    await expect(preloadSummaryVectorIndexCacheForCurrentChat_ACU()).resolves.toMatchObject({
      success: false,
      skipped: true,
      reason: 'external_files_missing_state_clear_save_failed',
      cacheCleared: false,
      chatStateCleared: false,
    });
  });

  it('预热删除失效指针后不走 flush 队列，并准确报告等待普通即时重建', async () => {
    const manifest = { status: 'ready', indexId: 'idx', sourceTableKey: 'summary-source' };
    h.snapshot = {
      summaryVectorIndexState: { manifest },
      layers: [{ messageIndex: 1, isolationKey: 'iso-source' }],
    };
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照读取失败: file 读取失败 404: Not Found'));
    h.deleteTemp.mockRejectedValue(new Error('temp cache down'));

    await expect(preloadSummaryVectorIndexCacheForCurrentChat_ACU()).resolves.toMatchObject({
      reason: 'external_files_missing_state_cleared_rebuild_required',
      cacheCleared: false,
      chatStateCleared: true,
    });
    expect(h.clearFlush).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'iso-source',
      sourceTableKey: 'summary-source',
    }));
  });
});
describe('summary vector invalid external file recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.clearLayer.mockResolvedValue(true);
    h.deleteTemp.mockResolvedValue(true);
    h.deleteHot.mockResolvedValue(true);
    h.clearFlush.mockResolvedValue(1);
    h.loadChunks.mockResolvedValue([]);
    h.snapshot = null;
    h.resolveScope.mockImplementation((params: any) => ({
      scopeKey: JSON.stringify({ chatKey: 'chat-a', isolationKey: params.isolationKey, sourceTableKey: params.sourceTableKey }),
      chatKey: 'chat-a',
      isolationKey: params.isolationKey,
      sourceTableKey: params.sourceTableKey,
    }));
  });

  it('身份校验失败也必须先删除 pointer，再清理缓存', async () => {
    await expect(clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU({
      messageIndex: 2,
      isolationKey: 'alpha',
      indexId: 'idx-invalid',
      sourceTableKey: 'summary-source',
    })).resolves.toEqual({ chatStateCleared: true, cacheCleared: true, flushTaskCountCleared: 1 });

    expect(h.clearFlush).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'alpha',
      sourceTableKey: 'summary-source',
    }));
    expect(h.clearLayer).toHaveBeenCalledWith({ messageIndex: 2, isolationKey: 'alpha', indexId: 'idx-invalid' });
    expect(h.deleteTemp).toHaveBeenCalledWith('idx-invalid');
    expect(h.deleteHot).toHaveBeenCalledWith('idx-invalid');
  });

  it('预热发现 identity mismatch 后返回普通重建原因', async () => {
    const manifest = { status: 'ready', indexId: 'idx-invalid', sourceTableKey: 'summary-source' };
    h.snapshot = {
      summaryVectorIndexState: { manifest },
      layers: [{ messageIndex: 1, isolationKey: 'iso-source' }],
    };
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照身份不匹配: snapshot field=isolationKey expected=default actual='));

    await expect(preloadSummaryVectorIndexCacheForCurrentChat_ACU()).resolves.toMatchObject({
      success: true,
      skipped: true,
      reason: 'external_files_identity_invalid_rebuild_required',
      chatStateCleared: true,
    });
  });
});

describe('clearAllSummaryVectorIndexFlushQueues_ACU', () => {
  function task(scopeKey: string, overrides: Record<string, unknown> = {}) {
    return { scopeKey, chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'sheet_summary', status: 'failed_terminal', ...overrides };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    h.chatKey = 'chat-a';
    h.isolationKey = 'iso-a';
    h.tables = { sheet_summary: { name: '纪要表', content: [['id'], ['r1']] } };
    // 复刻真实 resolveCurrentSummaryVectorFlushScope_ACU 的契约：scope 不完整即抛错。
    // 生产代码正是靠这个抛出走 fail-closed（不做任何删除），mock 若不抛该用例就失去判别力。
    h.resolveScope.mockImplementation((params: any) => {
      if (!String(h.chatKey || '').trim()) throw new Error('清理交火向量 flush 队列失败：当前聊天标识为空');
      if (!String(params.sourceTableKey || '').trim()) throw new Error('清理交火向量 flush 队列失败：纪要表标识为空');
      return {
        scopeKey: CURRENT_SCOPE_KEY,
        chatKey: h.chatKey,
        isolationKey: params.isolationKey,
        sourceTableKey: params.sourceTableKey,
      };
    });
    h.clearFlushCurrentScope.mockResolvedValue(1);
    h.listFlushTasks.mockResolvedValue([]);
    h.deleteFlushTask.mockResolvedValue(true);
  });

  /**
   * 按真实存储语义安装 flush 任务 fake：严格删除返回 true 即从后续 list 中消失。
   * 生产实现在清扫后会**复读一次**列表确认没留下残留，因此固定数组 mock（删除后仍返回同一条）
   * 会把"清干净"误判成"有残留"——那正是这条 fake 要挡住的假保证。
   */
  function seedFlushTasks_ACU(
    records: any[],
    options: { deleteResult?: (scopeKey: string) => any } = {},
  ): void {
    const store = records.map(record => ({ ...record }));
    h.listFlushTasks.mockImplementation(async () => store.map(record => ({ ...record })));
    h.deleteFlushTask.mockImplementation(async (scopeKey: string) => {
      const result = options.deleteResult ? options.deleteResult(scopeKey) : true;
      if (result === true) {
        const index = store.findIndex(record => record.scopeKey === scopeKey);
        if (index >= 0) store.splice(index, 1);
      }
      return result;
    });
  }

  it('先写当前 scope 墓碑，再严格删除其它 scope 的残留任务', async () => {
    seedFlushTasks_ACU([
      task(CURRENT_SCOPE_KEY, { status: 'invalidated' }),
      task('scope-other', { chatKey: 'chat-other', isolationKey: 'iso-other' }),
    ]);

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toEqual({
      clearedCount: 1,
      currentScopeInvalidated: true,
      failed: false,
    });

    // 顺序即协议：墓碑必须先于删除落地，否则在飞 runner 可能复活当前 scope 数据。
    expect(h.clearFlushCurrentScope).toHaveBeenCalledWith({ isolationKey: 'iso-a', sourceTableKey: 'sheet_summary' });
    expect(h.clearFlushCurrentScope.mock.invocationCallOrder[0]).toBeLessThan(h.deleteFlushTask.mock.invocationCallOrder[0]);
    // 当前 scope 的墓碑必须保留：删掉它等于放行在飞 runner 复活数据。
    expect(h.deleteFlushTask).not.toHaveBeenCalledWith(CURRENT_SCOPE_KEY);
    expect(h.deleteFlushTask).toHaveBeenCalledWith('scope-other');
  });

  it('清扫后复读仍有残留（并发重建/删除未生效）时不得谎报已清空', async () => {
    // 删除返回 true 但记录仍在（复读能看到）——只有复读校验能抓住这种"假清空"。
    const records = [task('scope-other')];
    h.listFlushTasks.mockImplementation(async () => records.map(record => ({ ...record })));
    h.deleteFlushTask.mockResolvedValue(true);

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toEqual({
      clearedCount: 1,
      currentScopeInvalidated: true,
      failed: true,
      reason: 'residual_left',
    });
  });

  it('严格删除返回 false 时如实上报 failed，不谎报已清空', async () => {
    seedFlushTasks_ACU([task('scope-other')], { deleteResult: () => false });

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toEqual({
      clearedCount: 0,
      currentScopeInvalidated: true,
      failed: true,
      reason: 'delete_failed',
    });
    expect(h.logWarn).toHaveBeenCalledWith(expect.stringContaining('scope-other'));
  });

  it('严格删除返回 undefined 时同样按未清干净上报（不得写成 !== false 的 fail-open）', async () => {
    // 喂 undefined 而非 false：`undefined === false` 为假，故若判据被改成 `!== false`
    // 则 undefined 会被当成清理成功，本用例即红。契约是 Promise<boolean>，无 undefined 出口，
    // 但正是这条判据防住未来误引入 Promise<void> helper 时的静默 fail-open。
    seedFlushTasks_ACU([task('scope-other')], { deleteResult: () => undefined });

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toEqual({
      clearedCount: 0,
      currentScopeInvalidated: true,
      failed: true,
      reason: 'delete_failed',
    });
  });

  it('list 抛错时按未清干净上报，绝不吞掉异常', async () => {
    h.listFlushTasks.mockRejectedValue(new Error('idb down'));

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toMatchObject({ failed: true });
    expect(h.deleteFlushTask).not.toHaveBeenCalled();
  });

  it('当前 scope 墓碑写入失败时不做任何删除并上报 failed', async () => {
    h.clearFlushCurrentScope.mockRejectedValue(new Error('tombstone write failed'));
    h.listFlushTasks.mockResolvedValue([task('scope-other')]);

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toMatchObject({
      clearedCount: 0,
      currentScopeInvalidated: false,
      failed: true,
    });
    expect(h.deleteFlushTask).not.toHaveBeenCalled();
  });

  it('当前 scope 解析不出时按 failed 上报，不做全库删除', async () => {
    h.chatKey = '';
    h.listFlushTasks.mockResolvedValue([task('scope-other')]);

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toMatchObject({ failed: true });
    expect(h.deleteFlushTask).not.toHaveBeenCalled();
  });

  it('legacy 空 isolationKey 的残留任务同样被清（不被 scope 过滤漏掉）', async () => {
    seedFlushTasks_ACU([
      task('scope-legacy', { isolationKey: '' }),
      task('scope-other', { chatKey: 'chat-other' }),
    ]);

    await expect(clearAllSummaryVectorIndexFlushQueues_ACU()).resolves.toMatchObject({ clearedCount: 2, failed: false });
    expect(h.deleteFlushTask).toHaveBeenCalledWith('scope-legacy');
    expect(h.deleteFlushTask).toHaveBeenCalledWith('scope-other');
  });
});
