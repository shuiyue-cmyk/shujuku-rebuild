/**
 * OpenCode Go 用量查询：只认 Go 端点；按官方客户端同款接口取 5 小时 / 本周 / 本月三个周期。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpencodeGoUsage_ACU, opencodeGoUsageUrl_ACU } from '../../../src/service/ai/opencode-go-usage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const okBody = {
  usage: {
    rolling: { status: 'ok', percent: 60, resetsAt: '2026-11-09T15:04:53.000Z' },
    weekly: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-16T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 93.5, resetsAt: '2026-11-09T19:38:32.000Z' },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opencodeGoUsageUrl_ACU', () => {
  it('Go 端点（新旧两种路径）都指向同一个用量接口', () => {
    expect(opencodeGoUsageUrl_ACU('https://opencode.ai/zen/go/v1')).toBe('https://opencode.ai/zen/go/v1/usage');
    expect(opencodeGoUsageUrl_ACU('https://opencode.ai/inference/go/openai/v1/')).toBe('https://opencode.ai/zen/go/v1/usage');
  });

  it('Zen 等非 Go 端点、其他服务商、空值都不查', () => {
    expect(opencodeGoUsageUrl_ACU('https://opencode.ai/zen/v1')).toBeNull();
    expect(opencodeGoUsageUrl_ACU('https://opencode.ai/inference/openai/v1')).toBeNull();
    expect(opencodeGoUsageUrl_ACU('https://api.example.com/zen/go/v1')).toBeNull();
    expect(opencodeGoUsageUrl_ACU('')).toBeNull();
  });
});

describe('fetchOpencodeGoUsage_ACU', () => {
  it('带密钥 GET 用量接口，解析三个周期的百分比、重置时间与限流状态', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, okBody));
    vi.stubGlobal('fetch', fetchMock);

    const usage = await fetchOpencodeGoUsage_ACU('https://opencode.ai/zen/go/v1', 'oc_sk_test');

    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/usage', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer oc_sk_test', Accept: 'application/json' }),
    }));
    expect(usage).toEqual({
      rolling: { percent: 60, limited: false, resetsAt: Date.parse('2026-11-09T15:04:53.000Z') },
      weekly: { percent: 100, limited: true, resetsAt: Date.parse('2026-11-16T00:00:00.000Z') },
      monthly: { percent: 93.5, limited: false, resetsAt: Date.parse('2026-11-09T19:38:32.000Z') },
    });
  });

  it('密钥无效（401）与未订阅 Go（403）给出可读原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { type: 'error' })));
    await expect(fetchOpencodeGoUsage_ACU('https://opencode.ai/zen/go/v1', 'bad')).rejects.toThrow('API 密钥无效');

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { type: 'error' })));
    await expect(fetchOpencodeGoUsage_ACU('https://opencode.ai/zen/go/v1', 'k')).rejects.toThrow('没有订阅 OpenCode Go');
  });

  it('返回内容不是预期格式时报错，不显示残缺数据', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { usage: { rolling: okBody.usage.rolling } })));
    await expect(fetchOpencodeGoUsage_ACU('https://opencode.ai/zen/go/v1', 'k')).rejects.toThrow('格式');
  });

  it('非 Go 端点直接拒绝，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchOpencodeGoUsage_ACU('https://opencode.ai/zen/v1', 'k')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
