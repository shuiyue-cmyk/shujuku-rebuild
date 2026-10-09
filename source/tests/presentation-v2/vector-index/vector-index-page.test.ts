/**
 * VectorIndexPage 集成 — 交火模式（向量混合增强）页骨架与立即构建动作
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { defaultVectorMemoryConfig_ACU } from '../../../src/shared/defaults';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      { name: 'kw-cheap', apiMode: 'custom', apiConfig: { url: 'https://x', apiKey: 'k', model: 'm', useMainApi: false, max_tokens: 1000, temperature: 1 } },
    ],
    defaultApiPresetName: 'kw-cheap',
    apiPresetBindingsByChat: {},
    summaryVectorIndexModeDefault: true,
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

function createConfig() {
  return {
    enabled: true,
    threshold: 50,
    archiveTriggerCount: 9,
    archiveBatchSize: 3,
    archiveMaxConcurrency: 30,
    summaryIndexArchiveMaxConcurrency: 30,
    summaryIndexArchiveMaxInputChars: 24000,
    summaryIndexArchiveEmbeddingConcurrency: 3,
    topK: 10,
    minScore: 0.4,
    embeddingEndpoint: 'https://emb',
    embeddingApiKey: '',
    embeddingModel: 'text-embedding-3-large',
    rerankEndpoint: '',
    rerankApiKey: '',
    rerankModel: '',
    vectorNamespace: 'chat',
    entryComment: 'TavernDB-ACU-VectorMemory',
    entryKey: 'TavernDB-ACU-VectorMemory-Key',
    summaryIndexKeywordMinRows: 100,
    summaryChunkSentenceCount: 2,
    summaryPromptGroupId: 'remote-memory-archive-default',
    archiveWithoutSummary: false,
    summaryPromptGroup: [],
    keywordApiPreset: '',
    keywordContextPairCount: 1,
    keywordGenerationMaxAttempts: 3,
    keywordPromptGroup: JSON.parse(JSON.stringify(defaultVectorMemoryConfig_ACU.keywordPromptGroup)),
    recallCandidateLimit: 1000,
    recentFixedInjectCount: 50,
  };
}

async function mountVectorIndexPage(opts: {
  settings?: any,
  validation?: { valid: boolean, errors: string[] },
  archiveResult?: any,
  migrationResult?: any,
  healthReport?: any,
  stats?: Record<string, unknown>,
  devOptions?: Record<string, unknown>,
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    router: { activePageId: 'vector-index' },
    ...(opts.devOptions ? { devOptions: opts.devOptions } : {}),
  }));

  const settings = opts.settings ?? createSettings();
  const config = createConfig();
  const validationResult = opts.validation ?? { valid: true, errors: [] };
  const archiveResult = opts.archiveResult ?? { success: true, skipped: false, indexedRowCount: 12, chunkCount: 7, errors: [] };
  const migrationResult = opts.migrationResult ?? { success: true, skipped: false, indexedRowCount: 12, chunkCount: 7, errors: [] };
  const healthReport = opts.healthReport ?? { legacyManifestCount: 0, issues: [] };

  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  const archiveSummary = vi.fn(async () => archiveResult);
  const migrateLegacy = vi.fn(async () => migrationResult);
  const loadOrCreate = vi.fn(async () => ({ ok: true }));
  const saveIndependent = vi.fn(async () => ({ ok: true }));
  const runTableUpdateCommit = vi.fn(async (_options: any, apply: any) => {
    const applied = await apply({ transactionContext: { runCommit: async (task: any) => task() }, workingData: null });
    return { success: applied.success !== false, value: applied.value, tableData: applied.tableData, saved: true };
  });
  const updateLorebook = vi.fn(async () => true);
  const rebuildNow = vi.fn(async () => {
    await runTableUpdateCommit({}, async () => ({ success: true, value: null, tableData: {}, mutationResult: { changes: 1, errors: [] } }));
    const result = await archiveSummary({ mode: 'sync' });
    if (result.success && !result.skipped) await updateLorebook();
    return result;
  });
  const getLastIndex = vi.fn(() => 5);
  const clearCache = vi.fn(async () => true);
  const clearFlushQueues = vi.fn(async () => ({ clearedCount: 3, currentScopeInvalidated: true, failed: false }));
  const deleteIndex = vi.fn(async () => true);
  const getStats = vi.fn(async () => ({
    status: 'ready',
    indexId: 'idx-1',
    backend: 'st-files',
    rowCount: 1,
    chunkCount: 2,
    baseShardCount: 1,
    deltaShardCount: 0,
    tombstoneRowCount: 0,
    tombstoneChunkCount: 0,
    externalTotalBytes: 2048,
    cacheTotalBytes: 128,
    flushTaskDirtyCount: 0,
    flushTaskQueuedCount: 0,
    flushTaskFlushingCount: 0,
    flushTaskFailedCount: 0,
    updatedAt: '2026-05-08T12:00:00.000Z',
    ...(opts.stats || {}),
  }));
  const inspectHealth = vi.fn(async () => healthReport);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-vector',
    currentJsonTableData_ACU: {
      sheet_summary: { name: '纪要表', content: [['id', 'summary'], ['1', 'r1']] },
    },
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/vector/vector-memory-config', () => ({
    getCurrentVectorMemoryConfig_ACU: () => config,
    updateGlobalVectorMemoryConfigFields_ACU: (patch: Record<string, any>) => {
      Object.assign(config, patch);
      saveSettings();
      return { ok: true };
    },
    validateSummaryVectorIndexConfig_ACU: () => validationResult,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
    archiveSummaryVectorIndexNow_ACU: archiveSummary,
    migrateLegacySummaryVectorIndexToContentAddressed_ACU: migrateLegacy,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-rebuild-service', () => ({
    rebuildCurrentSummaryVectorIndexNow_ACU: rebuildNow,
  }));
  vi.doMock('../../../src/service/table/table-service', () => ({
    loadOrCreateJsonTableFromChatHistory_ACU: loadOrCreate,
    saveIndependentTableToChatHistory_ACU: saveIndependent,
  }));
  vi.doMock('../../../src/service/table/table-update-commit', () => ({
    runTableUpdateCommit_ACU: runTableUpdateCommit,
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getLastMessageIndex_ACU: getLastIndex,
    getChatArray_ACU: vi.fn(() => [{ is_user: false, mes: 'ai', mesId: 'm1' }]),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    updateReadableLorebookEntry_ACU: updateLorebook,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-state-service', () => ({
    getLatestSummaryVectorIndexSnapshotState_ACU: vi.fn(() => ({
      summaryVectorIndexState: {
        manifest: { status: 'ready', indexId: 'idx-1' },
        rows: [{ rowKey: 'r1', status: 'active' }],
        chunks: [],
      },
      layers: [],
    })),
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
    getSummaryVectorIndexStats_ACU: getStats,
    inspectSummaryVectorIndexHealth_ACU: inspectHealth,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-cache-service', () => ({
    clearAllSummaryVectorIndexCaches_ACU: clearCache,
    clearAllSummaryVectorIndexFlushQueues_ACU: clearFlushQueues,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-chat-service', () => ({
    deleteCurrentSummaryVectorIndexFromChat_ACU: deleteIndex,
  }));

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));

  return {
    mount,
    settings,
    config,
    saveSettings,
    rebuildNow,
    archiveSummary,
    migrateLegacy,
    inspectHealth,
    loadOrCreate,
    saveIndependent,
    runTableUpdateCommit,
    updateLorebook,
    clearCache,
    clearFlushQueues,
    deleteIndex,
    getStats,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flushDialog(): Promise<HTMLElement> {
  await new Promise(r => setTimeout(r, 0));
  const layer = document.querySelector<HTMLElement>('.ub-dialog-layer');
  expect(layer).not.toBeNull();
  return layer!;
}

describe('VectorIndexPage', () => {

  it('默认关键词提示词切换页面后仍显示默认 badge', async () => {
    const { mount, config } = await mountVectorIndexPage();

    expect(document.querySelector('[data-ub-main]')?.textContent || '').toContain('使用默认提示词');

    const { useRouterStore } = await import('../../../src/presentation-v2/stores/router-store');
    useRouterStore().setActivePage('dashboard');
    await nextTick();

    config.keywordPromptGroup = config.keywordPromptGroup.map((segment: any) => ({
      ...segment,
      content: typeof segment.content === 'string' ? segment.content.trim() : segment.content,
    }));

    useRouterStore().setActivePage('vector-index');
    await nextTick();

    const textAfterReturn = document.querySelector('[data-ub-main]')?.textContent || '';
    expect(textAfterReturn).toContain('使用默认提示词');
    expect(textAfterReturn).not.toContain('已自定义提示词');

    mount.__resetAcuV2MountForTests();
  });

  /**
   * 交火模式必须把「混合召回」暴露成用户可开关的项。
   *
   * `hybridRetrievalEnabled` 在配置层一直是通的（vector-memory-config.ts:198/477，
   * 默认 true），但 UI 此前完全没有它 → 用户无法关闭，也无从判断 BM25 是否在起作用。
   * 这也是排查「BM25 看起来没效果」时的必要二分手段：关掉若召回质量无变化，
   * 说明它当前近乎空转（真正该解决的是查询词来源，而非开关）。
   *
   * 与「发送前用 AI 补充检索关键词」是两个独立开关：前者管检索方式（纯本地），
   * 后者补 BM25 的查询词（多一次 AI 调用）。默认都保持上游形态，不改默认值。
   */
  it('召回参数面板暴露混合召回开关：默认开启，点击可关闭并落盘', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage();

    const text = document.querySelector('[data-ub-main]')?.textContent || '';
    expect(text, '必须向用户暴露 BM25 混合召回开关').toContain('混合召回');
    expect(text, '必须说明关闭后只用向量召回').toContain('关闭则只用向量召回');

    const toggle = document.querySelector('[data-ub-main] [role="switch"][aria-label*="BM25"]');
    expect(toggle, '混合召回开关必须渲染为 role=switch 控件').toBeTruthy();
    expect(toggle?.getAttribute('aria-checked'), '默认应开启（上游默认 hybridRetrievalEnabled=true）').toBe('true');

    // 「可关闭」必须验到配置与持久化，否则只锁住了「开关存在」，
    // 把 @update:model-value 改成 no-op 仍会全绿。
    saveSettings.mockClear();
    toggle!.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    expect(config.hybridRetrievalEnabled, '关闭后必须写进配置（runtime 据此只用向量召回）').toBe(false);
    expect(saveSettings, '配置变更必须落盘').toHaveBeenCalled();
    // 关闭后「候选上限」hint 不得再提 BM25：recallCandidateLimit 实际只作用于向量召回
    // （summary-vector-index-runtime.ts:959 的 slice），旧文案「dense/BM25 各自」是误导。
    const limitHint = Array.from(document.querySelectorAll('[data-ub-main] .ub-row'))
      .find(el => /候选上限/.test(el.textContent || ''))?.textContent || '';
    expect(limitHint).not.toContain('BM25 各自保留');
    expect(limitHint).toContain('混合召回已关闭');

    mount.__resetAcuV2MountForTests();
  });

  it('立即构建按钮触发归档流程并显示成功消息', async () => {
    const { mount, archiveSummary, runTableUpdateCommit, updateLorebook } = await mountVectorIndexPage();

    const buildButton = Array.from(document.querySelectorAll('button'))
      .find(b => /立即构建交火纪要索引/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(buildButton).not.toBeUndefined();

    buildButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(archiveSummary).toHaveBeenCalledTimes(1);
    expect(archiveSummary).toHaveBeenCalledWith({ mode: 'sync' });
    expect(runTableUpdateCommit).toHaveBeenCalledTimes(1);
    expect(updateLorebook).toHaveBeenCalledTimes(1);

    const text = document.body.textContent || '';
    expect(text).toMatch(/交火索引快照重建完成/);

    mount.__resetAcuV2MountForTests();
  });

  it('立即构建失败为跨源被拒时，失败 toast 原样带出 CORS 处置建议（用户可见路径）', async () => {
    const { mount } = await mountVectorIndexPage({
      archiveResult: {
        success: false,
        skipped: false,
        errors: ['Embedding 请求失败（retryable）: Embedding 请求网络失败（Failed to fetch）：API 提供商未允许跨源访问（CORS）：请求被浏览器拦下，未拿到任何响应。请为该 embedding/rerank 服务配置允许跨源访问（Access-Control-Allow-Origin），或改用支持 CORS 的中转地址。'],
      },
    });

    const buildButton = Array.from(document.querySelectorAll('button'))
      .find(b => /立即构建交火纪要索引/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(buildButton).not.toBeUndefined();

    buildButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const text = document.body.textContent || '';
    expect(text).toContain('交火索引快照未完成');
    expect(text).toContain('API 提供商未允许跨源访问（CORS）');
    expect(text).toContain('或改用支持 CORS 的中转地址');

    mount.__resetAcuV2MountForTests();
  });

  it('非破坏迁移旧索引入口不再渲染', async () => {
    const { mount, migrateLegacy } = await mountVectorIndexPage({
      healthReport: { legacyManifestCount: 1, issues: [] },
    });
    expect(document.body.textContent || '').not.toContain('非破坏迁移旧索引');
    expect(migrateLegacy).not.toHaveBeenCalled();
    mount.__resetAcuV2MountForTests();
  });

  it('清空临时缓存按钮只调用缓存清理服务，不删除当前索引', async () => {
    const { mount, clearCache, deleteIndex } = await mountVectorIndexPage();

    const clearButton = Array.from(document.querySelectorAll('button'))
      .find(b => /清空临时缓存/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(clearButton).not.toBeUndefined();

    clearButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(deleteIndex).not.toHaveBeenCalled();
    expect(document.body.textContent || '').toContain('交火索引临时缓存与热缓存已清空');

    mount.__resetAcuV2MountForTests();
  });

  it('清缓存未完全成功时报 warning 文案而非「已清空」', async () => {
    const { mount, clearCache } = await mountVectorIndexPage();
    clearCache.mockResolvedValueOnce(false);

    const clearButton = Array.from(document.querySelectorAll('button'))
      .find(b => /清空临时缓存/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(clearButton).not.toBeUndefined();

    clearButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const text = document.body.textContent || '';
    expect(text).toContain('未能完全清空');
    expect(text).not.toContain('交火索引临时缓存与热缓存已清空');

    mount.__resetAcuV2MountForTests();
  });

  it('删除当前索引确认后调用当前聊天索引删除服务', async () => {
    const { mount, deleteIndex } = await mountVectorIndexPage();

    const deleteButton = Array.from(document.querySelectorAll('button'))
      .find(b => /删除当前索引/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(deleteButton).not.toBeUndefined();

    deleteButton!.click();
    const layer = await flushDialog();
    expect(layer.textContent || '').toContain('删除当前聊天的交火索引');
    const confirmButton = Array.from(layer.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('删除索引'));
    expect(confirmButton).not.toBeUndefined();
    confirmButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(deleteIndex).toHaveBeenCalledTimes(1);
    expect(document.body.textContent || '').toContain('当前聊天的交火索引已删除');

    mount.__resetAcuV2MountForTests();
  });

  it('关键词提示词编辑器只在侧抽屉中出现，保存后写回配置', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage();

    expect(document.querySelector('[data-ub-main] textarea[aria-label*="提示词"]')).toBeNull();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('编辑提示词')) as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('#ub-portal .ub-sheet-layer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    const textarea = drawer!.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();
    textarea!.value = '新的关键词系统提示';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const saveButton = Array.from(drawer!.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('保存提示词')) as HTMLButtonElement | undefined;
    expect(saveButton).not.toBeUndefined();
    saveButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(config.keywordPromptGroup[0].content).toBe('新的关键词系统提示');
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('关键词提示词抽屉有未保存修改时关闭整个 UI 会确认', async () => {
    const { mount } = await mountVectorIndexPage();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('编辑提示词')) as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('#ub-portal .ub-sheet-layer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    const textarea = drawer!.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();
    textarea!.value = '未保存关键词提示';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const appClose = document.querySelector<HTMLButtonElement>('button[title="关闭 UnbirthDB"]');
    expect(appClose).not.toBeNull();
    appClose!.click();
    const layer = await flushDialog();

    expect(layer.textContent || '').toContain('你有未保存的关键词生成提示词修改');
    expect(document.getElementById('acu-app-v2')!.style.display).not.toBe('none');
    expect(document.querySelector('#ub-portal .ub-sheet-layer')).not.toBeNull();

    mount.__resetAcuV2MountForTests();
  });

  it('最近固定注入条数输入非正整数时显示 toast 并重置为默认值', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage();
    const alertSpy = vi.spyOn(window, 'alert');

    const row = Array.from(document.querySelectorAll('[data-ub-main] .ub-row'))
      .find(el => /固定写入/.test(el.textContent || ''));
    const input = row?.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.min).toBe('1');

    input!.value = '0';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.ub-toast--warning')?.textContent || '')
      .toContain('固定写入必须是正整数，已重置为默认值 50。');
    expect(config.recentFixedInjectCount).toBe(50);
    expect(input!.value).toBe('50');
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('批处理上限写入交火索引实际读取的三个字段', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage();

    const row = Array.from(document.querySelectorAll('[data-ub-main] .ub-row'))
      .find(el => /单请求最多行数/.test(el.textContent || ''));
    const input = row?.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    input!.value = '42';
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    expect(config.summaryIndexArchiveMaxConcurrency).toBe(42);
    expect(config.archiveMaxConcurrency).toBe(30);
    expect(saveSettings).toHaveBeenCalled();

    const charRow = Array.from(document.querySelectorAll('[data-ub-main] .ub-row'))
      .find(el => /单请求字符预算/.test(el.textContent || ''));
    const charInput = charRow?.querySelector('input') as HTMLInputElement | null;
    expect(charInput).not.toBeNull();
    charInput!.value = '1234';
    charInput!.dispatchEvent(new Event('change', { bubbles: true }));

    const concurrencyRow = Array.from(document.querySelectorAll('[data-ub-main] .ub-row'))
      .find(el => /同时请求数/.test(el.textContent || ''));
    const concurrencyInput = concurrencyRow?.querySelector('input') as HTMLInputElement | null;
    expect(concurrencyInput).not.toBeNull();
    concurrencyInput!.value = '2';
    concurrencyInput!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    expect(config.summaryIndexArchiveMaxInputChars).toBe(1234);
    expect(config.summaryIndexArchiveEmbeddingConcurrency).toBe(2);

    mount.__resetAcuV2MountForTests();
  });

  it('高级面板不再暴露 V2 writer kill switch 与 scope allowlist', async () => {
    const { mount } = await mountVectorIndexPage();
    expect(document.body.textContent || '').not.toContain('V2 写入闸门');
    mount.__resetAcuV2MountForTests();
  });

  it('清空临时缓存一并处理归档队列，成功文案含归档队列与条数', async () => {
    const { mount, clearCache, clearFlushQueues } = await mountVectorIndexPage();

    const clearButton = Array.from(document.querySelectorAll('button'))
      .find(b => /清空临时缓存/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(clearButton).not.toBeUndefined();

    clearButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(clearFlushQueues).toHaveBeenCalledTimes(1);
    const text = document.body.textContent || '';
    // 钉住真正的成功文案（含"清理 N 条残留"），不要用 dt 标签或裸数字这种恒真断言。
    expect(text).toContain('交火索引临时缓存与热缓存已清空');
    expect(text).toContain('清理 3 条残留');

    mount.__resetAcuV2MountForTests();
  });

  it('归档队列残留未清干净时报 warning，绝不显示成功', async () => {
    const { mount, clearFlushQueues } = await mountVectorIndexPage();
    clearFlushQueues.mockResolvedValueOnce({ clearedCount: 1, currentScopeInvalidated: true, failed: true, reason: 'delete_failed' });

    const clearButton = Array.from(document.querySelectorAll('button'))
      .find(b => /清空临时缓存/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(clearButton).not.toBeUndefined();

    clearButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const text = document.body.textContent || '';
    expect(text).toContain('未能完全清空');
    expect(text).toContain('部分存储不可用');
    expect(text).not.toContain('交火索引临时缓存与热缓存已清空');

    mount.__resetAcuV2MountForTests();
  });

  it('没加载聊天导致队列未处理时不得谎报"存储不可用、请重试"', async () => {
    // 回归锚点：曾经无论原因统一说"部分存储不可用，请重试"，而没加载聊天时
    // 重试永远不会成功——那是既谎报又给出无效指引。
    const { mount, clearFlushQueues } = await mountVectorIndexPage();
    clearFlushQueues.mockResolvedValueOnce({ clearedCount: 0, currentScopeInvalidated: false, failed: true, reason: 'no_current_scope' });

    const clearButton = Array.from(document.querySelectorAll('button'))
      .find(b => /清空临时缓存/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(clearButton).not.toBeUndefined();

    clearButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const text = document.body.textContent || '';
    expect(text).toContain('未能完全清空');
    expect(text).toContain('打开聊天后可再清');
    expect(text).not.toContain('部分存储不可用');
    expect(text).not.toContain('交火索引临时缓存与热缓存已清空');

    mount.__resetAcuV2MountForTests();
  });
});
