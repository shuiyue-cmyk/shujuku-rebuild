/**
 * service/biotracker/biotracker-adapter.ts
 * BS BioTracker（生理状态追踪）合并适配层。
 *
 * biotracker 核心（vendor/*.js）原样嵌入，宿主接口经 host.js 的 ctx 依赖注入对接：
 * - 存储：settings_ACU.bs_biotracker 独立命名空间（含 chatStates，格式与 biotracker 原 extensionSettings.bs_biotracker 兼容，便于复用其前端）
 * - AI：默认复用数据库主 API 配置；可选生理追踪专用 API 预设（settings_ACU.bs_biotracker.apiPreset，参照剧情推进的 API 预设选择），走酒馆代理 fetch
 * - 恒字系列：异步追踪恒开启（enabled）、恒 after_ai、恒完整更新（requireFullDescriptionUpdates）、恒格式化输出（formattedOutputV4）、默认 json 响应
 * - 高级设置开关（生理追踪总开关）映射 settings_ACU.bs_biotracker.enabled
 */
import { MODULE_NAME, DEFAULT_SETTINGS, getSettings, saveSettings, getChatState, getChatKey, cloneValue, buildRecentMessages } from './vendor/state.js';
import { runRegistry, runRegistryBreedingInference } from './vendor/registry.js';
import { resetPoller, runTracker } from './vendor/tracker.js';
import { callOpenAICompatible, extractJson } from './vendor/api.js';
import { getHostContext } from './vendor/host.js';
import { settings_ACU, currentChatFileIdentifier_ACU, allChatMessages_ACU } from '../runtime/state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { resolveApiConfigByPreset_ACU } from '../settings/api-preset-service';
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

/**
 * 获取 biotracker settings 并把 API 三字段恒同步为数据库主 API 配置
 * （用户拍板：API 配置直接选用数据库保存的，不独立配置）
 */
/**
 * 获取 biotracker settings 并解析 API 配置：
 * 选定了生理追踪专用 API 预设（bs_biotracker.apiPreset）则用预设的 url/key/model，
 * 否则回退数据库主 API 配置（用户拍板：API 配置直接选用数据库保存的）
 */
function getBiotrackerSettings(ctx: BiotrackerCtx_ACU): any {
  const settings = getSettings(ctx);
  const presetName = String(settings.apiPreset || '').trim();
  const resolved = presetName ? resolveApiConfigByPreset_ACU(presetName) : null;
  const cfg = resolved?.apiConfig || settings_ACU.apiConfig || {};
  settings.apiUrl = cfg.url || settings.apiUrl || '';
  settings.apiKey = cfg.apiKey || settings.apiKey || '';
  settings.model = cfg.model || settings.model || '';
  return settings;
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
    const settings = getBiotrackerSettings(ctx);
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
    // 订阅新消息：自动注册开关开启时，新楼层后尝试发现角色
    const messageSentType = ctx.event_types?.MESSAGE_SENT;
    if (eventSource && messageSentType && typeof eventSource.on === 'function') {
      eventSource.on(messageSentType, () => {
        try {
          scheduleAutoRegisterCheck_ACU();
        } catch (e) {
          logWarn_ACU('[生理追踪] 自动注册调度失败:', e);
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

/**
 * 手动注册角色：一次点击串联两次 API（先繁育推演，再注册并套用推演结果）。
 * 流程与 biotracker 插件手动注册一致，简化为单按钮触发。
 */
export async function registerCharacter_ACU(options: RegisterCharacterOptions_ACU): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = createBiotrackerCtx_ACU();
    const name = String(options.name || '').trim();
    if (!name) return { ok: false, message: '请填写要注册的角色名。' };
    const shared = {
      targetName: name,
      customNotes: options.customNotes,
      declaredRace: options.declaredRace || '',
    };
    // 第一步：繁育推演（API 1）
    const breedingInference = await runRegistryBreedingInference(ctx, shared);
    // 第二步：注册并套用推演结果（API 2）
    await runRegistry(ctx, { ...shared, breedingInference });
    saveSettings(ctx);
    return { ok: true, message: `角色「${name}」注册完成（已套用繁育推演）。` };
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

// ═══════════════════════════════════════════════════════════════
// 自动注册（全新功能：读最新楼层 → AI 发现有价值角色 → 注册，种族由 AI 判断）
// ═══════════════════════════════════════════════════════════════

const AUTO_REGISTER_SYSTEM_PROMPT = [
  '你是角色生理状态追踪系统的「角色发现」组件。',
  '阅读下面最近的对话楼层，找出「值得被记录生理状态」的角色（角色卡角色、被反复提及/在场的有名有姓角色，排除纯路人）。',
  '输出 JSON：{"candidates":[{"name":"角色名","reason":"一句话理由"}]}。',
  '只输出 JSON，不要多余文字。',
].join('\n');

/** 自动注册开关（settings_ACU.bsBiotracker.autoRegister） */
export function isAutoRegisterEnabled_ACU(): boolean {
  return getBiotrackerRoot().autoRegister === true;
}

export function setAutoRegisterEnabled_ACU(enabled: boolean): void {
  getBiotrackerRoot().autoRegister = !!enabled;
  scheduleSettingsSave();
}

/** 自动搜寻注册的扫描楼层数（用户可选：读取最近 N 层发现角色） */
export function getAutoRegisterScanCount_ACU(): number {
  const raw = Number(getBiotrackerRoot().autoRegisterScanCount);
  const count = Math.floor(Number.isFinite(raw) ? raw : DEFAULT_SETTINGS.contextSize);
  return Math.max(2, Math.min(100, count));
}

export function setAutoRegisterScanCount_ACU(count: number): void {
  getBiotrackerRoot().autoRegisterScanCount = Math.max(2, Math.min(100, Math.floor(Number.isFinite(count) ? count : DEFAULT_SETTINGS.contextSize)));
  scheduleSettingsSave();
}

/** 扫描最新楼层并自动注册 AI 发现的角色（种族由 AI 推断，declaredRace 留空） */
export async function autoRegisterCharacters_ACU(): Promise<{ ok: boolean; registered: string[]; message: string }> {
  const ctx = createBiotrackerCtx_ACU();
  try {
    const settings = getBiotrackerSettings(ctx);
    if (!settings.apiUrl || !settings.model) {
      return { ok: false, registered: [], message: '生理追踪 API 尚未配置（API URL/模型）。' };
    }
    const chatState = getChatState(ctx, settings);
    // 用用户配置的扫描楼层数覆盖 contextSize（读取最近 N 层）
    const scanCount = getAutoRegisterScanCount_ACU();
    const recent = buildRecentMessages(ctx, { ...settings, contextSize: scanCount });
    if (recent.length === 0) return { ok: false, registered: [], message: '暂无楼层可扫描。' };

    // AI 发现候选角色（恒 json 响应）
    const result = await callOpenAICompatible(
      settings,
      { task: 'discover_characters_for_registration', recent_messages: recent },
      AUTO_REGISTER_SYSTEM_PROMPT,
    );
    const parsed = extractJson(result);
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];

    const registered: string[] = [];
    for (const candidate of candidates) {
      const name = String(candidate?.name || '').trim();
      if (!name) continue;
      if (chatState.characters?.[name]) continue; // 已注册跳过
      const reason = String(candidate?.reason || '').trim();
      try {
        // 自动注册同样走「繁育推演 + 注册」两段（与手动注册一致）
        const breedingInference = await runRegistryBreedingInference(ctx, {
          targetName: name,
          customNotes: reason || '由自动注册发现',
          declaredRace: '', // 种族交由 AI 判断
        });
        await runRegistry(ctx, {
          targetName: name,
          customNotes: reason || '由自动注册发现',
          declaredRace: '',
          breedingInference,
        });
        registered.push(name);
      } catch (e) {
        logWarn_ACU('[生理追踪] 自动注册角色失败:', name, e);
      }
    }
    if (registered.length > 0) saveSettings(ctx);
    return {
      ok: true,
      registered,
      message: registered.length > 0 ? `自动注册完成：${registered.join('、')}` : '本轮未发现需要注册的新角色。',
    };
  } catch (e: any) {
    logWarn_ACU('[生理追踪] 自动注册失败:', e);
    return { ok: false, registered: [], message: `自动注册失败：${e?.message || e}` };
  }
}

// 自动注册的周期触发：消息后延迟执行（防重入 + 冷却）
let autoRegisterInFlight = false;
let lastAutoRegisterAt = 0;

export function scheduleAutoRegisterCheck_ACU(): void {
  if (!isAutoRegisterEnabled_ACU() || autoRegisterInFlight) return;
  const now = Date.now();
  if (now - lastAutoRegisterAt < 30000) return; // 30s 冷却
  autoRegisterInFlight = true;
  lastAutoRegisterAt = now;
  setTimeout(() => {
    autoRegisterCharacters_ACU()
      .then((r) => { if (r.registered.length > 0) logDebug_ACU('[生理追踪]', r.message); })
      .catch((e) => logWarn_ACU('[生理追踪] 自动注册异常:', e))
      .finally(() => { autoRegisterInFlight = false; });
  }, 3000);
}
