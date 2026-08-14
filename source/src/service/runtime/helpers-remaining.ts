/**
 * service/runtime/helpers-remaining.ts — 辅助函数集入口文件
 * 原 4,263 行代码已按职责拆分为以下子模块：
 *   - helpers-context-tags.ts    — 上下文标签提取/过滤
 *   - helpers-table-lock.ts      — 表格锁定与索引
 *   - helpers-data-merge.ts      — 数据合并/格式化/首楼初始化/阈值
 *   - helpers-template-vars.ts   — 模板变量系统（random/calc/max/min/seed/cell/cond/if）
 *   - helpers-plot-runtime.ts    — 剧情推进运行时（task执行/历史/规划/世界书内容）
 *
 * 本文件保留 handleChatCompletionReady_ACU（依赖多个子模块，不适合放入任何单一子模块），
 * 并 re-export 所有子模块的公开 API。
 */
import {
  currentJsonTableData_ACU,
  pendingFinalGenerationGreenlights_ACU,
  settings_ACU
} from './state-manager';
import {
  logDebug_ACU
} from '../../shared/utils';
import {
  parseRandomTags_ACU,
  replaceRandomVariables_ACU,
  parseCalcTags_ACU,
  parseMaxTags_ACU,
  parseMinTags_ACU,
  replaceCalcVariables_ACU,
  replaceMaxVariables_ACU,
  replaceMinVariables_ACU,
  parseIfBlockRecursive_ACU,
  getLatestAIMessageContent_ACU,
  replaceDbSqlVariables
} from './template-vars';
import {
  getPlotFromHistory_ACU,
  getAgentControlledWorldbookEntriesForFinalPrompt_ACU
} from './plot-runtime';
import {
  isWorldbookTakeoverActive_ACU
} from '../agent/agent-worldbook-takeover';

// ═══ 上下文标签提取/过滤 ═══
export {
    getDefaultPlotContextExtractRules_ACU,
    getDefaultPlotContextExcludeRules_ACU,
    applyExcludeRulesToText_ACU,
    applyContextTagFilters_ACU,
} from './helpers-context-tags';

// ═══ 表格锁定与索引 ═══
export {
    getTableLocksForSheet_ACU,
    saveTableLocksForSheet_ACU,
    deleteTableLocksForSheet_ACU,
    toggleRowLock_ACU,
    toggleColLock_ACU,
    toggleCellLock_ACU,
    isSpecialIndexLockEnabled_ACU,
    setSpecialIndexLockEnabled_ACU,
    getSummaryIndexColumnIndex_ACU,
    formatSummaryIndexCode_ACU,
    applySummaryIndexSequenceToTable_ACU,
    applySpecialIndexSequenceToSummaryTables_ACU,
} from './helpers-table-lock';

// ═══ 数据合并/格式化/首楼初始化/阈值 ═══
export {
    mergeAllIndependentTables_ACU,
    mergeAllIndependentTablesLegacyV1_ACU,
    consumeLastMergeQuarantinedSheetKeys_ACU,
    consumeLastMergeWarnings_ACU,
    formatJsonToReadable_ACU,
    shouldSuppressWorldbookInjection_ACU,
    maybeLiftWorldbookSuppression_ACU,
    fillFirstLayerWithTemplateData_ACU,
    getEffectiveAutoUpdateThreshold_ACU,
    isNewChatGreetingStage_ACU,
    isSingleAiNoUserChat_ACU,
    buildTemplateBaseStateDataForLocalStorage_ACU,
    ensureInitialSeedCheckpoint_ACU,
    seedGreetingLocalDataFromTemplate_ACU,
    parseReadableToJson_ACU,
    GREETING_LOCAL_BASE_STATE_MARKER_ACU,
} from './helpers-data-merge';

// ═══ 模板变量系统 ═══
export {
    parseRandomTags_ACU,
    replaceRandomVariables_ACU,
    parseCalcTags_ACU,
    parseMaxTags_ACU,
    parseMinTags_ACU,
    replaceCalcVariables_ACU,
    replaceMaxVariables_ACU,
    replaceMinVariables_ACU,
    parseIfBlockRecursive_ACU,
    parseIfBlocksInContent_ACU,
    getLatestAIMessageContent_ACU,
} from './template-vars';

// ═══ 剧情推进运行时 ═══
export {
    formatOutlineTableForPlot_ACU,
    formatSummaryIndexForPlot_ACU,
    loadPresetAndCleanCharacterData_ACU,
    getPlotFromHistory_ACU,
    runOptimizationLogic_ACU,
    getWorldbookContentForPlot_ACU,
} from './plot-runtime';

// ═══ 保留在入口文件中的函数（依赖多个子模块） ═══

  type AgentWorldbookPromptRole_ACU = 'system' | 'user' | 'assistant';
  type AgentWorldbookPromptPosition_ACU = 'worldInfoBefore' | 'worldInfoAfter' | 'inChat';

  function normalizeAgentWorldbookDepth_ACU(value: any) {
    const depth = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
    return Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 1;
  }

  function normalizeAgentWorldbookRole_ACU(value: any): AgentWorldbookPromptRole_ACU {
    const role = String(value || '').trim().toLowerCase();
    if (role === 'user' || role === 'assistant' || role === 'system') return role;
    return 'system';
  }

  function normalizeAgentWorldbookPosition_ACU(value: any): AgentWorldbookPromptPosition_ACU {
    const position = String(value || '').trim().toLowerCase();
    if (position === 'before_char' || position === 'before_character' || position === 'before_character_definition' || position === '0') return 'worldInfoBefore';
    if (position === 'after_char' || position === 'after_character' || position === 'after_character_definition' || position === '1') return 'worldInfoAfter';
    return 'inChat';
  }

  function formatAgentWorldbookEntryForPrompt_ACU(entry: any) {
    const content = String(entry?.content || '').trim();
    if (!content) return '';
    const comment = String(entry?.comment || '').trim();
    const marker = comment ? `[ACU Agent Greenlight: ${comment}]` : '[ACU Agent Greenlight]';
    return `${marker}\n${content}`;
  }

  type AgentWorldbookInjectionItem_ACU = { order: number; content: string };

  function findAgentWorldbookPromptMessageIndex_ACU(messages: any[], identifier: 'worldInfoBefore' | 'worldInfoAfter') {
    return (Array.isArray(messages) ? messages : []).findIndex((message: any) => {
      if (!message || typeof message !== 'object') return false;
      return message.identifier === identifier || message.id === identifier || message.name === identifier;
    });
  }

  function appendAgentWorldbookContentToMessage_ACU(message: any, content: string) {
    if (!message || typeof message !== 'object' || !content) return false;
    if (typeof message.content === 'string') {
      message.content = [message.content, content].filter(chunk => typeof chunk === 'string' && chunk.trim()).join('\n\n');
      return true;
    }
    if (Array.isArray(message.content)) {
      const textPart = message.content.find((part: any) => part && part.type === 'text' && typeof part.text === 'string');
      if (textPart) {
        textPart.text = [textPart.text, content].filter(chunk => typeof chunk === 'string' && chunk.trim()).join('\n\n');
      } else {
        message.content.unshift({ type: 'text', text: content });
      }
      return true;
    }
    message.content = content;
    return true;
  }

  function escapeAgentWorldbookRegExp_ACU(value: string) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeAgentWorldbookFilteredText_ACU(value: string) {
    return String(value || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function buildNativeWorldbookGreenlightRemovalCandidates_ACU(entry: any) {
    const content = String(entry?.content || '').trim();
    if (!content) return [];
    const comment = String(entry?.comment || entry?.rawComment || entry?.name || '').trim();
    const candidates: { text: string; requiresComment: boolean }[] = [];
    const addCandidate = (text: string, requiresComment: boolean) => {
      const normalized = String(text || '').trim();
      if (!normalized) return;
      if (candidates.some(candidate => candidate.text === normalized)) return;
      candidates.push({ text: normalized, requiresComment });
    };

    if (comment) {
      addCandidate(`# ${comment}\n${content}`, true);
      addCandidate(`[ACU Agent Greenlight: ${comment}]\n${content}`, true);
    }
    addCandidate(content, false);

    return candidates.sort((a, b) => b.text.length - a.text.length);
  }

  function isNativeWorldbookPromptMessage_ACU(message: any) {
    if (!message || typeof message !== 'object') return false;
    if (message.identifier === 'worldInfoBefore' || message.identifier === 'worldInfoAfter') return true;
    if (message.id === 'worldInfoBefore' || message.id === 'worldInfoAfter') return true;
    if (message.name === 'worldInfoBefore' || message.name === 'worldInfoAfter') return true;
    return false;
  }

  function shouldFilterNativeWorldbookMessage_ACU(message: any) {
    if (!message || typeof message !== 'object') return false;
    if (message.injected === true) return false;
    if (isNativeWorldbookPromptMessage_ACU(message)) return true;
    return String(message.role || '').trim().toLowerCase() === 'system';
  }

  function removeNativeWorldbookGreenlightText_ACU(text: string, entries: any[], allowRawContentOnly: boolean) {
    let result = String(text || '');
    let removedCount = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const comment = String(entry?.comment || entry?.rawComment || entry?.name || '').trim();
      const candidates = buildNativeWorldbookGreenlightRemovalCandidates_ACU(entry);
      for (const candidate of candidates) {
        if (!allowRawContentOnly && !candidate.requiresComment) continue;
        if (candidate.requiresComment && comment && !result.includes(comment)) continue;
        const pattern = new RegExp(`(?:\\n{0,2})${escapeAgentWorldbookRegExp_ACU(candidate.text)}(?:\\n{0,2})`, 'g');
        const before = result;
        result = result.replace(pattern, '\n\n');
        if (result !== before) removedCount++;
      }
    }
    return {
      text: removedCount > 0 ? normalizeAgentWorldbookFilteredText_ACU(result) : text,
      removedCount,
    };
  }

  function filterNativeWorldbookGreenlightsFromMessages_ACU(messages: any[], entries: any[]) {
    if (!Array.isArray(messages) || !Array.isArray(entries) || entries.length === 0) return 0;
    let totalRemoved = 0;
    for (const message of messages) {
      if (!shouldFilterNativeWorldbookMessage_ACU(message)) continue;
      const allowRawContentOnly = isNativeWorldbookPromptMessage_ACU(message);
      if (typeof message.content === 'string') {
        const result = removeNativeWorldbookGreenlightText_ACU(message.content, entries, allowRawContentOnly);
        message.content = result.text;
        totalRemoved += result.removedCount;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (!part || part.type !== 'text' || typeof part.text !== 'string') continue;
          const result = removeNativeWorldbookGreenlightText_ACU(part.text, entries, allowRawContentOnly);
          part.text = result.text;
          totalRemoved += result.removedCount;
        }
      }
    }
    return totalRemoved;
  }

  function buildAgentWorldbookRefKeySet_ACU(refs: any[]) {
    const keySet = new Set<string>();
    for (const ref of Array.isArray(refs) ? refs : []) {
      const bookName = String(ref?.bookName || '').trim();
      const uid = ref?.uid;
      if (!bookName || uid === null || uid === undefined || String(uid).trim() === '') continue;
      keySet.add(`${bookName}\u0000${String(uid).trim()}`);
    }
    return keySet;
  }

  function isAgentWorldbookEntryAllowed_ACU(entry: any, allowedKeySet: Set<string>) {
    if (allowedKeySet.size === 0) return false;
    const bookName = String(entry?.bookName || '').trim();
    const uid = entry?.uid;
    if (!bookName || uid === null || uid === undefined || String(uid).trim() === '') return false;
    return allowedKeySet.has(`${bookName}\u0000${String(uid).trim()}`);
  }

  function buildAgentWorldbookInjectionItems_ACU(entries: any[]) {
    return (Array.isArray(entries) ? entries : [])
      .map(entry => {
        const content = formatAgentWorldbookEntryForPrompt_ACU(entry);
        if (!content) return null;
        const order = Number(entry?.order);
        return {
          entry,
          content,
          order: Number.isFinite(order) ? order : 0,
          position: normalizeAgentWorldbookPosition_ACU(entry?.position),
        };
      })
      .filter(Boolean) as { entry: any; content: string; order: number; position: AgentWorldbookPromptPosition_ACU }[];
  }

  function injectAgentWorldbookEntriesIntoMessages_ACU(messages: any[], entries: any[]) {
    const items = buildAgentWorldbookInjectionItems_ACU(entries);
    const positionedGroups = {
      worldInfoBefore: items.filter(item => item.position === 'worldInfoBefore').sort((a, b) => a.order - b.order),
      worldInfoAfter: items.filter(item => item.position === 'worldInfoAfter').sort((a, b) => a.order - b.order),
      inChat: items.filter(item => item.position === 'inChat'),
    };

    let injectedMessageCount = 0;
    for (const identifier of ['worldInfoBefore', 'worldInfoAfter'] as const) {
      const content = positionedGroups[identifier].map(item => item.content).join('\n\n').trim();
      if (!content) continue;
      const targetIndex = findAgentWorldbookPromptMessageIndex_ACU(messages, identifier);
      if (targetIndex >= 0 && appendAgentWorldbookContentToMessage_ACU(messages[targetIndex], content)) {
        injectedMessageCount++;
      } else {
        logDebug_ACU(`[提示词模板] 未找到 ${identifier} 消息，Agent 正文世界书绿灯降级为 system injected message。`);
        messages.push({ role: 'system', content, injected: true });
        injectedMessageCount++;
      }
    }

    const groups = new Map<number, Map<AgentWorldbookPromptRole_ACU, AgentWorldbookInjectionItem_ACU[]>>();
    for (const item of positionedGroups.inChat) {
      const depth = normalizeAgentWorldbookDepth_ACU(item.entry?.depth);
      const role = normalizeAgentWorldbookRole_ACU(item.entry?.role);
      if (!groups.has(depth)) groups.set(depth, new Map());
      const roleGroups = groups.get(depth)!;
      if (!roleGroups.has(role)) roleGroups.set(role, []);
      roleGroups.get(role)!.push({
        order: item.order,
        content: item.content,
      });
    }

    let totalInsertedMessages = 0;
    const roleOrder: AgentWorldbookPromptRole_ACU[] = ['system', 'user', 'assistant'];
    // 对齐 SillyTavern openai.js 的 populationInjectionPrompts：该 hook 阶段的
    // messages 仍是 reverse 前的顺序，depth=i 的注入点是 i + 已插入消息数，
    // 之后由 SillyTavern 统一 reverse 成最终请求顺序。不能用 messages.length - depth，
    // 否则会落到靠近最后 role 的位置，表现为被合并到错误身份附近。
    const sortedDepths = Array.from(groups.keys()).sort((a, b) => a - b);
    for (const depth of sortedDepths) {
      const roleGroups = groups.get(depth)!;
      const injectionMessages = roleOrder
        .map(role => {
          const content = (roleGroups.get(role) || [])
            .sort((a, b) => b.order - a.order)
            .map(item => item.content)
            .join('\n\n')
            .trim();
          return content ? { role, content, injected: true } : null;
        })
        .filter(Boolean);
      if (injectionMessages.length === 0) continue;
      const insertIndex = Math.min(messages.length, Math.max(0, depth + totalInsertedMessages));
      messages.splice(insertIndex, 0, ...injectionMessages);
      injectedMessageCount += injectionMessages.length;
      totalInsertedMessages += injectionMessages.length;
    }
    return injectedMessageCount;
  }

  function getTableDataForPrompt_ACU() {
    return currentJsonTableData_ACU || {};
  }

  export async function handleChatCompletionReady_ACU(data: any) {
    logDebug_ACU('[提示词模板] handleChatCompletionReady_ACU 被调用');
    logDebug_ACU('[提示词模板] settings_ACU?.promptTemplateSettings:', settings_ACU?.promptTemplateSettings);
    if (!settings_ACU?.promptTemplateSettings?.enabled) {
      logDebug_ACU('[提示词模板] 功能未启用，跳过处理');
      return;
    }
    if (!data || !data.messages || !Array.isArray(data.messages)) {
      return;
    }
    const finalGenerationGreenlights = Array.isArray(pendingFinalGenerationGreenlights_ACU) ? [...pendingFinalGenerationGreenlights_ACU] : [];
    const shouldHandleAgentWorldbookFinalPrompt = isWorldbookTakeoverActive_ACU() || finalGenerationGreenlights.length > 0;
    const startTime = Date.now();
    logDebug_ACU('[提示词模板] 开始处理酒馆提示词...');
    if (shouldHandleAgentWorldbookFinalPrompt) {
      try {
        const allAgentSkillWorldbookEntries = await getAgentControlledWorldbookEntriesForFinalPrompt_ACU(
          settings_ACU?.plotSettings || {},
        );
        const allowedFinalGreenlightKeySet = buildAgentWorldbookRefKeySet_ACU(finalGenerationGreenlights);
        const entriesToFilter = (Array.isArray(allAgentSkillWorldbookEntries) ? allAgentSkillWorldbookEntries : [])
          .filter(entry => !isAgentWorldbookEntryAllowed_ACU(entry, allowedFinalGreenlightKeySet));
        const filteredNativeCount = filterNativeWorldbookGreenlightsFromMessages_ACU(data.messages, entriesToFilter);
        if (filteredNativeCount > 0) {
          logDebug_ACU('[提示词模板] 已过滤酒馆原生正文世界书绿灯片段，数量:', filteredNativeCount);
        }
      } catch (e) {
        logDebug_ACU('[提示词模板] 运行时 Agent 正文世界书绿灯过滤失败，已跳过本轮过滤:', e);
      }
    }
    const lastPlotContent = getPlotFromHistory_ACU();
    logDebug_ACU('[提示词模板] $6 最新一层推进数据:', lastPlotContent ? `长度=${lastPlotContent.length}` : '(空)');
    const context = {
      seedContent: getLatestAIMessageContent_ACU(),
      allTablesJson: getTableDataForPrompt_ACU(),
      plotContent: lastPlotContent
    };
    const processPromptTemplateContent_ACU = (content: any) => {
      if (typeof content !== 'string' || !content) {
        return typeof content === 'string' ? content : '';
      }
      let processedContent = content;
      processedContent = parseRandomTags_ACU(processedContent);
      processedContent = replaceRandomVariables_ACU(processedContent);
      const contextForCalc = { allTablesJson: context.allTablesJson };
      processedContent = parseCalcTags_ACU(processedContent, contextForCalc);
      processedContent = parseMaxTags_ACU(processedContent, contextForCalc);
      processedContent = parseMinTags_ACU(processedContent, contextForCalc);
      processedContent = replaceCalcVariables_ACU(processedContent);
      processedContent = replaceMaxVariables_ACU(processedContent);
      processedContent = replaceMinVariables_ACU(processedContent);
      // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下，在 <if> 之前执行）
      processedContent = replaceDbSqlVariables(processedContent);
      processedContent = parseIfBlockRecursive_ACU(processedContent, context, 0);
      return processedContent;
    };
    let processedCount = 0;
    for (const message of data.messages) {
      if (typeof message.content === 'string') {
        const originalContent = message.content;
        message.content = processPromptTemplateContent_ACU(message.content);
        if (message.content !== originalContent) processedCount++;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            const originalText = part.text;
            part.text = processPromptTemplateContent_ACU(part.text);
            if (part.text !== originalText) processedCount++;
          }
        }
      }
    }
    const endTime = Date.now();
    logDebug_ACU(`[提示词模板] 处理完成，共处理 ${processedCount} 个消息块，耗时 ${endTime - startTime}ms`);
  }
