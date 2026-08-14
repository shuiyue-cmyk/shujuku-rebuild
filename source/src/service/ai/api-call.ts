// service/ai/api-call.ts — AI 调用编排（剧情推进用）
// 从 04_shared_helpers.js 迁入

import { handleApiResponse_ACU } from './prompt-builder';
import { settings_ACU } from '../runtime/state-manager';
import { getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { resolveApiConfigByPreset_ACU } from '../settings/api-preset-service';

function normalizeExcludeBodyParamsForSillyTavern_ACU(raw: any): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('- ') || trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;
  const keys = trimmed.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean);
  return keys.map((key: string) => `- ${key}`).join('\n');
}

/**
 * 构建 Chat Completions 自定义 API 请求体（支持 bodyParams / excludeBodyParams / requestHeaders）
 */
export function buildCustomApiRequestBody_ACU(
  messages: any[],
  effectiveApiConfig: any,
  overrides?: { maxTokens?: number; temperature?: number; topP?: number; stripModelPrefix?: boolean }
): Record<string, any> {
  const opts = overrides || {};
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
        ? messages.map((m) =>
              m && typeof m === 'object' && !Array.isArray(m) && typeof m.role === 'string'
                  ? { ...m, role: m.role.toLowerCase() }
                  : m,
          )
        : messages,
    model,
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
    stream: settings_ACU.streamingEnabled === true,
    chat_completion_source: 'custom',
    group_names: [],
    include_reasoning: false,
    reasoning_effort: 'medium',
    enable_web_search: false,
    request_images: false,
    custom_prompt_post_processing: 'strict',
    reverse_proxy: effectiveApiConfig.url,
    proxy_password: '',
    custom_url: effectiveApiConfig.url,
    custom_include_headers: headers,
    custom_include_body: effectiveApiConfig.bodyParams || '',
    custom_exclude_body: normalizeExcludeBodyParamsForSillyTavern_ACU(effectiveApiConfig.excludeBodyParams),
  };

  return body;
}

/**
 * 自定义 API 统一出口：调用宿主 /api/backends/chat-completions/generate。
 * stream 参数由 streamingEnabled 开关决定（见 buildCustomApiRequestBody_ACU）；
 * 返回 AI 响应文本（原始，未 trim），失败抛错。
 */
export async function postChatCompletion_ACU(body: unknown, signal?: AbortSignal | null): Promise<string | null> {
    const res = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal || undefined,
    });
    if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`API请求失败: ${res.status} ${errTxt}`);
    }
    return handleApiResponse_ACU(res);
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

    const requestBody = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig);

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

    const body = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { maxTokens, stripModelPrefix: false });

    const content = await postChatCompletion_ACU(body, signal);
    return content ? content.trim() : null;
}

