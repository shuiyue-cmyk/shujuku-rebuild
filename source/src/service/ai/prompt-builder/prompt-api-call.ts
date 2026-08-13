/**
 * service/ai/prompt-builder/prompt-api-call.ts
 * AI API 调用 — prompt 组装 + API 调用 + 流式/非流式响应处理
 * 从 prompt-builder.ts 拆出（L195-L501 + L1519-L1604）
 */
import { currentAbortController_ACU, trackAbortController_ACU, untrackAbortController_ACU, _set_currentAbortController_ACU } from '../../runtime/state-manager';
import { getApiConfigByPreset_ACU, buildCustomApiRequestBody_ACU, postChatCompletion_ACU } from '../api-call';
import { currentJsonTableData_ACU, settings_ACU } from '../../runtime/state-manager';
import { getPersonaDescription_ACU, getCharDescription_ACU } from '../../../data/gateways/host-state-gateway';
import { getHostRequestHeaders_ACU } from '../../../data/gateways/ai-gateway';
import { logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU } from '../../../shared/utils';
import { applyExcludeRulesToText_ACU, getLatestAIMessageContent_ACU, getPlotFromHistory_ACU, parseIfBlocksInContent_ACU, parseRandomTags_ACU, replaceRandomVariables_ACU } from '../../runtime/helpers-remaining';
import { replaceDbSqlVariables } from '../../runtime/template-vars/sql-query-var';
import { isSqliteMode } from '../../table/storage-mode';

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
        finalContent = finalContent.replace('$0', filterTableInjectedContent(dynamicContent.tableDataText, '$0'));
        finalContent = finalContent.replace('$1', filterTableInjectedContent(dynamicContent.messagesText, '$1'));
        finalContent = finalContent.replace('$4', filterTableInjectedContent(dynamicContent.worldbookContent, '$4'));
        finalContent = finalContent.replace(/\$6/g, filterTableInjectedContent(lastPlotContent || '', '$6'));
        finalContent = finalContent.replace('$8', filterTableInjectedContent(dynamicContent.manualExtraHint || '', '$8'));
        finalContent = finalContent.replace(/\$9/g, filterTableInjectedContent(dynamicContent.worldbookDatabaseExcludedContent || '', '$9'));
        finalContent = finalContent.replace(/\$U/g, filterTableInjectedContent(userInfoContent_Table, '$U'));
        finalContent = finalContent.replace(/\$C/g, filterTableInjectedContent(charInfoContent_Table, '$C'));

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
        const generateUrl = `/api/backends/chat-completions/generate`;

        logDebug_ACU('ACU: 调用新的后端生成API:', generateUrl, 'Model:', effectiveApiConfig.model);
        const content = await postChatCompletion_ACU(buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { stripModelPrefix: false }), abortSignal);
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

  // ═══ 非流式响应处理（流式输出开关已剥离，恒非流式） ═══

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

  export async function handleApiResponse_ACU(response: any, _signal: AbortSignal | null = null) {
    return await parseNonStreamResponse_ACU(response);
  }
