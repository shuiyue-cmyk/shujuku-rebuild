// import-process.ts — 导入编排逻辑（presentation 层：涉及 UI 读取和状态更新）


import { STORAGE_KEY_IMPORTED_ENTRIES_ACU, STORAGE_KEY_IMPORTED_STATUS_ACU, STORAGE_KEY_IMPORTED_STATUS_FULL_ACU, STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU, STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU } from '../../shared/data-constants';

import { importTempGet_ACU, importTempRemove_ACU, importTempSet_ACU } from '../../shared/idb-import-temp';
import { getImportWorldbookTarget_ACU, updateImportStatusUI_ACU } from '../components/import-status-ui';
import { showToastr_ACU } from '../theme/toast';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { getSelectedImportTableKeys_ACU } from '../../service/settings/settings-readers';
import { getCurrentCharPrimaryLorebook_ACU, isWorldbookApiAvailable_ACU, loadImportedJsonDataFromLorebook_ACU, saveImportedJsonDataToLorebook_ACU, deleteImportedJsonDataFromLorebook_ACU } from '../../service/worldbook/worldbook-service';
// re-export 从 service 层搬迁的业务逻辑函数，保持外部调用方兼容
export { loadImportedJsonDataFromLorebook_ACU, saveImportedJsonDataToLorebook_ACU, deleteImportedJsonDataFromLorebook_ACU } from '../../service/worldbook/worldbook-service';
import { currentJsonTableData_ACU, settings_ACU, _set_currentJsonTableData_ACU} from '../../service/runtime/state-manager';
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
import { proceedWithCardUpdate_ACU } from './update-process';
import { updateReadableLorebookEntry_ACU } from '../../service/worldbook/pipeline';
import { logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { setImportInjectButtonEnabled_ACU } from '../components/import-status-ui';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import { getInjectionTargetLorebook_ACU } from '../../service/worldbook/injection-engine';
import { initImportDatabase_ACU, saveChunkProgress_ACU, finalizeImportAndCleanup_ACU, clearImportedEntriesCore_ACU, deleteImportedEntriesCore_ACU } from '../../service/import/import-executor';

export   async function processImportedTxtAsUpdates_ACU() {
      // 外部导入：按"自选表格"处理与注入（与手动填表一致的表选择体验）
      const $injectButton: any = null; // 旧闭包变量，现在通过 UI 层控制

      const savedEntriesJson = await importTempGet_ACU(STORAGE_KEY_IMPORTED_ENTRIES_ACU);
      if (!savedEntriesJson) {
          logDebug_ACU('No imported entries found in storage.');
          return;
      }
      
      let allChunks;
      try {
          allChunks = JSON.parse(savedEntriesJson);
      } catch (e) {
          logError_ACU('Could not parse imported entries from storage.', e);
          await importTempRemove_ACU(STORAGE_KEY_IMPORTED_ENTRIES_ACU);
          void updateImportStatusUI_ACU();
          return;
      }

      if (!Array.isArray(allChunks) || allChunks.length === 0) return;

      // 先获取导入目标世界书
      const importTargetLorebook = await getImportWorldbookTarget_ACU();
      if (!importTargetLorebook) {
          showToastr_ACU('error', '无法注入：未设置导入数据注入目标世界书。');
          return;
      }
      const importTarget = importTargetLorebook === 'character'
        ? await getCurrentCharPrimaryLorebook_ACU()
          : importTargetLorebook;
      if (!importTarget) {
          showToastr_ACU('error', '无法注入：未找到实际导入目标世界书。');
          return;
      }

      // 读取当前表选择（空且曾选择过 => 不允许执行）
      const selectedSheetKeys = getSelectedImportTableKeys_ACU();
      if (settings_ACU.hasImportTableSelection && (!selectedSheetKeys || selectedSheetKeys.length === 0)) {
          showToastr_ACU('error', '未选择任何表格，无法注入。请先在"注入表选择"中勾选至少一个表。');
          return;
      }
      const selectionSig = JSON.stringify(selectedSheetKeys || []);

      if (typeof setImportInjectButtonEnabled_ACU === 'function') setImportInjectButtonEnabled_ACU(false);

      // [重构] 调用 service 层的 initImportDatabase_ACU 初始化/恢复导入数据库
      const initResult = await initImportDatabase_ACU(importTarget, selectedSheetKeys, allChunks, selectionSig);
      if (!initResult.success) {
          showToastr_ACU('error', initResult.error || '导入初始化失败。');
          if (typeof setImportInjectButtonEnabled_ACU === 'function') setImportInjectButtonEnabled_ACU(true);
          return;
      }

      const { status, modeSuffix } = initResult;

      // 自选表格：用统一模式 + 传入 targetSheetKeys，让 AI 只看/只改选中的表
      const updateMode = 'manual_unified';

      for (let i = status!.currentIndex; i < allChunks.length; i++) {
          const chunk = allChunks[i];
          const mockMessage = { is_user: false, mes: chunk.content, name: '导入文本' };
          
          let success = false;
          let attempt = 0;
          const MAX_RETRIES = 3;

          while (attempt < MAX_RETRIES && !success) {
              const toastMessage = `正在处理 ${i + 1}/${allChunks.length} (尝试 ${attempt + 1}/${MAX_RETRIES})...`;
              const updateResult = await proceedWithCardUpdate_ACU([mockMessage], toastMessage, -1, true, updateMode, false, selectedSheetKeys);
              success = updateResult.success;
              
              if (!success) {
                  attempt++;
                  logError_ACU(`处理区块 ${i + 1} 失败, 尝试次数 ${attempt}:`, "Update process returned false.");
                  if (attempt >= MAX_RETRIES) {
                      status!.currentIndex = i;
                      await importTempSet_ACU(STORAGE_KEY_IMPORTED_STATUS_ACU, JSON.stringify(status));
                      showToastr_ACU('error', `处理失败次数过多，操作已终止。请稍后点击"继续"重试。`);
                      void updateImportStatusUI_ACU();
                      if (typeof setImportInjectButtonEnabled_ACU === 'function') setImportInjectButtonEnabled_ACU(true);
                      return;
                  }
                  await new Promise(resolve => setTimeout(resolve, 2000));
              }
          }
          
          // [重构] 调用 service 层的 saveChunkProgress_ACU 保存中间状态
          const saved = await saveChunkProgress_ACU(importTarget, modeSuffix!, status!, i);
          if (!saved) {
              showToastr_ACU('error', `第 ${i + 1} 个分块处理成功，但无法保存临时数据库条目，已停止继续导入。`);
              if (typeof setImportInjectButtonEnabled_ACU === 'function') setImportInjectButtonEnabled_ACU(true);
              return;
          }
      }

      // [重构] 调用 service 层的 finalizeImportAndCleanup_ACU 完成最终注入和清理
      showToastr_ACU('info', `所有文本块已处理完毕，正在生成最终的世界书条目（自选表格注入）...`);
      const finalResult = await finalizeImportAndCleanup_ACU(importTarget, selectedSheetKeys, modeSuffix!, allChunks.length);

      if (finalResult.success) {
          if (finalResult.cleanedCount && finalResult.cleanedCount > 0) {
              showToastr_ACU('info', `外部导入完成：已清理 ${finalResult.cleanedCount} 个旧数据库条目。`);
          }
          showToastr_ACU('success', `外部导入已完成：已注入 ${allChunks.length} 个分块并解除与世界书的绑定。`);
      } else {
          showToastr_ACU('error', finalResult.error || '最终注入失败。');
      }

      void updateImportStatusUI_ACU();
      if (typeof setImportInjectButtonEnabled_ACU === 'function') setImportInjectButtonEnabled_ACU(true);
      }


  // [T176] handleTxtImportAndSplit_ACU 已移到 presentation/components/import-status-ui.ts


export   async function handleInjectImportedTxtSelected_ACU() {
      showToastr_ACU('info', '开始处理导入文件（自选表格注入）...', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT });
      await processImportedTxtAsUpdates_ACU();
  }


export   async function clearImportLocalStorage_ACU(notify = true) {
      try {
          const entriesExist = (await importTempGet_ACU(STORAGE_KEY_IMPORTED_ENTRIES_ACU)) !== null;
          await importTempRemove_ACU(STORAGE_KEY_IMPORTED_ENTRIES_ACU);
          await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_ACU);
          // [新增] 清除所有模式的断点续行状态
          await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU);
          await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU);
          await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_FULL_ACU);
          if (notify && entriesExist) showToastr_ACU('success', '已成功清除导入暂存缓存（IndexedDB）。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT });
          else if (notify && !entriesExist) showToastr_ACU('info', '没有需要清除的导入暂存缓存。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT });
          logDebug_ACU('[外部导入] Cleared imported txt entries and status from temp storage (IndexedDB preferred).');
          // Update the UI to reflect the change
          if (typeof updateImportStatusUI_ACU === 'function') {
              void updateImportStatusUI_ACU();
          }
          return true;
      } catch(error) {
          logError_ACU('[外部导入] Failed to clear import temp storage:', error);
          if (notify) showToastr_ACU('error', '清除导入缓存时出错。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR });
          return false;
      }
  }


export   async function clearImportedEntries_ACU(notify = true) {
    const targetLorebook = await getInjectionTargetLorebook_ACU();
    if (!targetLorebook) {
        showToastr_ACU('error', '无法清除导入条目：未设置数据注入目标。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR });
        return;
    }

    try {
        // [重构] 调用 service 层核心逻辑
        const result = await clearImportedEntriesCore_ACU(targetLorebook);
        if (result.deletedCount > 0) {
            if (notify) showToastr_ACU('success', `成功清除了 ${result.deletedCount} 个导入条目。`, { acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT });
        } else {
            if (notify) showToastr_ACU('info', '没有找到可清除的已注入世界书条目。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT });
        }
        // 更新 UI
        if (typeof updateImportStatusUI_ACU === 'function') {
            void updateImportStatusUI_ACU();
        }
    } catch(error) {
        logError_ACU('Failed to delete imported lorebook entries:', error);
        if (notify) showToastr_ACU('error', '清除导入条目时出错。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR });
    }
  }


export   async function deleteImportedEntries_ACU() {
      const targetLorebook = await getImportWorldbookTarget_ACU();
      if (!targetLorebook) {
          showToastr_ACU('error', '无法删除注入条目：未设置导入数据注入目标世界书。');
          return;
      }

      try {
          // [重构] 调用 service 层核心逻辑
          const deletedCount = await deleteImportedEntriesCore_ACU(targetLorebook);
          if (deletedCount > 0) {
              showToastr_ACU('success', `成功删除了 ${deletedCount} 个外部导入注入的条目。`, { acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT });
          } else {
              showToastr_ACU('info', `在世界书 "${targetLorebook}" 中没有找到符合当前标识的外部导入条目。`, { acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT });
          }
      } catch(error) {
          logError_ACU('Failed to delete imported entries:', error);
          showToastr_ACU('error', '删除注入条目时出错。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR });
    }
  }



  // [T176] getImportWorldbookTarget_ACU 已移到 presentation/components/import-status-ui.ts



  // loadImportedJsonDataFromLorebook_ACU, saveImportedJsonDataToLorebook_ACU, deleteImportedJsonDataFromLorebook_ACU
  // 已搬迁到 service/worldbook/worldbook-service.ts
  // 通过文件顶部的 re-export 保持外部调用方兼容
