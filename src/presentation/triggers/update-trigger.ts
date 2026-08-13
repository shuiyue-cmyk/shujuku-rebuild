import { DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU } from '../../shared/defaults-json.js';
import { getCharCardPromptFromUI_ACU, isAutoUpdatingCard_ACU } from '../components/plot-editors';
import { showToastr_ACU } from '../theme/toast';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { settings_ACU } from '../../service/runtime/state-manager';
import { sanitizeChatSheetsObject_ACU } from '../../service/template/chat-scope';
import { isSqliteMode } from '../../service/table/storage-mode';
import { ensureSheetOrderNumbers_ACU, logError_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
/**
 * presentation/triggers/update-trigger.ts — 手动更新触发 UI
 * 从 features/ui/01_update_trigger.js 迁移而来
 * presentation 层只负责 UI 交互，业务逻辑委托给 service 层。
 */

  // 手动合并纪要功能已从主界面隐藏并停用；保留导出函数形状，防止旧调用方直接报错。
  export async function handleManualMergeSummary_ACU() {
      showToastr_ACU('info', '合并总结功能已停用。');
  }

  export function exportCombinedSettings_ACU() {    const promptSegments = getCharCardPromptFromUI_ACU();
    if (!promptSegments || promptSegments.length === 0) {
      showToastr_ACU('warning', '没有可导出的提示词。');
      return;
    }

    try {
        // [修复] 合并导出应导出“当前模板”（localStorage/内存中的模板），并兼容旧模板缺少顺序编号的情况
        const templateObj = parseTableTemplateJson_ACU({ stripSeedRows: false });
        if (!templateObj || typeof templateObj !== 'object') {
            throw new Error('无法解析当前模板。');
        }
        const sheetKeys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
        ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: sheetKeys, forceRebuild: false });
        // [瘦身] 合并导出时也不带冗余字段
        const templateData = sanitizeChatSheetsObject_ACU(templateObj, { ensureMate: true });
        const combinedData = {
            prompt: promptSegments,
            template: templateData,
            mergeSummaryPrompt: settings_ACU.mergeSummaryPrompt || (isSqliteMode() ? DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU : DEFAULT_MERGE_SUMMARY_PROMPT_ACU), // [新增] 导出合并提示词（根据存储模式选择默认版本）
            mergeTargetCount: settings_ACU.mergeTargetCount || 1, // [新增] 导出合并目标条数
            mergeBatchSize: settings_ACU.mergeBatchSize || 5, // [新增] 导出合并批次大小
            mergeStartIndex: settings_ACU.mergeStartIndex || 1, // [新增] 导出合并起始条数
            mergeEndIndex: settings_ACU.mergeEndIndex || null, // [新增] 导出合并终止条数
            autoMergeEnabled: settings_ACU.autoMergeEnabled || false, // [新增] 导出自动合并总结设置
            autoMergeThreshold: settings_ACU.autoMergeThreshold || 20, // [新增] 导出自动合并总结楼层数
            autoMergeReserve: settings_ACU.autoMergeReserve || 0, // [新增] 导出保留固定楼层数
            deleteStartFloor: settings_ACU.deleteStartFloor || null, // [新增] 导出删除起始楼层
            deleteEndFloor: settings_ACU.deleteEndFloor || null // [新增] 导出删除终止楼层
        };
        const jsonString = JSON.stringify(combinedData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'TavernDB_Combined_Settings.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToastr_ACU('success', '合并配置已成功导出！');
    } catch (error) {
        logError_ACU('导出合并配置失败:', error);
        showToastr_ACU('error', '导出合并配置失败，请检查控制台获取详情。');
    }
  }