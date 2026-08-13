import { DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU } from '../../shared/defaults-json.js';
import { currentJsonTableData_ACU, settings_ACU } from '../runtime/state-manager';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getPersonaDescription_ACU, getCharDescription_ACU } from '../../data/gateways/host-state-gateway';
import { callAIWithPreset_ACU } from '../ai/api-call';
import { applyOptimizations_ACU } from '../../shared/text-optimization';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { saveOptimizationBaseToCache_ACU, loadOptimizationBaseFromCache_ACU } from '../../data/storage/optimization-cache-storage';
import { formatOutlineTableForPlot_ACU, formatSummaryIndexForPlot_ACU, getLatestAIMessageContent_ACU, getPlotFromHistory_ACU, getWorldbookContentForPlot_ACU, parseCalcTags_ACU, parseIfBlockRecursive_ACU, parseMaxTags_ACU, parseMinTags_ACU, parseRandomTags_ACU, replaceCalcVariables_ACU, replaceMaxVariables_ACU, replaceMinVariables_ACU, replaceRandomVariables_ACU } from '../runtime/helpers-remaining';
import { getSummaryIndexContentForPlot_ACU } from '../runtime/plot-runtime/plot-data-format';
import { replaceDbSqlVariables } from '../runtime/template-vars/sql-query-var';
/**
 * service/optimization/content-optimization.ts — 正文优化服务逻辑
 * 从 src/core/02_storage_and_profile.js:630~1325 迁移而来。
 */
  // buildDefaultContentOptimizationPromptGroup_ACU 已移至 shared/defaults.ts
  // 此处 re-export 保持向后兼容
  export { buildDefaultContentOptimizationPromptGroup_ACU } from '../../shared/defaults';

  // --- [正文优化] 核心函数 ---
  
  /**
   * 获取正文优化使用的占位符内容
   * @param {string} userMessage - 用户消息（用于$8占位符）
   * @returns {Promise<object>} 占位符内容映射
   */
  async function getOptimizationPlaceholders_ACU(userMessage = '') {
    const placeholders = {
      $1: '',   // 世界书内容
      $5: '',   // 纪要表/总体大纲表内容
      $6: '',   // 上一轮剧情规划数据
      $7: '',   // 前文上下文
      $8: userMessage,  // 本轮用户输入
      $U: '',   // 用户设定描述
      $C: ''    // 角色描述
    };
    const plotSettings = settings_ACU.plotSettings || {};

    try {
      // $1: 世界书内容（使用剧情推进的世界书读取逻辑）
      placeholders.$1 = await getWorldbookContentForPlot_ACU(plotSettings, userMessage, '');
      // [新增] 对世界书内容进行随机数处理
      placeholders.$1 = parseRandomTags_ACU(placeholders.$1);
      placeholders.$1 = replaceRandomVariables_ACU(placeholders.$1);
      // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下）
      placeholders.$1 = replaceDbSqlVariables(placeholders.$1);
      logDebug_ACU('[正文优化] $1 世界书内容:', placeholders.$1 ? `长度=${placeholders.$1.length}` : '(空)');
    } catch (e) {
      logWarn_ACU('[正文优化] 获取世界书内容失败:', e);
    }

    try {
      // $5: 纪要索引内容。交火模式会先覆盖世界书“纪要索引”条目；读取不到时再回退本地纪要表/总体大纲。
      const summaryIndexWorldbookContent = await getSummaryIndexContentForPlot_ACU(plotSettings);
      if (typeof summaryIndexWorldbookContent === 'string' && summaryIndexWorldbookContent.trim()) {
        placeholders.$5 = summaryIndexWorldbookContent;
        logDebug_ACU('[正文优化] $5 使用世界书纪要索引条目内容:', placeholders.$5 ? `长度=${placeholders.$5.length}` : '(空)');
      } else if (currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object') {
        const summaryIndexResult = formatSummaryIndexForPlot_ACU(currentJsonTableData_ACU);
        if (summaryIndexResult.success) {
          placeholders.$5 = summaryIndexResult.content;
        } else {
          placeholders.$5 = formatOutlineTableForPlot_ACU(currentJsonTableData_ACU);
        }
        logDebug_ACU('[正文优化] $5 未找到世界书纪要索引条目，使用本地表格内容:', placeholders.$5 ? `长度=${placeholders.$5.length}` : '(空)');
      }
    } catch (e) {
      logWarn_ACU('[正文优化] 获取纪要表内容失败:', e);
    }

    try {
      // $6: 上一轮剧情规划数据
      placeholders.$6 = getPlotFromHistory_ACU() || '';
      logDebug_ACU('[正文优化] $6 上轮规划数据:', placeholders.$6 ? `长度=${placeholders.$6.length}` : '(空)');
    } catch (e) {
      logWarn_ACU('[正文优化] 获取上轮规划数据失败:', e);
    }

    try {
      // $7: 前文上下文（仅AI输出）
      const chat = getChatArray_ACU();
      const contextMessages = chat
        .filter(msg => !msg.is_user)
        .slice(-10) // 最近10条AI消息
        .map(msg => `assistant："${msg.mes || ''}"`)
        .join('\n');
      placeholders.$7 = contextMessages ? `以下是前文的故事发展（AI输出）：\n${contextMessages}` : '';
      logDebug_ACU('[正文优化] $7 前文上下文:', placeholders.$7 ? `长度=${placeholders.$7.length}` : '(空)');
    } catch (e) {
      logWarn_ACU('[正文优化] 获取前文上下文失败:', e);
    }

    try {
      // $U: 用户设定描述 (persona_description)
      placeholders.$U = getPersonaDescription_ACU();
      logDebug_ACU('[正文优化] $U 用户设定:', placeholders.$U ? '成功' : '(空)');
    } catch (e) {
      logWarn_ACU('[正文优化] 获取用户设定失败:', e);
    }

    try {
      // $C: 角色描述 (char_description)
      placeholders.$C = getCharDescription_ACU();
      logDebug_ACU('[正文优化] $C 角色描述:', placeholders.$C ? '成功' : '(空)');
    } catch (e) {
      logWarn_ACU('[正文优化] 获取角色描述失败:', e);
    }

    return placeholders;
  }

  /**
   * 执行正文优化
   * @param {string} content - 需要优化的正文内容
   * @param {object} options - 优化选项
   * @param {number} options.currentLoop - 当前循环次数
   * @param {string} options.userMessage - 用户消息（用于占位符）
   * @returns {Promise<object>} 优化结果 { success, optimizations, summary, optimizedContent }
   */
   export async function performContentOptimization_ACU(content: any, options: any = {}) {
     const config = settings_ACU.contentOptimizationSettings || {};
     const maxLength = config.maxOptimizations || 10;
     const currentLoop = options.currentLoop || 1;
     const totalLoops = config.loopCount || 1;
     const maxRetries = config.retryCount || 3;
      
     logDebug_ACU(`[正文优化] 开始执行正文优化，循环 ${currentLoop}/${totalLoops}，原始内容长度:`, content.length);
      
     // 1. 获取占位符内容
     const placeholders = await getOptimizationPlaceholders_ACU(options.userMessage || '');
      
     // 2. 构建提示词消息
     const promptGroup = config.promptGroup && config.promptGroup.length > 0
       ? config.promptGroup
       : DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU;
      
     // 替换占位符并转换role为小写（某些API如豆包只接受小写role）
     const messages = JSON.parse(JSON.stringify(promptGroup));
     messages.forEach((item: any) => {
       if (item.content && typeof item.content === 'string') {
         // 替换 $CONTENT 占位符
         item.content = item.content.replace(/\$CONTENT/g, content);
         // 替换剧情推进占位符
         for (const [key, value] of Object.entries(placeholders)) {
           if (value && typeof value === 'string') {
             const regex = new RegExp(`\\${key}`, 'g');
             item.content = item.content.replace(regex, value);
           }
         }
         
         // [新增] 条件模板支持：随机数、计算变量、条件判断
         // 1. 解析随机数标签
         item.content = parseRandomTags_ACU(item.content);
         // 2. 替换随机数变量引用
         item.content = replaceRandomVariables_ACU(item.content);
         // 3. 解析计算变量标签
         const contextForCalc = { allTablesJson: currentJsonTableData_ACU };
         item.content = parseCalcTags_ACU(item.content, contextForCalc);
         // 4. 解析最大值变量标签
         item.content = parseMaxTags_ACU(item.content, contextForCalc);
         // 5. 解析最小值变量标签
         item.content = parseMinTags_ACU(item.content, contextForCalc);
         // 6. 替换计算变量引用
         item.content = replaceCalcVariables_ACU(item.content);
         // 7. 替换最大值变量引用
         item.content = replaceMaxVariables_ACU(item.content);
         // 8. 替换最小值变量引用
         item.content = replaceMinVariables_ACU(item.content);
         // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下，在 <if> 之前执行）
         item.content = replaceDbSqlVariables(item.content);
         // 9. 解析条件模板
         const latestAiContentForConditional = getLatestAIMessageContent_ACU();
         const latestPlotContentForConditional = getPlotFromHistory_ACU();
         const contextForIf = {
           seedContent: latestAiContentForConditional,
           allTablesJson: currentJsonTableData_ACU,
           plotContent: latestPlotContentForConditional
         };
         item.content = parseIfBlockRecursive_ACU(item.content, contextForIf, 0);
       }
       // 转换role为小写
       if (item.role && typeof item.role === 'string') {
         item.role = item.role.toLowerCase();
       }
     });
     
     // 3. 调用AI API（带自动重试）
     const apiPreset = config.apiPreset || '';
     logDebug_ACU(`[正文优化] 使用API预设: ${apiPreset || '当前配置'}`);
     
     let lastError = null;
     let responseContent = null;
     
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
       try {
        logDebug_ACU(`[正文优化] 调用AI API... (尝试 ${attempt}/${maxRetries})`);
        responseContent = await callAIWithPreset_ACU(messages, apiPreset);
         
         if (responseContent) {
           // API调用成功，跳出重试循环
           break;
         }
         
         // 空响应视为失败
         lastError = new Error('AI API 返回空响应');
         logDebug_ACU(`[正文优化] API返回空响应，尝试 ${attempt}/${maxRetries}`);
       } catch (error) {
         lastError = error;
         logError_ACU(`[正文优化] API调用失败 (尝试 ${attempt}/${maxRetries}):`, error);
         
         if (attempt < maxRetries) {
           // 等待一段时间后重试（指数退避：1秒、2秒、4秒...）
           const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
           logDebug_ACU(`[正文优化] 等待 ${delayMs}ms 后重试...`);
           await new Promise(resolve => setTimeout(resolve, delayMs));
         }
       }
     }
     
     // 检查是否所有重试都失败
     if (!responseContent) {
       logError_ACU(`[正文优化] 所有重试均失败 (${maxRetries}次)`);
       return {
         success: false,
         error: lastError ? lastError.message : 'API调用失败，已达到最大重试次数',
         retryExhausted: true
       };
     }
     
     let parseRetryResponseContent = responseContent;
     let parseLastError = null;
     
     for (let parseAttempt = 1; parseAttempt <= maxRetries; parseAttempt++) {
       try {
         // 4. 解析优化结果
         const parsed = parseOptimizationResponse_ACU(parseRetryResponseContent, maxLength);
         
         if (!parsed.success) {
           throw new Error(parsed.error || '解析失败');
         }
         
         // 5. 应用优化到正文
         const optimizedContent = applyOptimizations_ACU(content, parsed.optimizations);
         
         logDebug_ACU(`[正文优化] 循环 ${currentLoop}/${totalLoops} 完成，共 ${parsed.optimizations.length} 个优化项`);
         
         return {
           success: true,
           optimizations: parsed.optimizations,
           summary: parsed.summary,
           optimizedContent: optimizedContent
         };
         
       } catch (error) {
         parseLastError = error;
         logError_ACU(`[正文优化] 解析/应用失败 (尝试 ${parseAttempt}/${maxRetries}):`, error);
         
         if (parseAttempt >= maxRetries) {
           break;
         }
         
         const delayMs = Math.min(1000 * Math.pow(2, parseAttempt - 1), 10000);
         logDebug_ACU(`[正文优化] 等待 ${delayMs}ms 后重新请求优化结果...`);
         await new Promise(resolve => setTimeout(resolve, delayMs));
         
         try {
           logDebug_ACU(`[正文优化] 重新调用AI API以获取更干净的优化结果... (尝试 ${parseAttempt + 1}/${maxRetries})`);
           parseRetryResponseContent = await callAIWithPreset_ACU(messages, apiPreset);
           if (!parseRetryResponseContent) {
             throw new Error('重试请求未返回有效内容');
           }
         } catch (retryError) {
           parseLastError = retryError;
           logError_ACU(`[正文优化] 解析失败后的重新请求失败 (尝试 ${parseAttempt + 1}/${maxRetries}):`, retryError);
           if (parseAttempt >= maxRetries - 1) {
             break;
           }
         }
       }
     }
     
     return { success: false, error: parseLastError?.message || '解析失败' };
   }
  
  /**
   * 获取正文优化使用的API配置
   */
  async function getOptimizationApiConfig_ACU(presetName: string) {
    if (presetName && settings_ACU.apiPresets) {
      const preset = settings_ACU.apiPresets.find((p: any) => p.name === presetName);
      if (preset) {
        if (preset.apiMode === 'tavern') {
          return {
            apiMode: 'tavern',
            tavernProfile: preset.tavernProfile
          };
        } else {
          return {
            apiMode: 'custom',
            apiConfig: preset.apiConfig
          };
        }
      }
    }
    
    // 使用当前默认配置
    return {
      apiMode: settings_ACU.apiMode,
      apiConfig: settings_ACU.apiConfig,
      tavernProfile: settings_ACU.tavernProfile
    };
  }
  
  /**
   * 解析AI返回的优化响应
   * @param {string} responseContent - AI返回的内容
   * @param {number} maxOptimizations - 最大优化项数
   * @returns {object} { success, optimizations, summary, error }
   */
  function parseOptimizationResponse_ACU(responseContent: string, maxOptimizations = 10) {
    function extractBalancedJsonObject_ACU(text: string) {
      const start = text.indexOf('{');
      if (start < 0) return '';

      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) {
            return text.slice(start, i + 1);
          }
        }
      }

      return text.slice(start);
    }

    function sanitizeOptimizationJson_ACU(jsonStr: string) {
      if (!jsonStr) return '';

      let sanitized = String(jsonStr)
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/^[^\{]*?(\{)/s, '$1')
        .trim();

      sanitized = extractBalancedJsonObject_ACU(sanitized) || sanitized;

      sanitized = sanitized
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

      return sanitized;
    }

    function normalizeOptimizationItem_ACU(opt: any) {
      if (!opt || typeof opt !== 'object') return null;

      const type = typeof opt.type === 'string' ? opt.type.trim() : 'replace';
      const original = typeof opt.original === 'string' ? opt.original.trim() : '';
      const optimized = typeof opt.optimized === 'string' ? opt.optimized.trim() : '';
      const plan = [opt.plan, opt.reason, opt.strategy, opt.description, opt.note]
        .find(value => typeof value === 'string' && value.trim())?.trim() || '';

      if (type !== 'replace' || !original || !optimized) {
        return null;
      }

      return {
        type: 'replace',
        original,
        plan,
        optimized
      };
    }

    function extractStringField_ACU(source: string, fieldName: string) {
      if (typeof source !== 'string' || !fieldName) return '';
      const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`);
      const match = fieldPattern.exec(source);
      if (!match) return '';

      let i = match.index + match[0].length;
      let result = '';
      let escaped = false;

      while (i < source.length) {
        const ch = source[i];

        if (escaped) {
          result += ch;
          escaped = false;
          i++;
          continue;
        }

        if (ch === '\\') {
          result += ch;
          escaped = true;
          i++;
          continue;
        }

        if (ch === '"') {
          break;
        }

        result += ch;
        i++;
      }

      return result
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    function salvageOptimizationResponse_ACU(rawText: string) {
      if (typeof rawText !== 'string' || !rawText.trim()) return null;

      const containerText = extractBalancedJsonObject_ACU(rawText) || rawText;
      const arrayMatch = containerText.match(/"optimizations"\s*:\s*\[/);
      if (!arrayMatch) return null;

      const arrayStart = containerText.indexOf('[', arrayMatch.index);
      if (arrayStart < 0) return null;

      let depth = 0;
      let inString = false;
      let escaped = false;
      let arrayEnd = -1;

      for (let i = arrayStart; i < containerText.length; i++) {
        const ch = containerText[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === '[') depth++;
        if (ch === ']') {
          depth--;
          if (depth === 0) {
            arrayEnd = i;
            break;
          }
        }
      }

      if (arrayEnd < 0) return null;

      const arrayContent = containerText.slice(arrayStart + 1, arrayEnd);
      const objects = [];
      let objStart = -1;
      depth = 0;
      inString = false;
      escaped = false;

      for (let i = 0; i < arrayContent.length; i++) {
        const ch = arrayContent[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === '{') {
          if (depth === 0) objStart = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && objStart >= 0) {
            objects.push(arrayContent.slice(objStart, i + 1));
            objStart = -1;
          }
        }
      }

      const planFieldCandidates = ['plan', 'reason', 'strategy', 'description', 'note'];
      const optimizations = objects
        .map(objText => {
          const fallbackPlan = planFieldCandidates
            .map(field => extractStringField_ACU(objText, field))
            .find(value => value && value.trim()) || '';

          return normalizeOptimizationItem_ACU({
            type: extractStringField_ACU(objText, 'type') || 'replace',
            original: extractStringField_ACU(objText, 'original'),
            plan: fallbackPlan,
            optimized: extractStringField_ACU(objText, 'optimized')
          });
        })
        .filter(Boolean)
        .slice(0, maxOptimizations);

      if (!optimizations.length) return null;

      return {
        success: true,
        optimizations,
        summary: extractStringField_ACU(containerText, 'summary') || ''
      };
    }

    try {
      let jsonStr = responseContent;
      const jsonMatch = responseContent.match(/```json\s*([\s\S]*?)\s*```/i);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else {
        jsonStr = extractBalancedJsonObject_ACU(responseContent) || responseContent;
      }

      const sanitizedJson = sanitizeOptimizationJson_ACU(jsonStr);
      const parsed = JSON.parse(sanitizedJson);

      if (!parsed || !Array.isArray(parsed.optimizations)) {
        return { success: false, error: '响应格式错误：缺少 optimizations 数组' };
      }

      const optimizations = parsed.optimizations
        .slice(0, maxOptimizations)
        .map(normalizeOptimizationItem_ACU)
        .filter(Boolean);

      return {
        success: true,
        optimizations,
        summary: typeof parsed.summary === 'string' ? parsed.summary : ''
      };

    } catch (error) {
      const salvaged = salvageOptimizationResponse_ACU(responseContent);
      if (salvaged) {
        logDebug_ACU('[正文优化] JSON标准解析失败，已使用容错提取恢复优化结果');
        return salvaged;
      }
      logError_ACU('[正文优化] JSON解析失败:', error);
      return { success: false, error: 'JSON解析失败: ' + error.message };
    }
  }
  
 
  export let contentOptimizationAbortRequested_ACU = false;
  export let optimizationProgressToast_ACU: any = null;
  let lastOptimizedMessageMeta_ACU: any = null;

  export function setLastOptimizationBase_ACU(payload: any = {}) {
    const cache = {
      messageIndex: Number.isInteger(payload.messageIndex) ? payload.messageIndex : -1,
      messageId: payload.messageId ?? null,
      baseContent: typeof payload.baseContent === 'string' ? payload.baseContent : '',
      updatedAt: Date.now()
    };

    lastOptimizedMessageMeta_ACU = cache;
    saveOptimizationBaseToCache_ACU(cache);

    return cache;
  }

  export function getLastOptimizationBase_ACU() {
    if (lastOptimizedMessageMeta_ACU?.baseContent) {
      return lastOptimizedMessageMeta_ACU;
    }

    const cachedBase = loadOptimizationBaseFromCache_ACU();
    if (cachedBase?.baseContent) {
      lastOptimizedMessageMeta_ACU = cachedBase;
      return cachedBase;
    }

    return null;
  }

  /**
   * 取消正文优化
   * @param {string} reason - 取消原因
   * @returns {{ cancelled: boolean; reason: string }}
   */
  export function cancelContentOptimization_ACU(reason = '正文优化已由用户终止。'): { cancelled: boolean; reason: string } {
    contentOptimizationAbortRequested_ACU = true;
    return { cancelled: true, reason };
  }

  /**
   * 检查正文优化是否已被取消
   */
  export function ensureOptimizationNotCancelled_ACU() {
    if (contentOptimizationAbortRequested_ACU) {
      throw new Error('用户终止正文优化');
    }
  }

  /**
   * 显示无感替换遮罩
   * @param {string} message - 显示的消息
   */

export function _set_optimizationProgressToast_ACU(v: any) { optimizationProgressToast_ACU = v; }
export function _set_contentOptimizationAbortRequested_ACU(v: any) { contentOptimizationAbortRequested_ACU = v; }
