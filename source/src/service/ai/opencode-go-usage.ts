// service/ai/opencode-go-usage.ts — OpenCode Go 订阅用量（5 小时 / 本周 / 本月）
//
// 接口即 OpenCode 官方客户端读取 Go 额度用的那个（anomalyco/opencode PR #16513，
// 官方文档未列出），Bearer 用同一把 API 密钥，不消耗额度。
// 返回 { usage: { rolling|weekly|monthly: { status: 'ok'|'rate-limited', percent, resetsAt } } }，
// 只有百分比，没有美元数；未订阅 Go 回 403。
// 必须走 /inference/go/v1/usage：带 Authorization 头的跨域请求先发 OPTIONS 预检，旧路径
// /zen/go/v1/usage 对预检回 404，浏览器（WebKit 报 "Load failed"）直接拦下；官方客户端不走
// 浏览器所以不受影响。新路径正常应答预检（2026-11-09 实测），酒馆后端又没有可借的通用代发通道。

import { isOpencodeGoEndpoint_ACU } from './api-call';

export interface OpencodeGoUsageMeter_ACU {
    /** 本周期已用百分比（0–100）。 */
    percent: number;
    /** 已用满，Go 在重置前拒绝请求。 */
    limited: boolean;
    /** 重置时间（毫秒时间戳）。 */
    resetsAt: number;
}

export interface OpencodeGoUsage_ACU {
    rolling: OpencodeGoUsageMeter_ACU;
    weekly: OpencodeGoUsageMeter_ACU;
    monthly: OpencodeGoUsageMeter_ACU;
}

/** Go 端点对应的用量接口地址；非 Go 端点返回 null（不查）。 */
export function opencodeGoUsageUrl_ACU(endpointUrl: unknown): string | null {
    if (!isOpencodeGoEndpoint_ACU(endpointUrl)) return null;
    return `${new URL(String(endpointUrl)).origin}/inference/go/v1/usage`;
}

function parseMeter_ACU(raw: any): OpencodeGoUsageMeter_ACU | null {
    const percent = Number(raw?.percent);
    const resetsAt = Date.parse(String(raw?.resetsAt ?? ''));
    if (!Number.isFinite(percent) || !Number.isFinite(resetsAt)) return null;
    return { percent, limited: raw?.status === 'rate-limited', resetsAt };
}

export async function fetchOpencodeGoUsage_ACU(endpointUrl: string, apiKey: string): Promise<OpencodeGoUsage_ACU> {
    const url = opencodeGoUsageUrl_ACU(endpointUrl);
    if (!url) throw new Error('不是 OpenCode Go 端点');
    const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (response.status === 401) throw new Error('API 密钥无效');
    if (response.status === 403) throw new Error('这个密钥所在的账号没有订阅 OpenCode Go');
    if (!response.ok) throw new Error(`查询失败（HTTP ${response.status}）`);
    const body: any = await response.json().catch((): null => null);
    const rolling = parseMeter_ACU(body?.usage?.rolling);
    const weekly = parseMeter_ACU(body?.usage?.weekly);
    const monthly = parseMeter_ACU(body?.usage?.monthly);
    if (!rolling || !weekly || !monthly) throw new Error('返回格式无法识别，接口可能已变更');
    return { rolling, weekly, monthly };
}
