// presentation-v2/composables/saved-api-endpoints.ts — API 预设「已保存的端点」
// 从用户已保存的 API 预设里收集用过的端点（基础 URL），新建预设时一键复用。
// 只带端点：同一地址的接口协议可能按模型不同（如 OpenCode），协议、密钥、模型都由用户自己选填。

export interface SavedApiEndpointSource_ACU {
  name: string;
  apiConfig?: { url?: string } | null;
}

export interface SavedApiEndpoint_ACU {
  id: string;
  url: string;
  label: string;
}

/** 「手填」选项值：不改端点。 */
export const SAVED_API_ENDPOINT_MANUAL_ACU = '';

const MAX_LABEL_PRESET_NAMES_ACU = 2;

function normalizeEndpoint_ACU(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
}

/** 按端点去重（忽略大小写与末尾斜杠），保持预设顺序；标签带来源预设名。 */
export function collectSavedApiEndpoints_ACU(presets: readonly SavedApiEndpointSource_ACU[]): SavedApiEndpoint_ACU[] {
  const groups = new Map<string, { url: string; names: string[] }>();
  for (const preset of presets || []) {
    const url = String(preset?.apiConfig?.url || '').trim();
    if (!url) continue;
    const id = normalizeEndpoint_ACU(url);
    const group = groups.get(id);
    if (group) group.names.push(preset.name);
    else groups.set(id, { url, names: [preset.name] });
  }
  return [...groups.entries()].map(([id, group]) => {
    const shown = group.names.slice(0, MAX_LABEL_PRESET_NAMES_ACU).join('、');
    const more = group.names.length > MAX_LABEL_PRESET_NAMES_ACU ? ` 等 ${group.names.length} 个` : '';
    const address = group.url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return { id, url: group.url, label: `${address}（来自：${shown}${more}）` };
  });
}

/** 当前端点对应的已保存端点；没有对应（新地址）时返回 null。 */
export function matchSavedApiEndpoint_ACU(endpoints: readonly SavedApiEndpoint_ACU[], url: string): SavedApiEndpoint_ACU | null {
  const id = normalizeEndpoint_ACU(url);
  if (!id) return null;
  return endpoints.find(endpoint => endpoint.id === id) || null;
}
