/**
 * service/ai/ai-service.ts — AI 调用服务
 *
 * 中转 data/gateways/ai-gateway 的所有方法。
 * presentation 层通过本模块发起 AI 请求，不再直接调用 gateway。
 * 后续可在此层统一添加日志、埋点、请求限流等增值逻辑。
 */

export {
    getConnectionManagerProfiles_ACU,
    getHostRequestHeaders_ACU,
} from '../../data/gateways/ai-gateway';

import { getHostRequestHeaders_ACU as _getHeaders } from '../../data/gateways/ai-gateway';
import { withOpencodeSessionHeader_ACU } from './api-call';
import { hashUserInput_ACU, logDebug_ACU } from '../../shared/utils';

// ============================================================
// 模型列表获取
// ============================================================

export interface FetchModelsResult {
    success: boolean;
    models?: string[];
    error?: string;
}

/** 接口协议白名单（与 api-call.ts 请求体 custom_api_format 契约同源；TT 现有第五档 gemini_generate_content）。 */
const CUSTOM_API_FORMAT_WHITELIST_ACU: readonly string[] = ['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions', 'gemini_generate_content'];

/** 模型列表探活专用超时（毫秒）：status 请求是轻量探测，15 秒无响应即视为端点不可达。
 *  仅约束本探活请求；主生成出口 postChatCompletion_ACU 不设硬超时（长生成合法，见 api-call.ts）。 */
const MODEL_PROBE_TIMEOUT_MS_ACU = 15000;

/**
 * status 探活的 custom_api_format 归一：缺省/非法一律降级 ''。
 * TT 后端 `CustomApiFormat::parse` 把 '' 视为 openai_compat（与不传字段等价），
 * 但对非法值 fail fast（ValidationError），故脏配置必须在客户端降级为空，不能让探活整体失败。
 */
export function normalizeStatusCustomApiFormat_ACU(value: unknown): string {
    const raw = String(value ?? '').trim();
    return CUSTOM_API_FORMAT_WHITELIST_ACU.includes(raw) ? raw : '';
}

/**
 * 从自定义 API 端点获取可用模型列表
 * 纯业务逻辑：发送 HTTP 请求、解析响应、返回模型列表
 * 不涉及 UI（toast、状态显示由 presentation 层负责）
 * @param customApiFormat 接口协议（预设级，五值白名单）；缺省/非法降级 ''，
 *                        TT 后端据此把模型列表来源切到对应协议（claude_messages→Claude、
 *                        gemini_interactions→Makersuite），不传则恒按 openai_compat 探活。
 */
/** 模型列表探活缓存：成功 5 分钟，失败 30 秒负缓存；防面板连点雪崩。键含密钥指纹，换 key 即穿透。 */
const MODEL_LIST_TTL_MS_ACU = 5 * 60 * 1000;
const MODEL_LIST_FAIL_TTL_MS_ACU = 30 * 1000;
const MODEL_LIST_CACHE_CAP_ACU = 50;
interface ModelListCacheEntry_ACU { at: number; result: FetchModelsResult; }
const modelListCache_ACU = new Map<string, ModelListCacheEntry_ACU>();
const modelListInflight_ACU = new Map<string, Promise<FetchModelsResult>>();

function modelListCacheKey_ACU(apiUrl: string, apiKey: string, customApiFormat?: string): string {
    const url = String(apiUrl || '').trim().replace(/\/+$/, '').toLowerCase();
    return `${url}\n${normalizeStatusCustomApiFormat_ACU(customApiFormat)}\n${hashUserInput_ACU(String(apiKey || ''))}`;
}

function cloneModelsResult_ACU(result: FetchModelsResult): FetchModelsResult {
    return { ...result, models: result.models ? [...result.models] : undefined };
}

export async function fetchAvailableModels_ACU(apiUrl: string, apiKey: string, customApiFormat?: string, options?: { force?: boolean }): Promise<FetchModelsResult> {
    if (!apiUrl) {
        return { success: false, error: '请输入API基础URL。' };
    }
    const key = modelListCacheKey_ACU(apiUrl, apiKey, customApiFormat);
    const now = Date.now();
    const hit = options?.force ? undefined : modelListCache_ACU.get(key);
    if (hit && now - hit.at < (hit.result.success ? MODEL_LIST_TTL_MS_ACU : MODEL_LIST_FAIL_TTL_MS_ACU)) {
        return cloneModelsResult_ACU(hit.result);
    }
    const inflight = modelListInflight_ACU.get(key);
    if (inflight) return inflight.then(cloneModelsResult_ACU);
    const pending = fetchAvailableModelsUncached_ACU(apiUrl, apiKey, customApiFormat).then(
        (result) => {
            modelListCache_ACU.set(key, { at: Date.now(), result });
            if (modelListCache_ACU.size > MODEL_LIST_CACHE_CAP_ACU) {
                const oldest = modelListCache_ACU.keys().next();
                if (!oldest.done) modelListCache_ACU.delete(oldest.value);
            }
            modelListInflight_ACU.delete(key);
            return cloneModelsResult_ACU(result);
        },
        (error) => {
            modelListInflight_ACU.delete(key);
            throw error;
        },
    );
    modelListInflight_ACU.set(key, pending);
    return pending;
}

/** 清掉模型列表探活缓存（仅测试与端点配置大改后用；正常调用靠 TTL/密钥指纹）。 */
export function __clearModelListCacheForTests_ACU(): void {
    modelListCache_ACU.clear();
    modelListInflight_ACU.clear();
}

async function fetchAvailableModelsUncached_ACU(apiUrl: string, apiKey: string, customApiFormat?: string): Promise<FetchModelsResult> {
    if (!apiUrl) {
        return { success: false, error: '请输入API基础URL。' };
    }
    try {
        const { assertSafeHttpEndpoint_ACU } = await import('../../shared/utils');
        assertSafeHttpEndpoint_ACU(apiUrl);
    } catch (e: any) {
        const reason = String(e?.message || '端点地址不安全。');
        // 协议非法分支：SSRF 守卫的协议相关拒绝追加可操作提示（其余拒绝保持原文）。
        const protocolHint = /协议|仅支持 http/i.test(reason) ? '请使用完整的 http(s):// 地址（不支持协议相对 URL 与非 http(s) 协议）。' : '';
        return { success: false, error: protocolHint ? `${reason} ${protocolHint}` : reason };
    }

    const statusUrl = `/api/backends/chat-completions/status`;
    const sanitizedKey = String(apiKey || '').replace(/[\r\n\0]+/g, '');
    const body = {
        "reverse_proxy": apiUrl,
        "proxy_password": "",
        "chat_completion_source": "custom",
        // 接口协议（预设级）：TT status 路由按 custom_api_format 解析模型列表来源
        // （resolve_status_model_list_source，仅 source==Custom 生效），不改 base/密钥解析。
        "custom_api_format": normalizeStatusCustomApiFormat_ACU(customApiFormat),
        "custom_url": apiUrl,
        // OpenCode Go 端点自动补 x-opencode-session 会话头（缺失会被 Go 拒单）
        "custom_include_headers": withOpencodeSessionHeader_ACU(sanitizedKey ? `Authorization: Bearer ${sanitizedKey}` : "", apiUrl)
    };

    // 探活专用 15s AbortController：不设超时的探活会挂在无响应端点上，UI 状态停在"正在检查"。
    // 仅对本次 fetch 生效；响应头到达后读 body 不再受此定时约束（轻量响应，无实际影响）。
    const controller = new AbortController();
    const probeTimer = setTimeout(() => controller.abort(), MODEL_PROBE_TIMEOUT_MS_ACU);
    let response: Response;
    try {
        response = await fetch(statusUrl, {
            method: 'POST',
            redirect: 'error', // 307/308 会把 POST 原样重放到重定向目标：SSRF 守卫只校发起前 URL，禁止重定向
            headers: { ..._getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (e: any) {
        // 仅折叠探活中断为结构化失败（返回 FetchModelsResult，调用方 UI 才能正确落到错误态）；
        // 其余网络层异常保持原有抛出行为不变。
        if (e?.name === 'AbortError' || /abort/i.test(String(e?.message || ''))) {
            return { success: false, error: `API 端点状态检查超时：${MODEL_PROBE_TIMEOUT_MS_ACU / 1000} 秒内无响应，请检查端点地址与网络后重试。` };
        }
        throw e;
    } finally {
        clearTimeout(probeTimer);
    }

    if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        let errorMessage = `API端点状态检查失败: ${status} ${response.statusText}.`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage += ` 详情: ${errorJson.error || errorJson.message || errorText}`;
        } catch (e) {
            errorMessage += ` 详情: ${errorText}`;
        }
        // status 可操作映射：文案保留 {status} 数字与关键词形状，供 log-error-hints
        //（http-401 / http-404 等规则按状态码与关键短语匹配）直接复用。
        if (status === 401) {
            errorMessage += ' 请检查 API Key 是否正确、完整且未过期（401 unauthorized：API Key 无效）。';
        } else if (status === 404) {
            errorMessage += ' 请检查接口地址是否完整、模型名是否存在（404 not found：模型不存在或地址错误，可点「拉取模型列表」重选）。';
        }
        return { success: false, error: errorMessage };
    }

    const data = await response.json();
    logDebug_ACU('获取到的模型数据:', data);

    let modelsList: any[] = [];
    if (data && data.models && Array.isArray(data.models)) {
        modelsList = data.models;
    } else if (data && data.data && Array.isArray(data.data)) {
        modelsList = data.data;
    } else if (Array.isArray(data)) {
        modelsList = data;
    }

    const modelNames = modelsList
        .map((model: any) => typeof model === 'string' ? model : model.id)
        .filter(Boolean);

    if (modelNames.length === 0) {
        return { success: false, error: '未能解析模型数据或列表为空。' };
    }

    return { success: true, models: modelNames };
}
