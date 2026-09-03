/**
 * agent-web-client — TT 适配通道测试。
 * MediaWiki 直连与 SearXNG 同源路由一律用 mock fetch 覆盖，不出网；
 * 真实 TT WebView（tauri://localhost）可达性待真机实测，见移植报告。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_ENCYCLOPEDIA_SUPPORT_ACU,
  AGENT_WEB_PROVIDER_SUPPORT_ACU,
  AgentWebClient_ACU,
  collapseWhitespace_ACU,
  enabledEncyclopediaSources_ACU,
  evaluateWebUrlPolicy_ACU,
  extractReadableText_ACU,
  parseBlockedDomains_ACU,
  parseSearxngHtml_ACU,
  truncateWebText_ACU,
} from '../../../../src/service/continuation/agent/agent-web-client';

function jsonResponse_ACU(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function textResponse_ACU(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function client_ACU(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { client: AgentWebClient_ACU; fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  return { client: new AgentWebClient_ACU({ fetch: fetch as unknown as typeof globalThis.fetch, hostHeaders: () => ({ 'X-CSRF-Token': 't' }), now: () => 1 }), fetch };
}

describe('URL 策略与文本处理', () => {
  it('拒绝非 http、IP 直连、内网、酒馆自身与黑名单域名', () => {
    const blocked = parseBlockedDomains_ACU('example.com, https://bad.org/path\nfoo.net');
    expect(blocked).toEqual(['example.com', 'bad.org', 'foo.net']);
    expect(evaluateWebUrlPolicy_ACU('ftp://x.org/a', blocked)).toContain('http');
    expect(evaluateWebUrlPolicy_ACU('http://127.0.0.1/a', blocked)).toContain('IP');
    expect(evaluateWebUrlPolicy_ACU('http://localhost/a', blocked)).toContain('内网');
    expect(evaluateWebUrlPolicy_ACU('http://router.local/', blocked)).toContain('内网');
    expect(evaluateWebUrlPolicy_ACU('https://my.tavern.host/api', blocked, 'https://my.tavern.host:8000')).toContain('酒馆');
    expect(evaluateWebUrlPolicy_ACU('https://sub.example.com/x', blocked)).toContain('黑名单');
    expect(evaluateWebUrlPolicy_ACU('https://zh.moegirl.org.cn/x', blocked)).toBeNull();
    expect(evaluateWebUrlPolicy_ACU('not a url', blocked)).toContain('非法');
  });

  it('HTML 抽纯文本：去脚本样式导航、块级换行、解实体、折叠空白', () => {
    const html = '<html><head><title>测试&amp;页</title><style>p{}</style></head><body><nav>菜单</nav><script>var a=1;</script><h1>标题</h1><p>第一段&nbsp;内容</p><div>第二段</div></body></html>';
    const result = extractReadableText_ACU(html);
    expect(result.title).toBe('测试&页');
    expect(result.text).toBe('标题\n第一段 内容\n第二段');
    expect(result.text).not.toContain('菜单');
    expect(result.text).not.toContain('var a');
  });

  it('折叠萌娘百科 extract 里成片的制表符与空行，保留段落边界', () => {
    expect(collapseWhitespace_ACU('简介\n\t\t\n\t\t\t\n\n\n经历\n  外貌  金发')).toBe('简介\n\n经历\n外貌 金发');
  });

  it('截断超出上限的原文并标注', () => {
    expect(truncateWebText_ACU('短文', 10)).toBe('短文');
    const long = truncateWebText_ACU('一二三四五六七八九十一二', 10);
    expect(long.startsWith('一二三四五六七八九十')).toBe(true);
    expect(long).toContain('已截断');
  });

  it('按设置得到启用的百科来源', () => {
    expect(enabledEncyclopediaSources_ACU({ sources: { moegirl: true, wikipediaZh: false, wikipediaEn: true, baidu: false } })).toEqual(['moegirl', 'wikipedia_en']);
  });
});

describe('TT 通道能力标记', () => {
  it('仅 SearXNG 与萌娘/维基直连可行，其余默认关闭且有迹可查', () => {
    expect(AGENT_WEB_PROVIDER_SUPPORT_ACU).toEqual({ searxng: true, duckduckgo: false, serper: false, tavily: false });
    expect(AGENT_ENCYCLOPEDIA_SUPPORT_ACU).toEqual({ moegirl: true, wikipedia_zh: true, wikipedia_en: true, baidu: false });
  });
});

describe('SearXNG HTML 解析', () => {
  it('article.result 里的 h3 链接与 p.content，坏链丢弃', () => {
    const html = '<article class="result result-default"><h3><a href="https://a.org/1">标题一</a></h3><p class="content">摘要一</p></article><article class="result"><h3><a href="javascript:void(0)">坏链</a></h3></article>';
    expect(parseSearxngHtml_ACU(html)).toEqual([{ title: '标题一', url: 'https://a.org/1', snippet: '摘要一' }]);
  });
});

describe('AgentWebClient_ACU 百科通道（TT 直连）', () => {
  it('萌娘百科用 opensearch 找候选，用 extracts 精读并折叠空白', async () => {
    const { client, fetch } = client_ACU(url => {
      if (url.includes('action=opensearch')) return jsonResponse_ACU(['鲁迪', ['鲁迪乌斯·格雷拉特'], [''], ['https://zh.moegirl.org.cn/%E9%B2%81']]);
      if (url.includes('prop=extracts')) return jsonResponse_ACU({ query: { pages: { 1: { pageid: 1, title: '鲁迪乌斯·格雷拉特', extract: '鲁迪乌斯是主角。\n\n\t\t\n简介\n转生者。' } } } });
      throw new Error(`unexpected ${url}`);
    });
    const search = await client.searchEncyclopedia('moegirl', '鲁迪');
    expect(search.candidates).toEqual([{ source: 'moegirl', title: '鲁迪乌斯·格雷拉特', url: 'https://zh.moegirl.org.cn/%E9%B2%81', snippet: '' }]);
    const page = await client.readEncyclopedia('moegirl', '鲁迪乌斯·格雷拉特', 4000);
    expect(page.status).toBe('ok');
    expect(page.text).toBe('鲁迪乌斯是主角。\n\n简介\n转生者。');
    expect(page.url).toContain('zh.moegirl.org.cn/');
    // 直连百科 API 必须带 origin=* 才有 CORS 头。
    expect(String(fetch.mock.calls[0][0])).toContain('origin=*');
  });

  it('维基百科 list=search 无命中与词条缺失都以说明文本返回而不抛错', async () => {
    const { client } = client_ACU(url => {
      if (url.includes('list=search')) return jsonResponse_ACU({ query: { search: [] } });
      if (url.includes('prop=extracts')) return jsonResponse_ACU({ query: { pages: { '-1': { title: '不存在', missing: '' } } } });
      throw new Error(`unexpected ${url}`);
    });
    const search = await client.searchEncyclopedia('wikipedia_zh', '不存在');
    expect(search.candidates).toEqual([]);
    expect(search.note).toContain('无命中');
    const page = await client.readEncyclopedia('wikipedia_zh', '不存在', 4000);
    expect(page.status).toBe('unavailable');
    expect(page.note).toContain('encyclopedia_search');
  });

  it('负向控制：百度百科在 TT 无转发路由，直接返回不可用且不出网', async () => {
    const { client, fetch } = client_ACU(() => textResponse_ACU(''));
    const search = await client.searchEncyclopedia('baidu', '鲁迪乌斯');
    expect(search.candidates).toEqual([]);
    expect(search.note).toContain('/api/search/visit');
    const page = await client.readEncyclopedia('baidu', '鲁迪乌斯', 4000);
    expect(page.status).toBe('unavailable');
    expect(page.note).toContain('/api/search/visit');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AgentWebClient_ACU 通用搜索与网页抓取（TT 路由实态）', () => {
  it('SearXNG 按 TT 契约 POST /api/search/searxng（{baseUrl, query}）并解析 HTML', async () => {
    const { client, fetch } = client_ACU((url, init) => {
      expect(url).toBe('/api/search/searxng');
      const body = JSON.parse(String(init?.body));
      // 与 TT tests/search-routes-contract.test.mjs 的请求形状一致。
      expect(body).toEqual({ baseUrl: 'http://localhost:8888', query: 'Tauri' });
      expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('t');
      return textResponse_ACU('<article class="result"><h3><a href="https://a.org/x">A</a></h3><p class="content">s</p></article>');
    });
    const result = await client.webSearch('Tauri', { searchProvider: 'searxng', searxngBaseUrl: 'http://localhost:8888' });
    expect(result.hits).toEqual([{ title: 'A', url: 'https://a.org/x', snippet: 's' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SearXNG 可选键 preferences/categories 有值时全透传（TT DTO 全透传断言）', async () => {
    const { client, fetch } = client_ACU((url, init) => {
      expect(url).toBe('/api/search/searxng');
      const body = JSON.parse(String(init?.body));
      // 与 TT tests/search-routes-contract.test.mjs 的三键透传断言一致。
      expect(body).toEqual({ baseUrl: 'http://localhost:8888', query: 'Tauri', preferences: 'lang=en', categories: 'it' });
      return textResponse_ACU('<article class="result"><h3><a href="https://a.org/x">A</a></h3><p class="content">s</p></article>');
    });
    const result = await client.webSearch('Tauri', { searchProvider: 'searxng', searxngBaseUrl: 'http://localhost:8888', preferences: 'lang=en', categories: 'it' });
    expect(result.hits).toEqual([{ title: 'A', url: 'https://a.org/x', snippet: 's' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SearXNG 可选键为空/全空白时不发送（TT prepare_request optional_text 语义）', async () => {
    const { client, fetch } = client_ACU((url, init) => {
      expect(url).toBe('/api/search/searxng');
      expect(JSON.parse(String(init?.body))).toEqual({ baseUrl: 'http://localhost:8888', query: 'Tauri' });
      return textResponse_ACU('<article class="result"><h3><a href="https://a.org/x">A</a></h3><p class="content">s</p></article>');
    });
    const empty = await client.webSearch('Tauri', { searchProvider: 'searxng', searxngBaseUrl: 'http://localhost:8888', preferences: '', categories: '   ' });
    expect(empty.hits).toHaveLength(1);
    const omitted = await client.webSearch('Tauri', { searchProvider: 'searxng', searxngBaseUrl: 'http://localhost:8888' });
    expect(omitted.hits).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('SearXNG 未填地址时给出可操作提示且不出网；实例失败时说明原因', async () => {
    const { client, fetch } = client_ACU(() => textResponse_ACU(''));
    const result = await client.webSearch('q', { searchProvider: 'searxng', searxngBaseUrl: '' });
    expect(result.note).toContain('SearXNG 实例地址未配置');
    expect(fetch).not.toHaveBeenCalled();

    const { client: bad } = client_ACU(() => textResponse_ACU('', 500));
    const failed = await bad.webSearch('q', { searchProvider: 'searxng', searxngBaseUrl: 'http://localhost:8888' });
    expect(failed.hits).toEqual([]);
    expect(failed.note).toContain('HTTP 500');
  });

  it('负向控制：DuckDuckGo / Serper / Tavily 在 TT 无对应路由，直接说明且不出网', async () => {
    const { client, fetch } = client_ACU(() => textResponse_ACU(''));
    for (const provider of ['duckduckgo', 'serper', 'tavily'] as const) {
      const result = await client.webSearch('q', { searchProvider: provider, searxngBaseUrl: '' });
      expect(result.hits).toEqual([]);
      expect(result.note).toContain('/api/search/searxng');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('web_read 先过域名策略；策略放行后因 TT 无抓取路由返回不可用且不出网', async () => {
    const { client, fetch } = client_ACU(() => textResponse_ACU('<html><title>页</title><body><p>正文</p></body></html>'));
    const blocked = await client.webRead('http://192.168.1.1/admin', { blockedDomains: '', pageCharLimit: 100 });
    expect(blocked.status).toBe('blocked');
    expect(fetch).not.toHaveBeenCalled();
    const page = await client.webRead('https://fandom.example/wiki/X', { blockedDomains: '', pageCharLimit: 5 });
    expect(page.status).toBe('unavailable');
    expect(page.note).toContain('/api/search/visit');
    expect(fetch).not.toHaveBeenCalled();
  });
});
