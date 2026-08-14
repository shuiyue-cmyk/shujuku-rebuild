/**
 * service/biotracker/biotracker-adapter.ts
 * BS BioTracker（生理状态追踪）合并适配层。
 *
 * biotracker 核心（vendor/*.js）原样嵌入，宿主接口经 host.js 的 ctx 依赖注入对接：
 * - 存储：settings_ACU.bsBiotracker 独立命名空间（含 chatStates，格式与 biotracker 原 extensionSettings.bs_biotracker 兼容，便于复用其前端）
 * - AI：独立 API 配置（settings_ACU.bsBiotracker.apiUrl/apiKey/model），走酒馆代理 fetch
 * - 恒字系列：异步追踪恒开启（enabled）、恒 after_ai、恒完整更新（requireFullDescriptionUpdates）、恒格式化输出（formattedOutputV4）、默认 json 响应
 * - 高级设置开关（生理追踪总开关）映射 settings_ACU.bsBiotracker.enabled
 */
import { MODULE_NAME, DEFAULT_SETTINGS, getSettings, saveSettings, getChatState, getChatKey, cloneValue } from './vendor/state.js';
import { runRegistry } from './vendor/registry.js';
import { resetPoller, runTracker } from './vendor/tracker.js';
import { getHostContext } from './vendor/host.js';
import { settings_ACU, currentChatFileIdentifier_ACU, allChatMessages_ACU } from '../runtime/state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { getCurrentCharacterFallback_ACU } from '../host/host-state-service';
import { getLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

// ═══════════════════════════════════════════════════════════════
// 存储命名空间（settings_ACU.bsBiotracker）
// ═══════════════════════════════════════════════════════════════

/** biotracker 存储根对象（映射到 settings_ACU.bsBiotracker，惰性初始化） */
function getBiotrackerRoot(): Record<string, any> {
  if (!settings_ACU[MODULE_NAME] || typeof settings_ACU[MODULE_NAME] !== 'object') {
    settings_ACU[MODULE_NAME] = cloneValue(DEFAULT_SETTINGS);
  }
  return settings_ACU[MODULE_NAME];
}

// ═══════════════════════════════════════════════════════════════
// ctx 构造（biotracker 宿主上下文依赖注入）
// ═══════════════════════════════════════════════════════════════

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSettingsSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveSettings_ACU(); } catch (e) { logWarn_ACU('[生理追踪] 保存设置失败:', e); }
  }, 400);
}

export interface BiotrackerCtx_ACU {
  extensionSettings: Record<string, any>;
  saveSettingsDebounced: () => void;
  chat: any[];
  characters: any[];
  chatId: string;
  getCurrentChatId: () => string;
  eventSource: any;
  event_types: any;
  chatCompletionSettings: any;
  loadWorldInfo: (name: string) => Promise<any>;
  setExtensionPrompt?: (key: string, text: string, position: number, budget: number) => void;
  getContext?: () => any;
}

/** 构造 biotracker 宿主上下文（每次调用取当前运行态） */
export function createBiotrackerCtx_ACU(): BiotrackerCtx_ACU {
  const host = getHostContext() || (globalThis as any).SillyTavern?.getContext?.() || null;
  const extensionSettings = { [MODULE_NAME]: getBiotrackerRoot() };
  return {
    extensionSettings,
    saveSettingsDebounced: scheduleSettingsSave,
    chat: Array.isArray(allChatMessages_ACU) ? allChatMessages_ACU : [],
    characters: Array.isArray(host?.characters) ? host.characters : [],
    chatId: String(currentChatFileIdentifier_ACU || ''),
    getCurrentChatId: () => String(currentChatFileIdentifier_ACU || ''),
    eventSource: host?.eventSource || null,
    event_types: host?.eventTypes || null,
    chatCompletionSettings: host?.chatCompletionSettings || null,
    loadWorldInfo: async (name: string) => {
      try {
        const entries = await getLorebookEntries_ACU(String(name || ''));
        return Array.isArray(entries) ? entries : null;
      } catch (e) {
        logWarn_ACU('[生理追踪] 读取世界书失败:', name, e);
        return null;
      }
    },
    setExtensionPrompt: () => {},
    getContext: () => host,
  };
}

// ═══════════════════════════════════════════════════════════════
// 开关与恒字系列
// ═══════════════════════════════════════════════════════════════

/** 高级设置总开关（settings_ACU.bsBiotracker.enabled）读写 */
export function isBiotrackerEnabled_ACU(): boolean {
  return getBiotrackerRoot().enabled === true;
}

export function setBiotrackerEnabled_ACU(enabled: boolean): void {
  getBiotrackerRoot().enabled = !!enabled;
  if (getBiotrackerRoot().enabled) {
    // 恒字系列：after_ai / 完整更新 / 格式化输出 / json
    getBiotrackerRoot().triggerTiming = 'after_ai';
    getBiotrackerRoot().requireFullDescriptionUpdates = true;
    getBiotrackerRoot().formattedOutputV4 = true;
  }
  scheduleSettingsSave();
  syncPoller();
}

// ═══════════════════════════════════════════════════════════════
// 初始化与轮询
// ═══════════════════════════════════════════════════════════════

const trackerDeps = { renderStatusPanel: () => {}, updateClock: () => {} };

let pollerActive = false;

function syncPoller(): void {
  const ctx = createBiotrackerCtx_ACU();
  if (isBiotrackerEnabled_ACU()) {
    if (!pollerActive) {
      pollerActive = true;
      resetPoller(ctx, trackerDeps);
    }
  } else if (pollerActive) {
    pollerActive = false;
    resetPoller(ctx, trackerDeps);
  }
}

let initialized = false;

/** 初始化生理追踪模块（entry 启动时调用一次） */
export function initBiotracker_ACU(): void {
  if (initialized) return;
  initialized = true;
  try {
    const ctx = createBiotrackerCtx_ACU();
    const settings = getSettings(ctx);
    // 恒字系列强制（异步追踪恒开启/after_ai/完整更新/格式化输出/json）
    settings.enabled = true;
    settings.triggerTiming = 'after_ai';
    settings.requireFullDescriptionUpdates = true;
    settings.formattedOutputV4 = true;
    scheduleSettingsSave();

    // 订阅聊天切换：预热当前聊天状态（chatStates[chatKey]）
    const eventSource = ctx.eventSource;
    const chatChangedType = ctx.event_types?.CHAT_CHANGED;
    if (eventSource && chatChangedType && typeof eventSource.on === 'function') {
      eventSource.on(chatChangedType, () => {
        try {
          const nextCtx = createBiotrackerCtx_ACU();
          const nextSettings = getSettings(nextCtx);
          getChatState(nextCtx, nextSettings);
          syncPoller();
        } catch (e) {
          logWarn_ACU('[生理追踪] CHAT_CHANGED 处理失败:', e);
        }
      });
    }
    logDebug_ACU('[生理追踪] 初始化完成，已注册角色数:', Object.keys(getChatState(ctx, settings).characters || {}).length);
  } catch (e) {
    logWarn_ACU('[生理追踪] 初始化失败（宿主未就绪，等待重试）:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// 注册入口
// ═══════════════════════════════════════════════════════════════

export interface RegisterCharacterOptions_ACU {
  name: string;
  declaredRace?: string;
  customNotes?: string;
}

/** 手动注册角色（种族手动选择） */
export async function registerCharacter_ACU(options: RegisterCharacterOptions_ACU): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = createBiotrackerCtx_ACU();
    const name = String(options.name || '').trim();
    if (!name) return { ok: false, message: '请填写要注册的角色名。' };
    await runRegistry(ctx, {
      targetName: name,
      customNotes: options.customNotes,
      declaredRace: options.declaredRace || '',
      breedingInference: false,
    });
    saveSettings(ctx);
    return { ok: true, message: `角色「${name}」注册完成。` };
  } catch (e: any) {
    logWarn_ACU('[生理追踪] 注册角色失败:', e);
    return { ok: false, message: `注册失败：${e?.message || e}` };
  }
}

/** 手动触发一次追踪分析（调试/入口用） */
export async function runBiotrackerNow_ACU(): Promise<void> {
  const ctx = createBiotrackerCtx_ACU();
  await runTracker(ctx, trackerDeps, 'manual');
}
