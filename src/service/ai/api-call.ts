// service/ai/api-call.ts — AI 调用编排（剧情推进用）
// 从 04_shared_helpers.js 迁入

import { handleApiResponse_ACU } from './prompt-builder';
import { settings_ACU } from '../runtime/state-manager';
import { isGenerateRawAvailable_ACU, generateRaw_ACU, sendConnectionManagerRequest_ACU, getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';
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

  // 基础 Authorization 头
  let headers = effectiveApiConfig.apiKey ? `Authorization: Bearer ${effectiveApiConfig.apiKey}` : '';
  // 追加 requestHeaders
  if (effectiveApiConfig.requestHeaders) {
    const extra = effectiveApiConfig.requestHeaders.trim();
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
    // 本项目既有约定（merge-logic.ts:198 / merge-executor.ts:126 / content-optimization.ts:183）
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
    stream: settings_ACU.streamingEnabled || false,
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
 * 剧情推进任务级 API 调用 — 接受显式预设名称
 * 调用优先级：presetName 参数 > 全局 plotApiPreset > 当前 API 配置
 */
export async function callApiWithPlotPreset_ACU(messages: any[], presetName: string, abortSignal: AbortSignal | null = null) {
    const effectivePresetName = presetName || settings_ACU.plotApiPreset || '';
    const apiPresetConfig = getApiConfigByPreset_ACU(effectivePresetName);
    const effectiveApiMode = apiPresetConfig.apiMode ?? settings_ACU.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig || settings_ACU.apiConfig || {};


    logDebug_ACU(`[剧情推进] 任务级API调用，预设: ${effectivePresetName || '当前配置'}, 模式: ${effectiveApiMode}`);


    if (effectiveApiMode === 'tavern' || effectiveApiConfig.useMainApi) {
      logDebug_ACU('[剧情推进] 通过酒馆主API发送请求（流式传输）...');
      if (!isGenerateRawAvailable_ACU()) {
        throw new Error('TavernHelper.generateRaw 函数不存在。请检查酒馆版本。');
      }
      const response = await generateRaw_ACU({
        ordered_prompts: messages,
        should_stream: settings_ACU.streamingEnabled || false,
      });
      if (typeof response !== 'string') {
        throw new Error('主API调用未返回预期的文本响应。');
      }
      return response.trim();
    } else {
      if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
      }

      const requestBody = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig);


      const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`API请求失败: ${response.status} ${errTxt}`);
      }

      const content = await handleApiResponse_ACU(response, abortSignal);
      if (content) {
        return content.trim();
      }

      throw new Error(`API调用返回无效响应`);
    }
}

export async function callApi_ACU(messages: any[], apiSettings: any, abortSignal: AbortSignal | null = null) {
    // [新增] 获取剧情推进使用的API配置（支持API预设）
    const apiPresetConfig = getApiConfigByPreset_ACU(settings_ACU.plotApiPreset);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig;


    logDebug_ACU(`[剧情推进] 使用API预设: ${settings_ACU.plotApiPreset || '当前配置'}, 模式: ${effectiveApiMode}`);

    if (effectiveApiMode === 'tavern' || effectiveApiConfig.useMainApi) {
      // 使用主API或酒馆预设（流式传输）
      logDebug_ACU('[剧情推进] 通过酒馆主API发送请求（流式传输）...');
      if (!isGenerateRawAvailable_ACU()) {
        throw new Error('TavernHelper.generateRaw 函数不存在。请检查酒馆版本。');
      }
      const response = await generateRaw_ACU({
        ordered_prompts: messages,
        should_stream: settings_ACU.streamingEnabled || false,
      });
      if (typeof response !== 'string') {
        throw new Error('主API调用未返回预期的文本响应。');
      }
      return response.trim();
    } else {
      // 使用自定义API（流式传输）
      if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
      }

      const requestBody = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig);

      const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });


      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`API请求失败: ${response.status} ${errTxt}`);
      }

      // 根据streamingEnabled设置选择响应处理方式
      const content = await handleApiResponse_ACU(response, abortSignal);
      if (content) {
        return content.trim();
      }


      throw new Error(`API调用返回无效响应`);
    }
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


export async function callCustomOpenAI_ACU_Direct(messages: any[]) {
      // Reuse the logic from callCustomOpenAI_ACU but bypass the prompt replacement part
      // ... For brevity, I will just call callCustomOpenAI_ACU with a hacked dynamicContent?
      // No, callCustomOpenAI_ACU relies on settings_ACU.charCardPrompt.
      // I should refactor callCustomOpenAI_ACU to accept direct messages, or duplicate the API calling part.

      // Duplicating API calling logic for safety and isolation
      if (settings_ACU.apiMode === 'tavern') {
          const profileId = settings_ACU.tavernProfile;
          return await sendConnectionManagerRequest_ACU(
                profileId, messages, settings_ACU.apiConfig.max_tokens ?? settings_ACU.apiConfig.maxTokens ?? 4096
          ).then(r => r.result.choices[0].message.content);
      } else {
          // Custom API（流式传输）
          if (settings_ACU.apiConfig.useMainApi) {
             return await generateRaw_ACU({ ordered_prompts: messages, should_stream: settings_ACU.streamingEnabled || false });
          } else {
             const requestBody = buildCustomApiRequestBody_ACU(messages, settings_ACU.apiConfig, { stripModelPrefix: false });
             const res = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: {...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json'}, body: JSON.stringify(requestBody) });
             // 根据streamingEnabled设置选择响应处理方式
             const content = await handleApiResponse_ACU(res);
             return content;
          }
      }
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
    const effectiveTavernProfile = apiPresetConfig.tavernProfile;
    const maxTokens = maxTokensOverride ?? effectiveApiConfig.max_tokens ?? effectiveApiConfig.maxTokens ?? 4096;


    logDebug_ACU(`[callAIWithPreset] 调用 AI，消息数=${messages.length}，预设=${presetName || '当前配置'}，模式=${effectiveApiMode}`);

    if (effectiveApiMode === 'tavern') {
        const profileId = effectiveTavernProfile || settings_ACU.tavernProfile;
        const response = await sendConnectionManagerRequest_ACU(profileId, messages, maxTokens);
        assertNotAborted_ACU(signal);
        if (response?.result?.choices?.[0]?.message?.content) {
            return response.result.choices[0].message.content;
        }
        if (response && typeof response.content === 'string') {
            return response.content;
        }
        logWarn_ACU('[callAIWithPreset] 酒馆 API 返回无效响应');
        return null;
    }

    if (effectiveApiConfig.useMainApi) {
        if (!isGenerateRawAvailable_ACU()) {
            throw new Error('TavernHelper.generateRaw 函数不存在。请检查酒馆版本。');
        }
        const response = await generateRaw_ACU({
            ordered_prompts: messages,
            should_stream: settings_ACU.streamingEnabled || false,
            max_tokens: maxTokens,
        });
        assertNotAborted_ACU(signal);
        return typeof response === 'string' ? response.trim() : null;
    }

    if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
    }

    const body = JSON.stringify(buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { maxTokens, stripModelPrefix: false }));

    const res = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body,
        signal: signal || undefined,
    });

    if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`API请求失败: ${res.status} ${errTxt}`);
    }

    const content = await handleApiResponse_ACU(res, signal);
    return content ? content.trim() : null;
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

