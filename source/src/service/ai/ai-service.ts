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
import { logDebug_ACU } from '../../shared/utils';

// ============================================================
// 模型列表获取
// ============================================================

export interface FetchModelsResult {
    success: boolean;
    models?: string[];
    error?: string;
}

/** 接口协议四值白名单（与 api-call.ts 请求体 custom_api_format 契约同源）。 */
const CUSTOM_API_FORMAT_WHITELIST_ACU: readonly string[] = ['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions'];

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
 * @param customApiFormat 接口协议（预设级，四值白名单）；缺省/非法降级 ''，
 *                        TT 后端据此把模型列表来源切到对应协议（claude_messages→Claude、
 *                        gemini_interactions→Makersuite），不传则恒按 openai_compat 探活。
 */
export async function fetchAvailableModels_ACU(apiUrl: string, apiKey: string, customApiFormat?: string): Promise<FetchModelsResult> {
    if (!apiUrl) {
        return { success: false, error: '请输入API基础URL。' };
    }
    try {
        const { assertSafeHttpEndpoint_ACU } = await import('../../shared/utils');
        assertSafeHttpEndpoint_ACU(apiUrl);
    } catch (e: any) {
        return { success: false, error: String(e?.message || '端点地址不安全。') };
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
        "custom_include_headers": sanitizedKey ? `Authorization: Bearer ${sanitizedKey}` : ""
    };

    const response = await fetch(statusUrl, {
        method: 'POST',
        headers: { ..._getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API端点状态检查失败: ${response.status} ${response.statusText}.`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage += ` 详情: ${errorJson.error || errorJson.message || errorText}`;
        } catch (e) {
            errorMessage += ` 详情: ${errorText}`;
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
