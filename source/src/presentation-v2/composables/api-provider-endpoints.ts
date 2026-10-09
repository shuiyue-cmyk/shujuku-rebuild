// presentation-v2/composables/api-provider-endpoints.ts — API 预设「常用服务商」端点
// 选中后只填端点（基础 URL）与接口协议，密钥、模型等仍由用户自己填。
// 清单参考 MVU「额外模型解析 → 更多」的服务商注册表（2026-10 版），按本库口径换算：
// - 请求经 TT 后端发出：Claude Messages 直接在端点后拼 /messages，所以 MVU 里 Anthropic SDK 风格的
//   基础地址（SDK 自己补 /v1）这里统一补上 /v1；Gemini 端点带 /v1beta，TT 不会重复补。
// - 同一家有多种协议时优先兼容 OpenAI（本库主路径）；MVU 只登记了 Claude 协议的照搬 Claude Messages。
// - Mistral 原生对话协议本库不支持，改用其 OpenAI 兼容端点。
// - 不收录只能 OAuth 登录（OpenAI Codex）或需换取专用令牌（GitHub Copilot）的服务商；
//   Qwen Token Plan 国际版与个人版端点相同，合并为一项。
import type { CustomApiFormat_ACU } from '../../service/settings/api-preset-service';

export interface ApiProviderEndpoint_ACU {
  id: string;
  label: string;
  url: string;
  format: CustomApiFormat_ACU;
}

export const API_PROVIDER_ENDPOINTS_ACU: readonly ApiProviderEndpoint_ACU[] = [
  { id: 'ant-ling', label: 'Ant Ling', url: 'https://api.ant-ling.com/v1', format: 'openai_compat' },
  { id: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com/v1', format: 'claude_messages' },
  { id: 'baseten', label: 'Baseten', url: 'https://inference.baseten.co/v1', format: 'openai_compat' },
  { id: 'cerebras', label: 'Cerebras', url: 'https://api.cerebras.ai/v1', format: 'openai_compat' },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', format: 'openai_compat' },
  { id: 'fireworks', label: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1', format: 'openai_compat' },
  { id: 'google', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta', format: 'gemini_generate_content' },
  { id: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', format: 'openai_compat' },
  { id: 'huggingface', label: 'Hugging Face', url: 'https://router.huggingface.co/v1', format: 'openai_compat' },
  { id: 'kimi-coding', label: 'Kimi For Coding', url: 'https://api.kimi.com/coding/v1', format: 'claude_messages' },
  { id: 'minimax', label: 'MiniMax', url: 'https://api.minimax.io/anthropic/v1', format: 'claude_messages' },
  { id: 'minimax-cn', label: 'MiniMax（中国）', url: 'https://api.minimaxi.com/anthropic/v1', format: 'claude_messages' },
  { id: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1', format: 'openai_compat' },
  { id: 'moonshotai', label: 'Moonshot AI', url: 'https://api.moonshot.ai/v1', format: 'openai_compat' },
  { id: 'moonshotai-cn', label: 'Moonshot AI（中国）', url: 'https://api.moonshot.cn/v1', format: 'openai_compat' },
  { id: 'nvidia', label: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', format: 'openai_compat' },
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', format: 'openai_compat' },
  { id: 'opencode', label: 'OpenCode Zen', url: 'https://opencode.ai/zen/v1', format: 'openai_compat' },
  { id: 'opencode-go', label: 'OpenCode Go', url: 'https://opencode.ai/zen/go/v1', format: 'openai_compat' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', format: 'openai_compat' },
  { id: 'qwen-token-plan', label: 'Qwen Token Plan（国际 / 个人版）', url: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', format: 'openai_compat' },
  { id: 'qwen-token-plan-cn', label: 'Qwen Token Plan（中国）', url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', format: 'openai_compat' },
  { id: 'together', label: 'Together', url: 'https://api.together.ai/v1', format: 'openai_compat' },
  { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh/v1', format: 'claude_messages' },
  { id: 'xai', label: 'xAI', url: 'https://api.x.ai/v1', format: 'openai_compat' },
  { id: 'xiaomi', label: 'Xiaomi MiMo', url: 'https://api.xiaomimimo.com/v1', format: 'openai_compat' },
  { id: 'xiaomi-token-plan-ams', label: 'Xiaomi Token Plan AMS', url: 'https://token-plan-ams.xiaomimimo.com/v1', format: 'openai_compat' },
  { id: 'xiaomi-token-plan-cn', label: 'Xiaomi Token Plan（中国）', url: 'https://token-plan-cn.xiaomimimo.com/v1', format: 'openai_compat' },
  { id: 'xiaomi-token-plan-sgp', label: 'Xiaomi Token Plan SGP', url: 'https://token-plan-sgp.xiaomimimo.com/v1', format: 'openai_compat' },
  { id: 'zai', label: 'Z.AI', url: 'https://api.z.ai/api/coding/paas/v4', format: 'openai_compat' },
  { id: 'zai-coding-cn', label: 'Z.AI Coding（中国）', url: 'https://open.bigmodel.cn/api/coding/paas/v4', format: 'openai_compat' },
];

/** 「手填」选项值：不改端点与协议。 */
export const API_PROVIDER_ENDPOINT_MANUAL_ACU = '';

function normalizeEndpoint_ACU(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
}

/** 当前端点 + 协议对应的服务商；没有对应（手填的地址）时返回 null。 */
export function matchApiProviderEndpoint_ACU(url: string, format: string): ApiProviderEndpoint_ACU | null {
  const target = normalizeEndpoint_ACU(url);
  if (!target) return null;
  return API_PROVIDER_ENDPOINTS_ACU.find(p => normalizeEndpoint_ACU(p.url) === target && p.format === (format || 'openai_compat')) || null;
}
