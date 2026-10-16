// service/ai/direct-send.ts — 自定义 API 的两种发送方式
//
// 经酒馆转接发送（默认）：请求体按 TT 自定义连接的契约交给 /api/backends/chat-completions/generate，
// 由酒馆后端按接口协议改写并转发。
// 数据库直接发送：插件在浏览器里直接请求预设端点，按接口协议自己组装上游请求体，
// 非流式回复归一成 OpenAI 形态，流式回复原样交给既有 SSE 解析（各协议的增量事件已识别）。
// 改写口径对照 TT dev 的自定义连接（payload/custom.rs 及各协议 builder）：
// 附加主体参数在协议转换后浅合并、排除主体参数最后删除；Gemini 关闭安全过滤。
// 与转接的有意差别：开头连续的 system 进协议的系统提示字段（TT 自定义连接默认把 system 当 user 发），
// 中部 system 按 user 发；不做提示词后处理，消息按原顺序发出。
// 直接发送不带宿主请求头（CSRF 令牌只给酒馆后端），也不带 Cookie。

import { parse as parseYaml_ACU } from 'yaml';
import { getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';

const TAVERN_GENERATE_URL_ACU = '/api/backends/chat-completions/generate';
const ANTHROPIC_VERSION_ACU = '2023-06-01';
const GEMINI_API_VERSION_ACU = 'v1beta';

/** 走直接发送的请求体登记表：请求体对象本身不带任何额外字段，转接时逐字不变。 */
const directSendBodies_ACU = new WeakSet<object>();

export function markDirectSendBody_ACU(body: object): void {
  directSendBodies_ACU.add(body);
}

export function isDirectSendBody_ACU(body: unknown): boolean {
  return !!body && typeof body === 'object' && directSendBodies_ACU.has(body as object);
}

type AnyRecord_ACU = Record<string, any>;
type DirectFormat_ACU = 'openai_compat' | 'openai_responses' | 'claude_messages' | 'gemini_interactions' | 'gemini_generate_content';

const DIRECT_FORMATS_ACU: readonly DirectFormat_ACU[] = ['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions', 'gemini_generate_content'];

function isRecord_ACU(value: unknown): value is AnyRecord_ACU {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function directFormat_ACU(value: unknown): DirectFormat_ACU {
  return DIRECT_FORMATS_ACU.includes(value as DirectFormat_ACU) ? (value as DirectFormat_ACU) : 'openai_compat';
}

function textOf_ACU(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return content === undefined || content === null ? '' : String(content);
}

function argumentsObject_ACU(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function stripTrailingSlash_ACU(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function appendGoogleApiPath_ACU(base: string, suffix: string): string {
  const root = stripTrailingSlash_ACU(base);
  const path = suffix.replace(/^\/+/, '');
  return /\/v1(?:beta)?$/.test(root) ? `${root}/${path}` : `${root}/${GEMINI_API_VERSION_ACU}/${path}`;
}

function geminiMajorVersion_ACU(model: string): number | null {
  const match = model.toLowerCase().match(/gemini-(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseIncludeBody_ACU(raw: unknown): AnyRecord_ACU {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = parseYaml_ACU(text);
  } catch {
    throw new Error('附加主体参数不是合法的 YAML，数据库直接发送未发出请求。');
  }
  if (isRecord_ACU(parsed)) return parsed;
  if (Array.isArray(parsed)) return Object.assign({}, ...parsed.filter(isRecord_ACU));
  throw new Error('附加主体参数必须是 YAML 对象，数据库直接发送未发出请求。');
}

function parseExcludeKeys_ACU(raw: unknown): string[] {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return [];
  try {
    const parsed = parseYaml_ACU(text);
    if (Array.isArray(parsed)) return parsed.map(key => String(key).trim()).filter(Boolean);
    if (isRecord_ACU(parsed)) return Object.keys(parsed);
  } catch { /* 按逗号分隔兜底 */ }
  return text.split(/[,\n]/).map(key => key.replace(/^-\s*/, '').trim()).filter(Boolean);
}

/** 附加请求标头逐行 `Name: Value`；后写的同名标头覆盖先写的（用户行在密钥行之后）。 */
function parseHeaderLines_ACU(raw: unknown): Array<[string, string]> {
  const text = typeof raw === 'string' ? raw : '';
  const headers: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error(`附加请求标头格式无效（应为 Header: Value）：${line.trim().slice(0, 40)}`);
    headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return headers;
}

/** 开头连续的 system 拆出来；其余消息里的 system 按 user 发。 */
function splitLeadingSystem_ACU(messages: AnyRecord_ACU[]): { system: string[]; rest: AnyRecord_ACU[] } {
  const system: string[] = [];
  let index = 0;
  while (index < messages.length && messages[index]?.role === 'system') {
    const text = textOf_ACU(messages[index].content);
    if (text.trim()) system.push(text);
    index += 1;
  }
  return { system, rest: messages.slice(index) };
}

function openAiTools_ACU(tools: unknown): AnyRecord_ACU[] {
  return Array.isArray(tools) ? tools.filter(tool => isRecord_ACU(tool) && isRecord_ACU(tool.function) && tool.function.name) : [];
}

function toolChoiceName_ACU(choice: unknown): string | null {
  return isRecord_ACU(choice) && isRecord_ACU(choice.function) && typeof choice.function.name === 'string' ? choice.function.name : null;
}

function buildOpenAiCompat_ACU(bridge: AnyRecord_ACU): AnyRecord_ACU {
  const body: AnyRecord_ACU = {
    messages: bridge.messages,
    model: bridge.model,
    max_tokens: bridge.max_tokens,
    temperature: bridge.temperature,
    top_p: bridge.top_p,
    stream: bridge.stream === true,
  };
  if (bridge.stream === true) body.stream_options = { include_usage: true };
  if (bridge.reasoning_effort !== undefined) body.reasoning_effort = bridge.reasoning_effort;
  const tools = openAiTools_ACU(bridge.tools);
  if (tools.length) {
    body.tools = tools;
    if (bridge.tool_choice !== undefined) body.tool_choice = bridge.tool_choice;
  }
  return body;
}

function buildResponses_ACU(bridge: AnyRecord_ACU): AnyRecord_ACU {
  const input: AnyRecord_ACU[] = [];
  for (const message of bridge.messages as AnyRecord_ACU[]) {
    const text = textOf_ACU(message?.content);
    if (message?.role === 'assistant') {
      if (text.trim()) input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
      continue;
    }
    input.push({ role: message?.role === 'system' ? 'developer' : message?.role === 'developer' ? 'developer' : 'user', content: text });
  }
  const body: AnyRecord_ACU = {
    model: bridge.model,
    input,
    store: false,
    stream: bridge.stream === true,
    temperature: bridge.temperature,
    top_p: bridge.top_p,
    max_output_tokens: bridge.max_tokens,
  };
  if (bridge.reasoning_effort !== undefined) body.reasoning = { effort: bridge.reasoning_effort };
  const tools = openAiTools_ACU(bridge.tools);
  if (tools.length) {
    body.tools = tools.map(tool => ({ type: 'function', name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }));
    const name = toolChoiceName_ACU(bridge.tool_choice);
    if (name) body.tool_choice = { type: 'function', name };
    else if (bridge.tool_choice !== undefined) body.tool_choice = bridge.tool_choice;
  }
  return body;
}

function mergeConsecutiveRoles_ACU<T extends { role: string }>(items: T[], merge: (into: T, next: T) => void): T[] {
  const merged: T[] = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) merge(last, item);
    else merged.push(item);
  }
  return merged;
}

function buildClaude_ACU(bridge: AnyRecord_ACU): AnyRecord_ACU {
  const { system, rest } = splitLeadingSystem_ACU(bridge.messages as AnyRecord_ACU[]);
  const converted = rest.map(message => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: [{ type: 'text', text: textOf_ACU(message?.content) }] as AnyRecord_ACU[],
  }));
  const messages = mergeConsecutiveRoles_ACU(converted, (into, next) => { into.content.push(...next.content); });
  const body: AnyRecord_ACU = {
    model: bridge.model,
    max_tokens: bridge.max_tokens,
    stream: bridge.stream === true,
    messages: messages.length ? messages : [{ role: 'user', content: [{ type: 'text', text: '' }] }],
  };
  // 与 TT 同口径：采样参数只在偏离默认值 1 时发送（新 Claude 模型拒收 temperature 与 top_p 同时出现）。
  if (typeof bridge.temperature === 'number' && bridge.temperature !== 1) body.temperature = bridge.temperature;
  if (typeof bridge.top_p === 'number' && bridge.top_p !== 1) body.top_p = bridge.top_p;
  if (system.length) body.system = system.map(text => ({ type: 'text', text }));
  if (bridge.reasoning_effort !== undefined && bridge.reasoning_effort !== false) body.output_config = { effort: bridge.reasoning_effort };
  const tools = openAiTools_ACU(bridge.tools);
  if (tools.length) {
    body.tools = tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters ?? { type: 'object' } }));
    const name = toolChoiceName_ACU(bridge.tool_choice);
    if (name) body.tool_choice = { type: 'tool', name };
    else if (bridge.tool_choice === 'none') body.tool_choice = { type: 'none' };
    else if (bridge.tool_choice === 'required') body.tool_choice = { type: 'any' };
    else if (bridge.tool_choice !== undefined) body.tool_choice = { type: 'auto' };
  }
  return body;
}

function buildGeminiInteractions_ACU(bridge: AnyRecord_ACU): AnyRecord_ACU {
  const systemParts: string[] = [];
  const input: AnyRecord_ACU[] = [];
  for (const message of bridge.messages as AnyRecord_ACU[]) {
    const text = textOf_ACU(message?.content);
    if (message?.role === 'system' || message?.role === 'developer') {
      if (text.trim()) systemParts.push(text.trim());
    } else if (message?.role === 'assistant') {
      if (text.trim()) input.push({ type: 'model_output', content: [{ type: 'text', text }] });
    } else {
      input.push({ type: 'user_input', content: [{ type: 'text', text }] });
    }
  }
  const generationConfig: AnyRecord_ACU = {};
  if (typeof bridge.max_tokens === 'number' && bridge.max_tokens > 0) generationConfig.max_output_tokens = bridge.max_tokens;
  if (typeof bridge.reasoning_effort === 'string') generationConfig.thinking_level = bridge.reasoning_effort;
  const body: AnyRecord_ACU = { model: bridge.model, input, stream: bridge.stream === true, store: false };
  if (systemParts.length) body.system_instruction = systemParts.join('\n\n');
  const tools = openAiTools_ACU(bridge.tools);
  if (tools.length) {
    body.tools = tools.map(tool => ({ type: 'function', name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }));
    if (bridge.tool_choice === 'none' || bridge.tool_choice === 'auto') generationConfig.tool_choice = bridge.tool_choice;
    else if (bridge.tool_choice === 'required') generationConfig.tool_choice = 'any';
  }
  if (Object.keys(generationConfig).length) body.generation_config = generationConfig;
  return body;
}

const GEMINI_SAFETY_SETTINGS_ACU = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY']
  .map(category => ({ category, threshold: 'OFF' }));

function buildGeminiGenerateContent_ACU(bridge: AnyRecord_ACU): AnyRecord_ACU {
  const { system, rest } = splitLeadingSystem_ACU(bridge.messages as AnyRecord_ACU[]);
  const converted = rest.map(message => ({
    role: message?.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: textOf_ACU(message?.content) }] as AnyRecord_ACU[],
  }));
  const contents = mergeConsecutiveRoles_ACU(converted, (into, next) => { into.parts.push(...next.parts); });
  const generationConfig: AnyRecord_ACU = {};
  if (bridge.max_tokens !== undefined && bridge.max_tokens !== null) generationConfig.maxOutputTokens = bridge.max_tokens;
  if (bridge.temperature !== undefined && bridge.temperature !== null) generationConfig.temperature = bridge.temperature;
  if (bridge.top_p !== undefined && bridge.top_p !== null) generationConfig.topP = bridge.top_p;
  // Gemini 3 起用 thinkingLevel；2.x 只认 thinkingBudget，不猜预算，交给模型默认。
  const major = geminiMajorVersion_ACU(String(bridge.model || ''));
  if (typeof bridge.reasoning_effort === 'string' && (major === null || major >= 3)) {
    generationConfig.thinkingConfig = { thinkingLevel: bridge.reasoning_effort, includeThoughts: false };
  }
  const body: AnyRecord_ACU = {
    contents: contents.length ? contents : [{ role: 'user', parts: [{ text: '' }] }],
    generationConfig,
    safetySettings: GEMINI_SAFETY_SETTINGS_ACU.map(item => ({ ...item })),
  };
  if (system.length) body.systemInstruction = { parts: [{ text: system.join('\n\n') }] };
  const tools = openAiTools_ACU(bridge.tools);
  if (tools.length) {
    body.tools = [{ function_declarations: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }];
    const mode = bridge.tool_choice === 'none' ? 'NONE' : bridge.tool_choice === 'required' || toolChoiceName_ACU(bridge.tool_choice) ? 'ANY' : bridge.tool_choice === 'auto' ? 'AUTO' : null;
    if (mode) {
      const name = toolChoiceName_ACU(bridge.tool_choice);
      body.toolConfig = { functionCallingConfig: { mode, ...(name ? { allowedFunctionNames: [name] } : {}) } };
    }
  }
  return body;
}

export interface DirectProviderRequest_ACU {
  url: string;
  headers: Array<[string, string]>;
  body: AnyRecord_ACU;
  format: DirectFormat_ACU;
  stream: boolean;
}

/** 由 TT 契约请求体（buildCustomApiRequestBody_ACU 的产物）组装直接发送的上游请求。 */
export function buildDirectProviderRequest_ACU(bridge: AnyRecord_ACU): DirectProviderRequest_ACU {
  const base = String(bridge.reverse_proxy || '').trim();
  if (!base) throw new Error('数据库直接发送需要填写端点地址。');
  const format = directFormat_ACU(bridge.custom_api_format);
  const stream = bridge.stream === true;
  const messages = Array.isArray(bridge.messages) ? bridge.messages : [];
  const normalized = { ...bridge, messages };
  let body: AnyRecord_ACU;
  let url: string;
  switch (format) {
    case 'openai_responses':
      body = buildResponses_ACU(normalized);
      url = `${stripTrailingSlash_ACU(base)}/responses`;
      break;
    case 'claude_messages':
      body = buildClaude_ACU(normalized);
      url = `${stripTrailingSlash_ACU(base)}/messages`;
      break;
    case 'gemini_interactions':
      body = buildGeminiInteractions_ACU(normalized);
      url = appendGoogleApiPath_ACU(base, 'interactions');
      break;
    case 'gemini_generate_content': {
      body = buildGeminiGenerateContent_ACU(normalized);
      const rawModel = String(bridge.model || '').trim();
      const modelPath = rawModel.startsWith('models/') ? rawModel : `models/${rawModel}`;
      url = appendGoogleApiPath_ACU(base, `${modelPath}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`);
      break;
    }
    default:
      body = buildOpenAiCompat_ACU(normalized);
      url = `${stripTrailingSlash_ACU(base)}/chat/completions`;
  }
  for (const [key, value] of Object.entries(parseIncludeBody_ACU(bridge.custom_include_body))) body[key] = value;
  for (const key of parseExcludeKeys_ACU(bridge.custom_exclude_body)) delete body[key];
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];

  const apiKey = String(bridge.proxy_password || '');
  const headers: Array<[string, string]> = [['Content-Type', 'application/json']];
  if (format === 'claude_messages') {
    headers.push(['anthropic-version', ANTHROPIC_VERSION_ACU], ['anthropic-dangerous-direct-browser-access', 'true']);
    if (apiKey) headers.push(['x-api-key', apiKey]);
  } else if ((format === 'gemini_interactions' || format === 'gemini_generate_content') && apiKey) {
    headers.push(['x-goog-api-key', apiKey]);
  }
  headers.push(...parseHeaderLines_ACU(bridge.custom_include_headers));
  // 同名标头（不分大小写）后写的覆盖先写的，不叠加成逗号拼接的多值。
  const deduped = new Map<string, [string, string]>();
  for (const header of headers) {
    deduped.delete(header[0].toLowerCase());
    deduped.set(header[0].toLowerCase(), header);
  }
  return { url, headers: [...deduped.values()], body, format, stream };
}

/** 「加载模型」的直接发送请求：与生成请求同一鉴权口径（Claude x-api-key、Gemini x-goog-api-key 并带 Bearer，同 TT）。 */
export function buildDirectModelListRequest_ACU(apiUrl: string, apiKey: string, format: unknown, extraHeaders = ''): { url: string; headers: Array<[string, string]> } {
  const kind = directFormat_ACU(format);
  const url = kind === 'gemini_interactions' || kind === 'gemini_generate_content'
    ? appendGoogleApiPath_ACU(apiUrl, 'models')
    : `${stripTrailingSlash_ACU(apiUrl)}/models`;
  const headers: Array<[string, string]> = [['Accept', 'application/json']];
  if (kind === 'claude_messages') {
    headers.push(['anthropic-version', ANTHROPIC_VERSION_ACU], ['anthropic-dangerous-direct-browser-access', 'true']);
    if (apiKey) headers.push(['x-api-key', apiKey]);
  } else if ((kind === 'gemini_interactions' || kind === 'gemini_generate_content') && apiKey) {
    headers.push(['x-goog-api-key', apiKey]);
  }
  headers.push(...parseHeaderLines_ACU(extraHeaders));
  return { url, headers };
}

/** 直接发送连不上时给用户的统一说明（生成与加载模型共用）。 */
export function directUnreachableHint_ACU(url: string, reason: string): string {
  let host = url;
  try { host = new URL(url).host; } catch { /* 保留原地址 */ }
  return `数据库直接发送连不上 ${host}：${reason || '网络错误'}。多半是该服务商不允许网页直接访问（跨域），可在 API 预设里改回「经酒馆转接发送」。`;
}

function usageOf_ACU(raw: unknown): AnyRecord_ACU | undefined {
  if (!isRecord_ACU(raw)) return undefined;
  const prompt = raw.prompt_tokens ?? raw.input_tokens ?? raw.promptTokenCount ?? raw.total_input_tokens;
  const completion = raw.completion_tokens ?? raw.output_tokens ?? raw.candidatesTokenCount ?? raw.total_output_tokens;
  return { ...raw, ...(prompt !== undefined ? { prompt_tokens: prompt } : {}), ...(completion !== undefined ? { completion_tokens: completion } : {}) };
}

function toolCall_ACU(id: unknown, name: unknown, args: unknown): AnyRecord_ACU {
  return { id: typeof id === 'string' ? id : undefined, type: 'function', function: { name: String(name || ''), arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) } };
}

/** 各协议的非流式回复归一到 OpenAI Chat Completion 形态（正文、原生工具调用、用量）。 */
export function normalizeDirectProviderReply_ACU(data: unknown, format: DirectFormat_ACU): unknown {
  if (format === 'openai_compat' || !isRecord_ACU(data) || Array.isArray(data.choices)) return data;
  let content = '';
  const toolCalls: AnyRecord_ACU[] = [];
  let usage: AnyRecord_ACU | undefined;
  if (format === 'claude_messages') {
    for (const block of Array.isArray(data.content) ? data.content : []) {
      if (block?.type === 'text' && typeof block.text === 'string') content += block.text;
      else if (block?.type === 'tool_use') toolCalls.push(toolCall_ACU(block.id, block.name, block.input));
    }
    usage = usageOf_ACU(data.usage);
  } else if (format === 'openai_responses') {
    for (const item of Array.isArray(data.output) ? data.output : []) {
      if (item?.type === 'message') {
        for (const part of Array.isArray(item.content) ? item.content : []) {
          if (part?.type === 'output_text' && typeof part.text === 'string') content += part.text;
        }
      } else if (item?.type === 'function_call') {
        toolCalls.push(toolCall_ACU(item.call_id ?? item.id, item.name, item.arguments));
      }
    }
    if (!content && typeof data.output_text === 'string') content = data.output_text;
    usage = usageOf_ACU(data.usage);
  } else if (format === 'gemini_interactions') {
    const steps = Array.isArray(data.steps) ? data.steps : Array.isArray(data.outputs) ? data.outputs : [];
    for (const step of steps) {
      if (step?.type === 'model_output') content += textOf_ACU(step.content);
      else if (step?.type === 'text' && typeof step.text === 'string') content += step.text;
      else if (step?.type === 'function_call') toolCalls.push(toolCall_ACU(step.id ?? step.call_id, step.name, step.arguments));
    }
    usage = usageOf_ACU(data.usage);
  } else {
    const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
    for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
      if (typeof part?.text === 'string' && part.thought !== true) content += part.text;
      else if (isRecord_ACU(part?.functionCall)) toolCalls.push(toolCall_ACU(part.functionCall.id, part.functionCall.name, part.functionCall.args));
    }
    usage = usageOf_ACU(data.usageMetadata);
  }
  const message: AnyRecord_ACU = { role: 'assistant', content };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return { choices: [{ index: 0, message, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }], ...(usage ? { usage } : {}) };
}

/** 直接发送的连接层失败（多为服务商不允许网页跨域访问）：保留 TypeError 以沿用网络错误的重试判定。 */
function directNetworkError_ACU(error: unknown, url: string): unknown {
  if (!(error instanceof TypeError)) return error;
  return new TypeError(directUnreachableHint_ACU(url, error.message));
}

/**
 * 自定义 API 统一发送口：按请求体登记的发送方式走酒馆转接或直接发送。
 * 直接发送的非流式成功回复归一成 OpenAI 形态 JSON；流式与失败回复原样返回（失败体由调用方脱敏展示）。
 */
export async function sendChatCompletionBody_ACU(body: unknown, signal?: AbortSignal | null): Promise<Response> {
  if (!isDirectSendBody_ACU(body)) {
    return fetch(TAVERN_GENERATE_URL_ACU, {
      method: 'POST',
      redirect: 'error', // 307/308 会把 POST 原样重放到重定向目标：SSRF 守卫只校发起前 URL，禁止重定向
      headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal || undefined,
    });
  }
  const request = buildDirectProviderRequest_ACU(body as AnyRecord_ACU);
  let headers: Headers;
  try {
    headers = new Headers(request.headers);
  } catch (error: any) {
    throw new Error(`附加请求标头无效，数据库直接发送未发出请求：${String(error?.message || error)}`);
  }
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers,
      body: JSON.stringify(request.body),
      signal: signal || undefined,
    });
  } catch (error) {
    throw directNetworkError_ACU(error, request.url);
  }
  if (!response.ok || request.stream) return response;
  const raw = await response.text();
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return new Response(raw, { status: response.status, headers: { 'Content-Type': 'text/plain' } }); }
  return new Response(JSON.stringify(normalizeDirectProviderReply_ACU(data, request.format)), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
