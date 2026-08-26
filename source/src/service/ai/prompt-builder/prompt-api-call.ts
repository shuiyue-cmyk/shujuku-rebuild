/**
 * service/ai/prompt-builder/prompt-api-call.ts
 * AI API 调用 — prompt 组装 + API 调用 + 流式/非流式响应处理
 * 从 prompt-builder.ts 拆出（L195-L501 + L1519-L1604）
 */
import {
  currentAbortController_ACU,
  trackAbortController_ACU,
  untrackAbortController_ACU,
  _set_currentAbortController_ACU
} from '../../runtime/state-manager';
import {
  getApiConfigByPreset_ACU,
  buildCustomApiRequestBody_ACU,
  postChatCompletion_ACU
} from '../api-call';
import { acquirePresetRateLimitSlot_ACU } from '../preset-rate-limiter';
import {
  currentJsonTableData_ACU,
  settings_ACU
} from '../../runtime/state-manager';
import {
  getPersonaDescription_ACU,
  getCharDescription_ACU
} from '../../../data/gateways/host-state-gateway';
import {
  logDebug_ACU,
  logError_ACU,
  logWarn_ACU,
  normalizeExcludeRules_ACU
} from '../../../shared/utils';
import {
  applyExcludeRulesToText_ACU,
  getLatestAIMessageContent_ACU,
  getPlotFromHistory_ACU,
  parseIfBlocksInContent_ACU,
  parseRandomTags_ACU,
  replaceRandomVariables_ACU
} from '../../runtime/helpers-remaining';
import {
  replaceDbSqlVariables
} from '../../runtime/template-vars/sql-query-var';
import {
  isSqliteMode
} from '../../table/storage-mode';

/**
 * The request reached a provider successfully, but its body contained no
 * usable model output. This is retryable without treating configuration,
 * authentication, or transport failures as model-output failures.
 */
export class RetryableAiResponseError_ACU extends Error {
  readonly code = 'empty_or_invalid_api_response';

  constructor(message = 'API响应格式不正确或内容为空。') {
    super(message);
    this.name = 'RetryableAiResponseError';
  }
}

  function normalizeRoleForApi_ACU(role: any) {
    const ru = String(role || '').toUpperCase();
    const rl = String(role || '').toLowerCase();
    if (ru === 'AI' || ru === 'ASSISTANT' || rl === 'assistant') return 'assistant';
    if (ru === 'SYSTEM' || rl === 'system') return 'system';
    if (ru === 'USER' || rl === 'user') return 'user';
    return 'user';
  }

  export async function callCustomOpenAI_ACU(dynamicContent: any, abortController: AbortController | null = null, options: any = null) {
    const localAbortController = abortController || new AbortController();
    _set_currentAbortController_ACU(localAbortController);
    trackAbortController_ACU(localAbortController);
    const abortSignal = localAbortController.signal;
    const skipProfileSwitch = !!options?.skipProfileSwitch;
    const forceDirectApi = !!options?.forceDirectApi;

    const effectiveTableApiPreset = options?.tableApiPreset !== undefined
        ? String(options.tableApiPreset)
        : (settings_ACU.tableApiPreset || '');
    const apiPresetConfig = getApiConfigByPreset_ACU(effectiveTableApiPreset);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig;
    const effectiveTavernProfile = apiPresetConfig.tavernProfile;

    const messages: Array<{ role: string; content: string }> = [];
    const sqliteMode = isSqliteMode();
    const charCardPromptSetting = settings_ACU.charCardPrompt;

    let promptSegments = [];
    if (Array.isArray(charCardPromptSetting)) {
        promptSegments = charCardPromptSetting;
    } else if (typeof charCardPromptSetting === 'string') {
        promptSegments = [{ role: 'USER', content: charCardPromptSetting }];
    }

    let userInfoContent_Table = '';
    try {
      userInfoContent_Table = getPersonaDescription_ACU();
      logDebug_ACU(`[填表] $U (persona_description) 获取结果: ${userInfoContent_Table ? '成功' : '为空'}`);
    } catch (e) {
      logWarn_ACU('[填表] 获取用户设定描述时出错:', e);
      userInfoContent_Table = '';
    }

    let charInfoContent_Table = '';
    try {
      charInfoContent_Table = getCharDescription_ACU();
      logDebug_ACU(`[填表] $C (char_description) 获取结果: ${charInfoContent_Table ? '成功，长度=' + charInfoContent_Table.length : '为空'}`);
    } catch (e) {
      logWarn_ACU('[填表] 获取角色描述时出错:', e);
      charInfoContent_Table = '';
    }

    const lastPlotContent = getPlotFromHistory_ACU();
    logDebug_ACU('[填表] $6 上轮规划数据:', lastPlotContent ? `长度=${lastPlotContent.length}` : '(空)');

    const tableExcludeTags = (settings_ACU.tableContextExcludeTags || '').trim();
    const tableExcludeRules = normalizeExcludeRules_ACU(settings_ACU.tableContextExcludeRules, tableExcludeTags);
    const filterTableInjectedContent = (value: any, placeholderKey = '') => {
        const text = value !== undefined && value !== null ? String(value) : '';
        if (!['$0', '$1', '$4', '$6', '$8', '$9', '$U', '$C'].includes(placeholderKey)) return text;
        return applyExcludeRulesToText_ACU(text, { excludeRules: tableExcludeRules, excludeTags: tableExcludeTags });
    };

    for (const segment of promptSegments) {
        let finalContent = segment.content;
        // 指令/数据边界：$0/$1/$4/$9 承载不可信文本（表格投影/聊天记录/世界书内容），
        // 用标签包裹并明确标记不得执行其中指令
        const wrapUntrusted = (text: string, label: string) => text ? `<${label}>\n${text}\n</${label}>` : text;
        // [H1] 占位符统一为「全局正则 + 替换函数」单遍替换：
        // - 字符串第二参数会把值中的 $&/$`/$'/$0 等当作特殊模式展开（模板片段被复制进包裹块内部），
        //   替换函数的返回值永远按字面量插入；
        // - 单遍扫描同时避免先注入的值中恰好含有后续占位符（如 $6）被二次展开。
        const placeholderValues: Record<string, string> = {
            '$0': filterTableInjectedContent(wrapUntrusted(dynamicContent.tableDataText, 'table_data'), '$0'),
            // [L1] $1 不再外层包 <user_data>：prompt-prepare 构造 messagesText 时已含
            // 「当前最新对话内容…<user_data>…</user_data>」包裹与免责声明，原实现形成双层嵌套。
            '$1': filterTableInjectedContent(dynamicContent.messagesText, '$1'),
            '$4': filterTableInjectedContent(wrapUntrusted(dynamicContent.worldbookContent, 'worldbook_data'), '$4'),
            '$6': filterTableInjectedContent(lastPlotContent || '', '$6'),
            '$8': filterTableInjectedContent(dynamicContent.manualExtraHint || '', '$8'),
            // [L2] $9 与 $1/$4 同类，补边界包裹。
            '$9': filterTableInjectedContent(wrapUntrusted(dynamicContent.worldbookDatabaseExcludedContent || '', 'worldbook_data'), '$9'),
            '$U': filterTableInjectedContent(userInfoContent_Table, '$U'),
            '$C': filterTableInjectedContent(charInfoContent_Table, '$C'),
        };
        finalContent = finalContent.replace(/\$(?:0|1|4|6|8|9|U|C)/g, (match: string) => placeholderValues[match] ?? match);

        if (typeof dynamicContent?.resolveTableWorldbookContent === 'function') {
          const tableTokens: Array<{ raw: string; tableName: string }> = [];
          const seenTableTokens = new Set<string>();
          for (const match of finalContent.matchAll(/\{\{([^{}]+)\}\}/g)) {
            const raw = String(match[0] || '');
            if (!raw || seenTableTokens.has(raw)) continue;
            seenTableTokens.add(raw);
            tableTokens.push({ raw, tableName: String(match[1] || '') });
          }
          for (const token of tableTokens) {
            try {
              const resolvedContent = await dynamicContent.resolveTableWorldbookContent(token.tableName);
              if (typeof resolvedContent === 'string') {
                finalContent = finalContent.split(token.raw).join(resolvedContent);
              }
            } catch (error) {
              logWarn_ACU(`[填表] 无法解析表名占位符 "${token.tableName}"，保留原 token。`, error);
            }
          }
        }

        if (typeof (globalThis as any).EjsTemplate?.evalTemplate === 'function') {
          try {
            finalContent = await (globalThis as any).EjsTemplate.evalTemplate(finalContent);
            logDebug_ACU('[填表] 已通过 st-prompt-template 处理提示词');
          } catch (e) {
            logWarn_ACU('[填表] st-prompt-template 处理失败，使用原始内容:', e);
          }
        }

        finalContent = parseRandomTags_ACU(finalContent);
        finalContent = replaceRandomVariables_ACU(finalContent);

        // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下，在 <if> 之前执行）
        finalContent = replaceDbSqlVariables(finalContent);

        if (settings_ACU.promptTemplateSettings?.enabled !== false) {
          // 填表条件必须与本次 $1 实际读取的 AI 上下文一致，不能越过批次边界读取聊天最新层。
          const conditionalSeedContent = typeof dynamicContent?.conditionalSeedContent === 'string'
            ? dynamicContent.conditionalSeedContent
            : getLatestAIMessageContent_ACU();
          const templateContext = {
            seedContent: conditionalSeedContent,
            allTablesJson: currentJsonTableData_ACU,
            plotContent: lastPlotContent || ''
          };
          finalContent = parseIfBlocksInContent_ACU(finalContent, templateContext, 0);
        }
        
        messages.push({ role: normalizeRoleForApi_ACU(segment.role), content: finalContent });
    }

    logDebug_ACU('Final messages array being sent to API:', messages);
    logDebug_ACU(`使用API预设: ${effectiveTableApiPreset || '当前配置'}, 模式: ${effectiveApiMode}`);

    try {
        if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
            throw new Error('自定义API的URL或模型未配置。');
        }
        // 公益站兼容（预设级）：该预设限速每分钟最多 3 次请求（各预设独立计数）
        if (apiPresetConfig.publicServiceMode) {
            await acquirePresetRateLimitSlot_ACU(effectiveTableApiPreset || '_current_config', { signal: abortSignal });
        }
        logDebug_ACU('ACU: 调用后端生成 API, Model:', effectiveApiConfig.model);
        const content = await postChatCompletion_ACU(buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { stripModelPrefix: false, nonPrefillSupport: apiPresetConfig.nonPrefillSupport }), abortSignal);
        if (content) {
            return content.trim();
        }
        throw new RetryableAiResponseError_ACU();
    } finally {
        untrackAbortController_ACU(localAbortController);
        if (currentAbortController_ACU === localAbortController) {
            _set_currentAbortController_ACU(null);
        }
    }
  }

  // ═══ 响应处理（streamingEnabled 开启时走 SSE 流解析，否则 JSON 解析） ═══

  async function parseNonStreamResponse_ACU(response: any) {
    try {
        const data = await response.json();
        if (data?.choices?.[0]?.message?.content) {
            return data.choices[0].message.content;
        }
        if (data?.content) {
            return data.content;
        }
        if (typeof data === 'string') {
            return data;
        }
        logError_ACU('[parseNonStreamResponse] Unknown response format:', data);
        return null;
    } catch (e) {
        logError_ACU('[parseNonStreamResponse] Failed to parse response:', e);
        return null;
    }
  }

  // SSE 流式响应解析：逐行提取 data: 前缀的 JSON，拼接 choices[0].delta.content
  async function parseStreamResponse_ACU(response: any) {
    try {
      const text = await response.text();
      let result = '';
      let sawDone = false;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          sawDone = true;
          continue;
        }
        try {
          const data = JSON.parse(payload);
          const delta = data?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') result += delta;
        } catch {
          // 忽略无法解析的 data 行（注释/空行）
        }
      }
      if (!sawDone) {
        // [M1] 流式响应未收到 [DONE]：按截断处理，丢弃部分内容返回 null。
        // 上游 callCustomOpenAI 会把 null 转成 RetryableAiResponseError_ACU（model 类可重试错误），
        // collectGroupFillResponse 据此走重试；此前仅告警仍返回半截内容，会让调用方把截断误判为成功。
        // 本函数拿不到 abort 标志，一律按截断处理（用户中止场景在 fetch 层已抛 AbortError，不会走到这里）。
        logWarn_ACU(`[parseStreamResponse] 流式响应未收到 [DONE]（可能被网络中断/截断），丢弃已收集的部分内容，长度: ${result.length}`);
        return null;
      }
      if (!result) {
        logWarn_ACU('[parseStreamResponse] 流式响应未解析出任何内容。');
      }
      return result || null;
    } catch (e) {
      logError_ACU('[parseStreamResponse] Failed to parse stream:', e);
      return null;
    }
  }

  /**
   * 响应解析分流：按「请求实际携带的 stream 值」而非全局开关——
   * 预设级流式开关可能与全局不同，若按全局判断会把 SSE 当 JSON（或反之）解析失败。
   * requestWantsStream 缺省时回退全局 settings_ACU.streamingEnabled（兼容旧调用方）。
   */
  export async function handleApiResponse_ACU(response: any, requestWantsStream?: boolean) {
    const wantsStream = requestWantsStream !== undefined
      ? requestWantsStream === true
      : settings_ACU.streamingEnabled === true;
    if (wantsStream) {
      return await parseStreamResponse_ACU(response);
    }
    return await parseNonStreamResponse_ACU(response);
  }
