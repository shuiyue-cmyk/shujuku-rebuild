// ═══════════════════════════════════════════════════════════
// service/settings/api-preset-service.ts — API 预设单一权威
//
// 本模块是 API 配置与预设的唯一写入、归一化、引用清理、解析边界。
// V1 presentation 不得直接修改这些字段；V2 必须通过本 service 操作。
// 写操作流程：校验 → 快照 → 改内存 → saveSettings_ACU → 失败回滚。
// ═══════════════════════════════════════════════════════════════

import { settings_ACU, currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { saveSettings_ACU, type SaveSettingsResult_ACU } from './settings-service';
import { bumpApiPresetRevision_ACU } from './api-preset-staleness';
import { logWarn_ACU } from '../../shared/utils';

// ═══ 类型 ═══

export type ApiPresetApiMode_ACU = 'custom';

/** 思考强度等级（reasoning_effort）：'false' 传 false 关闭思考，'auto' 则请求体省略该参数由服务端自定 */
export type ReasoningEffort_ACU = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'false' | 'auto';

/** 接口协议（预设级）：对齐 TauriTavern 主 API 的四个「自定义」选项（custom_api_format 四值契约） */
export type CustomApiFormat_ACU = 'openai_compat' | 'openai_responses' | 'claude_messages' | 'gemini_interactions';

const CUSTOM_API_FORMATS_ACU: readonly CustomApiFormat_ACU[] = ['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions'];

export function normalizeCustomApiFormat_ACU(value: unknown): CustomApiFormat_ACU {
  const raw = String(value ?? '').trim();
  return (CUSTOM_API_FORMATS_ACU as readonly string[]).includes(raw) ? (raw as CustomApiFormat_ACU) : 'openai_compat';
}

/**
 * 提示词后处理（随请求体 custom_prompt_post_processing 透传给 TT 后端）。
 * '' = 未选择：请求体省略该字段，后端原样透传消息，可保留提示词组中部 system 段的角色；
 * 缺省/非法值统一归一为 'strict'（默认严格，与历史写死 strict 的行为保持兼容）。
 * 白名单校验仿 custom_api_format：非法值降级 strict（TT 对非法值 fail-fast，必须在客户端兜底）。
 */
export type ApiPromptPostProcessingValue_ACU =
  | ''
  | 'merge'
  | 'semi'
  | 'strict'
  | 'single'
  | 'merge_tools'
  | 'semi_tools'
  | 'strict_tools';

export const API_PROMPT_POST_PROCESSING_VALUES_ACU: readonly ApiPromptPostProcessingValue_ACU[] = [
  '',
  'merge',
  'semi',
  'strict',
  'single',
  'merge_tools',
  'semi_tools',
  'strict_tools',
];

export const API_PROMPT_POST_PROCESSING_DEFAULT_ACU: ApiPromptPostProcessingValue_ACU = 'strict';

export function normalizePromptPostProcessing_ACU(value: unknown): ApiPromptPostProcessingValue_ACU {
  // 显式空串 = 用户选择「未选择」，保留；缺失/非字符串/非法值 → 默认严格。
  if (typeof value !== 'string') return API_PROMPT_POST_PROCESSING_DEFAULT_ACU;
  const normalized = value.trim();
  if (normalized === '') return '';
  return (API_PROMPT_POST_PROCESSING_VALUES_ACU as readonly string[]).includes(normalized)
    ? (normalized as ApiPromptPostProcessingValue_ACU)
    : API_PROMPT_POST_PROCESSING_DEFAULT_ACU;
}

export interface ApiPresetApiConfig_ACU {
  url: string;
  apiKey: string;
  model: string;
  max_tokens: number;
  maxTokens?: number; // [兼容] 历史字段别名，防止旧调用方 maxTokens 访问崩溃
  temperature: number;
  bodyParams: string;
  excludeBodyParams: string;
  requestHeaders: string;
  /** 流式输出（预设级）：该预设是否开启流式输出；缺省时回退全局 settings_ACU.streamingEnabled */
  streamingEnabled?: boolean;
  /** 思考强度（预设级）：该预设的 reasoning_effort 等级；缺省时回退全局 */
  reasoningEffort?: ReasoningEffort_ACU;
  /** 接口协议（预设级）：openai_compat（默认）/ openai_responses / claude_messages / gemini_interactions；随请求体 custom_api_format 透传给 TT 后端分流 */
  customApiFormat: CustomApiFormat_ACU;
  /** 提示词后处理（预设级）：strict（默认）/ merge / semi / single / *_tools；显式 '' = 未选择，请求体省略该字段 */
  promptPostProcessing: ApiPromptPostProcessingValue_ACU;
}

export interface ApiPreset_ACU {
  name: string;
  apiMode: ApiPresetApiMode_ACU;
  apiConfig: ApiPresetApiConfig_ACU;
  /** 非预填充支持（预设级）：该预设是否把 assistant 消息改写为 user +「助手：」前缀 */
  nonPrefillSupport?: boolean;
  /** 公益站兼容（预设级）：开启后该预设限速每分钟最多 3 次请求（各预设独立计数） */
  publicServiceMode?: boolean;
  /** JSON 格式化输出（预设级）：开启后，需要明确返回 JSON 的调用会在请求体附加 response_format json_object */
  jsonFormatOutput?: boolean;
}

export interface ApiPresetBinding_ACU {
  presetName: string;
  updatedAt: number;
}

/** 统一写操作结果 */
export interface ApiPresetWriteResult_ACU {
  ok: boolean;
  code: 'ok' | 'invalid_input' | 'not_found' | 'save_failed' | 'settings_loading';
  changed: boolean;
  value?: unknown;
  saveResult?: SaveSettingsResult_ACU;
  message?: string;
}

// ═══ 归一化 ═══

/** 酒馆主 API（tavern）已剥离，API 模式恒为自定义 */
export function normalizeApiMode_ACU(_value: unknown): ApiPresetApiMode_ACU {
  return 'custom';
}

export function normalizeApiConfig_ACU(value: any): ApiPresetApiConfig_ACU {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const maxTokens = Number(source.max_tokens ?? source.maxTokens ?? 60000);
  const temperature = Number(source.temperature ?? 1);
  const rawStreaming = source.streamingEnabled;
  let streamingEnabled: boolean | undefined;
  if (rawStreaming === true || (typeof rawStreaming === 'string' && rawStreaming.trim().toLowerCase() === 'true')) streamingEnabled = true;
  else if (rawStreaming === false || (typeof rawStreaming === 'string' && rawStreaming.trim().toLowerCase() === 'false')) streamingEnabled = false;
  else streamingEnabled = undefined;
  const rawReasoning = String(source.reasoningEffort ?? '').trim().toLowerCase();
  const reasoningEffort = (['low', 'medium', 'high', 'xhigh', 'max', 'false', 'auto'] as const).includes(rawReasoning as any)
    ? (rawReasoning as ReasoningEffort_ACU)
    : undefined;
  // [修复] 保留源对象中所有非白名单字段（如 topP/top_p/frequency_penalty），
  // 避免对运行中 apiConfig 的归一化破坏调用方依赖的透传字段。
  return {
    url: typeof source.url === 'string' ? source.url : '',
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
    model: typeof source.model === 'string' ? source.model : '',
    max_tokens: Number.isFinite(maxTokens) && maxTokens >= 0 ? Math.floor(maxTokens) : 60000,
    maxTokens: Number.isFinite(maxTokens) && maxTokens >= 0 ? Math.floor(maxTokens) : 60000,
    temperature: Number.isFinite(temperature) ? temperature : 1,
    bodyParams: typeof source.bodyParams === 'string' ? source.bodyParams : '',
    excludeBodyParams: typeof source.excludeBodyParams === 'string' ? source.excludeBodyParams : '',
    requestHeaders: typeof source.requestHeaders === 'string' ? source.requestHeaders : '',
    customApiFormat: normalizeCustomApiFormat_ACU(source.customApiFormat),
    promptPostProcessing: normalizePromptPostProcessing_ACU(source.promptPostProcessing),
    ...(streamingEnabled !== undefined ? { streamingEnabled } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...Object.fromEntries(
      Object.entries(source).filter(([key]) =>
        !['url', 'apiKey', 'model', 'useMainApi', 'max_tokens', 'maxTokens', 'temperature', 'bodyParams', 'excludeBodyParams', 'requestHeaders', 'streamingEnabled', 'reasoningEffort', 'customApiFormat', 'promptPostProcessing'].includes(key)
      )
    ),
  };
}

export function normalizePreset_ACU(value: any): ApiPreset_ACU | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;
  return {
    name,
    apiMode: normalizeApiMode_ACU(value.apiMode),
    apiConfig: normalizeApiConfig_ACU(value.apiConfig),
    nonPrefillSupport: value.nonPrefillSupport === true,
    publicServiceMode: value.publicServiceMode === true,
    jsonFormatOutput: value.jsonFormatOutput === true,
  };
}

export function normalizePresetList_ACU(value: unknown): ApiPreset_ACU[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const presets: ApiPreset_ACU[] = [];
  for (const raw of value) {
    const preset = normalizePreset_ACU(raw);
    if (!preset || seen.has(preset.name)) continue;
    seen.add(preset.name);
    presets.push(preset);
  }
  return presets;
}

/** 确保 settings shape 就位（纯内存，不持久化） */
export function ensureApiSettingsShape_ACU(): void {
  if (!Array.isArray(settings_ACU.apiPresets)) settings_ACU.apiPresets = [];
  settings_ACU.apiPresets = normalizePresetList_ACU(settings_ACU.apiPresets);
  if (typeof settings_ACU.defaultApiPresetName !== 'string') settings_ACU.defaultApiPresetName = '';
  if (
    !settings_ACU.apiPresetBindingsByChat ||
    typeof settings_ACU.apiPresetBindingsByChat !== 'object' ||
    Array.isArray(settings_ACU.apiPresetBindingsByChat)
  ) {
    settings_ACU.apiPresetBindingsByChat = {};
  }
  settings_ACU.apiMode = normalizeApiMode_ACU(settings_ACU.apiMode);
  // [修复] 仅在 apiConfig shape 非法时重建；合法时保留原引用，避免读路径破坏引用同一性。
  if (!settings_ACU.apiConfig || typeof settings_ACU.apiConfig !== 'object' || Array.isArray(settings_ACU.apiConfig)) {
    settings_ACU.apiConfig = normalizeApiConfig_ACU(settings_ACU.apiConfig);
  }
  if (typeof settings_ACU.tavernProfile !== 'string') settings_ACU.tavernProfile = '';
  if (typeof settings_ACU.tableApiPreset !== 'string') settings_ACU.tableApiPreset = '';
  if (typeof settings_ACU.plotApiPreset !== 'string') settings_ACU.plotApiPreset = '';
  if (
    !settings_ACU.tableApiPresetOverridesByName ||
    typeof settings_ACU.tableApiPresetOverridesByName !== 'object' ||
    Array.isArray(settings_ACU.tableApiPresetOverridesByName)
  ) {
    settings_ACU.tableApiPresetOverridesByName = {};
  }
  if (
    !settings_ACU.plotTaskApiPresetOverridesById ||
    typeof settings_ACU.plotTaskApiPresetOverridesById !== 'object' ||
    Array.isArray(settings_ACU.plotTaskApiPresetOverridesById)
  ) {
    settings_ACU.plotTaskApiPresetOverridesById = {};
  }
  if (!settings_ACU.contentOptimizationSettings || typeof settings_ACU.contentOptimizationSettings !== 'object') {
    settings_ACU.contentOptimizationSettings = { apiPreset: '' };
  }
  if (typeof settings_ACU.contentOptimizationSettings.apiPreset !== 'string') {
    settings_ACU.contentOptimizationSettings.apiPreset = '';
  }
}

// ═══ 读取 ═══

export function findPresetByName_ACU(presets: ApiPreset_ACU[], name: string): ApiPreset_ACU | null {
  const normalized = String(name || '').trim();
  return presets.find(p => p.name === normalized) ?? null;
}

export function getCurrentChatKey_ACU(): string {
  const raw = String(currentChatFileIdentifier_ACU || '').trim();
  return raw || 'unknown_chat';
}

/** 读取当前聊天绑定的预设名（悬挂引用返回空串） */
export function getBoundPresetNameForChat_ACU(chatKey?: string): string {
  ensureApiSettingsShape_ACU();
  const key = chatKey || getCurrentChatKey_ACU();
  const binding = settings_ACU.apiPresetBindingsByChat[key] as ApiPresetBinding_ACU | undefined;
  if (!binding || typeof binding !== 'object') return '';
  const preset = findPresetByName_ACU(settings_ACU.apiPresets, binding.presetName);
  return preset ? preset.name : '';
}

/** 按预设名解析运行配置；空名或悬挂引用返回可断言结果（不静默复用当前配置） */
export function resolveApiConfigByPreset_ACU(presetName: string): {
  apiMode: ApiPresetApiMode_ACU;
  apiConfig: ApiPresetApiConfig_ACU;
  tavernProfile: string;
  resolved: boolean;
  /** 预设级非预填充支持；未指定预设/悬挂引用时回退全局 settings_ACU.nonPrefillSupport */
  nonPrefillSupport: boolean;
  /** 预设级公益站兼容（限速 3 次/分钟）；仅预设显式开启时为 true，回退路径恒 false */
  publicServiceMode: boolean;
  /** 预设级 JSON 格式化输出；无全局 settings 对应项，回退路径恒 false（与 nonPrefillSupport 回退全局不同） */
  jsonFormatOutput: boolean;
} {
  ensureApiSettingsShape_ACU();
  const normalized = String(presetName || '').trim();
  if (!normalized) {
    return {
      apiMode: settings_ACU.apiMode,
      apiConfig: settings_ACU.apiConfig,
      tavernProfile: settings_ACU.tavernProfile,
      resolved: false,
      nonPrefillSupport: settings_ACU.nonPrefillSupport === true,
      publicServiceMode: false,
      // 无全局 settings.jsonFormatOutput 对应项，回退恒 false（与 nonPrefillSupport 回退全局不同）。
      jsonFormatOutput: false,
    };
  }
  const preset = findPresetByName_ACU(settings_ACU.apiPresets, normalized);
  if (preset) {
    return {
      apiMode: preset.apiMode,
      apiConfig: preset.apiConfig,
      tavernProfile: settings_ACU.tavernProfile,
      resolved: true,
      nonPrefillSupport: preset.nonPrefillSupport === true,
      publicServiceMode: preset.publicServiceMode === true,
      jsonFormatOutput: preset.jsonFormatOutput === true,
    };
  }
  // 悬挂引用：返回当前配置但标记未解析，调用方应据此拒绝或回退，而不是静默误用。
  logWarn_ACU(`[API预设] 预设 "${normalized}" 不存在，返回当前配置（resolved=false）。`);
  return {
    apiMode: settings_ACU.apiMode,
    apiConfig: settings_ACU.apiConfig,
    tavernProfile: settings_ACU.tavernProfile,
    resolved: false,
    nonPrefillSupport: settings_ACU.nonPrefillSupport === true,
    publicServiceMode: false,
    // 无全局 settings.jsonFormatOutput 对应项，回退恒 false（与 nonPrefillSupport 回退全局不同）。
    jsonFormatOutput: false,
  };
}

/** 聊天切换后 reconcile：把当前聊天绑定重新投影到 apiMode/apiConfig/tavernProfile */
export function reconcileApiBindingForCurrentChat_ACU(): { applied: boolean; presetName: string } {
  ensureApiSettingsShape_ACU();
  const boundName = getBoundPresetNameForChat_ACU();
  if (!boundName) return { applied: false, presetName: '' };
  const preset = findPresetByName_ACU(settings_ACU.apiPresets, boundName);
  if (!preset) return { applied: false, presetName: '' };
  settings_ACU.apiMode = preset.apiMode;
  settings_ACU.apiConfig = JSON.parse(JSON.stringify(preset.apiConfig));
  return { applied: true, presetName: preset.name };
}

// ═══ 写操作（事务式：快照 → 修改 → 保存 → 失败回滚） ═══

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function snapshotApiFields_ACU(): Record<string, unknown> {
  ensureApiSettingsShape_ACU();
  return {
    apiMode: settings_ACU.apiMode,
    apiConfig: clone(settings_ACU.apiConfig),
    tavernProfile: settings_ACU.tavernProfile,
    apiPresets: clone(settings_ACU.apiPresets),
    defaultApiPresetName: settings_ACU.defaultApiPresetName,
    apiPresetBindingsByChat: clone(settings_ACU.apiPresetBindingsByChat),
    tableApiPreset: settings_ACU.tableApiPreset,
    plotApiPreset: settings_ACU.plotApiPreset,
    tableApiPresetOverridesByName: clone(settings_ACU.tableApiPresetOverridesByName),
    plotTaskApiPresetOverridesById: clone(settings_ACU.plotTaskApiPresetOverridesById),
    contentOptimizationApiPreset: settings_ACU.contentOptimizationSettings?.apiPreset,
  };
}

function restoreApiFields_ACU(snapshot: Record<string, unknown>): void {
  settings_ACU.apiMode = snapshot.apiMode;
  settings_ACU.apiConfig = clone(snapshot.apiConfig);
  settings_ACU.tavernProfile = snapshot.tavernProfile;
  settings_ACU.apiPresets = clone(snapshot.apiPresets);
  settings_ACU.defaultApiPresetName = snapshot.defaultApiPresetName;
  settings_ACU.apiPresetBindingsByChat = clone(snapshot.apiPresetBindingsByChat);
  settings_ACU.tableApiPreset = snapshot.tableApiPreset;
  settings_ACU.plotApiPreset = snapshot.plotApiPreset;
  settings_ACU.tableApiPresetOverridesByName = clone(snapshot.tableApiPresetOverridesByName);
  settings_ACU.plotTaskApiPresetOverridesById = clone(snapshot.plotTaskApiPresetOverridesById);
  if (settings_ACU.contentOptimizationSettings && typeof settings_ACU.contentOptimizationSettings === 'object') {
    settings_ACU.contentOptimizationSettings.apiPreset = snapshot.contentOptimizationApiPreset;
  }
}

function finalizeSave_ACU(snapshot: Record<string, unknown>): ApiPresetWriteResult_ACU {
  const saveResult = saveSettings_ACU();
  if (!saveResult.saved) {
    restoreApiFields_ACU(snapshot);
    return {
      ok: false,
      code: saveResult.code === 'settings_loading' ? 'settings_loading' : 'save_failed',
      changed: true,
      saveResult,
      message: saveResult.warning || saveResult.error || '保存失败，已回滚。',
    };
  }
  // [防呆] 任一预设写入/绑定变化成功落盘后递增全局修订号，
  // 各引用处的预设选择器据此标黄提醒用户重新确认（见 api-preset-staleness.ts）。
  bumpApiPresetRevision_ACU('preset_write');
  return { ok: true, code: 'ok', changed: true, saveResult };
}

/** 清除所有指向指定预设的引用（table/plot/optimization/vector/chat binding） */
export function clearApiPresetReferences_ACU(presetName: string): void {
  const target = String(presetName || '').trim();
  if (!target) return;
  if (settings_ACU.tableApiPreset === target) settings_ACU.tableApiPreset = '';
  if (settings_ACU.plotApiPreset === target) settings_ACU.plotApiPreset = '';
  if (settings_ACU.contentOptimizationSettings?.apiPreset === target) {
    settings_ACU.contentOptimizationSettings.apiPreset = '';
  }
  if (settings_ACU.tableApiPresetOverridesByName && typeof settings_ACU.tableApiPresetOverridesByName === 'object') {
    for (const key of Object.keys(settings_ACU.tableApiPresetOverridesByName)) {
      if (settings_ACU.tableApiPresetOverridesByName[key] === target) {
        delete settings_ACU.tableApiPresetOverridesByName[key];
      }
    }
  }
  if (settings_ACU.plotTaskApiPresetOverridesById && typeof settings_ACU.plotTaskApiPresetOverridesById === 'object') {
    for (const key of Object.keys(settings_ACU.plotTaskApiPresetOverridesById)) {
      if (settings_ACU.plotTaskApiPresetOverridesById[key] === target) {
        delete settings_ACU.plotTaskApiPresetOverridesById[key];
      }
    }
  }
  if (settings_ACU.apiPresetBindingsByChat && typeof settings_ACU.apiPresetBindingsByChat === 'object') {
    for (const [chatKey, binding] of Object.entries(settings_ACU.apiPresetBindingsByChat) as Array<[string, ApiPresetBinding_ACU]>) {
      if (binding?.presetName === target) delete settings_ACU.apiPresetBindingsByChat[chatKey];
    }
  }
}

/** 重命名预设时原子更新所有引用 */
export function renameApiPresetReferences_ACU(oldName: string, newName: string): void {
  const oldN = String(oldName || '').trim();
  const newN = String(newName || '').trim();
  if (!oldN || !newN || oldN === newN) return;
  const now = Date.now();
  if (settings_ACU.tableApiPreset === oldN) settings_ACU.tableApiPreset = newN;
  if (settings_ACU.plotApiPreset === oldN) settings_ACU.plotApiPreset = newN;
  if (settings_ACU.contentOptimizationSettings?.apiPreset === oldN) {
    settings_ACU.contentOptimizationSettings.apiPreset = newN;
  }
  if (settings_ACU.tableApiPresetOverridesByName && typeof settings_ACU.tableApiPresetOverridesByName === 'object') {
    for (const key of Object.keys(settings_ACU.tableApiPresetOverridesByName)) {
      if (settings_ACU.tableApiPresetOverridesByName[key] === oldN) {
        settings_ACU.tableApiPresetOverridesByName[key] = newN;
      }
    }
  }
  if (settings_ACU.plotTaskApiPresetOverridesById && typeof settings_ACU.plotTaskApiPresetOverridesById === 'object') {
    for (const key of Object.keys(settings_ACU.plotTaskApiPresetOverridesById)) {
      if (settings_ACU.plotTaskApiPresetOverridesById[key] === oldN) {
        settings_ACU.plotTaskApiPresetOverridesById[key] = newN;
      }
    }
  }
  if (settings_ACU.apiPresetBindingsByChat && typeof settings_ACU.apiPresetBindingsByChat === 'object') {
    for (const binding of Object.values(settings_ACU.apiPresetBindingsByChat) as ApiPresetBinding_ACU[]) {
      if (binding?.presetName === oldN) {
        binding.presetName = newN;
        binding.updatedAt = now;
      }
    }
  }
}

/** 设置当前聊天绑定并投影到运行配置 */
export function setActivePresetForCurrentChat_ACU(name: string): ApiPresetWriteResult_ACU {
  ensureApiSettingsShape_ACU();
  const preset = findPresetByName_ACU(settings_ACU.apiPresets, name);
  if (!preset) {
    return { ok: false, code: 'not_found', changed: false, message: `预设 "${name}" 不存在。` };
  }
  const snapshot = snapshotApiFields_ACU();
  const chatKey = getCurrentChatKey_ACU();
  settings_ACU.apiPresetBindingsByChat[chatKey] = { presetName: preset.name, updatedAt: Date.now() };
  settings_ACU.apiMode = preset.apiMode;
  settings_ACU.apiConfig = clone(preset.apiConfig);
  return finalizeSave_ACU(snapshot);
}

/** 保存/新建预设；oldName 存在时为重命名，原子更新所有引用 */
export function saveApiPreset_ACU(presetInput: ApiPreset_ACU, originalName = ''): ApiPresetWriteResult_ACU {
  const preset = normalizePreset_ACU(presetInput);
  if (!preset) {
    return { ok: false, code: 'invalid_input', changed: false, message: '预设数据无效。' };
  }
  ensureApiSettingsShape_ACU();
  const snapshot = snapshotApiFields_ACU();
  const oldName = String(originalName || '').trim();
  const existingByNewName = settings_ACU.apiPresets.findIndex((p: ApiPreset_ACU) => p.name === preset.name);
  if (existingByNewName >= 0 && settings_ACU.apiPresets[existingByNewName].name !== oldName) {
    // 重命名/新建撞上已有名称：拒绝覆盖，避免静默销毁已有预设（不可逆数据丢失）
    return {
      ok: false,
      code: 'invalid_input',
      changed: false,
      message: `预设名称「${preset.name}」已存在，请换一个名称。`,
    };
  } else {
    const existingByOldName = oldName ? settings_ACU.apiPresets.findIndex((p: ApiPreset_ACU) => p.name === oldName) : -1;
    if (existingByOldName >= 0) settings_ACU.apiPresets[existingByOldName] = preset;
    else settings_ACU.apiPresets.push(preset);
  }

  if (!settings_ACU.defaultApiPresetName) settings_ACU.defaultApiPresetName = preset.name;
  if (oldName && settings_ACU.defaultApiPresetName === oldName) settings_ACU.defaultApiPresetName = preset.name;
  if (oldName && oldName !== preset.name) renameApiPresetReferences_ACU(oldName, preset.name);

  // [兼容] 保存/重命名的预设是当前聊天活动预设、或当前无活动预设（保存第一个预设）时，
  // 自动绑定到当前聊天并投影其配置到运行 apiMode/apiConfig/tavernProfile。
  // 旧 V2 store 的 savePreset 在保存后会对 active preset 重新 setActivePresetForCurrentChat，
  // service 迁移需保持该语义（事务式：快照之后投影，失败由 finalizeSave 回滚）。
  const boundName = getBoundPresetNameForChat_ACU();
  const shouldAutoSelect = !oldName
    ? !boundName || boundName === preset.name
    : boundName === oldName || boundName === preset.name;
  if (shouldAutoSelect && findPresetByName_ACU(settings_ACU.apiPresets, preset.name)) {
    settings_ACU.apiPresetBindingsByChat[getCurrentChatKey_ACU()] = {
      presetName: preset.name,
      updatedAt: Date.now(),
    };
    settings_ACU.apiMode = preset.apiMode;
    settings_ACU.apiConfig = clone(preset.apiConfig);
  }

  const result = finalizeSave_ACU(snapshot);
  if (!result.ok) return result;
  return { ...result, value: preset };
}

/** 删除预设并清理全部引用 */
export function deleteApiPreset_ACU(name: string): ApiPresetWriteResult_ACU {
  ensureApiSettingsShape_ACU();
  const target = findPresetByName_ACU(settings_ACU.apiPresets, name);
  if (!target) {
    return { ok: false, code: 'not_found', changed: false, message: `预设 "${name}" 不存在。` };
  }
  const snapshot = snapshotApiFields_ACU();
  const chatKey = getCurrentChatKey_ACU();
  // [关键] 在删除前捕获当前聊天绑定：删除后 findPresetByName 对已删预设返回 null，
  // getBoundPresetNameForChat_ACU 会把悬挂引用归一为空串，导致无法识别“删除的是活动预设”。
  const boundBeforeDelete = getBoundPresetNameForChat_ACU();
  const wasActive = boundBeforeDelete === target.name;
  settings_ACU.apiPresets = settings_ACU.apiPresets.filter((p: ApiPreset_ACU) => p.name !== target.name);
  if (settings_ACU.defaultApiPresetName === target.name) {
    settings_ACU.defaultApiPresetName = settings_ACU.apiPresets[0]?.name ?? '';
  }
  clearApiPresetReferences_ACU(target.name);
  // [兼容] 删除的是当前聊天活动预设时，重新投影到默认/剩余预设，保持旧 V2 store 语义。
  if (wasActive) {
    const fallbackName = settings_ACU.defaultApiPresetName || settings_ACU.apiPresets[0]?.name || '';
    if (fallbackName) {
      settings_ACU.apiPresetBindingsByChat[chatKey] = {
        presetName: fallbackName,
        updatedAt: Date.now(),
      };
      const fallback = findPresetByName_ACU(settings_ACU.apiPresets, fallbackName);
      if (fallback) {
        settings_ACU.apiMode = fallback.apiMode;
        settings_ACU.apiConfig = clone(fallback.apiConfig);
      }
    }
  }
  const result = finalizeSave_ACU(snapshot);
  if (!result.ok) return result;
  return { ...result, value: target.name };
}

/** 设置默认预设 */
export function setDefaultApiPreset_ACU(name: string): ApiPresetWriteResult_ACU {
  ensureApiSettingsShape_ACU();
  const preset = findPresetByName_ACU(settings_ACU.apiPresets, name);
  if (!preset) {
    return { ok: false, code: 'not_found', changed: false, message: `预设 "${name}" 不存在。` };
  }
  const snapshot = snapshotApiFields_ACU();
  settings_ACU.defaultApiPresetName = preset.name;
  return finalizeSave_ACU(snapshot);
}

/** 将当前配置保存为新预设 */
export function saveCurrentConfigAsPreset_ACU(name: string): ApiPresetWriteResult_ACU {
  const preset: ApiPreset_ACU = {
    name: String(name || '').trim(),
    apiMode: normalizeApiMode_ACU(settings_ACU.apiMode),
    apiConfig: normalizeApiConfig_ACU(settings_ACU.apiConfig),
  };
  return saveApiPreset_ACU(preset);
}
