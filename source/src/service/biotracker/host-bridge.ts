/**
 * service/biotracker/host-bridge.ts — 宿主桥（silent-migration 专用精简层）
 *
 * 由剥离内置 biotracker 时的 vendor/host.js 抽出：仅保留一次性静默迁移
 * （silent-migration.ts）所需的宿主读写能力与其内部依赖，行为逐字等价。
 * 面板/追踪用的聊天视图、事件订阅、世界书/预设读取等导出已全部弃置。
 */

type HostContext = any;
type HostKind = 'tauritavern' | 'luker' | 'sillytavern';
type ChatState = Record<string, unknown>;

const HOST_STABLE_CHAT_ID_CACHE = new WeakMap<HostContext, { fallbackId: string; stableId: string }>();
const TAURI_STATE_NAMESPACE = 'bs-biotracker';
const TAURI_STATE_KEY = 'chat-state-v1';
const TAURI_STATE_SAVE_DELAY_MS = 250;
const TAURI_STATE_SAVE_QUEUE = new Map<string, { ctx?: HostContext; handle?: HostContext; payload: unknown; timer: ReturnType<typeof setTimeout> }>();
const TAURI_STATE_KNOWN_MISSING_IDS = new Set<string>();
const TAURI_STATE_LOAD_INFLIGHT = new Map<string, Promise<ChatState | null>>();
// 已经确认过存档内容（读到了资料，或确认过没有存档）的聊天。
// 在确认之前绝不允许用空状态回写 sidecar，详见 shouldSkipBlankHostChatStateSave。
const TAURI_STATE_HYDRATED_IDS = new Set<string>();
const TAURI_HANDLE_WAIT_TIMEOUT_MS = 3000;
const TAURI_HANDLE_WAIT_INTERVAL_MS = 100;

export function getHostKind(): HostKind {
  if ((globalThis as any).__TAURITAVERN__) return 'tauritavern';
  if ((globalThis as any).Luker?.getContext) return 'luker';
  return 'sillytavern';
}

export function getHostContext(): HostContext {
  try {
    return (globalThis as any).Luker?.getContext?.() || (globalThis as any).SillyTavern?.getContext?.() || null;
  } catch (error) {
    console.warn('[BS BioTracker] unable to read host context', error);
    return null;
  }
}

function getHostChatId(ctx: HostContext): string {
  const fallbackId = getFallbackHostChatId(ctx);
  if (getHostKind() === 'tauritavern') {
    const cached = ctx && typeof ctx === 'object' ? HOST_STABLE_CHAT_ID_CACHE.get(ctx) : null;
    if (cached?.fallbackId === fallbackId && cached.stableId) return cached.stableId;
  }
  return fallbackId;
}

function getFallbackHostChatId(ctx: HostContext): string {
  try {
    const currentChatId = ctx?.getCurrentChatId?.();
    if (currentChatId !== undefined && currentChatId !== null && String(currentChatId)) {
      return String(currentChatId);
    }
  } catch (error) {
    console.warn('[BS BioTracker] unable to read current chat id', error);
  }
  if (ctx?.chatId !== undefined && ctx?.chatId !== null && String(ctx.chatId)) return String(ctx.chatId);
  return `${ctx?.characterId ?? 'char'}:${ctx?.groupId ?? 'solo'}`;
}

export async function resolveHostChatId(ctx: HostContext): Promise<string> {
  const fallbackId = getFallbackHostChatId(ctx);
  if (getHostKind() !== 'tauritavern') return fallbackId;
  const cached = ctx && typeof ctx === 'object' ? HOST_STABLE_CHAT_ID_CACHE.get(ctx) : null;
  if (cached?.fallbackId === fallbackId && cached.stableId) return cached.stableId;
  const ready = (globalThis as any).__TAURITAVERN__?.ready || (globalThis as any).__TAURITAVERN_MAIN_READY__;
  if (ready && typeof ready.then === 'function') await ready;
  const handle = getCurrentTauriChatHandle();
  if (typeof handle?.stableId !== 'function') return fallbackId;
  try {
    const stableId = String(await handle.stableId() || '').trim();
    if (!stableId) return fallbackId;
    if (ctx && typeof ctx === 'object') HOST_STABLE_CHAT_ID_CACHE.set(ctx, { fallbackId, stableId });
    return stableId;
  } catch (error) {
    console.warn('[BS BioTracker] unable to resolve TauriTavern stable chat id', error);
    return fallbackId;
  }
}

export function getHostExtensionSettings(ctx: HostContext): ChatState | null {
  if (!ctx || typeof ctx !== 'object') return null;
  if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') ctx.extensionSettings = {};
  return ctx.extensionSettings;
}

export function saveHostSettings(ctx: HostContext): void {
  try {
    ctx?.saveSettingsDebounced?.();
  } catch (error) {
    console.warn('[BS BioTracker] unable to save host settings', error);
  }
}

function getTauriTavernApi(): HostContext | null {
  const api = (globalThis as any).__TAURITAVERN__?.api;
  return api && typeof api === 'object' ? api : null;
}

function cloneHostValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function getCurrentTauriChatHandle(): HostContext | null {
  const api = getTauriTavernApi()?.chat;
  return typeof api?.current?.handle === 'function' ? api.current.handle() : null;
}

/**
 * 保守判空：只有确认不含任何用户资料才算空。
 * 判错方向要偏「非空」——把真资料误判为空会导致存档被洗掉，反之只是多写一次。
 */
function isHostChatStateBlank(chatState: HostContext): boolean {
  if (!chatState || typeof chatState !== 'object') return true;
  const characters = chatState.characters;
  if (characters && typeof characters === 'object' && Object.keys(characters).length > 0) return false;
  if (Array.isArray(chatState.skillCatalog) && chatState.skillCatalog.length > 0) return false;
  if (Array.isArray(chatState.snapshots) && chatState.snapshots.length > 0) return false;
  return true;
}

/**
 * 防止空状态覆盖既有存档。
 *
 * TT／Luker 上 chatStates 不进全局设置，per-chat sidecar 是唯一真源，每次重开都靠 hydrate 读回来。
 * 一旦 hydrate 没成功（store 未就绪、宿主抛 Failed to resolve active character id 等），
 * 内存里就是一份刚建出来的空状态；而 getChatState 归一化时会顺手 saveSettings，
 * 把这份空状态按 handle 写进该聊天的 sidecar，真正的注册资料就此被洗掉。
 *
 * 因此：没确认过这个聊天存了什么之前，空状态一律不写。
 * 确认过之后（读到资料，或确认没有存档）才放行，使用者主动「清除」仍能正常落盘。
 */
function shouldSkipBlankHostChatStateSave(chatId: string, chatState: HostContext): boolean {
  if (!isHostChatStateBlank(chatState)) return false;
  return !TAURI_STATE_HYDRATED_IDS.has(chatId);
}

/**
 * 是否已经确认过当前聊天的存档内容。
 * 原生宿主不依赖 sidecar，永远视为已确认；TT／Luker 未确认時代表这次载入没有定论，
 * 呼叫端应该稍后重试，而不是把面板当成「没有注册角色」。
 */
export function isHostChatStateConfirmed(ctx: HostContext): boolean {
  const hostKind = getHostKind();
  if (hostKind !== 'tauritavern' && hostKind !== 'luker') return true;
  return TAURI_STATE_HYDRATED_IDS.has(getHostChatId(ctx));
}

/**
 * 先确认 sidecar 是否存在，避免直接 getJson 触发宿主的 not-found 弹窗。
 *
 * TauriTavern 把 store 读取 miss 当成后端错误：新聊天第一次探测时，
 * 使用者会看到一个红色的「后端错误 Failed to get chat store json …」，
 * 虽然不影响功能，但很吓人。后端其实提供了 list_character_chat_store_keys，
 * 只是前端包装的方法名未知，因此这里做特性探测：
 * 探得到就先列 key 再决定要不要读；探不到就回退成原本的直接读取。
 *
 * @returns true/false 为确定结果，null 表示无从检查
 */
async function tauriChatStoreHasKey(handle: HostContext, namespace: string, key: string): Promise<boolean | null> {
  const store = handle?.store;
  if (!store) return null;
  const lister = [store.listKeys, store.list, store.keys, store.listJsonKeys]
    .find((candidate: unknown) => typeof candidate === 'function');
  if (!lister) return null;
  try {
    const result = await lister.call(store, { namespace });
    const keys = Array.isArray(result)
      ? result
      : (Array.isArray(result?.keys) ? result.keys : null);
    if (!keys) return null;
    return keys.some((entry: any) => String(entry?.key ?? entry) === key);
  } catch {
    // 列举本身失败就当作无从检查，交回原本的读取路径
    return null;
  }
}

/**
 * 等待当前聊天的 store 句柄就绪。
 * 重开存档时 TT 主体可能已经 ready，但该聊天的 handle 还没挂上；
 * 原本直接当成「没有存档」返回，面板就会显示成未注册。这里给一段有限等待。
 */
async function waitForTauriChatStoreHandle(timeoutMs = TAURI_HANDLE_WAIT_TIMEOUT_MS): Promise<HostContext | null> {
  let handle = getCurrentTauriChatHandle();
  if (typeof handle?.store?.getJson === 'function') return handle;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TAURI_HANDLE_WAIT_INTERVAL_MS));
    handle = getCurrentTauriChatHandle();
    if (typeof handle?.store?.getJson === 'function') return handle;
  }
  return null;
}

export async function loadHostChatState(ctx: HostContext = null): Promise<ChatState | null> {
  const hostKind = getHostKind();
  if (hostKind === 'luker') {
    const runtime = ctx || getHostContext();
    if (typeof runtime?.getChatState !== 'function') return null;
    try {
      const stored = await runtime.getChatState(TAURI_STATE_NAMESPACE);
      // 读到了（无论有没有资料）就算确认过内容，之后才允许写空
      TAURI_STATE_HYDRATED_IDS.add(getHostChatId(ctx));
      if (stored?.version === 1 && stored.chatState && typeof stored.chatState === 'object') return cloneHostValue(stored.chatState);
    } catch (error) {
      // 读取失败＝内容未知，保持未确认状态，避免拿空的覆盖掉
      console.warn('[BS BioTracker] unable to load Luker chat state', error);
    }
    return null;
  }
  if (hostKind !== 'tauritavern') return null;
  const ready = (globalThis as any).__TAURITAVERN__?.ready || (globalThis as any).__TAURITAVERN_MAIN_READY__;
  if (ready && typeof ready.then === 'function') await ready;
  // 句柄还没挂上时不当成「没有存档」：等一小段时间，超时则维持未确认让呼叫端重试
  const handle = await waitForTauriChatStoreHandle();
  if (!handle) return null;
  // TT surfaces every backend store miss as an error toast, so remember chats
  // without stored state and skip repeat probes until our own save creates one.
  const chatId = await resolveHostChatId(ctx);
  if (TAURI_STATE_KNOWN_MISSING_IDS.has(chatId)) {
    TAURI_STATE_HYDRATED_IDS.add(chatId);
    return null;
  }
  const inflight = TAURI_STATE_LOAD_INFLIGHT.get(chatId);
  if (inflight) return inflight;
  const loadPromise = (async (): Promise<ChatState | null> => {
    // 能事先确认不存在时就不要读，省下宿主那个吓人的 not-found 错误弹窗
    const exists = await tauriChatStoreHasKey(handle, TAURI_STATE_NAMESPACE, TAURI_STATE_KEY);
    if (exists === false) {
      TAURI_STATE_KNOWN_MISSING_IDS.add(chatId);
      TAURI_STATE_HYDRATED_IDS.add(chatId);
      return null;
    }
    try {
      const stored = await handle.store.getJson({ namespace: TAURI_STATE_NAMESPACE, key: TAURI_STATE_KEY });
      // 读到了（无论有没有资料）就算确认过内容，之后才允许写空
      TAURI_STATE_HYDRATED_IDS.add(chatId);
      if (stored?.version === 1 && stored.chatState && typeof stored.chatState === 'object') {
        return cloneHostValue(stored.chatState);
      }
    } catch (error) {
      if (/not found/i.test(String(error?.message || error))) {
        // 确认这个聊天没有存档，写空无害
        TAURI_STATE_KNOWN_MISSING_IDS.add(chatId);
        TAURI_STATE_HYDRATED_IDS.add(chatId);
      } else {
        // 其它错误＝内容未知（store 未就绪、宿主报错等），保持未确认，避免拿空的覆盖掉
        console.warn('[BS BioTracker] unable to load TauriTavern chat state', error);
      }
    }
    return null;
  })();
  TAURI_STATE_LOAD_INFLIGHT.set(chatId, loadPromise);
  try {
    return await loadPromise;
  } finally {
    TAURI_STATE_LOAD_INFLIGHT.delete(chatId);
  }
}

export function scheduleHostChatStateSave(ctx: HostContext, chatState: ChatState): boolean {
  const hostKind = getHostKind();
  // [迁移契约] 返回值：true=已入队/明确无需保存；false=句柄缺失等静默 no-op（调用方据此不打完成标）
  if (!chatState || typeof chatState !== 'object') return false;
  if (hostKind === 'luker') {
    if (typeof ctx?.updateChatState !== 'function') return false;
    const chatId = getHostChatId(ctx);
    if (shouldSkipBlankHostChatStateSave(chatId, chatState)) return true;
    const previous = TAURI_STATE_SAVE_QUEUE.get(chatId);
    if (previous?.timer) clearTimeout(previous.timer);
    const payload = { version: 1, chatState: cloneHostValue(chatState) };
    const timer = setTimeout(async () => {
      const queued = TAURI_STATE_SAVE_QUEUE.get(chatId);
      if (!queued || queued.timer !== timer) return;
      TAURI_STATE_SAVE_QUEUE.delete(chatId);
      try {
        await queued.ctx.updateChatState(TAURI_STATE_NAMESPACE, () => queued.payload);
      } catch (error) {
        console.warn('[BS BioTracker] unable to save Luker chat state', error);
      }
    }, TAURI_STATE_SAVE_DELAY_MS);
    TAURI_STATE_SAVE_QUEUE.set(chatId, { ctx, payload, timer });
    return true;
  }
  if (hostKind !== 'tauritavern') return false;
  const handle = getCurrentTauriChatHandle();
  if (typeof handle?.store?.setJson !== 'function') return false;
  const chatId = getHostChatId(ctx);
  if (shouldSkipBlankHostChatStateSave(chatId, chatState)) return true;
  TAURI_STATE_KNOWN_MISSING_IDS.delete(chatId);
  const previous = TAURI_STATE_SAVE_QUEUE.get(chatId);
  if (previous?.timer) clearTimeout(previous.timer);
  const payload = { version: 1, chatState: cloneHostValue(chatState) };
  const timer = setTimeout(async () => {
    const queued = TAURI_STATE_SAVE_QUEUE.get(chatId);
    if (!queued || queued.timer !== timer) return;
    TAURI_STATE_SAVE_QUEUE.delete(chatId);
    try {
      await queued.handle.store.setJson({
        namespace: TAURI_STATE_NAMESPACE,
        key: TAURI_STATE_KEY,
        value: queued.payload,
      });
    } catch (error) {
      console.warn('[BS BioTracker] unable to save TauriTavern chat state', error);
    }
  }, TAURI_STATE_SAVE_DELAY_MS);
  TAURI_STATE_SAVE_QUEUE.set(chatId, { handle, payload, timer });
  return true;
}
