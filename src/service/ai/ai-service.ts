/**
 * service/ai/ai-service.ts — AI 调用服务
 *
 * 中转 data/gateways/ai-gateway 的所有方法。
 * presentation 层通过本模块发起 AI 请求，不再直接调用 gateway。
 * 后续可在此层统一添加日志、埋点、请求限流等增值逻辑。
 */

export {
    isGenerateRawAvailable_ACU,
    isConnectionManagerAvailable_ACU,
    isTriggerSlashAvailable_ACU,
    generateRaw_ACU,
    sendConnectionManagerRequest_ACU,
    triggerSlash_ACU,
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

/**
 * 从自定义 API 端点获取可用模型列表
 * 纯业务逻辑：发送 HTTP 请求、解析响应、返回模型列表
 * 不涉及 UI（toast、状态显示由 presentation 层负责）
 */
export async function fetchAvailableModels_ACU(apiUrl: string, apiKey: string): Promise<FetchModelsResult> {
    if (!apiUrl) {
        return { success: false, error: '请输入API基础URL。' };
    }

    const statusUrl = `/api/backends/chat-completions/status`;
    const body = {
        "reverse_proxy": apiUrl,
        "proxy_password": "",
        "chat_completion_source": "custom",
        "custom_url": apiUrl,
        "custom_include_headers": apiKey ? `Authorization: Bearer ${apiKey}` : ""
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
