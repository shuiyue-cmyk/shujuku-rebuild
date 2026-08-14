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
import { settings_ACU, currentChatFileIdentifier_ACU, allChatMessages_ACU, currentJsonTableData_ACU } from '../runtime/state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { resolveApiConfigByPreset_ACU } from '../settings/api-preset-service';
import { getCurrentCharacterFallback_ACU } from '../host/host-state-service';
import { getLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import { readFinalGenerationGreenlights_ACU } from '../agent/agent-worldbook-takeover';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { pushLog, isDebugLogEnabled } from '../../shared/log-buffer';
import { ensureBiotrackerPanelLoaded_ACU } from './panel/panel-entry';

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
  const presetCfg = resolved?.apiConfig || {};
  const mainCfg = settings_ACU.apiConfig || {};
  const cfg = presetName ? presetCfg : mainCfg;
  settings.apiUrl = cfg.url || mainCfg.url || settings.apiUrl || '';
  settings.apiKey = cfg.apiKey || mainCfg.apiKey || settings.apiKey || '';
  settings.model = cfg.model || mainCfg.model || settings.model || '';
  // 温度/max token 采用数据库保存的（选中预设时预设值优先，缺字段回退主配置）
  settings.temperature = Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : Number(mainCfg.temperature);
  settings.maxTokens = Number.isFinite(Number(cfg.max_tokens)) ? Number(cfg.max_tokens) : Number(mainCfg.max_tokens);
  // 每轮追踪分析的世界书 = 固有的蓝灯（constant 条目）+ 数据库 agent 正文放行的绿灯（readFinalGenerationGreenlights_ACU）
  // （注册流程走 registry 自己的世界书逻辑，保持插件主流模式，不受此模式影响）
  settings.trackerWorldbookMode = 'agent_greenlights';
  try {
    const greenlights = readFinalGenerationGreenlights_ACU();
    settings.agentGreenlightUids = Array.isArray(greenlights) ? greenlights.map((g) => String(g?.uid || '')).filter(Boolean) : [];
  } catch (e) {
    logWarn_ACU('[生理追踪] 读取 agent 放行世界书失败:', e);
    settings.agentGreenlightUids = [];
  }
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

/**
 * 把 biotracker vendor 的 console.warn/error/log 桥接到数据库日志系统。
 * 只转发带 [BS BioTracker] 前缀的日志（vendor 统一前缀），其余 console 行为保持不变。
 * error 无条件写入；warn 受日志系统 warn 采集开关门控；log 视为 debug（受 debug 采集开关门控）。
 * 同时注入 vendor API 调试门控探针：数据库 debug 采集开启时 vendor 的 API request/response 详情也记录。
 */
let consoleBridgeInstalled = false;
function installBiotrackerConsoleBridge(): void {
  if (consoleBridgeInstalled) return;
  consoleBridgeInstalled = true;
  const BIOTRACKER_LOG_PREFIX = '[BS BioTracker]';
  (globalThis as any).__bs_biotracker_debug_api_probe__ = () => isDebugLogEnabled();
  // API 采样参数兜底：vendor 每次 API 调用时读取数据库当前配置（温度/max token），
  // 保证追踪/注册内部直连调用（不经适配层同步）也采用数据库设置
  (globalThis as any).__bs_biotracker_api_probe__ = () => ({
    temperature: Number.isFinite(Number(settings_ACU.apiConfig?.temperature)) ? Number(settings_ACU.apiConfig.temperature) : undefined,
    maxTokens: Number.isFinite(Number(settings_ACU.apiConfig?.max_tokens)) ? Number(settings_ACU.apiConfig.max_tokens) : undefined,
  });
  const bridge = (level: 'warn' | 'error' | 'debug') => (original: (...args: any[]) => void) => (...args: any[]) => {
    original(...args);
    try {
      if (String(args[0] || '').includes(BIOTRACKER_LOG_PREFIX)) {
        pushLog(level, args);
      }
    } catch (e) { /* 桥接失败不影响原 console */ }
  };
  console.warn = bridge('warn')(console.warn.bind(console));
  console.error = bridge('error')(console.error.bind(console));
  console.log = bridge('debug')(console.log.bind(console));
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
        if (!Array.isArray(entries)) return null;
        // vendor 过滤函数只认 { name, entries } 结构——裸数组会被原样返回导致蓝灯+绿灯过滤不生效
        return { name: String(name || ''), entries };
      } catch (e) {
        logWarn_ACU('[生理追踪] 读取世界书失败:', name, e);
        return null;
      }
    },
    setExtensionPrompt: () => {},
    getContext: () => host,
  };
}

/**
 * 挂 biotracker 前端 iframe 桥（window.__ACU_BIOTRACKER_BRIDGE__）。
 * biotracker-ui 弹窗（同源 iframe）经此拿到数据库适配层 ctx / 表格数据 / 追踪触发。
 * 追踪核心由适配层单实例驱动——iframe 前端只渲染，绝不在 iframe 内跑第二实例。
 */
let frontendBridgeInstalled = false;
function installBiotrackerFrontendBridge(): void {
  if (frontendBridgeInstalled) return;
  frontendBridgeInstalled = true;
  try {
    const bridge = {
      createCtx: createBiotrackerCtx_ACU,
      getRequestHeaders: () => {
        try {
          const host = getHostContext() || (globalThis as any).SillyTavern?.getContext?.() || null;
          return typeof host?.getRequestHeaders === 'function' ? host.getRequestHeaders() : {};
        } catch (e) {
          return {};
        }
      },
      // 表格数据快照（iframe 渲染用；序列化避免 iframe 意外改写）
      getTables: () => {
        try {
          if (!currentJsonTableData_ACU || typeof currentJsonTableData_ACU !== 'object') return {};
          return JSON.parse(JSON.stringify(currentJsonTableData_ACU)) || {};
        } catch (e) {
          return {};
        }
      },
      // 手动「立即分析」：调顶层单实例追踪入口
      runTrackerNow: async () => {
        try {
          await runBiotrackerNow_ACU();
          return {};
        } catch (e) {
          logWarn_ACU('[生理追踪] 弹窗触发追踪失败:', e);
          return { skipped: true, reason: 'failed' };
        }
      },
    };
    (globalThis as any).__ACU_BIOTRACKER_BRIDGE__ = bridge;
    logDebug_ACU('[生理追踪] 前端桥已挂载');
  } catch (e) {
    logWarn_ACU('[生理追踪] 前端桥安装失败:', e);
  }
}

/**
 * 确保 biotracker 面板已加载（顶层 DOM 渲染，无 iframe）。
 * 生理追踪恒开启 → 面板 bootstrap 自动挂载弹窗并默认打开；不可关闭（settings.html 无 close 按钮）。
 * 追踪核心由本适配层单实例驱动，面板只渲染 + 桥接触发。
 */
let panelLoadRequested = false;
export function ensureBiotrackerPopup_ACU(): void {
  if (panelLoadRequested) return;
  panelLoadRequested = true;
  try {
    ensureBiotrackerPanelLoaded_ACU();
    logDebug_ACU('[生理追踪] 面板已加载');
  } catch (e) {
    logWarn_ACU('[生理追踪] 面板加载失败:', e);
    panelLoadRequested = false;
  }
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
  // 桥接 biotracker vendor 日志（console.warn/error）到数据库日志系统（高级工具日志查看器可见）
  installBiotrackerConsoleBridge();
  // 挂 iframe 前端桥（弹窗渲染用；追踪核心保持本模块单实例）
  installBiotrackerFrontendBridge();
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
    // 生理追踪恒开启 → 默认出现悬浮窗（biotracker 前端弹窗，纯渲染）
    ensureBiotrackerPopup_ACU();
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
  /** 发送给 AI 分析的最近 N 条 AI 回复（覆盖 contextSize） */
  recentCount?: number;
}

// 手动操作进行中标志（模块级共享）：页面关闭再打开时按钮保持「注册中/分析中」直至操作完成
let registerInFlight = false;
let trackerInFlight = false;
export function isRegisterInFlight_ACU(): boolean { return registerInFlight; }
export function isTrackerInFlight_ACU(): boolean { return trackerInFlight; }
export function isAutoRegisterInFlight_ACU(): boolean { return autoRegisterInFlight; }

/**
 * 手动注册角色：一次点击串联两次 API（先繁育推演，再注册并套用推演结果）。
 * 流程与 biotracker 插件手动注册一致，简化为单按钮触发。
 */
export async function registerCharacter_ACU(options: RegisterCharacterOptions_ACU): Promise<{ ok: boolean; message: string }> {
  registerInFlight = true;
  try {
    const ctx = createBiotrackerCtx_ACU();
    const name = String(options.name || '').trim();
    if (!name) return { ok: false, message: '请填写要注册的角色名。' };
    const shared = {
      targetName: name,
      customNotes: options.customNotes,
      declaredRace: options.declaredRace || '',
    };
    // 用户可指定发送最近 N 条 AI 回复（覆盖 contextSize）
    const recentCount = Number(options.recentCount);
    const settings = getBiotrackerSettings(ctx);
    if (Number.isFinite(recentCount) && recentCount > 0) {
      settings.contextSize = Math.max(1, Math.min(100, Math.floor(recentCount)));
    }
    // 第一步：繁育推演（API 1）
    const breedingInference = await runRegistryBreedingInference(ctx, shared);
    // 第二步：注册并套用推演结果（API 2）
    await runRegistry(ctx, { ...shared, breedingInference });
    saveSettings(ctx);
    return { ok: true, message: `角色「${name}」注册完成（已套用繁育推演）。` };
  } catch (e: any) {
    logWarn_ACU('[生理追踪] 注册角色失败:', e);
    return { ok: false, message: `注册失败：${e?.message || e}` };
  } finally {
    registerInFlight = false;
  }
}

/** 手动触发一次追踪分析（调试/入口用） */
export async function runBiotrackerNow_ACU(): Promise<void> {
  trackerInFlight = true;
  const ctx = createBiotrackerCtx_ACU();
  try {
    await runTracker(ctx, trackerDeps, 'manual');
  } finally {
    trackerInFlight = false;
  }
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

/**
 * 自动注册分析：发现正文角色并注册（种族由 AI 推断）。
 * - 手动触发（立即分析并注册）：recentCount 指定发送最近 N 条 AI 回复
 * - 自动触发（频率驱动）：fromIndex 指定发送自该楼层索引以来的新增楼层（增量）
 */
export async function autoRegisterCharacters_ACU(options: { recentCount?: number; fromIndex?: number } = {}): Promise<{ ok: boolean; registered: string[]; message: string }> {
  autoRegisterInFlight = true;
  const ctx = createBiotrackerCtx_ACU();
  try {
    const settings = getBiotrackerSettings(ctx);
    if (!settings.apiUrl || !settings.model) {
      return { ok: false, registered: [], message: '生理追踪 API 尚未配置（API URL/模型）。' };
    }
    const chatState = getChatState(ctx, settings);
    const chat = Array.isArray(allChatMessages_ACU) ? allChatMessages_ACU : [];

    // 手动触发：recentCount（最近 N 条）；自动触发：fromIndex（增量起点）
    const recentCount = Number(options.recentCount);
    let sliceStart: number;
    if (Number.isFinite(recentCount) && recentCount > 0) {
      sliceStart = Math.max(0, chat.length - Math.max(1, Math.min(100, Math.floor(recentCount))));
    } else {
      sliceStart = Number.isFinite(options.fromIndex) ? Math.max(0, Math.floor(Number(options.fromIndex))) : 0;
    }
    const recent = chat.slice(sliceStart).map((message: any) => ({
      name: message.name || (message.is_user ? 'user' : 'assistant') || '',
      role: message.is_user ? 'user' : 'assistant',
      text: String(message.mes || ''),
    }));
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
  } finally {
    autoRegisterInFlight = false;
  }
}

/** 自动注册的更新频率（每 N 层新楼层送入分析一次，默认 5） */
export function getAutoRegisterFrequency_ACU(): number {
  const raw = Number(getBiotrackerRoot().autoRegisterFrequency);
  const freq = Math.floor(Number.isFinite(raw) ? raw : 5);
  return Math.max(1, Math.min(50, freq));
}

export function setAutoRegisterFrequency_ACU(freq: number): void {
  getBiotrackerRoot().autoRegisterFrequency = Math.max(1, Math.min(50, Math.floor(Number.isFinite(freq) ? freq : 5)));
  scheduleSettingsSave();
}

// 自动注册的周期触发：按「更新频率」楼层增量触发（防重入）
let autoRegisterInFlight = false;
let lastAutoCheckedMessageCount = -1;

export function scheduleAutoRegisterCheck_ACU(): void {
  if (!isAutoRegisterEnabled_ACU() || autoRegisterInFlight) return;
  // 楼层增量判断：最新楼层数较上次分析增长 ≥ 更新频率才送入分析
  const messageCount = Array.isArray(allChatMessages_ACU) ? allChatMessages_ACU.length : 0;
  if (lastAutoCheckedMessageCount < 0) {
    // 首次：记录基线，不触发（避免启动即全量分析）
    lastAutoCheckedMessageCount = messageCount;
    return;
  }
  const frequency = getAutoRegisterFrequency_ACU();
  if (messageCount - lastAutoCheckedMessageCount < frequency) return;
  // 本次触发发送「自上次分析以来的新增楼层」（fromIndex = 旧基线），随后更新基线
  const fromIndex = lastAutoCheckedMessageCount;
  lastAutoCheckedMessageCount = messageCount;
  autoRegisterInFlight = true;
  setTimeout(() => {
    autoRegisterCharacters_ACU({ fromIndex })
      .then((r) => { if (r.registered.length > 0) logDebug_ACU('[生理追踪]', r.message); })
      .catch((e) => logWarn_ACU('[生理追踪] 自动注册异常:', e))
      .finally(() => { autoRegisterInFlight = false; });
  }, 3000);
}
