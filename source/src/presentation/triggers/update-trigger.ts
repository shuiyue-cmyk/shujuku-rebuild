import {
  showToastr_ACU
} from '../theme/toast';
import {
  buildCombinedSettingsExportPayload_ACU
} from '../../service/settings/combined-settings-transfer';
import {
  logError_ACU
} from '../../shared/utils';
/**
 * presentation/triggers/update-trigger.ts — 手动更新触发 UI
 * 从 features/ui/01_update_trigger.js 迁移而来
 * presentation 层只负责 UI 交互，业务逻辑委托给 service 层。
 */

  // 手动合并纪要功能已从主界面隐藏并停用；保留导出函数形状，防止旧调用方直接报错。
  export async function handleManualMergeSummary_ACU() {
      showToastr_ACU('info', '合并总结功能已停用。');
      return false;
  }

  export function exportCombinedSettings_ACU() {
    try {
        // R9-07：提示词读设置（旧实现读已停用弹窗的 DOM，恒为空，导出永远失败）；与 V2 共用导出内容。
        const combinedData = buildCombinedSettingsExportPayload_ACU();
        if (!Array.isArray(combinedData.prompt) || combinedData.prompt.length === 0) {
            showToastr_ACU('warning', '没有可导出的提示词。');
            return false;
        }
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
        return true;
    } catch (error) {
        logError_ACU('导出合并配置失败:', error);
        showToastr_ACU('error', '导出合并配置失败，请检查控制台获取详情。');
        return false;
    }
  }