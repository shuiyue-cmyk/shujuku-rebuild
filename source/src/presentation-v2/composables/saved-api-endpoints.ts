// presentation-v2/composables/saved-api-endpoints.ts — API 预设「已保存的端点」
// 从用户已保存的 API 预设里收集用过的端点（基础 URL + 接口协议），新建预设时一键复用。
// 只带端点与协议（同一地址按模型分协议的服务商，协议要跟着端点走才能用），密钥、模型等仍由用户自己填。

export interface SavedApiEndpointSource_ACU {
  name: string;
  apiConfig?: { url?: string; customApiFormat?: string } | null;
}

export interface SavedApiEndpoint_ACU {
  id: string;
  url: string;
  format: string;
  label: string;
}

/** 「手填」选项值：不改端点与协议。 */
export const SAVED_API_ENDPOINT_MANUAL_ACU = '';

const FORMAT_LABELS_ACU: Record<string, string> = {
  openai_compat: '兼容 OpenAI',
  openai_responses: 'OpenAI Responses',
  claude_messages: 'Claude Messages',
  gemini_interactions: 'Gemini Interactions',
  gemini_generate_content: 'Gemini generateContent',
};

const MAX_LABEL_PRESET_NAMES_ACU = 2;

function normalizeEndpoint_ACU(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeFormat_ACU(format: string | undefined): string {
  return String(format || '').trim() || 'openai_compat';
}

function endpointId_ACU(url: string, format: string | undefined): string {
  return `${normalizeEndpoint_ACU(url)}|${normalizeFormat_ACU(format)}`;
}

/** 按「端点 + 协议」去重，保持预设顺序；标签带协议与来源预设名。 */
export function collectSavedApiEndpoints_ACU(presets: readonly SavedApiEndpointSource_ACU[]): SavedApiEndpoint_ACU[] {
  const groups = new Map<string, { url: string; format: string; names: string[] }>();
  for (const preset of presets || []) {
    const url = String(preset?.apiConfig?.url || '').trim();
    if (!url) continue;
    const format = normalizeFormat_ACU(preset.apiConfig?.customApiFormat);
    const id = endpointId_ACU(url, format);
    const group = groups.get(id);
    if (group) group.names.push(preset.name);
    else groups.set(id, { url, format, names: [preset.name] });
  }
  return [...groups.entries()].map(([id, group]) => {
    const shown = group.names.slice(0, MAX_LABEL_PRESET_NAMES_ACU).join('、');
    const more = group.names.length > MAX_LABEL_PRESET_NAMES_ACU ? ` 等 ${group.names.length} 个` : '';
    const address = group.url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return {
      id,
      url: group.url,
      format: group.format,
      label: `${address} · ${FORMAT_LABELS_ACU[group.format] || group.format}（来自：${shown}${more}）`,
    };
  });
}

/** 当前端点 + 协议对应的已保存端点；没有对应（新地址）时返回 null。 */
export function matchSavedApiEndpoint_ACU(
  endpoints: readonly SavedApiEndpoint_ACU[],
  url: string,
  format: string,
): SavedApiEndpoint_ACU | null {
  if (!normalizeEndpoint_ACU(url)) return null;
  const id = endpointId_ACU(url, format);
  return endpoints.find(endpoint => endpoint.id === id) || null;
}
