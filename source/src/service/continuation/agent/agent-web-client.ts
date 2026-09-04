/**
 * service/continuation/agent/agent-web-client.ts — web-researcher 专用的出网客户端（TT 适配）
 *
 * TT 可行通道（P1）：
 * - 百科检索 / 精读：萌娘百科、中文/英文维基百科走 MediaWiki API（带 origin=* 的 CORS，
 *   TT 内网页（WebView）直连）。百度百科没有 CORS 头且需要上游酒馆服务器
 *   `/api/search/visit` 转发——TT 仅提供 `/api/search/searxng`，没有该路由，故不可用。
 * - 通用搜索：仅 SearXNG，经 TT 同源路由 POST /api/search/searxng（请求体
 *   { baseUrl, query } + 可选 { preferences, categories }，响应 text/html 结果页，
 *   见 TT tests/search-routes-contract.test.mjs）。
 *   DuckDuckGo（需 /visit 抓页）、Serper / Tavily（需上游 /api/search/<provider> 复用酒馆 key）
 *   在 TT 均无对应路由，故不可用。
 * - 任意网页抓取：需要上游 /api/search/visit，TT 未提供，webRead 只做域名策略判定后
 *   返回不可用说明，不发起任何请求。
 *
 * 能力标记（默认关闭、非死代码——每个分支都有测试覆盖）：
 * - AGENT_WEB_PROVIDER_SUPPORT_ACU：各搜索提供方是否可行；
 * - AGENT_ENCYCLOPEDIA_SUPPORT_ACU：各百科来源是否可行。
 * 不可行通道返回可操作的问题说明（not throw），子代理看到后换通道重搜，而不是让整次派工崩掉。
 *
 * 出网只发生在这里，且只由 web-researcher 调用。所有 URL 先过域名黑名单（内网、酒馆自身、
 * 用户追加），所有响应都截断到设置上限，所有失败都以文本结果返回而不是抛错。
 *
 * 真机实测登记：MediaWiki 直连在 jsdom 下以 mock fetch 覆盖；真实 TT WebView
 *（origin tauri://localhost，理论上 ACAO:* 放行）是否可达，待真机实测确认。
 */

import { getHostRequestHeaders_ACU } from '../../../data/gateways/ai-gateway';
import type { ContinuationWebResearchSettings_ACU, ContinuationWebSearchProvider_ACU } from '../model';
import type { AgentWebRefSource_ACU, AgentWebRefStatus_ACU } from './agent-model';

/** 百科来源（不含泛网页）。baidu 在 TT 不可用，见 AGENT_ENCYCLOPEDIA_SUPPORT_ACU。 */
export type AgentEncyclopediaSource_ACU = Exclude<AgentWebRefSource_ACU, 'web'>;

export const AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU: Record<AgentEncyclopediaSource_ACU, string> = {
  moegirl: '萌娘百科',
  wikipedia_zh: '中文维基百科',
  wikipedia_en: '英文维基百科',
  baidu: '百度百科',
};

/**
 * TT 通道能力标记。true=本客户端真实实现并有测试覆盖；false=需要上游酒馆转发路由，
 * TT 当前未提供，调用时返回不可用说明而不出网。
 */
export const AGENT_WEB_PROVIDER_SUPPORT_ACU: Record<ContinuationWebSearchProvider_ACU, boolean> = {
  searxng: true,
  duckduckgo: false,
  serper: false,
  tavily: false,
};

/** 各百科来源是否可在 TT 直连。baidu 需上游 /api/search/visit 转发，TT 未提供。 */
export const AGENT_ENCYCLOPEDIA_SUPPORT_ACU: Record<AgentEncyclopediaSource_ACU, boolean> = {
  moegirl: true,
  wikipedia_zh: true,
  wikipedia_en: true,
  baidu: false,
};

/**
 * SearXNG 可选透传键（TT SearxngSearchRequestDto.preferences/categories，Option+default；
 * search-routes.js 全透传 dto，prepare_request 以 optional_text 拼参，空即不拼）。
 * 有值才发，空不填——缺省不发时 TT 按 None 处理，与只发 { baseUrl, query } 等价。
 */
export interface SearxngSearchOptions_ACU {
  preferences?: string;
  categories?: string;
}

/** 单次出网请求超时。百科 API 通常 1–3 秒；SearXNG 经同源路由给宽一点。 */
const WEB_REQUEST_TIMEOUT_MS_ACU = 20000;
/** 搜索结果条数上限：再多也只是让模型多花 token 挑选。 */
const SEARCH_RESULT_LIMIT_ACU = 8;
/** 百科检索候选条数上限。 */
const ENCYCLOPEDIA_CANDIDATE_LIMIT_ACU = 6;

const MEDIAWIKI_ENDPOINTS_ACU: Record<Exclude<AgentEncyclopediaSource_ACU, 'baidu'>, { api: string; page: string }> = {
  moegirl: { api: 'https://zh.moegirl.org.cn/api.php', page: 'https://zh.moegirl.org.cn/' },
  wikipedia_zh: { api: 'https://zh.wikipedia.org/w/api.php', page: 'https://zh.wikipedia.org/wiki/' },
  wikipedia_en: { api: 'https://en.wikipedia.org/w/api.php', page: 'https://en.wikipedia.org/wiki/' },
};

/** 始终拦截的主机模式：本机、内网、链路本地、.local 与酒馆自身。 */
const ALWAYS_BLOCKED_HOST_PATTERNS_ACU: readonly RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
];

/** 一条搜索结果。 */
export interface AgentWebSearchHit_ACU {
  title: string;
  url: string;
  snippet: string;
}

/** 一条百科候选词条。 */
export interface AgentEncyclopediaCandidate_ACU {
  source: AgentEncyclopediaSource_ACU;
  title: string;
  url: string;
  snippet: string;
}

/** 一次抓取到的页面。给子代理的工具结果与契约回填共用同一份对象。 */
export interface AgentFetchedPage_ACU {
  source: AgentWebRefSource_ACU;
  title: string;
  url: string;
  text: string;
  status: AgentWebRefStatus_ACU;
  /** 抓取失败或被拦时的原因，给模型看。 */
  note: string;
}

export interface AgentWebClientDependencies_ACU {
  fetch: typeof fetch;
  hostHeaders: () => Record<string, string>;
  now: () => number;
}

const defaultDependencies_ACU: AgentWebClientDependencies_ACU = {
  fetch: (input, init) => globalThis.fetch(input, init),
  hostHeaders: getHostRequestHeaders_ACU,
  now: () => Date.now(),
};

/**
 * fix5 附加式守卫：&#N; / &#xN; 实体的码点超出 0..0x10FFFF（或非安全整数）时，
 * String.fromCodePoint 会抛 RangeError 并炸掉整次派工（本函数处于搜索/百科正文
 * 抽取链路，外层无 try/catch 兜底）。越界/非法实体按「无法解码」处理返回空串。
 */
function safeFromCodePoint_ACU(code: string, radix: 10 | 16): string {
  const cp = Number.parseInt(code, radix);
  return Number.isSafeInteger(cp) && cp >= 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : '';
}

function decodeHtmlEntities_ACU(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => safeFromCodePoint_ACU(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => safeFromCodePoint_ACU(code, 16));
}

function stripTags_ACU(html: string): string {
  // 百科页面的上标是引用角标（<sup>4</sup>），进正文只会变成噪音数字。
  const withoutSup = html.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '');
  // 行内标签（加粗、链接、高亮）直接去掉，不能变成空格把一个词拆成两半；块级标签才换成空格。
  const withoutInline = withoutSup.replace(/<\/?(b|i|em|strong|span|a|mark|u|small|font|code)\b[^>]*>/gi, '');
  return decodeHtmlEntities_ACU(withoutInline.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * 折叠 MediaWiki extract 与网页正文里的空白：萌娘百科的模板表格会残留成片的制表符与空行。
 * 保留段落边界（双换行）以便按行编入搜索索引。
 */
export function collapseWhitespace_ACU(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 把整页 HTML 抽成可读纯文本：去脚本样式导航，块级标签换行，去标签解实体，折叠空白。
 * 不追求 Readability 级别的正文提取——原文按字数截断后由模型自己挑重点。
 * @param html 页面 HTML
 * @returns { title, text }
 */
export function extractReadableText_ACU(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripTags_ACU(titleMatch[1]) : '';
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|dd|dt)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  const text = collapseWhitespace_ACU(decodeHtmlEntities_ACU(body.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' '));
  return { title, text };
}

/**
 * 截断到字数上限并标注；上限以内原样返回。
 */
export function truncateWebText_ACU(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n（原文超出 ${limit} 字上限，已截断；未展示部分不代表不存在）`;
}

/**
 * 解析用户追加的域名黑名单：逗号 / 换行 / 空白分隔，小写，去掉协议与路径。
 */
export function parseBlockedDomains_ACU(raw: string): string[] {
  return String(raw ?? '')
    .split(/[\n,，;；\s]+/)
    .map(item => item.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
}

/**
 * 判定 URL 是否允许抓取。
 * @returns 允许时返回 null；否则返回拒绝原因
 */
export function evaluateWebUrlPolicy_ACU(rawUrl: string, blockedDomains: readonly string[], hostOrigin?: string): string | null {
  let url: URL;
  try {
    url = new URL(String(rawUrl ?? '').trim());
  } catch {
    return 'URL 格式非法（必须是完整的 http(s) 地址）';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '只允许 http / https 协议';
  if (url.port && url.port !== '80' && url.port !== '443') return '不允许非标准端口';
  const host = url.hostname.toLowerCase();
  // fix4 直连 IP 拦截补进制变体：WHATWG URL 会把纯整数/十六进制/短点分 host 规范化为
  // 点分四段（原正则可拦），但宿主 URL 实现不规范时可能保留原文——按字面兜底拒绝。
  // 此类 host 均无合法公网域名用例，普通域名（含数字标签）不会命中。
  if (
    /^\d+(\.\d+){0,3}$/.test(host)   // 点分 1~4 段（含原四段形态）、纯十进制整数（如 http://2130706433/）与 1.2.3/1.2 等不足四段形式
    || /^0[xX]/.test(host)           // 十六进制形态（如 0x7f000001、0x7f.0x0.0x0.0x1）
    || host.includes(':')            // IPv6 字面量（URL.hostname 已去括号）
  ) return '不允许直接访问 IP 地址';
  if (ALWAYS_BLOCKED_HOST_PATTERNS_ACU.some(pattern => pattern.test(host))) return '内网或本机地址被拦截';
  if (hostOrigin) {
    try {
      if (new URL(hostOrigin).hostname.toLowerCase() === host) return '不允许抓取酒馆服务器自身';
    } catch { /* 宿主 origin 不可解析时忽略该项 */ }
  }
  for (const blocked of blockedDomains) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return `域名 ${host} 在黑名单内`;
  }
  return null;
}

function encyclopediaPageUrl_ACU(source: Exclude<AgentEncyclopediaSource_ACU, 'baidu'>, title: string): string {
  return `${MEDIAWIKI_ENDPOINTS_ACU[source].page}${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** 客户端实例。无状态：页面缓存由子代理运行时按派工持有。 */
export class AgentWebClient_ACU {
  constructor(private readonly dependencies: AgentWebClientDependencies_ACU = defaultDependencies_ACU) {}

  /** 出网 fetch（百科 API 与 TT 同源路由），带超时。 */
  private async fetchDirect_ACU(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_REQUEST_TIMEOUT_MS_ACU);
    try {
      return await this.dependencies.fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchMediawikiJson_ACU(source: Exclude<AgentEncyclopediaSource_ACU, 'baidu'>, params: Record<string, string>): Promise<{ ok: true; data: any } | { ok: false; reason: string }> {
    const search = new URLSearchParams({ ...params, format: 'json', origin: '*', utf8: '1' });
    const url = `${MEDIAWIKI_ENDPOINTS_ACU[source].api}?${search.toString()}`;
    try {
      const response = await this.fetchDirect_ACU(url, { method: 'GET' });
      if (!response.ok) return { ok: false, reason: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 返回 HTTP ${response.status}` };
      const data = await response.json();
      if (data && typeof data === 'object' && data.error) {
        return { ok: false, reason: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} API 错误：${String(data.error.info ?? data.error.code ?? '未知')}` };
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, reason: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 请求失败（网络不可达或被浏览器拦截）：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 在一个百科来源里检索候选词条。
   * 萌娘百科关闭了 list=search，改用 opensearch（前缀匹配，返回标题与链接）；维基用全文 search。
   * 百度百科需要上游 /api/search/visit 转发，TT 未提供该路由，直接返回不可用说明。
   */
  async searchEncyclopedia(source: AgentEncyclopediaSource_ACU, query: string): Promise<{ candidates: AgentEncyclopediaCandidate_ACU[]; note: string }> {
    const trimmed = query.trim();
    if (!trimmed) return { candidates: [], note: '检索词为空' };
    if (source === 'baidu') {
      return { candidates: [], note: '百度百科需要经酒馆服务器转发（上游 /api/search/visit），TT 当前未提供该路由；请用萌娘百科 / 维基百科或 SearXNG 通道' };
    }
    if (source === 'moegirl') {
      const result = await this.fetchMediawikiJson_ACU(source, { action: 'opensearch', search: trimmed, limit: String(ENCYCLOPEDIA_CANDIDATE_LIMIT_ACU), redirects: 'resolve' });
      if (result.ok === false) return { candidates: [], note: result.reason };
      const titles: unknown = Array.isArray(result.data) ? result.data[1] : [];
      const urls: unknown = Array.isArray(result.data) ? result.data[3] : [];
      const list = Array.isArray(titles) ? titles : [];
      const candidates = list.map((title, index) => ({
        source,
        title: String(title),
        url: Array.isArray(urls) && typeof urls[index] === 'string' ? urls[index] : encyclopediaPageUrl_ACU(source, String(title)),
        snippet: '',
      }));
      return { candidates, note: candidates.length ? '' : '萌娘百科 opensearch 无候选（它按标题前缀匹配，试试角色全名、作品名或去掉修饰词）' };
    }
    const result = await this.fetchMediawikiJson_ACU(source, { action: 'query', list: 'search', srsearch: trimmed, srlimit: String(ENCYCLOPEDIA_CANDIDATE_LIMIT_ACU) });
    if (result.ok === false) return { candidates: [], note: result.reason };
    const hits: unknown = result.data?.query?.search;
    const candidates = (Array.isArray(hits) ? hits : []).flatMap(hit => {
      const title = typeof hit?.title === 'string' ? hit.title : '';
      return title ? [{ source, title, url: encyclopediaPageUrl_ACU(source, title), snippet: stripTags_ACU(String(hit.snippet ?? '')) }] : [];
    });
    return { candidates, note: candidates.length ? '' : `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 无命中` };
  }

  /**
   * 精读一个百科词条的纯文本正文。
   * @param source 百科来源
   * @param title 词条标题（可来自 searchEncyclopedia 的候选）
   * @param charLimit 原文字数上限
   */
  async readEncyclopedia(source: AgentEncyclopediaSource_ACU, title: string, charLimit: number): Promise<AgentFetchedPage_ACU> {
    const trimmed = title.trim();
    if (source === 'baidu') {
      return { source, title: trimmed, url: `https://baike.baidu.com/item/${encodeURIComponent(trimmed)}`, text: '', status: 'unavailable', note: '百度百科需要经酒馆服务器转发（上游 /api/search/visit），TT 当前未提供该路由；请用萌娘百科 / 维基百科或 SearXNG 通道' };
    }
    const url = encyclopediaPageUrl_ACU(source, trimmed || title);
    if (!trimmed) return { source, title: '', url, text: '', status: 'unavailable', note: '词条标题为空' };
    const result = await this.fetchMediawikiJson_ACU(source, { action: 'query', prop: 'extracts', explaintext: '1', exlimit: '1', exsectionformat: 'plain', redirects: '1', titles: trimmed });
    if (result.ok === false) return { source, title: trimmed, url, text: '', status: 'unavailable', note: result.reason };
    const pages = result.data?.query?.pages;
    const page = pages && typeof pages === 'object' ? Object.values(pages as Record<string, any>)[0] : null;
    if (!page || page.missing !== undefined || typeof page.extract !== 'string') {
      return { source, title: trimmed, url, text: '', status: 'unavailable', note: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 没有名为「${trimmed}」的词条；先用 encyclopedia_search 找准确标题` };
    }
    const resolvedTitle = typeof page.title === 'string' && page.title ? page.title : trimmed;
    const text = collapseWhitespace_ACU(page.extract);
    if (!text) return { source, title: resolvedTitle, url: encyclopediaPageUrl_ACU(source, resolvedTitle), text: '', status: 'unavailable', note: '词条存在但正文为空（可能是消歧义页或纯模板页）' };
    return { source, title: resolvedTitle, url: encyclopediaPageUrl_ACU(source, resolvedTitle), text: truncateWebText_ACU(text, charLimit), status: 'ok', note: '' };
  }

  /**
   * 通用网页搜索。TT 仅 SearXNG 可行（经同源路由 POST /api/search/searxng，
   * 请求体 { baseUrl, query } + 可选 { preferences, categories }，响应为 text/html 结果页）。
   * @param query 检索词
   * @param settings 网页检索设置（提供方、SearXNG 地址与可选透传键）
   */
  async webSearch(query: string, settings: Pick<ContinuationWebResearchSettings_ACU, 'searchProvider' | 'searxngBaseUrl'> & SearxngSearchOptions_ACU): Promise<{ hits: AgentWebSearchHit_ACU[]; note: string }> {
    const trimmed = query.trim();
    if (!trimmed) return { hits: [], note: '检索词为空' };
    const provider: ContinuationWebSearchProvider_ACU = settings.searchProvider;
    if (provider === 'searxng') return this.searchSearxng_ACU(trimmed, settings.searxngBaseUrl, settings);
    return { hits: [], note: `${provider} 需要酒馆服务器「网页搜索」转发（上游 /api/search/${provider}），TT 仅提供 /api/search/searxng；请把搜索引擎切换为 SearXNG（自建或公共实例）后再搜` };
  }

  private async searchSearxng_ACU(query: string, baseUrl: string, options: SearxngSearchOptions_ACU = {}): Promise<{ hits: AgentWebSearchHit_ACU[]; note: string }> {
    if (!baseUrl.trim()) return { hits: [], note: 'SearXNG 实例地址未配置（续写设置 → 网页检索 → SearXNG 实例地址，如 https://searx.example.org；可自建实例或选用公共实例）' };
    try {
      // TT DTO 全透传（见 TT tests/search-routes-contract.test.mjs 三键断言）：
      // preferences/categories 为 Option，有值才填，空（或全空白）不填。
      const body: Record<string, string> = { baseUrl: baseUrl.trim(), query };
      const preferences = options.preferences?.trim();
      if (preferences) body.preferences = preferences;
      const categories = options.categories?.trim();
      if (categories) body.categories = categories;
      const response = await this.fetchDirect_ACU('/api/search/searxng', {
        method: 'POST',
        headers: { ...this.dependencies.hostHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) return { hits: [], note: `SearXNG 请求失败（HTTP ${response.status}）：实例地址可能填错、实例离线，或实例拒绝了该查询` };
      return { hits: parseSearxngHtml_ACU(await response.text()), note: '' };
    } catch (error) {
      return { hits: [], note: `SearXNG 请求异常：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 抓取任意网页。TT 未提供通用网页抓取路由（上游 /api/search/visit 在 TT 不存在），
   * 因此只做域名策略判定：被拦的按 blocked 返回，其余按 unavailable 返回 TT 说明，不发起任何请求。
   * @param url 目标地址
   * @param settings 黑名单与字数上限
   * @param hostOrigin 酒馆自身 origin，用于拒绝抓自己
   */
  async webRead(url: string, settings: Pick<ContinuationWebResearchSettings_ACU, 'blockedDomains' | 'pageCharLimit'>, hostOrigin?: string): Promise<AgentFetchedPage_ACU> {
    const trimmed = String(url ?? '').trim();
    const denied = evaluateWebUrlPolicy_ACU(trimmed, parseBlockedDomains_ACU(settings.blockedDomains), hostOrigin);
    if (denied) return { source: 'web', title: '', url: trimmed, text: '', status: 'blocked', note: denied };
    return { source: 'web', title: '', url: trimmed, text: '', status: 'unavailable', note: 'TT 当前未提供通用网页抓取路由（上游 /api/search/visit 在 TT 不存在），无法抓取任意网页；百科词条请用 encyclopedia_read，站外发现请用 web_search（SearXNG）后定位对应百科词条精读' };
  }
}

/** 解析 SearXNG 结果页：`article.result` 内 `h3 > a` 为标题链接，`p.content` 为摘要。 */
export function parseSearxngHtml_ACU(html: string): AgentWebSearchHit_ACU[] {
  const hits: AgentWebSearchHit_ACU[] = [];
  const blocks = html.split(/<article[^>]*class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const anchor = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = decodeHtmlEntities_ACU(anchor[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const content = /<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    hits.push({ title: stripTags_ACU(anchor[2]), url, snippet: stripTags_ACU(content?.[1] ?? '') });
    if (hits.length >= SEARCH_RESULT_LIMIT_ACU) break;
  }
  return hits;
}

/** 按设置得到启用的百科来源列表；全部关闭时返回空数组，由调用方给出提示。 */
export function enabledEncyclopediaSources_ACU(settings: Pick<ContinuationWebResearchSettings_ACU, 'sources'>): AgentEncyclopediaSource_ACU[] {
  const list: AgentEncyclopediaSource_ACU[] = [];
  if (settings.sources.moegirl) list.push('moegirl');
  if (settings.sources.wikipediaZh) list.push('wikipedia_zh');
  if (settings.sources.wikipediaEn) list.push('wikipedia_en');
  if (settings.sources.baidu) list.push('baidu');
  return list;
}
