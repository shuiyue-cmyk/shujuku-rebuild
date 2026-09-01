/**
 * tests/integration/worldbook-unified-host-chain.test.ts
 * 世界书统一宿主链路集成测试
 *
 * 真身链路：buildTavernHelperCompat_ACU（组级后端锁）→ _set_TavernHelper_API_ACU
 * → worldbook-gateway / character-gateway → pipeline 严格读取。
 * 只 mock 与被测链无关的重依赖（state-manager / injection-engine / worker 等），
 * host-compat 与两个 gateway 全部走真实实现。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockSettings, mockCurrentJsonTableData, mockAllChatMessages,
  mockCoreApisAreReady, mockCurrentChatFileIdentifier, mockGetCurrentIsolationKey,
  mockGetCurrentWorldbookConfig,
} = vi.hoisted(() => ({
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '', knownCustomEntryNames: [] } as any,
  mockCurrentJsonTableData: { value: null as any },
  mockAllChatMessages: { value: [] as any[] },
  mockCoreApisAreReady: { value: true },
  mockCurrentChatFileIdentifier: { value: 'test-chat' },
  mockGetCurrentIsolationKey: vi.fn(() => ''),
  mockGetCurrentWorldbookConfig: vi.fn(() => ({
    source: 'character',
    injectionTarget: 'character',
    manualSelection: [],
    enabledEntries: {},
    zeroTkOccupyMode: false,
  })),
}));

// pipeline 的重依赖：与被测链路无关，仅补齐 import 形状
vi.mock('../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));
vi.mock('../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData.value; },
  get allChatMessages_ACU() { return mockAllChatMessages.value; },
  get coreApisAreReady_ACU() { return mockCoreApisAreReady.value; },
  get currentChatFileIdentifier_ACU() { return mockCurrentChatFileIdentifier.value; },
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  _set_currentJsonTableData_ACU: vi.fn(),
  _set_allChatMessages_ACU: vi.fn(),
}));
vi.mock('../../src/data/gateways/chat-gateway', () => ({ getChatLength_ACU: vi.fn(() => 0) }));
vi.mock('../../src/service/settings/settings-service', () => ({ saveSettings_ACU: vi.fn() }));
vi.mock('../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: vi.fn(() => []),
  materializeDataFromSheetGuide_ACU: vi.fn(() => null),
  reorderDataBySheetKeys_ACU: vi.fn((data: any) => data),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
}));
// shared/constants 无依赖且被真实 utils 读取（DEBUG_MODE_ACU / SCRIPT_ID_PREFIX_ACU），保持真身
vi.mock('../../src/service/runtime/helpers-remaining', () => ({
  formatJsonToReadable_ACU: vi.fn((v: any) => JSON.stringify(v)),
  maybeLiftWorldbookSuppression_ACU: vi.fn(),
  mergeAllIndependentTables_ACU: vi.fn(() => ({})),
  consumeLastMergeQuarantinedSheetKeys_ACU: vi.fn(() => []),
  consumeLastMergeWarnings_ACU: vi.fn(() => []),
  shouldSuppressWorldbookInjection_ACU: vi.fn(() => false),
}));
vi.mock('../../src/service/table/storage-frame-v2-persist', () => ({
  persistNullRowCleanupShards_ACU: vi.fn(async () => 'persisted'),
}));
vi.mock('../../src/service/worldbook/injection-engine', () => ({
  allocConsecutiveOrderBlock_ACU: vi.fn(),
  applyPlacementToEntry_ACU: vi.fn(),
  buildDefaultGlobalInjectionConfig_ACU: vi.fn(() => ({})),
  buildUsedOrderSet_ACU: vi.fn(() => new Set()),
  ensureExportConfigDefaults_ACU: vi.fn(),
  ensureGlobalInjectionConfigDefaults_ACU: vi.fn(),
  getEntryOrderNumber_ACU: vi.fn(() => 0),
  getFixedPlacementDefaultsForTable_ACU: vi.fn(() => ({})),
  getInjectionTargetLorebook_ACU: vi.fn(() => ''),
  getIsolationPrefix_ACU: vi.fn(() => ''),
  isEntryPlacementMatched_ACU: vi.fn(() => false),
  normalizeLorebookPosition_ACU: vi.fn(),
  normalizePlacementConfig_ACU: vi.fn(),
  updateCustomTableExports_ACU: vi.fn(),
  updateImportantPersonsRelatedEntries_ACU: vi.fn(),
  updateOutlineTableEntry_ACU: vi.fn(),
  updateSummaryTableEntries_ACU: vi.fn(),
}));
vi.mock('../../src/service/workers/worker-pool', () => ({
  runInWorkerIfNeeded: vi.fn(async () => null),
  shouldUseWorkerForWorldbook: vi.fn(() => false),
}));
vi.mock('../../src/service/agent/agent-worldbook-skill-meta', () => ({
  hasUsableWorldbookSkillMeta_ACU: vi.fn(() => false),
}));

import { buildTavernHelperCompat_ACU } from '../../src/shared/host-compat/tavern-helper-compat';
import { _set_TavernHelper_API_ACU } from '../../src/shared/host-api';
import { getCurrentCharacterWorldbookBinding_ACU } from '../../src/data/gateways/character-gateway';
import { getLorebookEntriesStrict_ACU } from '../../src/service/worldbook/pipeline';

function makeNativeContext(loadWorldInfo = vi.fn()) {
  return {
    loadWorldInfo,
    saveWorldInfo: vi.fn(),
    executeSlashCommandsWithOptions: vi.fn(),
    chat: [],
    characters: [],
  };
}

afterEach(() => {
  _set_TavernHelper_API_ACU(undefined as any);
});

describe('世界书统一宿主链路', () => {
  it('raw TavernHelper 的绑定与严格读取使用同一来源，native 世界书后端不参与', async () => {
    const nativeLoadWorldInfo = vi.fn().mockResolvedValue(null);
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '目标书', additional: [] }),
      getLorebookEntries: vi.fn().mockResolvedValue([{ uid: 1, content: '来自 raw TavernHelper' }]),
    };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => makeNativeContext(nativeLoadWorldInfo));
    _set_TavernHelper_API_ACU(api as any);

    await expect(getCurrentCharacterWorldbookBinding_ACU()).resolves.toMatchObject({
      orderedNames: ['目标书'],
      apiSource: 'getCharWorldbookNames',
    });
    await expect(getLorebookEntriesStrict_ACU(['目标书'], {
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'raw-host-chain',
    })).resolves.toMatchObject({
      status: 'success',
      entriesByBook: { '目标书': [{ uid: 1, content: '来自 raw TavernHelper' }] },
    });
    expect(rawTH.getLorebookEntries).toHaveBeenCalledWith('目标书');
    expect(nativeLoadWorldInfo).not.toHaveBeenCalled();
  });

  it('raw TavernHelper 缺少条目读取时严格链路报告 API 不可用，不切换到 native', async () => {
    const nativeLoadWorldInfo = vi.fn().mockResolvedValue({ entries: { 1: { uid: 1 } } });
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '目标书', additional: [] }),
    };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => makeNativeContext(nativeLoadWorldInfo));
    _set_TavernHelper_API_ACU(api as any);

    const result = await getLorebookEntriesStrict_ACU(['目标书'], {
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'missing-raw-read',
    });

    expect(result.status).toBe('read_failed');
    expect(result.failedBooks).toEqual([{ bookName: '目标书', errorCategory: 'api_unavailable' }]);
    expect(nativeLoadWorldInfo).not.toHaveBeenCalled();
  });
});
