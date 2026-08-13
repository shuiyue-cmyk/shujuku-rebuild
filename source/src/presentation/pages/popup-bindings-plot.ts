// popup-bindings-plot.ts
// 剧情推进标签页事件绑定

import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { showToastr_ACU } from '../theme/toast';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU } from '../../shared/utils';
import { jQuery_API_ACU } from '../dom-utils';
import { getCurrentCharacterWorldbookBinding_ACU, getLorebookEntries_ACU } from '../../service/worldbook/worldbook-service';
import { settings_ACU, currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';
import { setGlobalPlotEnabled_ACU } from '../../service/settings/settings-service';
import { $popupInstance_ACU, $plotPromptSegmentsContainer_ACU, $plotTaskListContainer_ACU, _assignUIPlaceholders_ACU } from '../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
import { addPlotTaskFromUI_ACU, deleteCurrentPlotTaskFromUI_ACU, flushCurrentPlotTaskEditorState_ACU, getPlotPromptGroupFromUI_ACU, loadCurrentPlotTaskToUI_ACU, moveCurrentPlotTask_ACU, renderPlotPromptSegments_ACU, renderPlotTaskList_ACU, saveCurrentPlotTaskApiPresetFromUI_ACU, saveCurrentPlotTaskFromUI_ACU, schedulePlotTaskAutoSave_ACU, selectPlotTaskForEditing_ACU } from '../components/plot-editors';
import { appendExcludeRuleRow_ACU, applyGlobalPlotPresetSelectionForEditor_ACU, applyPlotPresetToSettings_ACU, clearPlotPresetBindingForChat_ACU, ensurePlotTasksCompat_ACU, getActivePlotEditorSettings_ACU, getCurrentRuntimePlotPresetName_ACU, getPlotPresetBindingForChat_ACU, isDefaultPlotPresetSelection_ACU, normalizePlotPresetExcludeRules_ACU, normalizePlotPresetSelectionValue_ACU, persistPlotPresetSelectionState_ACU, readExcludeRulesFromRows_ACU, setActivePlotEditorSettings_ACU, setCurrentEditablePlotPresetState_ACU, setPlotPromptContentByIdForSettings_ACU, stripPlotPresetWorldbookEntrySelectionForExport_ACU, switchCurrentChatPlotPreset_ACU } from '../components/optimization-ui';
import { buildDefaultPlotPromptGroup_ACU } from '../../service/plot/plot-state';
import { getCurrentChatPlotScopeState_ACU } from '../../service/template/chat-scope';
import { getCurrentPlotSettingsFromUI_ACU, loadPlotPresetSelect_ACU, loadPlotSettingsToUI_ACU, savePlotPresetAsNew_ACU } from './popup-helpers';
import { refreshPresetUIAfterSwitch_ACU } from '../components/pipeline-ui-helpers';
import { applyWorldbookEntryFilter_ACU, applyWorldbookListFilter_ACU, getPlotWorldbookConfig_ACU, isEntryBlocked_ACU, populatePlotWorldbookEntryList_ACU, renderLazyWorldbookEntryItems_ACU, toggleLazyWorldbookEntryGroup_ACU, updateLazyWorldbookEntryCheckedState_ACU, updatePlotWorldbookSourceView_ACU } from '../components/worldbook-selector';
import { getLorebookEntriesByNames_ACU, getWorldBooks_ACU } from '../../service/worldbook/pipeline';

/**
 * 绑定剧情推进标签页的所有事件（含剧情推进世界书）
 */
export async function bindPlotEvents_ACU(): Promise<void> {
      // --- [剧情推进] UI事件绑定 ---
      // 剧情推进功能开关
      const $plotEnabledCheckbox = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-enabled`);
      if ($plotEnabledCheckbox.length) {
        $plotEnabledCheckbox.on('change', function(this: HTMLElement) {
          setGlobalPlotEnabled_ACU(jQuery_API_ACU(this).is(':checked'));
          saveSettingsAndNotify_ACU();
        });
      }


      // 剧情推进：独立提示词组 + 最终注入指令
      // 1) 最终注入指令仍使用原字段（兼容旧数据/旧编辑器）
      const $plotFinalDirective = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-final-directive`);
      if ($plotFinalDirective.length) {
        $plotFinalDirective.on('input change', function(this: HTMLElement) {
          const value = jQuery_API_ACU(this).val() as string || '';
          const plotSettings = getActivePlotEditorSettings_ACU();
          if (!plotSettings) return;
          plotSettings.finalSystemDirective = value;
          setPlotPromptContentByIdForSettings_ACU(plotSettings, 'finalSystemDirective', value);
          saveSettingsAndNotify_ACU();
        });
      }

      // 2) 独立提示词组编辑器（段落）
      _assignUIPlaceholders_ACU({
        $plotPromptSegmentsContainer_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-prompt-segments-container`),
        $plotTaskListContainer_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-list`),
      });

      // 初次载入：若缺失 plotTasks / promptGroup，则从旧结构迁移生成
      try {
        setActivePlotEditorSettings_ACU(settings_ACU.plotSettings);
        ensurePlotTasksCompat_ACU(settings_ACU.plotSettings, { persist: true, syncLegacy: true });
      } catch (e) {}
      try {
        renderPlotTaskList_ACU();
        loadCurrentPlotTaskToUI_ACU();
      } catch (e) {}

      // 任务切换/新增/删除/排序
      $popupInstance_ACU.on('click', '.acu-plot-task-item', function(this: HTMLElement) {
        const taskId = jQuery_API_ACU(this).data('task-id');
        if (!taskId) return;
        selectPlotTaskForEditing_ACU(taskId, { saveCurrent: true });
      });
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-add`).on('click', function(this: HTMLElement) {
        addPlotTaskFromUI_ACU();
      });
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-delete`).on('click', function(this: HTMLElement) {
        deleteCurrentPlotTaskFromUI_ACU();
      });
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-move-up`).on('click', function(this: HTMLElement) {
        moveCurrentPlotTask_ACU('up');
      });
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-move-down`).on('click', function(this: HTMLElement) {
        moveCurrentPlotTask_ACU('down');
      });

      // 添加段落
      $popupInstance_ACU.on('click', `.${SCRIPT_ID_PREFIX_ACU}-plot-add-prompt-segment-btn`, function(this: HTMLElement) {
        const position = jQuery_API_ACU(this).data('position');
        const newSegment = { role: 'USER', content: '', deletable: true };
        let segments = getPlotPromptGroupFromUI_ACU();
        if (position === 'top') segments.unshift(newSegment);
        else segments.push(newSegment);
        renderPlotPromptSegments_ACU(segments);
        schedulePlotTaskAutoSave_ACU({ renderTaskList: false });
      });

      // 删除段落
      $popupInstance_ACU.on('click', '.plot-prompt-segment-delete-btn', function(this: HTMLElement) {
        const indexToDelete = jQuery_API_ACU(this).data('index');
        let segments = getPlotPromptGroupFromUI_ACU();
        segments.splice(indexToDelete, 1);
        renderPlotPromptSegments_ACU(segments);
        schedulePlotTaskAutoSave_ACU({ renderTaskList: false });
      });

      // A/B 槽位唯一
      $popupInstance_ACU.on('change', '.plot-prompt-segment-main-slot', function(this: HTMLElement) {
        const $currentSegment = jQuery_API_ACU(this).closest('.plot-prompt-segment');
        const selected = String(jQuery_API_ACU(this).val() || '').toUpperCase();

        if (selected === 'A' || selected === 'B') {
          $plotPromptSegmentsContainer_ACU
            .find('.plot-prompt-segment')
            .not($currentSegment)
            .each(function(this: HTMLElement) {
              const $seg = jQuery_API_ACU(this);
              const v = String($seg.find('.plot-prompt-segment-main-slot').val() || '').toUpperCase();
              if (v === selected) {
                $seg.find('.plot-prompt-segment-main-slot').val('');
              }
            });
        }

        // 刷新样式/删除按钮
        $plotPromptSegmentsContainer_ACU.find('.plot-prompt-segment').each(function(this: HTMLElement) {
          const $seg = jQuery_API_ACU(this);
          const slot = String($seg.find('.plot-prompt-segment-main-slot').val() || '').toUpperCase();
          const isA = slot === 'A';
          const isB = slot === 'B';
          const isMain = isA || isB;
          const borderColor = isA ? 'var(--accent-primary)' : (isB ? '#ffb74d' : '');
          if (isMain) {
            $seg.css('border-left', `3px solid ${borderColor}`).attr('data-main-slot', slot);
            $seg.find('.plot-prompt-segment-delete-btn').hide();
          } else {
            $seg.css('border-left', '').attr('data-main-slot', '');
            $seg.find('.plot-prompt-segment-delete-btn').show();
          }
        });
        schedulePlotTaskAutoSave_ACU({ renderTaskList: false });
      });

      $popupInstance_ACU.on('input change', '.plot-prompt-segment-role, .plot-prompt-segment-content', function(this: HTMLElement) {
        schedulePlotTaskAutoSave_ACU({ renderTaskList: false });
      });

      // 任务基础信息自动保存
      [
        `#${SCRIPT_ID_PREFIX_ACU}-plot-task-name`,
        `#${SCRIPT_ID_PREFIX_ACU}-plot-extract-tags`,
        `#${SCRIPT_ID_PREFIX_ACU}-plot-extract-inject-tags`,
        `#${SCRIPT_ID_PREFIX_ACU}-plot-min-length`,
        `#${SCRIPT_ID_PREFIX_ACU}-plot-task-stage`,
        `#${SCRIPT_ID_PREFIX_ACU}-plot-task-max-retries`,
      ].forEach(selector => {
        $popupInstance_ACU.on('input change', selector, function(this: HTMLElement) {
          schedulePlotTaskAutoSave_ACU({ renderTaskList: true });
        });
      });
      $popupInstance_ACU.on('change', `#${SCRIPT_ID_PREFIX_ACU}-plot-task-enabled`, function(this: HTMLElement) {
        saveCurrentPlotTaskFromUI_ACU({ silent: true, renderTaskList: true, persist: true });
        loadCurrentPlotTaskToUI_ACU();
      });
      $popupInstance_ACU.on('change', `#${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset`, function(this: HTMLElement) {
        saveCurrentPlotTaskApiPresetFromUI_ACU({ persist: true });
      });

      // 匹配替换速率保存
      const plotRateInputs = [
        { id: 'plot-rate-main', key: 'rateMain', defaultValue: 1.0 },
        { id: 'plot-rate-personal', key: 'ratePersonal', defaultValue: 1.0 },
        { id: 'plot-rate-erotic', key: 'rateErotic', defaultValue: 0 },
        { id: 'plot-rate-cuckold', key: 'rateCuckold', defaultValue: 1.0 },
        { id: 'plot-recall-count', key: 'recallCount', defaultValue: 20 }
      ];

      plotRateInputs.forEach(({ id, key, defaultValue }) => {
        const $input = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${id}`);
        if ($input.length) {
          $input.on('input change', function(this: HTMLElement) {
            const plotSettings = getActivePlotEditorSettings_ACU();
            if (!plotSettings) return;
            plotSettings[key] = parseFloat(jQuery_API_ACU(this).val() as string) || defaultValue;
            saveSettingsAndNotify_ACU();
          });
        }
      });

      // 剧情推进其他全局参数自动保存（不含任务私有参数）
      const plotPersistentInputs = [
        { id: 'plot-context-turn-count', key: 'contextTurnCount', type: 'number' },
      ];

      plotPersistentInputs.forEach(({ id, key, type }) => {
        const $input = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${id}`);
        if ($input.length) {
          $input.on('input change', function(this: HTMLElement) {
            const plotSettings = getActivePlotEditorSettings_ACU();
            if (!plotSettings) return;

            let value: string | number = jQuery_API_ACU(this).val() as string;
            if (type === 'number') {
              value = parseFloat(value) || 0;
            }

            if (key.includes('.')) {
              const [parent, child] = key.split('.');
              if (!plotSettings[parent]) {
                plotSettings[parent] = {};
              }
              plotSettings[parent][child] = value;
            } else {
              plotSettings[key] = value;
            }

            saveSettingsAndNotify_ACU();
          });
        }
      });

      // 剧情推进正文标签提取规则编辑器
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-add-rule`).on('click', function(this: HTMLElement) {
        appendExcludeRuleRow_ACU(
          `#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules`,
          { startPlaceholder: '开始词（例如：<think）', endPlaceholder: '结束词（例如：</think>）' },
        );
      });
      $popupInstance_ACU.on('input', `#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules .acu-exclude-rule-start, #${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules .acu-exclude-rule-end`, function(this: HTMLElement) {
        const plotSettings = getActivePlotEditorSettings_ACU();
        if (!plotSettings) return;
        plotSettings.contextExtractRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules`);
        saveSettingsAndNotify_ACU();
      });
      $popupInstance_ACU.on('click', `#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules .acu-exclude-rule-delete`, function(this: HTMLElement) {
        const plotSettings = getActivePlotEditorSettings_ACU();
        if (!plotSettings) return;
        const $row = jQuery_API_ACU(this).closest('.acu-exclude-rule-row');
        if ($row.length) $row.remove();
        plotSettings.contextExtractRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules`);
        saveSettingsAndNotify_ACU();
      });

      // 剧情推进标签排除规则编辑器
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-add-rule`).on('click', function(this: HTMLElement) {
        appendExcludeRuleRow_ACU(
          `#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules`,
          { startPlaceholder: '开始词（例如：<thinking）', endPlaceholder: '结束词（例如：</thinking>）' },
        );
      });
      $popupInstance_ACU.on('input', `#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules .acu-exclude-rule-start, #${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules .acu-exclude-rule-end`, function(this: HTMLElement) {
        const plotSettings = getActivePlotEditorSettings_ACU();
        if (!plotSettings) return;
        plotSettings.contextExcludeRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules`);
        saveSettingsAndNotify_ACU();
      });
      $popupInstance_ACU.on('click', `#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules .acu-exclude-rule-delete`, function(this: HTMLElement) {
        const plotSettings = getActivePlotEditorSettings_ACU();
        if (!plotSettings) return;
        const $row = jQuery_API_ACU(this).closest('.acu-exclude-rule-row');
        if ($row.length) $row.remove();
        plotSettings.contextExcludeRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules`);
        saveSettingsAndNotify_ACU();
      });

      // 预设管理（全局负责管理，当前聊天仅负责切换使用）
      const $plotPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-preset-select`);
      const $plotImportPresets = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-import-presets`);
      const $plotExportPresets = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-export-presets`);
      const $plotSavePreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-save-preset`);
      const $plotSaveAsNewPreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-save-as-new-preset`);
      const $plotResetDefaults = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-reset-defaults`);
      const $plotDeletePreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-delete-preset`);
      const $plotPresetFileInput = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-preset-file-input`);
      const $plotChatPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-chat-preset-select`);

      // 第一步：全局预设选择事件
      if ($plotPresetSelect.length) {
        $plotPresetSelect.on('change', function(this: HTMLElement) {
          flushCurrentPlotTaskEditorState_ACU({ renderTaskList: false, persist: true });
          const selectedName = normalizePlotPresetSelectionValue_ACU(jQuery_API_ACU(this).val());
          const result = applyGlobalPlotPresetSelectionForEditor_ACU(selectedName, {
            source: 'ui_global_select',
            save: true,
          });

          if (!result) {
            showToastr_ACU('error', '找不到选中的全局预设。');
          }
          // 无论成功或失败，统一刷新所有预设相关 UI
          refreshPresetUIAfterSwitch_ACU();
        });
      }

      // 第二步：当前聊天预设选择事件（这里只负责切换当前聊天使用的预设）
      if ($plotChatPresetSelect.length) {
        $plotChatPresetSelect.on('change', function(this: HTMLElement) {
          flushCurrentPlotTaskEditorState_ACU({ renderTaskList: false, persist: true });
          const selectedName = normalizePlotPresetSelectionValue_ACU(jQuery_API_ACU(this).val());
          const result = switchCurrentChatPlotPreset_ACU(selectedName, {
            source: 'ui',
            save: true,
          });

          if (!result) {
            showToastr_ACU('error', '找不到选中的当前聊天预设。');
            refreshPresetUIAfterSwitch_ACU();
            return;
          }

          // 切换成功：统一刷新所有预设相关 UI（下拉框、状态文案、状态卡片、独立窗口）
          refreshPresetUIAfterSwitch_ACU();
          showToastr_ACU(
            'success',
            result.followsGlobal
              ? '当前聊天已改为跟随全局剧情推进预设。'
              : `当前聊天已切换到预设 "${result.presetName}"。`,
          );
        });
      }


      // 导入全局预设
      if ($plotImportPresets.length) {
        $plotImportPresets.on('click', function(this: HTMLElement) {
          $plotPresetFileInput.click();
        });
      }

      // 导出全局预设
      if ($plotExportPresets.length) {
        $plotExportPresets.on('click', function(this: HTMLElement) {
          const selectedName = normalizePlotPresetSelectionValue_ACU($plotPresetSelect.val());
          if (isDefaultPlotPresetSelection_ACU(selectedName)) {
            showToastr_ACU('info', '默认预设不支持直接导出，请先另存为自定义预设。');
            return;
          }

          const presets = settings_ACU.plotSettings.promptPresets || [];
          const selectedPreset = presets.find((p: any) => p.name === selectedName);

          if (!selectedPreset) {
            showToastr_ACU('error', '找不到选中的全局预设。');
            return;
          }

          const exportPreset = stripPlotPresetWorldbookEntrySelectionForExport_ACU(selectedPreset);
          const dataStr = JSON.stringify([exportPreset], null, 2);
          const blob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);

          const a = document.createElement('a');
          a.href = url;
          a.download = `plot_preset_${selectedName.replace(/[^a-z0-9]/gi, '_')}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          showToastr_ACU('success', `全局预设 "${selectedName}" 已成功导出。`);
        });
      }

      // 保存全局预设
      if ($plotSavePreset.length) {
        $plotSavePreset.on('click', function(this: HTMLElement) {
          const selectedName = normalizePlotPresetSelectionValue_ACU($plotPresetSelect.val());
          if (isDefaultPlotPresetSelection_ACU(selectedName)) {
            // 如果当前是默认预设，则等同于"另存为新的全局预设"
            savePlotPresetAsNew_ACU();
            return;
          }

          if (!confirm(`确定要用当前设置覆盖全局预设 "${selectedName}" 吗？`)) {
            return;
          }

          const presets = settings_ACU.plotSettings.promptPresets || [];
          const existingIndex = presets.findIndex((p: any) => p.name === selectedName);

          if (existingIndex === -1) {
            showToastr_ACU('error', '找不到要覆盖的全局预设。');
            return;
          }

          const currentSettings = getCurrentPlotSettingsFromUI_ACU();
          if (!currentSettings || typeof currentSettings !== 'object') {
            showToastr_ACU('error', '读取当前剧情推进设置失败。');
            return;
          }

          const savedPreset = normalizePlotPresetExcludeRules_ACU({ name: selectedName, ...currentSettings });
          const currentRuntimePresetName = getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });

          presets[existingIndex] = savedPreset;
          settings_ACU.plotSettings.promptPresets = presets;

          if (normalizePlotPresetSelectionValue_ACU(currentRuntimePresetName) === selectedName) {
            applyPlotPresetToSettings_ACU(settings_ACU.plotSettings, savedPreset);
          }

          setCurrentEditablePlotPresetState_ACU(selectedName, {
            scope: 'global',
            source: 'ui_global_save',
          });
          persistPlotPresetSelectionState_ACU(selectedName, { source: 'ui_global_save', updateGlobal: true, save: false });
          saveSettingsAndNotify_ACU();
          refreshPresetUIAfterSwitch_ACU();
          showToastr_ACU('success', `全局预设 "${selectedName}" 已被成功覆盖。`);
        });
      }

      // 另存为新的全局预设
      if ($plotSaveAsNewPreset.length) {
        $plotSaveAsNewPreset.on('click', function(this: HTMLElement) {
          savePlotPresetAsNew_ACU();
        });
      }

      // 删除全局预设
      if ($plotDeletePreset.length) {
        $plotDeletePreset.on('click', function(this: HTMLElement) {
          const selectedName = normalizePlotPresetSelectionValue_ACU($plotPresetSelect.val());
          if (isDefaultPlotPresetSelection_ACU(selectedName)) {
            showToastr_ACU('warning', '默认全局预设不能删除。');
            return;
          }

          if (!confirm(`确定要删除全局预设 "${selectedName}" 吗？`)) {
            return;
          }

          const presets = settings_ACU.plotSettings.promptPresets || [];
          const indexToDelete = presets.findIndex((p: any) => p.name === selectedName);

          if (indexToDelete > -1) {
            presets.splice(indexToDelete, 1);
            settings_ACU.plotSettings.promptPresets = presets;

            const shouldResetGlobalSelection = normalizePlotPresetSelectionValue_ACU(settings_ACU.plotSettings.lastUsedPresetName || '') === selectedName;
            const chatScopeState = getCurrentChatPlotScopeState_ACU();
            const currentBinding = getPlotPresetBindingForChat_ACU();
            if (shouldResetGlobalSelection) {
              settings_ACU.plotSettings.lastUsedPresetName = '';
            }
            if (!chatScopeState && currentBinding && normalizePlotPresetSelectionValue_ACU(currentBinding.presetName || '') === selectedName) {
              clearPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU);
            }

            saveSettingsAndNotify_ACU();

            // 刷新预设选择器 + 状态卡片 + 可视化编辑器
            refreshPresetUIAfterSwitch_ACU();
            showToastr_ACU('success', `全局预设 "${selectedName}" 已被删除。`);
          } else {
            showToastr_ACU('error', '找不到要删除的全局预设。');
          }
        });
      }

      // 恢复全局默认提示词
      if ($plotResetDefaults.length) {
        $plotResetDefaults.on('click', function(this: HTMLElement) {
          if (!confirm('确定要恢复全局默认的剧情推进提示词吗？这将覆盖当前的提示词设置，并重置"标签摘取"。')) {
            return;
          }

          flushCurrentPlotTaskEditorState_ACU({ renderTaskList: false, persist: true });
          const result = applyGlobalPlotPresetSelectionForEditor_ACU('', {
            source: 'ui_global_reset',
            save: true,
          });

          if (!result) {
            showToastr_ACU('error', '恢复全局默认预设失败。');
            return;
          }

          showToastr_ACU('success', '全局剧情推进提示词与"标签摘取"已恢复为默认值。');
        });
      }

      // 全局预设文件导入
      if ($plotPresetFileInput.length) {
        $plotPresetFileInput.on('change', function(this: HTMLElement, e: Event) {
          const file = ((e.target as HTMLInputElement).files || [])[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = function(e: ProgressEvent<FileReader>) {
            try {
              const importedPresets = JSON.parse(String(e.target?.result || ''));

              if (!Array.isArray(importedPresets)) {
                throw new Error('JSON文件格式不正确，根节点必须是一个数组。');
              }

              let currentPresets = settings_ACU.plotSettings.promptPresets || [];
              let importedCount = 0;
              let overwrittenCount = 0;

              importedPresets.forEach((preset: any) => {
                if (preset && typeof preset.name === 'string' && preset.name.length > 0) {
                  const getLegacyPromptFromThree_ACU = (p: any, id: any) => {
                    if (!p) return '';
                    if (Array.isArray(p)) return (p.find(x => x && x.id === id)?.content) || '';
                    if (typeof p === 'object') return p[id] || '';
                    return '';
                  };
                  const looksLikePromptGroupSegments = (arr: any) => {
                    if (!Array.isArray(arr) || arr.length === 0) return false;
                    const x = arr[0];
                    return x && typeof x === 'object' && 'role' in x && 'content' in x && !('id' in x);
                  };

                  // 兼容导入：新格式(promptGroup) / 某些导出用 prompts 存了段落数组 / 旧格式(三段提示词)
                  let promptGroup = null;
                  if (Array.isArray(preset.promptGroup) && preset.promptGroup.length) {
                    promptGroup = JSON.parse(JSON.stringify(preset.promptGroup));
                  } else if (looksLikePromptGroupSegments(preset.prompts)) {
                    promptGroup = JSON.parse(JSON.stringify(preset.prompts));
                  } else {
                    const legacyMain = preset.mainPrompt || getLegacyPromptFromThree_ACU(preset.prompts, 'mainPrompt') || '';
                    const legacySystem = preset.systemPrompt || getLegacyPromptFromThree_ACU(preset.prompts, 'systemPrompt') || '';
                    promptGroup = buildDefaultPlotPromptGroup_ACU({ mainAContent: legacyMain, mainBContent: legacySystem });
                  }

                  const finalDirective =
                    preset.finalSystemDirective ||
                    preset.finalDirective ||
                    getLegacyPromptFromThree_ACU(preset.prompts, 'finalSystemDirective') ||
                    '';

                  const presetData = normalizePlotPresetExcludeRules_ACU({
                    name: preset.name,
                    promptGroup: promptGroup,
                    plotTasks: Array.isArray(preset.plotTasks) ? JSON.parse(JSON.stringify(preset.plotTasks)) : undefined,
                    finalSystemDirective: finalDirective,
                    rateMain: preset.rateMain ?? 1.0,
                    ratePersonal: preset.ratePersonal ?? 1.0,
                    rateErotic: preset.rateErotic ?? 0,
                    rateCuckold: preset.rateCuckold ?? 1.0,
                    recallCount: preset.recallCount ?? 20,
                    extractTags: preset.extractTags || '',
                    contextExtractRules: normalizeExtractRules_ACU(preset.contextExtractRules, preset.contextExtractTags || ''),
                    contextExcludeRules: normalizeExcludeRules_ACU(preset.contextExcludeRules, preset.contextExcludeTags || ''),
                    minLength: preset.minLength ?? 0,
                    contextTurnCount: preset.contextTurnCount ?? 3,
                    loopSettings: preset.loopSettings || DEFAULT_PLOT_SETTINGS_ACU.loopSettings
                  });

                  const existingIndex = currentPresets.findIndex((p: any) => p.name === preset.name);

                  if (existingIndex !== -1) {
                    currentPresets[existingIndex] = presetData;
                    overwrittenCount++;
                  } else {
                    currentPresets.push(presetData);
                    importedCount++;
                  }
                }
              });

              if (importedCount > 0 || overwrittenCount > 0) {
                settings_ACU.plotSettings.promptPresets = currentPresets;
                saveSettingsAndNotify_ACU();
                refreshPresetUIAfterSwitch_ACU();

                let messages = [];
                if (importedCount > 0) messages.push(`成功导入 ${importedCount} 个新预设。`);
                if (overwrittenCount > 0) messages.push(`成功覆盖 ${overwrittenCount} 个同名预设。`);
                showToastr_ACU('success', messages.join(' '));

                // 导入后：自动选择第一个有效全局预设并加载到UI（方便继续修改）
                const firstValid = importedPresets.find((p: any) => p && typeof p.name === 'string' && p.name.length > 0);
                if (firstValid && $plotPresetSelect && $plotPresetSelect.length) {
                  setTimeout(() => {
                    $plotPresetSelect.val(firstValid.name).trigger('change');
                  }, 50);
                }
              } else {
                showToastr_ACU('warning', '未找到可导入的有效预设。');
              }
            } catch (error) {
              logError_ACU('[剧情推进] 导入预设失败:', error);
              showToastr_ACU('error', `导入失败: ${error.message}`);
            } finally {
              // 清空文件输入框
              $plotPresetFileInput.val('');
            }
          };
          reader.readAsText(file);
        });
      }

      // 中止按钮绑定将在剧情规划开始时动态绑定

      // 加载剧情推进设置到UI
      loadPlotSettingsToUI_ACU();


      // [剧情推进] 世界书选择 UI 绑定（独立）
      try {
        const cfg = getPlotWorldbookConfig_ACU();
        const $plotWbRadios = $popupInstance_ACU.find(`input[name="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-source"]`);
        if ($plotWbRadios.length) {
          $plotWbRadios.filter(`[value="${cfg.source || 'character'}"]`).prop('checked', true);
          $plotWbRadios.off('change.acu_plot_wb').on('change.acu_plot_wb', async function(this: HTMLElement) {
            const v = jQuery_API_ACU(this).val();
            cfg.source = (v === 'manual') ? 'manual' : 'character';
            saveSettingsAndNotify_ACU();
            await updatePlotWorldbookSourceView_ACU();
          });
        }

        // 手动选择：世界书列表点击切换选中
        const $plotWbList = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select`);
        const $plotWbListFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select-filter`);
        const $plotEntryFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-entry-filter`);
        if ($plotWbList.length) {
          $plotWbList.off('click.acu_plot_wb').on('click.acu_plot_wb', '.qrf_worldbook_list_item', async function(this: HTMLElement) {
            const bookName = jQuery_API_ACU(this).data('book-name');
            if (!bookName) return;
            let selection = Array.isArray(cfg.manualSelection) ? cfg.manualSelection : [];
            if (selection.includes(bookName)) selection = selection.filter((x: any) => x !== bookName);
            else selection = [...selection, bookName];
            cfg.manualSelection = selection;
            saveSettingsAndNotify_ACU();
            await updatePlotWorldbookSourceView_ACU();
          });
        }
        if ($plotWbListFilter.length) {
          $plotWbListFilter.off('input.acu_plot_wb').on('input.acu_plot_wb', function(this: HTMLElement) {
            applyWorldbookListFilter_ACU($plotWbList, jQuery_API_ACU(this).val());
          });
        }

        const $plotSelectAll = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select-all`);
        const $plotDeselectAll = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-deselect-all`);
        // 兼容旧id（如果用户未更新UI片段或缓存导致旧节点仍在）
        const $plotSelectNoneLegacy = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select-none`);
        const resolvePlotBookNames_ACU = async () => {
          if ((cfg.source || 'character') === 'manual') return Array.isArray(cfg.manualSelection) ? cfg.manualSelection : [];
          return (await getCurrentCharacterWorldbookBinding_ACU()).orderedNames;
        };
        const isPlotEntryAllowed_ACU = (entry: any) => {
          if (!entry) return false;
          const comment = entry.comment || entry.name || '';
          // UI 不显示数据库生成条目（含隔离/外部导入前缀），因此"全选/全不选"也只作用于非数据库条目
          let normalizedComment = String(comment).replace(/^ACU-\[[^\]]+\]-/, '');
          normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');
          if (normalizedComment.startsWith('TavernDB-ACU-OutlineTable')) return false; // 仍需屏蔽总结大纲
          const isDbGenerated =
            normalizedComment.startsWith('TavernDB-ACU-') ||
            normalizedComment.startsWith('总结条目') ||
            normalizedComment.startsWith('小总结条目') ||
            normalizedComment.startsWith('重要人物条目');
          if (isDbGenerated) return false;
          if (isEntryBlocked_ACU(entry)) return false;
          // "启用的世界书条目"按钮应只勾选 ST 本身启用的条目（否则勾选了也不会被使用）
          if (!entry.enabled) return false;
          return true;
        };
        const reportPlotWorldbookActionFailure_ACU = (phase: string) => {
          logError_ACU('[剧情推进] Plot worldbook action failed:', {
            phase,
            error: { category: 'unknown' },
          });
          showToastr_ACU('error', '剧情世界书操作失败，请重试。');
        };
        const setPlotEntriesSelection_ACU = async (mode: string) => {
          // mode: 'all' | 'none'
          let bookNames: string[];
          try {
            bookNames = await resolvePlotBookNames_ACU();
          } catch {
            reportPlotWorldbookActionFailure_ACU('plot_character_binding');
            return;
          }

          let allBooks: any[];
          try {
            allBooks = await getWorldBooks_ACU();
          } catch {
            reportPlotWorldbookActionFailure_ACU('plot_worldbook_selection_catalog');
            return;
          }

          const nextEnabledEntries = { ...(cfg.enabledEntries || {}) };
          for (const bookName of bookNames) {
            let entries: any[];
            const bookData = allBooks.find(b => b.name === bookName);
            if (bookData?.entries?.length) {
              entries = bookData.entries;
            } else {
              try {
                entries = await getLorebookEntries_ACU(bookName);
              } catch {
                reportPlotWorldbookActionFailure_ACU('plot_worldbook_selection_entries');
                return;
              }
            }

            if (mode === 'none') {
              nextEnabledEntries[bookName] = [];
            } else {
              nextEnabledEntries[bookName] = entries.filter(isPlotEntryAllowed_ACU).map(e => e.uid);
            }
          }

          cfg.enabledEntries = nextEnabledEntries;
          saveSettingsAndNotify_ACU();
          await populatePlotWorldbookEntryList_ACU(); // 立即刷新UI，显示勾选/取消
        };

        if ($plotSelectAll.length) {
          $plotSelectAll.off('click.acu_plot_wb').on('click.acu_plot_wb', async function(this: HTMLElement) {
            try {
              await setPlotEntriesSelection_ACU('all');
            } catch {
              reportPlotWorldbookActionFailure_ACU('plot_worldbook_selection');
            }
          });
        }
        if ($plotDeselectAll.length) {
          $plotDeselectAll.off('click.acu_plot_wb').on('click.acu_plot_wb', async function(this: HTMLElement) {
            try {
              await setPlotEntriesSelection_ACU('none');
            } catch {
              reportPlotWorldbookActionFailure_ACU('plot_worldbook_selection');
            }
          });
        }
        if ($plotSelectNoneLegacy.length) {
          $plotSelectNoneLegacy.off('click.acu_plot_wb').on('click.acu_plot_wb', async function(this: HTMLElement) {
            try {
              await setPlotEntriesSelection_ACU('none');
            } catch {
              reportPlotWorldbookActionFailure_ACU('plot_worldbook_selection');
            }
          });
        }

        const $plotRefreshWorldbooks = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-refresh-worldbooks`);
        if ($plotRefreshWorldbooks.length) {
          $plotRefreshWorldbooks.off('click.acu_plot_wb').on('click.acu_plot_wb', async function(this: HTMLElement) {
            await updatePlotWorldbookSourceView_ACU();
          });
        }

        // 条目勾选
        const $plotEntryList = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-entry-list`);
        if ($plotEntryList.length) {
          $plotEntryList.off('change.acu_plot_wb').on('change.acu_plot_wb', 'input[type="checkbox"]', function(this: HTMLElement) {
            const bookName = jQuery_API_ACU(this).data('book');
            const uid = jQuery_API_ACU(this).data('uid');
            if (!bookName || uid === undefined || uid === null) return;
            if (!cfg.enabledEntries) cfg.enabledEntries = {};
            if (!Array.isArray(cfg.enabledEntries[bookName])) cfg.enabledEntries[bookName] = [];
            const list = cfg.enabledEntries[bookName];
            const checked = jQuery_API_ACU(this).is(':checked');
            if (checked && !list.includes(uid)) list.push(uid);
            if (!checked && list.includes(uid)) cfg.enabledEntries[bookName] = list.filter((x: any) => x !== uid);
            updateLazyWorldbookEntryCheckedState_ACU($plotEntryList, bookName, uid, checked);
            saveSettingsAndNotify_ACU();
          });
          $plotEntryList.off('click.acu_plot_wb_toggle').on('click.acu_plot_wb_toggle', '.qrf_worldbook_entry_toggle', function(this: HTMLElement) {
            const bookName = jQuery_API_ACU(this).closest('.qrf_worldbook_entry_group').data('book-name');
            if (!bookName) return;
            toggleLazyWorldbookEntryGroup_ACU($plotEntryList, bookName);
          });
          $plotEntryList.off('click.acu_plot_wb_more').on('click.acu_plot_wb_more', '.qrf_worldbook_entry_load_more', function(this: HTMLElement) {
            const bookName = jQuery_API_ACU(this).closest('.qrf_worldbook_entry_group').data('book-name');
            if (!bookName) return;
            renderLazyWorldbookEntryItems_ACU($plotEntryList, bookName);
          });
        }
        if ($plotEntryFilter.length) {
          $plotEntryFilter.off('input.acu_plot_wb').on('input.acu_plot_wb', function(this: HTMLElement) {
            applyWorldbookEntryFilter_ACU($plotEntryList, jQuery_API_ACU(this).val() as string);
          });
        }

        await updatePlotWorldbookSourceView_ACU();
      } catch {
        logWarn_ACU('[剧情推进] Plot worldbook UI bind failed:', {
          phase: 'plot_worldbook_ui_bind',
          error: { category: 'unknown' },
        });
      }


}
