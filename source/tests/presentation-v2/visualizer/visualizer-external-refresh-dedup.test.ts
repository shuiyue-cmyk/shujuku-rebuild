/** @vitest-environment jsdom */
/**
 * tests/presentation-v2/visualizer/visualizer-external-refresh-dedup.test.ts
 * P1-n：可视化器双触发去重 + revision 相等跳过。
 *
 * 同一轮提交里两条独立路径都会请求「刷新可视化器」，最终都只 ++externalRefreshTick，
 * 编辑器据此整表重载（loadFromCurrentContext → loadSnapshot，两次全库 JSON 往返）：
 *   ① presentation/components/pipeline-ui-helpers：数据合并后 200ms 刷一次；
 *   ② presentation-v2 的模板运行时提交通知（useTemplateRuntimeChangeListener）。
 * 本文件用真实的两条触发链（真实 listener、真实 UI surface 注册、真实 store/composable）验证：
 *   · 同一轮两条触发 → 只重载一次（原来两次）；
 *   · 连续两次无变化刷新 → 零重载；
 *   · 真有外部变化 → 仍进草稿（草稿拿到新值）；
 *   · 脏草稿与「窗口内变脏」都只记冲突，绝不覆盖用户改动。
 *
 * 第三条路径（watchChatChanged_ACU）直连 loadFromCurrentContext，不经 tick，
 * 因此永不被合并窗口吞掉：切聊后立刻读到新聊天数据，由「切聊直连重载」用例钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, watch } from 'vue';

const mocks = vi.hoisted(() => ({
  data: null as any,
  chatKey: 'chat-a',
  isolationKey: '',
  pinia: null as any,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mocks.data; },
  _set_currentJsonTableData_ACU: (value: any) => { mocks.data = value; },
  get currentChatFileIdentifier_ACU() { return mocks.chatKey; },
  getCurrentIsolationKey_ACU: () => mocks.isolationKey,
}));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: new Set(), cols: new Set(), cells: new Set() })),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => false),
  mergeAllIndependentTables_ACU: vi.fn(async () => ({})),
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: vi.fn((data: any) => Object.keys(data || {}).filter(key => key.startsWith('sheet_'))),
  reorderDataBySheetKeys_ACU: vi.fn((data: any) => data),
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  getActiveTemplatePresetMeta_ACU: vi.fn(() => ({ displayName: '测试预设', scopeLabel: '全局' })),
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: vi.fn(async () => 0),
  refreshMergedDataAndNotify_ACU: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  buildDefaultExportConfig_ACU: vi.fn(() => ({})),
}));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => ({ info: vi.fn(), warning: vi.fn() }),
}));
// presentation 侧依赖：只留 UI 通知与状态面板两个旁路。
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: vi.fn() } } }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn() }));
// 外部刷新桥经 mount 拿 pinia：本文件不挂真实 app，直接交出测试用的 pinia。
vi.mock('../../../src/presentation-v2/bootstrap/mount', () => ({
  getAcuV2PiniaForBridge: () => mocks.pinia,
  openAcuV2App: vi.fn(async () => undefined),
}));

function sheet(name: string, cell: string) {
  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_a: { uid: 'sheet_a', name, content: [[null, '状态'], [null, cell]] },
  };
}

async function setupSurface() {
  const { createPinia, setActivePinia } = await import('pinia');
  const pinia = createPinia();
  setActivePinia(pinia);
  const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
  const { useVisualizerData } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerData');
  // 外部刷新桥经 mount 拿 pinia，本文件不挂真实 app，直接交出这一份。
  mocks.pinia = pinia;
  const store = useVisualizerStore();
  const data = useVisualizerData();
  store.open({ source: 'external-api', wasShellOpen: true, previousPageId: 'dashboard' });

  // 与 VisualizerSurface.vue 里同款的外挂监听：tick 变化即整表重载。
  const reloads: number[] = [];
  const stopWatch = watch(
    () => store.externalRefreshTick,
    () => { reloads.push(1); void data.loadFromCurrentContext(); },
    { flush: 'post' },
  );
  const loadSnapshot = vi.spyOn(store, 'loadSnapshot');

  return { store, data, reloads, stopWatch, loadSnapshot, pinia };
}

/** 挂载真实的模板运行时提交通知监听（触发源②）。 */
async function mountRuntimeListener(pinia: any) {
  const { createApp, h } = await import('vue');
  const listener = await import('../../../src/presentation-v2/composables/useTemplateRuntimeChangeListener');
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ setup: () => { listener.useTemplateRuntimeChangeListener(); return () => h('div'); } });
  app.config.globalProperties.$pinia = pinia;
  app.use(pinia);
  app.mount(host);
  await nextTick();
  return { app, host, listener };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.data = sheet('角色状态', '平静');
  mocks.chatKey = 'chat-a';
  mocks.isolationKey = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('可视化器外部刷新：同轮去重 + revision 跳过', () => {
  it('同一轮提交的两条触发源（模板提交通知 + 数据合并后 UI 刷新）只重载一次', async () => {
    const { store, data, reloads, loadSnapshot, pinia } = await setupSurface();
    const { app, host } = await mountRuntimeListener(pinia);
    const { requestVisualizerExternalRefresh_ACU } = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const { registerUiSurface_ACU } = await import('../../../src/shared/ui-surface-registry');
    const { refreshMergedDataAndNotifyWithUI_ACU } = await import('../../../src/presentation/components/pipeline-ui-helpers');

    // 初次载入（建立 loadedSourceRevision）。
    await data.loadFromCurrentContext();
    loadSnapshot.mockClear();
    expect(reloads).toHaveLength(0);

    // 本轮提交发布了新数据（外部写入 → 新的内存表数据对象）。
    mocks.data = sheet('角色状态', '紧张');

    // 触发源②：模板运行时提交通知（真实 listener → requestVisualizerExternalRefresh_ACU）。
    const { notifyTemplateRuntimeCommitted_ACU } = await import('../../../src/shared/template-runtime-change');
    notifyTemplateRuntimeCommitted_ACU();
    await Promise.resolve();
    await nextTick();
    // 触发源①：数据合并后 UI 刷新（真实 pipeline-ui-helpers → 200ms → surface.refreshVisualizer）。
    registerUiSurface_ACU({
      openSettings: vi.fn(async () => true),
      openVisualizer: vi.fn(async () => true),
      isVisualizerActive: () => true,
      refreshVisualizer: requestVisualizerExternalRefresh_ACU,
    });
    const merged = refreshMergedDataAndNotifyWithUI_ACU({ skipNotify: true });
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(200);
    await merged;

    // 两条都落在同一个合并窗口内：此刻还没结算，不应产生任何重载。
    expect(store.externalRefreshTick).toBe(0);
    expect(loadSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await nextTick();

    expect(store.externalRefreshTick).toBe(1);
    expect(reloads).toHaveLength(1);
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    // 外部更新仍然自动进草稿。
    expect(store.currentSheet.content[1][1]).toBe('紧张');

    app.unmount();
    host.remove();
  });

  it('连续两次无变化刷新：零重载（revision 未变直接跳过）', async () => {
    const { store, data, reloads, loadSnapshot } = await setupSurface();
    const { requestVisualizerExternalRefresh_ACU } = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');

    await data.loadFromCurrentContext();
    loadSnapshot.mockClear();

    // 请求确实走到了真实外部刷新桥（未打开时会被忽略；这里已打开，走到 revision 判定）。
    expect(requestVisualizerExternalRefresh_ACU).toBeDefined();
    const { readVisualizerSourceRevision_ACU } = await import('../../../src/service/visualizer/visualizer-source-revision');
    const revision = readVisualizerSourceRevision_ACU();

    expect(store.requestExternalRefresh(revision)).toBe('unchanged');
    expect(store.requestExternalRefresh(revision)).toBe('unchanged');

    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();

    expect(store.externalRefreshTick).toBe(0);
    expect(reloads).toHaveLength(0);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it('真有外部变化时仍进草稿：窗口结算后重载一次并拿到新值', async () => {
    const { store, data, loadSnapshot } = await setupSurface();

    await data.loadFromCurrentContext();
    loadSnapshot.mockClear();
    expect(store.currentSheet.content[1][1]).toBe('平静');

    mocks.data = sheet('角色状态', '紧张');
    const { readVisualizerSourceRevision_ACU } = await import('../../../src/service/visualizer/visualizer-source-revision');
    expect(store.requestExternalRefresh(readVisualizerSourceRevision_ACU())).toBe('refreshed');

    await vi.advanceTimersByTimeAsync(500);
    await nextTick();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(store.currentSheet.content[1][1]).toBe('紧张');
  });

  it('切聊（watchChatChanged 语义的直连重载）不被合并窗口吞掉', async () => {
    const { store, data, loadSnapshot } = await setupSurface();

    await data.loadFromCurrentContext();
    loadSnapshot.mockClear();

    // 窗口开着的时候切聊：外部数据换成另一条聊天的内容。
    mocks.chatKey = 'chat-b';
    mocks.data = sheet('事件记录', '初遇');
    // 先发一个外部刷新请求（窗口开着，未结算）。
    const { readVisualizerSourceRevision_ACU } = await import('../../../src/service/visualizer/visualizer-source-revision');
    expect(store.requestExternalRefresh(readVisualizerSourceRevision_ACU())).toBe('refreshed');

    // 直连重载（CHAT_CHANGED 路径）立刻读到新聊天数据。
    expect(await data.loadFromCurrentContext()).toBe(true);
    expect(store.currentSheetKey).toBe('sheet_a');
    expect(store.tempData.sheet_a.name).toBe('事件记录');
    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    // 窗口结算时 revision 已被这次直连重载消费掉，不再重复重载。
    await vi.advanceTimersByTimeAsync(500);
    await nextTick();
    expect(store.externalRefreshTick).toBe(0);
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it('脏草稿：外部刷新只记冲突，窗口内变脏同样不重载', async () => {
    const { store, data, loadSnapshot } = await setupSurface();

    const { readVisualizerSourceRevision_ACU } = await import('../../../src/service/visualizer/visualizer-source-revision');

    await data.loadFromCurrentContext();
    loadSnapshot.mockClear();

    // ① 已脏：立刻冲突，不排窗口。
    store.setDirty(true);
    expect(store.requestExternalRefresh(readVisualizerSourceRevision_ACU())).toBe('conflicted');
    expect(store.externalRevisionChanged).toBe(true);
    expect(store.externalRefreshTick).toBe(0);

    // ② 请求之后才变脏：结算时复检为冲突，不重载草稿。
    store.setDirty(false);
    store.clearExternalRefreshConflict();
    mocks.data = sheet('角色状态', '紧张');
    expect(store.requestExternalRefresh(readVisualizerSourceRevision_ACU())).toBe('refreshed');
    store.setDirty(true);
    await vi.advanceTimersByTimeAsync(500);

    expect(store.externalRefreshTick).toBe(0);
    expect(store.externalRevisionChanged).toBe(true);
    expect(loadSnapshot).not.toHaveBeenCalled();
    // 用户自己的草稿改动原样保留。
    store.updateCell(0, 0, '我改的');
    expect(store.currentSheet.content[1][1]).toBe('我改的');
  });

  it('surface 关闭时丢弃待结算请求，关闭后不再重载', async () => {
    const { store, data, loadSnapshot } = await setupSurface();
    const { readVisualizerSourceRevision_ACU } = await import('../../../src/service/visualizer/visualizer-source-revision');

    await data.loadFromCurrentContext();
    loadSnapshot.mockClear();
    mocks.data = sheet('角色状态', '紧张');
    store.requestExternalRefresh(readVisualizerSourceRevision_ACU());

    store.closeSurface();
    await vi.advanceTimersByTimeAsync(500);

    expect(store.externalRefreshTick).toBe(0);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });
});
