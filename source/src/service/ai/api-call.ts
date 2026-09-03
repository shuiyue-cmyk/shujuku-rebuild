// service/ai/api-call.ts — AI 调用编排（剧情推进用）
// 从 04_shared_helpers.js 迁入

import { parse as parseYaml_ACU } from 'yaml';
import { handleApiResponse_ACU, extractAiUsageMetadata_ACU, type AiUsageMetadata_ACU } from './prompt-builder';
export type { AiUsageMetadata_ACU };
import { settings_ACU } from '../runtime/state-manager';
import { getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';
import { assertSafeHttpEndpoint_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { resolveApiConfigByPreset_ACU, normalizePromptPostProcessing_ACU } from '../settings/api-preset-service';
import { acquirePresetRateLimitSlot_ACU } from './preset-rate-limiter';
import { isDebugLogEnabled } from '../../shared/log-buffer';

/**
 * OpenCode Go 会话头（x-opencode-session）：Go 官方要求所有请求携带该头做提示缓存优化，
 * 缺失的请求会被拒（2026-09-03 官方公告，09/06 起生效）。仅当目标端点是 Go 专属路径
 * （opencode.ai 主机 + /zen/go/ 路径前缀，见官方 Endpoints 表）时附加，其他端点
 * （含 Zen 余额直连等非 Go 路径、其他服务商）一律不受影响；用户已在附加请求头里
 * 显式写了该头则尊重用户值。
 * 会话 id 按端点 URL 稳定（进程内备忘，同端点同会话以利缓存命中），格式为 UUID。
 */
const OPENCODE_SESSION_IDS_ACU = new Map<string, string>();

export function isOpencodeGoEndpoint_ACU(url: unknown): boolean {
    try {
        const parsed = new URL(String(url || ''));
        const host = parsed.hostname.toLowerCase();
        if (host !== 'opencode.ai' && !host.endsWith('.opencode.ai')) return false;
        return /\/zen\/go(\/|$)/.test(parsed.pathname);
    } catch {
        return false;
    }
}

function newOpencodeSessionId_ACU(): string {
    try {
        const randomUUID = (globalThis as any)?.crypto?.randomUUID;
        if (typeof randomUUID === 'function') return randomUUID.call((globalThis as any).crypto);
    } catch { /* 回退 Math.random 拼装 */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

export function withOpencodeSessionHeader_ACU(headersText: string, url: unknown): string {
    const base = String(headersText || '');
    if (!isOpencodeGoEndpoint_ACU(url)) return base;
    if (/^x-opencode-session\s*:/mi.test(base)) return base;
    const key = String(url).trim().replace(/\/+$/, '').toLowerCase();
    let sessionId = OPENCODE_SESSION_IDS_ACU.get(key);
    if (!sessionId) {
        sessionId = newOpencodeSessionId_ACU();
        OPENCODE_SESSION_IDS_ACU.set(key, sessionId);
    }
    const line = `x-opencode-session: ${sessionId}`;
    return base ? `${base}\n${line}` : line;
}

type CustomIncludeBodyRootType_ACU = 'empty' | 'mapping' | 'sequence' | 'scalar' | 'invalid';

export interface CustomIncludeBodyDiagnostic_ACU {
  reason: 'none' | 'parse_error' | 'unsupported_root' | 'stream_options_replaced';
  rootType: CustomIncludeBodyRootType_ACU;
}

/**
 * 宿主 chat-completions 桥返回非 2xx 时的错误类型。
 * 保留 status 的目的不是美化日志，而是让上层重试归属方能区分「瞬时失败」与「必然失败的请求」：
 * 401/403/404 这类配置错误重试只是白烧配额，429/5xx 才值得再来一次。
 */
export class AgentApiHttpError_ACU extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AgentApiHttpError_ACU';
    this.status = status;
  }
}

/**
 * 只有瞬时的传输层失败值得重试；响应内容校验失败（JSON 不合法等）由调用方自己决定，不在这里放行。
 * AbortError 一律判 false：那是用户按了停止，重试等于把刚掐断的请求再发一遍。
 */
export function isRetryableAiRequestError_ACU(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; message?: unknown; status?: unknown };
  const name = String(candidate.name || '');
  const message = String(candidate.message || '');
  const status = Number(candidate.status);
  if (name === 'AbortError') return false;
  if (Number.isFinite(status)) return status === 429 || (status >= 500 && status <= 599);
  if (name === 'TimeoutError') return true;
  if (error instanceof TypeError) return true;
  return /(?:timeout|timed out|network(?:\s+error)?|connection reset|socket hang up)/i.test(message);
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function copyRecordWithoutPrototype_ACU(value: Record<string, unknown>): Record<string, unknown> {
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) copy[key] = value[key];
  return copy;
}

/**
 * 组合 SillyTavern 的 custom_include_body。JSON 是合法 YAML；输出 JSON 可避免把对象字段
 * 再拼成不合法的混合 YAML，同时与宿主 yaml.parse 后的浅合并语义保持一致。
 */
export function composeCustomIncludeBody_ACU(
  userBodyParams: string,
  pluginFields: Record<string, unknown>,
): { value: string; diagnostic: CustomIncludeBodyDiagnostic_ACU } {
  const pluginKeys = Object.keys(pluginFields);
  if (pluginKeys.length === 0) {
    return { value: userBodyParams, diagnostic: { reason: 'none', rootType: userBodyParams.trim() ? 'scalar' : 'empty' } };
  }

  const trimmed = userBodyParams.trim();
  if (!trimmed) {
    return {
      value: JSON.stringify(copyRecordWithoutPrototype_ACU(pluginFields)),
      diagnostic: { reason: 'none', rootType: 'empty' },
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml_ACU(userBodyParams);
  } catch {
    return { value: userBodyParams, diagnostic: { reason: 'parse_error', rootType: 'invalid' } };
  }

  const merged = Object.create(null) as Record<string, unknown>;
  let rootType: CustomIncludeBodyRootType_ACU;
  if (Array.isArray(parsed)) {
    rootType = 'sequence';
    for (const item of parsed) {
      if (!isRecord_ACU(item)) continue;
      for (const key of Object.keys(item)) merged[key] = item[key];
    }
  } else if (isRecord_ACU(parsed)) {
    rootType = 'mapping';
    for (const key of Object.keys(parsed)) merged[key] = parsed[key];
  } else {
    return { value: userBodyParams, diagnostic: { reason: 'unsupported_root', rootType: 'scalar' } };
  }

  let diagnostic: CustomIncludeBodyDiagnostic_ACU = { reason: 'none', rootType };
  for (const key of pluginKeys) {
    if (key === 'stream_options' && isRecord_ACU(pluginFields[key])) {
      const current = merged[key];
      if (current !== undefined && !isRecord_ACU(current)) {
        diagnostic = { reason: 'stream_options_replaced', rootType };
      }
      merged[key] = {
        ...(isRecord_ACU(current) ? copyRecordWithoutPrototype_ACU(current) : {}),
        ...copyRecordWithoutPrototype_ACU(pluginFields[key]),
      };
      continue;
    }
    merged[key] = pluginFields[key];
  }
  return { value: JSON.stringify(merged), diagnostic };
}

function normalizeExcludeBodyParamsForSillyTavern_ACU(raw: any): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('- ') || trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;
  const keys = trimmed.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean);
  return keys.map((key: string) => `- ${key}`).join('\n');
}

function sanitizeExcludeBodyForPresetFields_ACU(rawExclude: string, effectiveApiConfig: any): string {
  if (!rawExclude || typeof rawExclude !== 'string' || !rawExclude.trim()) return normalizeExcludeBodyParamsForSillyTavern_ACU(rawExclude);
  const rawKeys = rawExclude.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean);
  // 连带项修复（A2）：custom_exclude_body 是用户显式指令，优先于预设/全局的字段配置——
  // 不再自动剔除冲突排除键（旧行为把用户的 stream/reasoning_effort/temperature 等排除静默删掉，
  // 用户无从在 UI 恢复）。冲突仅告警提示，不改写用户的排除清单。
  const conflicts = rawKeys.filter((key: string) => {
    const lower = key.toLowerCase();
    if (lower === 'reasoning_effort' && (effectiveApiConfig?.reasoningEffort || settings_ACU?.reasoningEffort)) return true;
    if ((lower === 'temperature' || lower === 'temp') && effectiveApiConfig?.temperature !== undefined) return true;
    if (lower === 'max_tokens' && (effectiveApiConfig?.max_tokens !== undefined || effectiveApiConfig?.maxTokens !== undefined)) return true;
    if (lower === 'top_p' && (effectiveApiConfig?.top_p !== undefined || effectiveApiConfig?.topP !== undefined)) return true;
    if (lower === 'stream' && effectiveApiConfig?.streamingEnabled !== undefined) return true;
    return false;
  });
  if (conflicts.length) {
    logWarn_ACU(`[API] custom_exclude_body 与显式配置冲突，按排除优先（对应字段不会出现在请求体中）: ${conflicts.join(', ')}。如需该字段生效，请从排除参数里移除它。`);
  }
  return normalizeExcludeBodyParamsForSillyTavern_ACU(rawKeys.join(', '));
}

/**
 * 构建 Chat Completions 自定义 API 请求体（支持 bodyParams / excludeBodyParams / requestHeaders）
 */
export function buildCustomApiRequestBody_ACU(
  messages: any[],
  effectiveApiConfig: any,
  overrides?: { maxTokens?: number; temperature?: number; topP?: number; stripModelPrefix?: boolean; nonPrefillSupport?: boolean; promptCacheKey?: string; includeStreamUsage?: boolean; responseFormat?: Record<string, any> }
): Record<string, any> {
  const opts = overrides || {};
  if (effectiveApiConfig?.url) {
    assertSafeHttpEndpoint_ACU(String(effectiveApiConfig.url));
  }
  const model = opts.stripModelPrefix !== false
    ? (effectiveApiConfig.model || '').replace(/^models\//, '')
    : (effectiveApiConfig.model || '');
  const maxTokens = opts.maxTokens ?? effectiveApiConfig.max_tokens ?? effectiveApiConfig.maxTokens ?? 20000;
  const temperature = opts.temperature ?? effectiveApiConfig.temperature ?? 1.0;
  const topP = opts.topP ?? effectiveApiConfig.top_p ?? effectiveApiConfig.topP ?? 0.95;

  // 基础 Authorization 头（apiKey 剥离换行，防请求头注入）
  const apiKey = String(effectiveApiConfig.apiKey || '').replace(/[\r\n]+/g, '');
  let headers = apiKey ? `Authorization: Bearer ${apiKey}` : '';
  // 追加 requestHeaders（逐行清洗换行）
  if (effectiveApiConfig.requestHeaders) {
    const extra = String(effectiveApiConfig.requestHeaders).trim().replace(/[\r\n]+/g, '\n');
    if (extra) {
      headers = headers ? `${headers}\n${extra}` : extra;
    }
  }
  // OpenCode Go 端点自动补 x-opencode-session 会话头（缺失会被 Go 拒单，见本文件头注释）
  headers = withOpencodeSessionHeader_ACU(headers, effectiveApiConfig.url);

  // 非预填充支持：开启后把 messages 中的 assistant 消息改写为 user，
  // 内容首行加「助手：」前缀（换行接原内容），用于不支持 assistant 预填充的接口。
  // 优先取调用点传入的预设级值；未传入时读全局设置。
  const applyNonPrefill = opts.nonPrefillSupport !== undefined
    ? opts.nonPrefillSupport === true
    : settings_ACU.nonPrefillSupport === true;

  // 插件字段与用户 bodyParams 先按 SillyTavern 的 YAML 解析规则结构化组合，再作为
  // custom_include_body 交给宿主合并。无法安全解析时保留用户原文并跳过插件字段。
  const requestWantsStream = effectiveApiConfig.streamingEnabled !== undefined
    ? effectiveApiConfig.streamingEnabled === true
    : settings_ACU.streamingEnabled === true;
  const userBodyParams = String(effectiveApiConfig.bodyParams || '');
  const pluginFields = Object.create(null) as Record<string, unknown>;
  // 注入上游请求体的 prompt_cache_key（OpenAI 兼容缓存路由）。仅允许 [A-Za-z0-9_-]，防止破坏注入通道。
  if (opts.promptCacheKey && /^[A-Za-z0-9_-]+$/.test(opts.promptCacheKey)) {
    pluginFields.prompt_cache_key = opts.promptCacheKey;
  }
  // 流式请求时注入 stream_options.include_usage，让流末尾下发 usage 统计 chunk。非流式请求忽略。
  if (opts.includeStreamUsage && requestWantsStream) {
    pluginFields.stream_options = { include_usage: true };
  }
  // 注入上游请求体的 response_format（如严格 JSON 填表的 json_schema）。
  // JSON 是 YAML 的子集，结构化组合后走 custom_include_body 合并进上游请求体；
  // 后端不支持时用户可通过 excludeBodyParams 填 response_format 剔除。
  if (opts.responseFormat && typeof opts.responseFormat === 'object') {
    pluginFields.response_format = opts.responseFormat;
  }
  const composedIncludeBody = composeCustomIncludeBody_ACU(userBodyParams, pluginFields);
  if (composedIncludeBody.diagnostic.reason === 'parse_error' || composedIncludeBody.diagnostic.reason === 'unsupported_root') {
    logWarn_ACU('[buildCustomApiRequestBody] 跳过插件请求体字段', composedIncludeBody.diagnostic);
  } else if (composedIncludeBody.diagnostic.reason === 'stream_options_replaced') {
    logWarn_ACU('[buildCustomApiRequestBody] 用户 stream_options 不是对象，已由插件对象替换', composedIncludeBody.diagnostic);
  }

  // 提示词后处理（预设级可配）：缺省 strict 与历史写死行为一致；显式「未选择」（''）
  // 时请求体省略该键，后端原样透传消息，保留提示词组中部 system 段的角色。
  const promptPostProcessing_ACU = normalizePromptPostProcessing_ACU(effectiveApiConfig.promptPostProcessing);

  const body: Record<string, any> = {
    // 统一将 messages 的 role 归一为小写（system / user / assistant）。
    //
    // 背景：改表助手等伪 role 提示词组（buildPseudoRoleTemplateAssistantPromptSegments_ACU）
    // 产出的 role 为大写 SYSTEM / USER，而自定义 chat-completions 后端（本函数构建的 body）
    // 只接受小写 role。此前 messages 被原样透传，导致后端报
    // `unknown variant SYSTEM`，改表助手 AI 调用失败。
    //
    // 本项目既有约定（merge-logic.ts / content-optimization.ts）
    // 均在发送前对 role 做 toLowerCase；此处是自定义 chat-completions 的统一出口，
    // 对已是小写的输入（merge / plot / 存量路径）为无操作，不破坏既有行为。
    // tavern / 主 API（generateRaw）路径不经过本函数，不受影响。
    //
    // 边界契约：仅当 role 是字符串时才归一为小写；缺失 role、非字符串 role、
    // 数组/原始值等异常消息一律原样保留，交由后端校验，绝不把缺失 role 静默
    // 改造成 "undefined" / "null"。
    messages: Array.isArray(messages)
        ? messages.map((m) => {
              if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.role !== 'string') return m;
              let role = m.role.toLowerCase();
              let content = m.content;
              if (applyNonPrefill && role === 'assistant') {
                role = 'user';
                content = `助手：\n${typeof content === 'string' ? content : String(content ?? '')}`;
              }
              return { ...m, role, ...(content !== undefined ? { content } : {}) };
          })
        : messages,
    model,
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
    // 流式输出（预设级优先）：effectiveApiConfig.streamingEnabled 未定义时回退全局 settings_ACU.streamingEnabled
    stream: effectiveApiConfig.streamingEnabled !== undefined
      ? effectiveApiConfig.streamingEnabled === true
      : settings_ACU.streamingEnabled === true,
    chat_completion_source: 'custom',
    // 接口协议（预设级）：对齐 TT 四「自定义」选项（custom_api_format 契约）。
    // TT 后端按该值分流上游端点与请求/响应变形：openai_compat→/chat/completions、
    // openai_responses→/responses、claude_messages→/messages、gemini_interactions→/interactions；
    // 非流式响应由 TT 归一化为 OpenAI 形态，流式 Claude 为原样 Anthropic SSE（解析见 prompt-api-call）。
    // 白名单兜底：调用点可能传未归一化的 config，非法值回退 openai_compat。
    custom_api_format: (['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions'] as const).includes(effectiveApiConfig.customApiFormat as any)
      ? effectiveApiConfig.customApiFormat
      : 'openai_compat',
    group_names: [],
    include_reasoning: false,
    // 思考强度（预设级优先）：low/medium/high/xhigh/max 原样透传；'false' 传布尔 false 关闭思考；
    // 'auto' 则省略该参数由服务端自定；非法值回退 medium
    ...(((): Record<string, unknown> => {
      const raw = String(effectiveApiConfig.reasoningEffort || settings_ACU.reasoningEffort || 'medium').trim().toLowerCase();
      if (raw === 'auto') return {};
      if (raw === 'false') return { reasoning_effort: false };
      return { reasoning_effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(raw) ? raw : 'medium' };
    })()),
    enable_web_search: false,
    request_images: false,
    // 提示词后处理：'strict' 等合法值透传；显式 '' 时省略该键（后端按 none 原样透传）。
    ...(promptPostProcessing_ACU ? { custom_prompt_post_processing: promptPostProcessing_ACU } : {}),
    reverse_proxy: effectiveApiConfig.url,
    proxy_password: '',
    custom_url: effectiveApiConfig.url,
    custom_include_headers: headers,
    custom_include_body: composedIncludeBody.value,
    custom_exclude_body: sanitizeExcludeBodyForPresetFields_ACU(effectiveApiConfig.excludeBodyParams, effectiveApiConfig),
  };

  logDebug_ACU(`[API] 构建请求体: model=${model}, reasoning_effort=${'reasoning_effort' in body ? String(body.reasoning_effort) : '(auto 省略)'}, stream=${body.stream}, temperature=${body.temperature}, max_tokens=${body.max_tokens}, exclude=${body.custom_exclude_body ? '有' : '无'}`);
  if (isDebugLogEnabled()) {
    try {
      const toStore: any = JSON.parse(JSON.stringify(body));
      if (toStore.custom_include_headers) {
        toStore.custom_include_headers = String(toStore.custom_include_headers).replace(/(Authorization\s*:\s*Bearer\s+)([^\s"',}\n]+)/gi, '$1***');
      }
      if (toStore.proxy_password) toStore.proxy_password = '***';
      (globalThis as any).__ACU_DEBUG_LAST_API_BODY__ = toStore;
      (globalThis as any).__ACU_DEBUG_LAST_API_BODY_AT__ = Date.now();
    } catch {}
  } else {
    try { delete (globalThis as any).__ACU_DEBUG_LAST_API_BODY__; } catch {}
    try { delete (globalThis as any).__ACU_DEBUG_LAST_API_BODY_AT__; } catch {}
  }

  return body;
}

/**
 * 自定义 API 统一出口：调用宿主 /api/backends/chat-completions/generate。
 * stream 参数由 streamingEnabled 开关决定（见 buildCustomApiRequestBody_ACU）；
 * 响应解析按请求实际携带的 stream 值分流（预设级开关可能与全局不同）。
 * 返回 AI 响应文本（原始，未 trim），失败抛错。
 */
export async function postChatCompletion_ACU(body: unknown, signal?: AbortSignal | null): Promise<string | null> {
    let res: Response;
    try {
        res = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: signal || undefined,
        });
    } catch (e: any) {
        // 网络层失败（Failed to fetch / NetworkError）：调用方（剧情推进任务循环等）会决定是否重试，
        // 这里显式记录便于从日志区分「网络失败」与「后端返回错误状态」。
        logWarn_ACU(`[postChatCompletion] 网络请求失败: ${String(e?.message || e?.name || 'unknown')}`, { aborted: e?.name === 'AbortError' || String(e?.message || '').toLowerCase().includes('aborted') });
        throw e;
    }
    if (!res.ok) {
        const errTxt = await res.text();
        throw new AgentApiHttpError_ACU(res.status, `API请求失败: ${res.status} ${errTxt}`);
    }
    const requestWantsStream = (body as any)?.stream === true;
    return handleApiResponse_ACU(res, requestWantsStream);
}

/**
 * 剧情推进任务级 API 调用 — 接受显式预设名称
 * 调用优先级：presetName 参数 > 全局 plotApiPreset > 当前 API 配置
 */
export async function callApiWithPlotPreset_ACU(messages: any[], presetName: string, abortSignal: AbortSignal | null = null) {
    const effectivePresetName = presetName || settings_ACU.plotApiPreset || '';
    const apiPresetConfig = getApiConfigByPreset_ACU(effectivePresetName);
    const effectiveApiMode = apiPresetConfig.apiMode ?? settings_ACU.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig || settings_ACU.apiConfig || {};


    logDebug_ACU(`[剧情推进] 任务级API调用，预设: ${effectivePresetName || '当前配置'}, 模式: ${effectiveApiMode}`);

    // 酒馆主 API（tavern / useMainApi）已剥离，恒走自定义 API
    if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
    }

    const requestBody = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { nonPrefillSupport: apiPresetConfig.nonPrefillSupport });

    // 公益站兼容（预设级）：该预设限速每分钟最多 3 次请求（各预设独立计数）
    if (apiPresetConfig.publicServiceMode) {
        await acquirePresetRateLimitSlot_ACU(effectivePresetName || '_current_config', { signal: abortSignal });
    }

    const content = await postChatCompletion_ACU(requestBody, abortSignal);
    if (content) {
        return content.trim();
    }

    throw new Error(`API调用返回无效响应`);
}

export function getApiConfigByPreset_ACU(presetName: string) {
    // 委托 service 单一权威解析：空名返回当前配置；悬挂引用返回 resolved=false 并告警。
    const resolved = resolveApiConfigByPreset_ACU(presetName);
    return {
      apiMode: resolved.apiMode,
      apiConfig: resolved.apiConfig,
      tavernProfile: resolved.tavernProfile,
      nonPrefillSupport: resolved.nonPrefillSupport,
      publicServiceMode: resolved.publicServiceMode,
    };
}

/**
 * 通用 AI 调用（支持指定 API 预设名称）
 * 供 service 层内部使用，替代通过 topLevelWindow_ACU.AutoCardUpdaterAPI.callAI 的循环调用。
 * @param messages 消息数组 [{ role, content }]
 * @param presetName API 预设名称（空字符串表示使用当前配置）
 * @param maxTokensOverride 可选的最大 token 数覆盖，仅允许公开层传入经校验的安全值
 * @returns AI 响应文本，失败返回 null
 */
export async function callAIWithPreset_ACU(messages: any[], presetName: string = '', maxTokensOverride?: number, signal?: AbortSignal | null): Promise<string | null> {
    if (!Array.isArray(messages) || messages.length === 0) {
        logWarn_ACU('[callAIWithPreset] messages 必须是非空数组');
        return null;
    }

    const apiPresetConfig = getApiConfigByPreset_ACU(presetName);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig || {} as any;
    const maxTokens = maxTokensOverride ?? effectiveApiConfig.max_tokens ?? effectiveApiConfig.maxTokens ?? 4096;


    logDebug_ACU(`[callAIWithPreset] 调用 AI，消息数=${messages.length}，预设=${presetName || '当前配置'}，模式=${effectiveApiMode}`);

    // 酒馆主 API（tavern / useMainApi）已剥离，恒走自定义 API
    if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
    }

    const body = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { maxTokens, stripModelPrefix: false, nonPrefillSupport: apiPresetConfig.nonPrefillSupport });

    // 公益站兼容（预设级）：该预设限速每分钟最多 3 次请求（各预设独立计数）
    if (apiPresetConfig.publicServiceMode) {
        await acquirePresetRateLimitSlot_ACU(presetName || '_current_config', { signal });
    }

    const content = await postChatCompletion_ACU(body, signal);
    return content ? content.trim() : null;
}

/**
 * 已解析预设的调用生命周期回调。
 */
export interface ResolvedPresetCallLifecycle_ACU {
    beforeMainApiCall?: () => void;
    afterMainApiCall?: () => void;
    /** 响应带回 token 用量时回调（custom 路径解析响应体）。 */
    onUsage?: (usage: AiUsageMetadata_ACU) => void;
}

/** callAIWithResolvedPreset_ACU 的请求体附加项。仅 custom（chat-completions）路径生效。 */
export interface ResolvedPresetCallExtras_ACU {
    /** OpenAI 兼容缓存路由 key。稳定的 key 让同一会话的请求落到同一缓存命名空间。 */
    promptCacheKey?: string;
    /**
     * 本次调用的最大输出 token 下限：预设里的 max_tokens 小于它时抬到该值，大于时沿用预设。
     * 只作用于请求体的 max_tokens 参数，不做产出长度检查。用于总纲、大纲这类输出体量随任务增长的调用。
     */
    minOutputTokens?: number;
}

/**
 * 若 signal 已 abort 则抛出 AbortError，用于宿主 gateway 调用（无法强制中断）返回后立即检查。
 */
function assertNotAborted_ACU(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    const err = new Error('请求已取消');
    (err as any).name = 'AbortError';
    throw err;
  }
}

/**
 * 内部 AI（续写规划 / 主 Agent / 子代理）单次请求的传输超时兜底。
 * 背景：本入口跑在续写租约内，transport hang（后端代理挂起、半开连接）时 fetch 永不返回
 * → 租约被无限占用 → 一切续写操作以 CONTINUATION_OPERATION_BUSY 死锁，只能手动 stop。
 * 取值宽松（120s）：续写正文是全链路最长的一次生成，短超时会误杀正常的慢响应；
 * 它只兜「永远等不到结果」的挂死，不兜「慢但有结果」。对照 vector-rerank-gateway 的 30s 兜底。
 */
const INTERNAL_AI_FETCH_TIMEOUT_MS_ACU = 120_000;

/**
 * 把外部取消信号并入超时控制器：外部 abort 或超时到期都会中断 fetch。
 * 手写转发而非 AbortSignal.any：目标库为 ES2020（类型面里没有 AbortSignal.any），
 * 且旧内核缺少该静态方法时不能把续写链路搭进去。
 * @returns 解绑函数（请求结束后必须调用）：续写链路按聊天复用一个 signal，
 *          不解绑会让监听器随轮数线性堆积。
 */
function attachTimeoutAndExternalAbort_ACU(controller: AbortController, external?: AbortSignal | null): () => void {
  if (!external) return () => {};
  if (external.aborted) {
    controller.abort();
    return () => {};
  }
  // 测试与降级宿主可能传入伪 signal（无事件监听面）：缺 addEventListener 时只保留超时兜底。
  if (typeof (external as any).addEventListener !== 'function') return () => {};
  const onExternalAbort = () => controller.abort();
  (external as any).addEventListener('abort', onExternalAbort, { once: true });
  return () => {
    try { (external as any).removeEventListener?.('abort', onExternalAbort); } catch { /* 解绑失败不影响结果 */ }
  };
}

/**
 * 使用调用方已解析的预设配置发起一次内部 AI 请求（智能续写专用入口）。
 * 必须不再次查预设：固定预设的 fail-closed 决策不能与后续回退竞争。
 * 本库已剥离酒馆主 API（tavern / useMainApi 通路），恒走自定义 chat-completions 路径。
 */
export async function callAIWithResolvedPreset_ACU(
    messages: any[],
    resolved: { apiMode: string; apiConfig: any; tavernProfile: string; presetName?: string; nonPrefillSupport?: boolean; publicServiceMode?: boolean },
    signal?: AbortSignal | null,
    lifecycle?: ResolvedPresetCallLifecycle_ACU,
    extras?: ResolvedPresetCallExtras_ACU,
): Promise<string | null> {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('内部 AI 消息必须是非空数组。');
    }
    const reportUsage = (raw: unknown): void => {
        if (!lifecycle?.onUsage) return;
        const usage = extractAiUsageMetadata_ACU(raw);
        if (!usage) return;
        try { lifecycle.onUsage(usage); } catch { /* 用量回调异常不允许影响调用主流程。 */ }
    };
    const apiConfig = resolved.apiConfig || {};
    const presetMaxTokens = apiConfig.max_tokens ?? apiConfig.maxTokens ?? 4096;
    const outputTokenFloor = Number.isFinite(extras?.minOutputTokens) ? Math.max(0, Math.trunc(extras!.minOutputTokens!)) : 0;
    const maxTokens = Math.max(presetMaxTokens, outputTokenFloor);
    // 酒馆主 API（tavern / useMainApi）已剥离，恒走自定义 chat-completions 路径
    if (!apiConfig.url || !apiConfig.model) {
        throw new Error('自定义 API 的 URL 或模型未配置。');
    }
    const body = buildCustomApiRequestBody_ACU(messages, apiConfig, {
        maxTokens,
        stripModelPrefix: false,
        // 预设级非预填充透传（与 callAIWithPreset_ACU 对齐）；缺省时 build 内回退全局设置。
        nonPrefillSupport: resolved.nonPrefillSupport,
        promptCacheKey: extras?.promptCacheKey,
        // usage 回调在场时才请求流式 usage chunk：不改变没有订阅方时的请求体。
        includeStreamUsage: !!lifecycle?.onUsage,
    });
    // 公益站兼容（预设级）：该预设限速每分钟最多 3 次请求（各预设独立计数）
    if (resolved.publicServiceMode) {
        await acquirePresetRateLimitSlot_ACU(resolved.presetName || '_current_config', { signal });
    }
    // 超时可中断：本调用在续写租约内，挂起的 transport 不允许无限占用租约（见常量注释）。
    // 计时器覆盖到响应体读完为止——流式路径的悬挂发生在 body 读取阶段，只包 fetch 兜不住。
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => timeoutController.abort(), INTERNAL_AI_FETCH_TIMEOUT_MS_ACU);
    const detachExternalAbort = attachTimeoutAndExternalAbort_ACU(timeoutController, signal);
    try {
      let response: Response;
      try {
        response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: timeoutController.signal,
        });
      } catch (error: any) {
        if (signal?.aborted) {
            const cancelled = new Error('请求已取消');
            (cancelled as any).name = 'AbortError';
            throw cancelled;
        }
        if (error?.name === 'AbortError') {
            throw new Error(`内部 AI 请求超时（${INTERNAL_AI_FETCH_TIMEOUT_MS_ACU / 1000}s 无响应），已中断。`);
        }
        throw error;
      }
      try {
        if (!response.ok) {
            const errTxt = await response.text();
            throw new Error(`API 请求失败: ${response.status} ${errTxt}`);
        }
        assertNotAborted_ACU(signal);
        const requestWantsStream = (body as any)?.stream === true;
        const content = await handleApiResponse_ACU(response, requestWantsStream, lifecycle?.onUsage);
        return typeof content === 'string' && content.trim() ? content.trim() : null;
      } catch (error: any) {
        // 响应体读取阶段被超时计时器掐断：报超时而不是底层网络错文；外部取消仍按取消上报。
        if (error?.name === 'AbortError' && !signal?.aborted && timeoutController.signal.aborted) {
            throw new Error(`内部 AI 请求超时（${INTERNAL_AI_FETCH_TIMEOUT_MS_ACU / 1000}s），已中断。`);
        }
        throw error;
      }
    } finally {
      // fetch 抛错路径同样要清理：计时器与外部监听器残留会随轮数堆积（此前 fetch 段无 finally）。
      clearTimeout(timeoutTimer);
      detachExternalAbort();
    }
}

