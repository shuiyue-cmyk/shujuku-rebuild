// service/ai/api-call.ts — AI 调用编排（剧情推进用）
// 从 04_shared_helpers.js 迁入

import { handleApiResponse_ACU, extractAiUsageMetadata_ACU, type AiUsageMetadata_ACU } from './prompt-builder';
export type { AiUsageMetadata_ACU };
import { settings_ACU } from '../runtime/state-manager';
import { getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';
import { assertSafeHttpEndpoint_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { resolveApiConfigByPreset_ACU } from '../settings/api-preset-service';
import { acquirePresetRateLimitSlot_ACU } from './preset-rate-limiter';
import { isDebugLogEnabled } from '../../shared/log-buffer';

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
  const normalizedLower = rawKeys.map(k => k.toLowerCase());
  const shouldKeep = (key: string): boolean => {
    const lower = key.toLowerCase();
    if (lower === 'reasoning_effort' && effectiveApiConfig?.reasoningEffort) return false;
    if (lower === 'reasoning_effort' && settings_ACU?.reasoningEffort) return false;
    if ((lower === 'temperature' || lower === 'temp') && effectiveApiConfig?.temperature !== undefined) return false;
    // [L6] 原先的 `lower === 'max_tokens '` / `'top_p '` 尾空格分支不可达：
    // rawKeys 已逐项 trim，删除死分支。
    if (lower === 'max_tokens' && (effectiveApiConfig?.max_tokens !== undefined || effectiveApiConfig?.maxTokens !== undefined)) return false;
    if (lower === 'top_p' && (effectiveApiConfig?.top_p !== undefined || effectiveApiConfig?.topP !== undefined)) return false;
    if (lower === 'stream' && effectiveApiConfig?.streamingEnabled !== undefined) return false;
    return true;
  };
  const filtered = rawKeys.filter(shouldKeep);
  if (filtered.length !== rawKeys.length) {
    const removed = rawKeys.filter(k => !shouldKeep(k));
    logWarn_ACU(`[API] 已自动移除 custom_exclude_body 中与预设显式配置冲突的字段: ${removed.join(', ')}，以保证预设配置生效。`);
  }
  return normalizeExcludeBodyParamsForSillyTavern_ACU(filtered.join(', '));
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

  // 非预填充支持：开启后把 messages 中的 assistant 消息改写为 user，
  // 内容首行加「助手：」前缀（换行接原内容），用于不支持 assistant 预填充的接口。
  // 优先取调用点传入的预设级值；未传入时读全局设置。
  const applyNonPrefill = opts.nonPrefillSupport !== undefined
    ? opts.nonPrefillSupport === true
    : settings_ACU.nonPrefillSupport === true;

  // 追加缓存/用量/严格JSON相关字段走 custom_include_body（宿主会把这段 YAML 合并进上游请求体）。
  // 用户自配的 bodyParams 可能是 JSON 流式写法（{ 或 [ 开头），逐行追加键会产生非法 YAML，
  // 此时跳过注入，绝不破坏用户既有配置。
  const requestWantsStream = effectiveApiConfig.streamingEnabled !== undefined
    ? effectiveApiConfig.streamingEnabled === true
    : settings_ACU.streamingEnabled === true;
  const userBodyParams = String(effectiveApiConfig.bodyParams || '');
  const extraIncludeLines: string[] = [];
  // 注入上游请求体的 prompt_cache_key（OpenAI 兼容缓存路由）。仅允许 [A-Za-z0-9_-]，防止破坏 YAML 注入通道。
  if (opts.promptCacheKey && /^[A-Za-z0-9_-]+$/.test(opts.promptCacheKey)) {
    extraIncludeLines.push(`prompt_cache_key: ${opts.promptCacheKey}`);
  }
  // 流式请求时注入 stream_options.include_usage，让流末尾下发 usage 统计 chunk。非流式请求忽略。
  if (opts.includeStreamUsage && requestWantsStream) {
    extraIncludeLines.push('stream_options: {"include_usage": true}');
  }
  // 注入上游请求体的 response_format（如严格 JSON 填表的 json_schema）。
  // JSON 是 YAML 的子集，序列化为单行后走 custom_include_body 合并进上游请求体；
  // 后端不支持时用户可通过 excludeBodyParams 填 response_format 剔除。
  if (opts.responseFormat && typeof opts.responseFormat === 'object') {
    extraIncludeLines.push(`response_format: ${JSON.stringify(opts.responseFormat)}`);
  }
  const userBodyIsFlowStyle = /^[{[]/.test(userBodyParams.trim());
  if (extraIncludeLines.length && userBodyIsFlowStyle) {
    logDebug_ACU('[buildCustomApiRequestBody] bodyParams 为 JSON 流式写法，跳过 prompt_cache_key/stream_options 注入');
  }
  const includeBody = extraIncludeLines.length && !userBodyIsFlowStyle
    ? [userBodyParams.trim(), ...extraIncludeLines].filter(Boolean).join('\n')
    : userBodyParams;

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
    // 思考强度（预设级优先）：仅允许 low/medium/high/max/xhigh，非法值回退 medium
    reasoning_effort: ((): string => {
      const raw = String(effectiveApiConfig.reasoningEffort || settings_ACU.reasoningEffort || 'medium').trim().toLowerCase();
      return ['low', 'medium', 'high', 'max', 'xhigh'].includes(raw) ? raw : 'medium';
    })(),
    enable_web_search: false,
    request_images: false,
    custom_prompt_post_processing: 'strict',
    reverse_proxy: effectiveApiConfig.url,
    proxy_password: '',
    custom_url: effectiveApiConfig.url,
    custom_include_headers: headers,
    custom_include_body: includeBody,
    custom_exclude_body: sanitizeExcludeBodyForPresetFields_ACU(effectiveApiConfig.excludeBodyParams, effectiveApiConfig),
  };

  logDebug_ACU(`[API] 构建请求体: model=${model}, reasoning_effort=${body.reasoning_effort}, stream=${body.stream}, temperature=${body.temperature}, max_tokens=${body.max_tokens}, exclude=${body.custom_exclude_body ? '有' : '无'}`);
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
        throw new Error(`API请求失败: ${res.status} ${errTxt}`);
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
    const maxTokens = apiConfig.max_tokens ?? apiConfig.maxTokens ?? 4096;
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

