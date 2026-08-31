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
  /** 流式输出（预设级）：undefined=未配置（跟随全局），保存时不写键 */
  streamingEnabled?: boolean;
  /** 思考强度（预设级）：low / medium / high / max / xhigh；undefined=未配置（跟随全局），保存时不写键 */
  reasoningEffort?: string;
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
    // A2 修复：undefined 必须原样保留（=跟随全局）。旧版把 undefined 读成 false/'medium'
    // 再恒写具体值，旧预设只要「打开面板并保存」一次就被固化为显式配置，永久失去全局回退。
    streamingEnabled: typeof preset.apiConfig.streamingEnabled === 'boolean' ? preset.apiConfig.streamingEnabled : undefined,
    reasoningEffort: typeof preset.apiConfig.reasoningEffort === 'string' && preset.apiConfig.reasoningEffort ? preset.apiConfig.reasoningEffort : undefined,
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
      // undefined = 用户未显式配置 → 整个键不写，保持「跟随全局」语义（A2 修复）。
      ...(draft.streamingEnabled === true || draft.streamingEnabled === false
        ? { streamingEnabled: draft.streamingEnabled }
        : {}),
      ...(typeof draft.reasoningEffort === 'string' && (['low', 'medium', 'high', 'max', 'xhigh'] as const).includes(draft.reasoningEffort as any)
        ? { reasoningEffort: draft.reasoningEffort as 'low' | 'medium' | 'high' | 'max' | 'xhigh' }
        : {}),
      customApiFormat: (['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions'] as const).includes(draft.customApiFormat as any)
        ? (draft.customApiFormat as 'openai_compat' | 'openai_responses' | 'claude_messages' | 'gemini_interactions')
        : 'openai_compat',
    },
    nonPrefillSupport: draft.nonPrefillSupport === true,
    publicServiceMode: draft.publicServiceMode === true,
  };
}
