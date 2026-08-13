/**
 * presentation/triggers/settings-ui-sync/settings-ui-config.ts
 */
import { AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU } from '../../../shared/defaults';
import { updateCardUpdateStatusDisplay_ACU } from '../../components/update-status-display';
import { getCharCardPromptFromUI_ACU, isAutoUpdatingCard_ACU, manualExtraHint_ACU, renderPromptSegments_ACU, wasStoppedByUser_ACU, _set_isAutoUpdatingCard_ACU, _set_manualExtraHint_ACU } from '../../components/plot-editors';
import { showToastr_ACU } from '../../theme/toast';
import { ACU_TOAST_CATEGORY_ACU } from '../../../shared/constants';
import { SillyTavern_API_ACU, TavernHelper_API_ACU, toastr_API_ACU, _set_SillyTavern_API_ACU, _set_TavernHelper_API_ACU, _set_jQuery_API_ACU, _set_toastr_API_ACU } from '../../../shared/host-api';
import { jQuery_API_ACU } from '../../dom-utils';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../../service/chat/chat-service';
import { getConnectionManagerProfiles_ACU } from '../../../service/ai/ai-service';
import { getCurrentCharacterFallback_ACU } from '../../../service/host/host-state-service';
import { NEW_MESSAGE_DEBOUNCE_DELAY_ACU, allChatMessages_ACU, coreApisAreReady_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, lastTotalAiMessages_ACU, settings_ACU , _set_coreApisAreReady_ACU, _set_lastTotalAiMessages_ACU} from '../../../service/runtime/state-manager';
import { $popupInstance_ACU, $customApiUrlInput_ACU, $customApiKeyInput_ACU, $customApiModelInput_ACU, $customApiModelSelect_ACU, $maxTokensInput_ACU, $temperatureInput_ACU, $apiStatusDisplay_ACU, $charCardPromptSegmentsContainer_ACU, $autoUpdateThresholdInput_ACU, $autoUpdateTokenThresholdInput_ACU, $autoUpdateFrequencyInput_ACU, $updateBatchSizeInput_ACU, $maxConcurrentGroupsInput_ACU, $skipUpdateFloorsInput_ACU, $retainRecentLayersInput_ACU, $tableMaxRetriesInput_ACU, $manualExtraHintCheckbox_ACU } from '../../state/ui-refs';
import { checkAutoMergeTrigger_ACU, prepareAutoMergeBatches_ACU, executeAutoMergeBatch_ACU, finalizeAutoMerge_ACU } from '../../../service/summary/merge-logic';
import { processUpdates_ACU } from '../update-process';
import { getSortedSheetKeys_ACU } from '../../../service/template/chat-scope';
import { loadAllChatMessages_ACU } from '../../../service/worldbook/pipeline';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../../components/pipeline-ui-helpers';
import { SCRIPT_ID_PREFIX_ACU } from '../../../shared/constants';
import { escapeHtml_ACU } from '../../../shared/html-helpers';
import { topLevelWindow_ACU } from '../../../shared/env';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { executeContentOptimization_ACU } from '../../components/optimization-ui';
import { maybeLiftWorldbookSuppression_ACU } from '../../../service/runtime/helpers-remaining';
// [V1 收敛] 填表提示词写权限收敛到 service 事务式函数。
import { setCurrentPromptSegments_ACU, resetCurrentPromptToDefault_ACU, setUpdateNumberFields_ACU } from '../../../service/settings/settings-write-service';

  export function saveCustomCharCardPrompt_ACU() {
    if (!$popupInstance_ACU || !$charCardPromptSegmentsContainer_ACU) {
      logError_ACU('保存更新预设失败：UI元素未初始化。');
      return;
    }
    let newPromptSegments = getCharCardPromptFromUI_ACU();
    if (!newPromptSegments || newPromptSegments.length === 0 || (newPromptSegments.length === 1 && !newPromptSegments[0].content.trim())) {
      showToastr_ACU('warning', '更新预设不能为空。');
      return;
    }

    // [健全性] 主提示词槽位去重：A/B 各最多一个（多余的自动降级为普通段落）
    try {
      const seen = { A: false, B: false };
      newPromptSegments = newPromptSegments.map(seg => {
        const slot = String(seg?.mainSlot || (seg?.isMain ? 'A' : (seg?.isMain2 ? 'B' : ''))).toUpperCase();
        if (slot === 'A' || slot === 'B') {
          if (seen[slot]) {
            const cleaned = { ...seg };
            delete cleaned.mainSlot;
            delete cleaned.isMain;
            delete cleaned.isMain2;
            cleaned.deletable = cleaned.deletable !== false;
            return cleaned;
          }
          seen[slot] = true;
        }
        return seg;
      });
    } catch (e) {}

    // [V1 收敛] 委托 service 事务式保存；保存失败已回滚，不再触发全量 reload。
    const result = setCurrentPromptSegments_ACU(newPromptSegments);
    if (!result.ok) {
      showToastr_ACU('error', result.message || '更新预设保存失败，已回滚。');
      return;
    }
    showToastr_ACU('success', '更新预设已保存！');
  }

  export function resetDefaultCharCardPrompt_ACU() {
    // [V1 收敛] 委托 service 事务式重置；保存失败已回滚，不再触发全量 reload。
    const result = resetCurrentPromptToDefault_ACU();
    if (!result.ok) {
      showToastr_ACU('error', result.message || '恢复默认提示词失败，已回滚。');
      return;
    }
    showToastr_ACU('info', '更新预设已恢复为默认值！');
  }
  export function loadCharCardPromptFromJson_ACU() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = (e.target as any).files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = readerEvent => {
            const content = readerEvent.target.result;
            let jsonData;

            try {
                jsonData = JSON.parse(content as string);
            } catch (error) {
                logError_ACU('导入提示词模板失败：JSON解析错误。', error);
                showToastr_ACU('error', '文件不是有效的JSON格式。', { timeOut: 5000 });
                return;
            }
            
            try {
                // Basic validation: must be an array of objects with role and content
                if (!Array.isArray(jsonData) || jsonData.some(item => typeof item.role === 'undefined' || typeof item.content === 'undefined')) {
                    throw new Error('JSON格式不正确。它必须是一个包含 "role" 和 "content" 键的对象的数组。');
                }
                
                // Add deletable: true and normalize roles for consistency
                const segments = jsonData.map(item => {
                    let normalizedRole = 'USER'; // Default to USER
                    if (item.role) {
                        const roleLower = item.role.toLowerCase();
                        if (roleLower === 'system') {
                            normalizedRole = 'SYSTEM';
                        } else if (roleLower === 'assistant' || roleLower === 'ai') {
                            normalizedRole = 'assistant';
                        }
                    }
                    const slot = String(item?.mainSlot || (item?.isMain ? 'A' : (item?.isMain2 ? 'B' : ''))).toUpperCase();
                    const normalizedSlot = (slot === 'A' || slot === 'B') ? slot : '';
                    return {
                        ...item,
                        role: normalizedRole,
                        mainSlot: normalizedSlot || item.mainSlot,
                        // 主提示词A/B不可删除
                        deletable: (normalizedSlot ? false : (item.deletable !== false)),
                    };
                });

                // Use the existing render function
                renderPromptSegments_ACU(segments);
                showToastr_ACU('success', '提示词模板已成功加载！');
                logDebug_ACU('New prompt template loaded from JSON file.');

            } catch (error) {
                logError_ACU('导入提示词模板失败：结构验证失败。', error);
                showToastr_ACU('error', `导入失败: ${error.message}`, { timeOut: 10000 });
            }
        };
        reader.readAsText(file, 'UTF-8');
    };
    input.click();
  }

  // [新增] 导出"填表提示词组(更新预设/AI指令预设)"为 JSON（与 loadCharCardPromptFromJson_ACU 联动）
  export function exportCharCardPromptToJson_ACU() {
    try {
      const segments = getCharCardPromptFromUI_ACU();
      if (!Array.isArray(segments) || segments.length === 0) {
        showToastr_ACU('warning', '没有可导出的提示词模板。');
        return;
      }
      // 基础校验：必须包含 role/content
      const invalid = segments.some(s => !s || typeof s !== 'object' || typeof s.role === 'undefined' || typeof s.content === 'undefined');
      if (invalid) {
        showToastr_ACU('error', '导出失败：提示词结构不完整（缺少 role 或 content）。');
        return;
      }

      const jsonString = JSON.stringify(segments, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'TavernDB_TablePromptGroup.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToastr_ACU('success', '提示词模板已导出为JSON！', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.MANUAL_TABLE });
    } catch (e) {
      logError_ACU('导出提示词模板失败:', e);
      showToastr_ACU('error', '导出提示词模板失败，请检查控制台获取详情。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR });
    }
  }
  // ─── 数值字段统一保存（表驱动，取代同构 save* 函数） ───
  interface NumberFieldSaveConfig_ACU {
    key: string;
    input: () => any;
    min: number;
    max?: number;
    errPrefix: string;
    successText: (v: number) => string;
    warnTemplate: (raw: string) => string;
    restore: () => any;
  }
  const NUMBER_FIELD_SAVERS_ACU: NumberFieldSaveConfig_ACU[] = [
    { key: 'autoUpdateThreshold', input: () => $autoUpdateThresholdInput_ACU, min: 0, errPrefix: '自动更新阈值', successText: (v) => v === 0 ? '自动更新阈值已保存！标准表自动更新已禁用。' : '自动更新阈值已保存！', warnTemplate: (v) => `阈值 "${v}" 无效。请输入一个大于等于0的整数。恢复为: ${settings_ACU.autoUpdateThreshold}`, restore: () => settings_ACU.autoUpdateThreshold },
    { key: 'autoUpdateTokenThreshold', input: () => $autoUpdateTokenThresholdInput_ACU, min: 0, errPrefix: '自动更新Token阈值', successText: () => '自动更新Token阈值已保存！', warnTemplate: (v) => `Token阈值 "${v}" 无效。请输入一个大于等于0的整数。恢复为: ${settings_ACU.autoUpdateTokenThreshold}`, restore: () => settings_ACU.autoUpdateTokenThreshold },
    { key: 'tableMaxRetries', input: () => $tableMaxRetriesInput_ACU, min: 1, max: 10, errPrefix: '填表自动重试次数', successText: () => '填表自动重试次数已保存！', warnTemplate: (v) => `重试次数 "${v}" 无效。请输入1-10之间的整数。恢复为: ${settings_ACU.tableMaxRetries || 3}`, restore: () => settings_ACU.tableMaxRetries || 3 },
    { key: 'autoUpdateFrequency', input: () => $autoUpdateFrequencyInput_ACU, min: 1, errPrefix: '自动更新频率', successText: () => '自动更新频率已保存！', warnTemplate: (v) => `更新频率 "${v}" 无效。请输入一个大于0的整数。恢复为: ${settings_ACU.autoUpdateFrequency}`, restore: () => settings_ACU.autoUpdateFrequency },
    { key: 'updateBatchSize', input: () => $updateBatchSizeInput_ACU, min: 1, errPrefix: '批处理大小', successText: () => '批处理大小已保存！', warnTemplate: (v) => `批处理大小 "${v}" 无效。请输入一个大于0的整数。恢复为: ${settings_ACU.updateBatchSize}`, restore: () => settings_ACU.updateBatchSize },
    { key: 'maxConcurrentGroups', input: () => $maxConcurrentGroupsInput_ACU, min: 1, errPrefix: '最大并发数', successText: () => '最大并发数已保存！', warnTemplate: (v) => `最大并发数 "${v}" 无效。请输入一个大于0的整数。恢复为: ${settings_ACU.maxConcurrentGroups || 1}`, restore: () => settings_ACU.maxConcurrentGroups || 1 },
    { key: 'skipUpdateFloors', input: () => $skipUpdateFloorsInput_ACU, min: 0, errPrefix: '跳过更新楼层', successText: () => '跳过更新楼层已保存！', warnTemplate: (v) => `跳过更新楼层 "${v}" 无效。请输入一个大于等于0的整数。恢复为: ${settings_ACU.skipUpdateFloors || 0}`, restore: () => settings_ACU.skipUpdateFloors || 0 },
    { key: 'importSplitSize', input: () => $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-split-size`), min: 100, errPrefix: '导入分割大小', successText: () => '导入分割大小已保存！', warnTemplate: (v) => `导入分割大小 "${v}" 无效。请输入一个大于等于100的整数。恢复为: ${settings_ACU.importSplitSize}`, restore: () => settings_ACU.importSplitSize },
  ];

  function saveNumberField_ACU(key: string, { silent = false }: { silent?: boolean } = {}) {
    const cfg = NUMBER_FIELD_SAVERS_ACU.find(c => c.key === key);
    if (!cfg) return;
    if (!$popupInstance_ACU || !cfg.input()) {
      logError_ACU(`保存${cfg.errPrefix}失败：UI元素未初始化。`);
      return;
    }
    const valStr = cfg.input().val() as string;
    const val = parseInt(valStr, 10);

    if (!isNaN(val) && val >= cfg.min && (cfg.max === undefined || val <= cfg.max)) {
      // [V1 收敛] 委托 service 事务式写入（含归一化与保存失败回滚）
      const result = setUpdateNumberFields_ACU({ [cfg.key]: val });
      if (!result.ok) {
        if (!silent) showToastr_ACU('error', result.message || `${cfg.errPrefix}保存失败，已回滚。`);
        return;
      }
      if (!silent) showToastr_ACU('success', cfg.successText(val));
    } else {
      if (!silent) showToastr_ACU('warning', cfg.warnTemplate(valStr));
      cfg.input().val(cfg.restore());
    }
  }

  export const saveAutoUpdateThreshold_ACU = (opts = {}) => saveNumberField_ACU('autoUpdateThreshold', opts);
  export const saveAutoUpdateTokenThreshold_ACU = (opts = {}) => saveNumberField_ACU('autoUpdateTokenThreshold', opts);
  export const saveTableMaxRetries_ACU = (opts = {}) => saveNumberField_ACU('tableMaxRetries', opts);
  export const saveAutoUpdateFrequency_ACU = (opts = {}) => saveNumberField_ACU('autoUpdateFrequency', opts);
  export const saveUpdateBatchSize_ACU = (opts = {}) => saveNumberField_ACU('updateBatchSize', opts);
  export const saveMaxConcurrentGroups_ACU = (opts = {}) => saveNumberField_ACU('maxConcurrentGroups', opts);
  export const saveSkipUpdateFloors_ACU = (opts = {}) => saveNumberField_ACU('skipUpdateFloors', opts);
  export const saveImportSplitSize_ACU = (opts = {}) => saveNumberField_ACU('importSplitSize', opts);

   // [新增] 保存"保留最近N个AI回复楼层数据"（全局）
   export function saveRetainRecentLayers_ACU({ silent = false, skipReload = false } = {}) {
       if (!$popupInstance_ACU || !$retainRecentLayersInput_ACU) {
           logError_ACU('保存 AI 回复楼层保留数失败：UI元素未初始化。');
           return;
       }
       const valStr = $retainRecentLayersInput_ACU.val() as string;
       const parsed = parseInt(valStr, 10);
       // 空字符串或无效值视为0（全部保留）
       const newRetain = (!valStr || valStr.trim() === '' || isNaN(parsed)) ? 0 : Math.max(0, parsed);

       // [V1 收敛] 委托 service 事务式写入
       const result = setUpdateNumberFields_ACU({ retainRecentLayers: newRetain });
       if (!result.ok) {
           if (!silent) showToastr_ACU('error', result.message || 'AI 回复楼层保留数保存失败，已回滚。');
           return;
       }
       if (!silent) {
           if (newRetain === 0) {
               showToastr_ACU('success', 'AI 回复楼层保留数已清空（将保留全部历史数据）！');
           } else {
               showToastr_ACU('success', `AI 回复楼层保留数已保存：最近 ${newRetain} 个 AI 回复楼层！`);
           }
       }
   }

   // [新增] 清理超出 AI 回复楼层保留数的旧本地数据（表格数据 + 剧情推进数据）
   // 按 AI 回复楼层计数，仅保留最近 N 个 AI 回复楼层的数据，更早楼层的 TavernDB_ACU_* 和 qrf_plot 字段将被删除
   // [重要] 此函数不会删除聊天第一层的"空白指导表"（TavernDB_ACU_InternalSheetGuide），
   //        指导表用于保存表头结构和填表参数，作为该聊天的总指导。
   // purgeOldLayerData_ACU 已搬迁到 service/chat/chat-service.ts
   // 通过 re-export 保持外部调用方兼容
   export { purgeOldLayerData_ACU } from '../../../service/chat/chat-service';
