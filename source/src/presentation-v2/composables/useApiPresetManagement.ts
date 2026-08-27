import type { AcuV2ApiMode, AcuV2ApiPreset } from '../stores/api-preset-store';

export interface ApiPresetDraft {
  name: string;
  apiMode: AcuV2ApiMode;
  url: string;
  apiKey: string;
  model: string;
  max_tokens: number;
  temperature: number;
  bodyParams: string;
  excludeBodyParams: string;
  requestHeaders: string;
  /** 非预填充支持（预设级）：assistant 消息改写为 user +「助手：」前缀 */
  nonPrefillSupport: boolean;
  /** 流式输出（预设级） */
  streamingEnabled: boolean;
  /** 思考强度（预设级）：low / medium / high / max / xhigh */
  reasoningEffort: string;
  /** 公益站兼容（预设级）：限速每分钟最多 3 次请求（各预设独立计数） */
  publicServiceMode: boolean;
  /** 接口协议（预设级）：openai_compat / openai_responses / claude_messages / gemini_interactions */
  customApiFormat: string;
}

/** 连接模式（酒馆主 API / 酒馆预设已剥离，恒为自定义 API） */
export type ConnectionMode = 'custom';

export function createEmptyApiPresetDraft(): ApiPresetDraft {
  return {
    name: '',
    apiMode: 'custom',
    url: '',
    apiKey: '',
    model: '',
    max_tokens: 60000,
    temperature: 1,
    bodyParams: '',
    excludeBodyParams: '',
    requestHeaders: '',
    nonPrefillSupport: false,
    streamingEnabled: false,
    reasoningEffort: 'medium',
    publicServiceMode: false,
    customApiFormat: 'openai_compat',
  };
}

export function apiPresetDraftFromPreset(preset: AcuV2ApiPreset): ApiPresetDraft {
  return {
    name: preset.name,
    apiMode: preset.apiMode,
    url: preset.apiConfig.url || '',
    apiKey: preset.apiConfig.apiKey || '',
    model: preset.apiConfig.model || '',
    max_tokens: Number(preset.apiConfig.max_tokens || 60000),
    temperature: Number(preset.apiConfig.temperature ?? 1),
    bodyParams: preset.apiConfig.bodyParams || '',
    excludeBodyParams: preset.apiConfig.excludeBodyParams || '',
    requestHeaders: preset.apiConfig.requestHeaders || '',
    nonPrefillSupport: preset.nonPrefillSupport === true,
    streamingEnabled: preset.apiConfig.streamingEnabled === true,
    reasoningEffort: preset.apiConfig.reasoningEffort || 'medium',
    publicServiceMode: preset.publicServiceMode === true,
    customApiFormat: preset.apiConfig.customApiFormat || 'openai_compat',
  };
}

export function apiPresetFromDraft(draft: ApiPresetDraft): AcuV2ApiPreset {
  return {
    name: draft.name.trim(),
    apiMode: draft.apiMode,
    apiConfig: {
      url: draft.url.trim(),
      apiKey: draft.apiKey,
      model: draft.model.trim(),
      max_tokens: Math.max(1, Math.floor(Number(draft.max_tokens) || 60000)),
      temperature: Number.isFinite(Number(draft.temperature)) ? Number(draft.temperature) : 1,
      bodyParams: draft.bodyParams || '',
      excludeBodyParams: draft.excludeBodyParams || '',
      requestHeaders: draft.requestHeaders || '',
      streamingEnabled: draft.streamingEnabled === true,
      reasoningEffort: (['low', 'medium', 'high', 'max', 'xhigh'] as const).includes(draft.reasoningEffort as any)
        ? (draft.reasoningEffort as 'low' | 'medium' | 'high' | 'max' | 'xhigh')
        : 'medium',
      customApiFormat: (['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions'] as const).includes(draft.customApiFormat as any)
        ? (draft.customApiFormat as 'openai_compat' | 'openai_responses' | 'claude_messages' | 'gemini_interactions')
        : 'openai_compat',
    },
    nonPrefillSupport: draft.nonPrefillSupport === true,
    publicServiceMode: draft.publicServiceMode === true,
  };
}
