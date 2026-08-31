// @vitest-environment jsdom
/**
 * tests/presentation/triggers/settings-ui-connect-core-apis.test.ts
 * attemptToLoadCoreApis_ACU 装配 + fetchModelsAndConnect_ACU 协议透传 集成测试
 *
 * 核心回归：TT 裸环境（无酒馆助手）下，装配点必须把 TavernHelper_API_ACU 换成
 * buildTavernHelperCompat_ACU 的三级后端产物，让 worldbook-gateway 的世界书链路
 * 落到 SillyTavern 原生 context 而不是塌陷成空数组。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const fakeHostWin: any = {};
  return {
    hostWin: fakeHostWin,
    isExtensionMode: true,
    fetchAvailableModels: vi.fn(async () => ({ success: true, models: ['gpt-test'] })),
    showToast: vi.fn(),
    settings: {
      apiConfig: { url: 'https://api.test/v1', apiKey: 'k', model: 'gpt-test', customApiFormat: 'claude_messages' },
      contentOptimizationSettings: {},
    },
    modelSelect: { empty: vi.fn(), append: vi.fn(), find: vi.fn(() => ({ length: 0 })) },
    statusDisplay: (() => {
      const el: any = { text: vi.fn(), css: vi.fn(), html: vi.fn() };
      el.text.mockReturnValue(el);
      el.css.mockReturnValue(el);
      el.html.mockReturnValue(el);
      return el;
    })(),
    urlInput: { val: vi.fn(() => 'https://api.test/v1') },
    keyInput: { val: vi.fn(() => 'secret-key') },
  };
});
m.modelSelect.empty.mockReturnValue(m.modelSelect);

vi.mock('../../../src/shared/runtime-env', () => ({
  isExtensionMode: () => m.isExtensionMode,
  getHostWindow: () => m.hostWin,
}));
vi.mock('../../../src/service/ai/ai-service', () => ({
  fetchAvailableModels_ACU: m.fetchAvailableModels,
}));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: m.showToast }));
vi.mock('../../../src/presentation/state/ui-refs', () => ({
  $popupInstance_ACU: {},
  $customApiUrlInput_ACU: m.urlInput,
  $customApiKeyInput_ACU: m.keyInput,
  $customApiModelSelect_ACU: m.modelSelect,
  $apiStatusDisplay_ACU: m.statusDisplay,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
  currentChatFileIdentifier_ACU: 'chat-a',
  getCurrentIsolationKey_ACU: () => '',
  get coreApisAreReady_ACU() { return true; },
  settings_ACU: m.settings,
  _set_coreApisAreReady_ACU: vi.fn(),
  _set_lastTotalAiMessages_ACU: vi.fn(),
}));
vi.mock('../../../src/presentation/components/plot-editors', () => ({
  autoFillDebounceTimer_ACU: null,
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  _set_autoFillDebounceTimer_ACU: vi.fn(),
  _set_isAutoUpdatingCard_ACU: vi.fn(),
  _set_wasStoppedByUser_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(),
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger', () => ({ triggerAutomaticUpdateIfNeeded_ACU: vi.fn() }));
vi.mock('../../../src/shared/trigger-diagnostics', () => ({ logAutoFillSkip_ACU: vi.fn() }));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => [] }));
vi.mock('../../../src/shared/runtime-performance', () => ({ startRuntimePerformanceSpan_ACU: () => ({ id: 's', end: vi.fn() }) }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ maybeLiftWorldbookSuppression_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/message-handler', () => ({
  evaluateNewMessageAction_ACU: vi.fn(),
  resolveGeneratedAiMessageIndex_ACU: vi.fn(),
}));
vi.mock('../../../src/presentation/components/optimization-ui', () => ({ executeContentOptimization_ACU: vi.fn() }));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import {
  SillyTavern_API_ACU,
  TavernHelper_API_ACU,
  _set_SillyTavern_API_ACU,
  _set_TavernHelper_API_ACU,
} from '../../../src/shared/host-api';
import { attemptToLoadCoreApis_ACU, fetchModelsAndConnect_ACU } from '../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect';
import {
  isWorldbookApiAvailable_ACU,
  listLorebooks_ACU,
  getLorebookEntries_ACU,
} from '../../../src/data/gateways/worldbook-gateway';

/** 与 TT dev getContext() 同形的宿主 context */
function installTtLikeHost(options: { withTavernHelper?: boolean } = {}) {
  const loadWorldInfo = vi.fn(async (name: string) => ({
    entries: { 1: { uid: 1, comment: `${name}-条目`, content: `${name}-正文` } },
  }));
  const context = {
    loadWorldInfo,
    saveWorldInfo: vi.fn(async () => undefined),
    executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: '' })),
    getWorldInfoNames: vi.fn(() => ['剧情书', '设定书']),
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    characters: [],
    characterId: 0,
    chat: [],
  };
  m.hostWin.SillyTavern = { getContext: () => context };
  m.hostWin.TavernHelper = options.withTavernHelper
    ? { getLorebookEntries: vi.fn(async () => [{ uid: 1, comment: '助手条目' }]), getLorebooks: vi.fn(async () => ['助手书']) }
    : undefined;
  (m.hostWin as any).$ = (() => undefined) as any;
  (m.hostWin as any).toastr = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(), clear: vi.fn() };
  (window as any).$ = (m.hostWin as any).$;
  (window as any).toastr = (m.hostWin as any).toastr;
  delete (window as any).TavernHelper;
  delete (window as any).SillyTavern;
  return context;
}

beforeEach(() => {
  vi.clearAllMocks();
  _set_SillyTavern_API_ACU(undefined);
  _set_TavernHelper_API_ACU(undefined);
});

describe('attemptToLoadCoreApis_ACU 装配三级后端', () => {
  it('TT 裸环境（无酒馆助手）下世界书链路经原生 context 恢复', async () => {
    const context = installTtLikeHost();
    // 油猴模式下 iframe 自身没有 TavernHelper/SillyTavern，插件模式同理走 hostWin
    (window as any).TavernHelper = undefined;

    attemptToLoadCoreApis_ACU();

    expect(TavernHelper_API_ACU).toBeTruthy();
    expect(typeof TavernHelper_API_ACU!.getLorebookEntries).toBe('function');
    // 装配生效的直接证据：gateway 的可用性门控从 false 翻成 true
    expect(isWorldbookApiAvailable_ACU()).toBe(true);
    await expect(listLorebooks_ACU()).resolves.toEqual(['剧情书', '设定书']);
    expect(context.getWorldInfoNames).toHaveBeenCalled();
    await expect(getLorebookEntries_ACU('剧情书')).resolves.toEqual([
      expect.objectContaining({ uid: 1, comment: '剧情书-条目', content: '剧情书-正文' }),
    ]);
    expect(context.loadWorldInfo).toHaveBeenCalledWith('剧情书');
  });

  it('getStApi 是闭包：每次读取都重新调用 getContext()，不缓存过期快照', async () => {
    const getContext = vi.fn(() => ({
      loadWorldInfo: vi.fn(async () => ({ entries: {} })),
      saveWorldInfo: vi.fn(async () => undefined),
      executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: '' })),
      getWorldInfoNames: vi.fn(() => ['第一轮']),
    }));
    m.hostWin.SillyTavern = { getContext };
    (m.hostWin as any).$ = (() => undefined) as any;
    (m.hostWin as any).toastr = {};
    delete (window as any).TavernHelper;
    delete (window as any).SillyTavern;

    attemptToLoadCoreApis_ACU();
    const first = await listLorebooks_ACU();

    getContext.mockImplementation(() => ({
      loadWorldInfo: vi.fn(async () => ({ entries: {} })),
      saveWorldInfo: vi.fn(async () => undefined),
      executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: '' })),
      getWorldInfoNames: vi.fn(() => ['第二轮']),
    }));
    const second = await listLorebooks_ACU();

    expect(first).toEqual(['第一轮']);
    expect(second).toEqual(['第二轮']);
  });

  it('酒馆助手存在时保持透传：世界书读取仍走助手 API，不落到原生 context', async () => {
    const context = installTtLikeHost({ withTavernHelper: true });
    const helperEntries = m.hostWin.TavernHelper.getLorebookEntries;
    const helperList = m.hostWin.TavernHelper.getLorebooks;

    attemptToLoadCoreApis_ACU();

    await expect(listLorebooks_ACU()).resolves.toEqual(['助手书']);
    await expect(getLorebookEntries_ACU('书A')).resolves.toEqual([{ uid: 1, comment: '助手条目' }]);
    expect(helperList).toHaveBeenCalled();
    expect(helperEntries).toHaveBeenCalledWith('书A');
    expect(context.getWorldInfoNames).not.toHaveBeenCalled();
    expect(context.loadWorldInfo).not.toHaveBeenCalled();
  });

  it('宿主既无酒馆助手也无可用 context 时，方法保持缺失语义而不是抛错', async () => {
    m.hostWin.SillyTavern = { getContext: () => null };
    delete m.hostWin.TavernHelper;
    delete (window as any).TavernHelper;
    (m.hostWin as any).$ = (() => undefined) as any;
    (m.hostWin as any).toastr = {};

    attemptToLoadCoreApis_ACU();

    expect(TavernHelper_API_ACU).toBeTruthy();
    expect(typeof TavernHelper_API_ACU!.getLorebookEntries).toBe('undefined');
    expect(isWorldbookApiAvailable_ACU()).toBe(false);
    await expect(listLorebooks_ACU()).resolves.toEqual([]);
  });

  it('SillyTavern_API_ACU 仍被装配为 context Proxy', () => {
    installTtLikeHost();
    attemptToLoadCoreApis_ACU();
    expect(SillyTavern_API_ACU).toBeTruthy();
    expect((SillyTavern_API_ACU as any).getWorldInfoNames).toBeDefined();
  });
});

describe('fetchModelsAndConnect_ACU 透传 customApiFormat', () => {
  it('把 settings_ACU.apiConfig.customApiFormat 作为第三参传给 fetchAvailableModels_ACU', async () => {
    await fetchModelsAndConnect_ACU();

    expect(m.fetchAvailableModels).toHaveBeenCalledWith('https://api.test/v1', 'secret-key', 'claude_messages');
  });

  it('未配置协议时传空串（保持 service 侧默认分流）', async () => {
    m.settings.apiConfig = { ...m.settings.apiConfig, customApiFormat: undefined };
    await fetchModelsAndConnect_ACU();

    expect(m.fetchAvailableModels).toHaveBeenCalledWith('https://api.test/v1', 'secret-key', '');
  });
});
