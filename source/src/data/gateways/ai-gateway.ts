/**
 * data/gateways/ai-gateway.ts — AI 调用网关
 *
 * 封装 SillyTavern_API_ACU 的宿主调用方法。
 * service 层通过本模块发起 AI 请求，不再直接调用宿主 API。
 *
 * 酒馆主 API（TavernHelper.generateRaw / tavern 连接预设 / ConnectionManager 请求）已剥离。
 */

import { SillyTavern_API_ACU } from '../../shared/host-api';
import { logWarn_ACU } from '../../shared/utils';

// ═══ 配置读取 ═══

/**
 * 获取 ConnectionManager 的配置文件列表
 * @returns 配置文件数组，不可用时返回 []
 */
export function getConnectionManagerProfiles_ACU(): any[] {
    return SillyTavern_API_ACU?.extensionSettings?.connectionManager?.profiles || [];
}

// ═══ 请求认证 ═══

/**
 * 获取宿主平台的 HTTP 请求头（包含 CSRF token 等认证信息）
 * 封装 SillyTavern.getRequestHeaders()，不可用时返回空对象。
 *
 * 注意：主窗口的 window.SillyTavern 只有 {libs, getContext}，
 * getRequestHeaders 在 getContext() 返回的对象里。
 * 所以必须通过 SillyTavern_API_ACU（已被 Proxy 包装）或 getContext() 获取。
 */
export function getHostRequestHeaders_ACU(): Record<string, string> {
    try {
        // 优先通过 SillyTavern_API_ACU（插件模式下已被 Proxy 包装，每次读取走 getContext()）
        if (SillyTavern_API_ACU && typeof (SillyTavern_API_ACU as any).getRequestHeaders === 'function') {
            const headers = (SillyTavern_API_ACU as any).getRequestHeaders();
            if (headers && typeof headers === 'object') return headers;
        }
        // fallback：直接调用 getContext()（覆盖 SillyTavern_API_ACU 尚未初始化的场景）
        const ctx = (globalThis as any).SillyTavern?.getContext?.();
        if (ctx && typeof ctx.getRequestHeaders === 'function') {
            const headers = ctx.getRequestHeaders();
            if (headers && typeof headers === 'object') return headers;
        }
        return {};
    } catch {
        logWarn_ACU('[AIGateway] getRequestHeaders 不可用，返回空对象');
        return {};
    }
}
