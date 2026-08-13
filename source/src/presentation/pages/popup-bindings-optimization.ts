// popup-bindings-optimization.ts
// 正文替换标签页事件绑定

import { showToastr_ACU } from '../theme/toast';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { jQuery_API_ACU } from '../dom-utils';
import { getActivePinia } from 'pinia';
import { settings_ACU } from '../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
import { appendExcludeRuleRow_ACU, getLastOptimizedMessageIndex_ACU, readExcludeRulesFromRows_ACU, reoptimizeMessage_ACU } from '../components/optimization-ui';
import { buildDefaultContentOptimizationPromptGroup_ACU, performContentOptimization_ACU } from '../../service/optimization/content-optimization';
import { getOptimizationPromptGroupFromUI_ACU, loadOptimizationPresetSelect_ACU, loadOptimizationSettingsToUI_ACU, renderOptimizationPromptSegments_ACU, saveOptimizationPresetAsNew_ACU } from './popup-helpers';
import { refreshApiPresetSelectors_ACU } from '../triggers/settings-ui-sync';
import { setContentReplaceEnabledBySettings } from '../../presentation-v2/stores/content-replace-gate';
import { useRouterStore } from '../../presentation-v2/stores/router-store';
import { FEATURE_GATE_CONTENT_REPLACE } from '../../presentation-v2/router/page-registry';

/**
 * 绑定正文替换标签页的所有事件
 */
export async function bindOptimizationEvents_ACU(): Promise<void> {
      // --- [正文替换] UI事件绑定 ---
      // 正文替换功能开关（走统一 gate：写入 enabledSwitchTouched/enabledPreference，
      // 与 V2 仪表盘开关状态一致，避免被 syncContentReplaceAvailability 静默撤销；
      // 并同步 V2 侧边栏正文替换页可见性）
      const $optimizationEnabledCheckbox = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-enabled`);
      if ($optimizationEnabledCheckbox.length) {
        $optimizationEnabledCheckbox.on('change', function() {
          const enabled = setContentReplaceEnabledBySettings(jQuery_API_ACU(this).is(':checked'));
          saveSettingsAndNotify_ACU();
          // V2 面板从未打开时 pinia 未初始化，跳过侧栏同步（设置已正确落盘）
          if (getActivePinia()) {
            useRouterStore().syncFeatureGate(FEATURE_GATE_CONTENT_REPLACE, enabled);
          }
        });
      }

      // API预设选择
      const $optimizationApiPreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-api-preset`);
      if ($optimizationApiPreset.length) {
        $optimizationApiPreset.on('change', function() {
          settings_ACU.contentOptimizationSettings.apiPreset = jQuery_API_ACU(this).val();
          saveSettingsAndNotify_ACU();
        });
      }

      // 最小优化长度
      const $optimizationMinLength = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-min-length`);
      if ($optimizationMinLength.length) {
        $optimizationMinLength.on('input change', function() {
          const val = parseInt(jQuery_API_ACU(this).val() as string, 10);
          if (!isNaN(val) && val >= 0) {
            settings_ACU.contentOptimizationSettings.minLength = val;
            saveSettingsAndNotify_ACU();
          }
        });
      }

      // 最大优化项数
      const $optimizationMaxItems = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-max-items`);
      if ($optimizationMaxItems.length) {
        $optimizationMaxItems.on('input change', function() {
          const val = parseInt(jQuery_API_ACU(this).val() as string, 10);
          if (!isNaN(val) && val >= 1 && val <= 100) {
            settings_ACU.contentOptimizationSettings.maxOptimizations = val;
            saveSettingsAndNotify_ACU();
          }
        });
      }

      // [新增] 循环优化次数
      const $optimizationLoopCount = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-loop-count`);
      if ($optimizationLoopCount.length) {
        $optimizationLoopCount.on('input change', function() {
          const val = parseInt(jQuery_API_ACU(this).val() as string, 10);
          if (!isNaN(val) && val >= 1 && val <= 10) {
            settings_ACU.contentOptimizationSettings.loopCount = val;
            saveSettingsAndNotify_ACU();
          }
        });
      }

      // [新增] 自动重试次数
      const $optimizationRetryCount = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-retry-count`);
      if ($optimizationRetryCount.length) {
        $optimizationRetryCount.on('input change', function() {
          const val = parseInt(jQuery_API_ACU(this).val() as string, 10);
          if (!isNaN(val) && val >= 1 && val <= 10) {
            settings_ACU.contentOptimizationSettings.retryCount = val;
            saveSettingsAndNotify_ACU();
          }
        });
      }

      // 无感替换模式
      const $optimizationSeamlessMode = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-seamless-mode`);
      if ($optimizationSeamlessMode.length) {
        $optimizationSeamlessMode.on('change', function() {
          settings_ACU.contentOptimizationSettings.seamlessMode = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
        });
      }

      // 自动应用优化结果
      const $optimizationAutoApply = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-auto-apply`);
      if ($optimizationAutoApply.length) {
        $optimizationAutoApply.on('change', function() {
          settings_ACU.contentOptimizationSettings.autoApply = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
        });
      }

      // 显示优化对比
      const $optimizationShowDiff = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-show-diff`);
      if ($optimizationShowDiff.length) {
        $optimizationShowDiff.on('change', function() {
          settings_ACU.contentOptimizationSettings.showDiff = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
        });
      }

      // 填表与正文替换并行执行
      const $optimizationParallelMode = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-parallel-mode`);
      if ($optimizationParallelMode.length) {
        $optimizationParallelMode.on('change', function() {
          settings_ACU.contentOptimizationSettings.parallelMode = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
        });
      }

      // 正文优化快捷操作按钮
      const $optimizationReoptimizeLatest = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-reoptimize-latest`);
      if ($optimizationReoptimizeLatest.length) {
        $optimizationReoptimizeLatest.off('click').on('click', async function() {
          const lastOptimizedMessageIndex = getLastOptimizedMessageIndex_ACU();

          if (lastOptimizedMessageIndex < 0) {
            showToastr_ACU('warning', '当前还没有"已被正文替换过"的 AI 回复可供重新优化');
            return;
          }

          jQuery_API_ACU(this).prop('disabled', true).text('处理中...');
          try {
            await reoptimizeMessage_ACU(lastOptimizedMessageIndex);
          } finally {
            jQuery_API_ACU(this).prop('disabled', false).html('<i class="fa-solid fa-rotate-right"></i> 重新优化最近一次被替换的AI回复');
          }
        });
      }

 
      // ═══ 正文替换标签筛选规则 ═══
      // 标签提取输入框
      const $optimizationExtractTags = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-tags`);
      if ($optimizationExtractTags.length) {
        $optimizationExtractTags.on('input', function() {
          settings_ACU.contentOptimizationSettings.extractTags = jQuery_API_ACU(this).val();
          saveSettingsAndNotify_ACU();
        });
      }

      // 标签提取规则编辑器
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-add-rule`).on('click', function() {
        appendExcludeRuleRow_ACU(
          `#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules`,
          { startPlaceholder: '开始词（例如：<think）', endPlaceholder: '结束词（例如：</think）' },
        );
      });
      $popupInstance_ACU.on('input', `#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules .acu-exclude-rule-start, #${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules .acu-exclude-rule-end`, function() {
        settings_ACU.contentOptimizationSettings.extractRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules`);
        saveSettingsAndNotify_ACU();
      });
      $popupInstance_ACU.on('click', `#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules .acu-exclude-rule-delete`, function() {
        const $row = jQuery_API_ACU(this).closest('.acu-exclude-rule-row');
        if ($row.length) $row.remove();
        settings_ACU.contentOptimizationSettings.extractRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules`);
        saveSettingsAndNotify_ACU();
      });

      // 标签排除规则编辑器
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-add-rule`).on('click', function() {
        appendExcludeRuleRow_ACU(
          `#${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules`,
          { startPlaceholder: '开始词（例如：<think）', endPlaceholder: '结束词（例如：</think）' },
        );
      });
      $popupInstance_ACU.on('input', `#${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules .acu-exclude-rule-start, #${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules .acu-exclude-rule-end`, function() {
        settings_ACU.contentOptimizationSettings.excludeRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules`);
        saveSettingsAndNotify_ACU();
      });
      $popupInstance_ACU.on('click', `#${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules .acu-exclude-rule-delete`, function() {
        const $row = jQuery_API_ACU(this).closest('.acu-exclude-rule-row');
        if ($row.length) $row.remove();
        settings_ACU.contentOptimizationSettings.excludeRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules`);
        saveSettingsAndNotify_ACU();
      });

      // ═══ 正文替换预设管理 ═══
      const $optimizationPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-preset-select`);
      const $optimizationImportPresets = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-import-presets`);
      const $optimizationExportPresets = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-export-presets`);
      const $optimizationSavePreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-save-preset`);
      const $optimizationSaveAsNewPreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-save-as-new-preset`);
      const $optimizationDeletePreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-delete-preset`);
      const $optimizationResetDefaults = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-reset-defaults`);
      const $optimizationPresetFileInput = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-preset-file-input`);

      // 预设选择事件
      if ($optimizationPresetSelect.length) {
        $optimizationPresetSelect.on('change', function() {
          const selectedName = jQuery_API_ACU(this).val();
          if (!selectedName) {
            $optimizationDeletePreset.hide();
            return;
          }

          const presets = settings_ACU.contentOptimizationSettings.promptPresets || [];
          const selectedPreset = presets.find((p: any) => p.name === selectedName);

          if (selectedPreset) {
            // 加载预设到UI
            if (selectedPreset.promptGroup) {
              settings_ACU.contentOptimizationSettings.promptGroup = selectedPreset.promptGroup;
              renderOptimizationPromptSegments_ACU(selectedPreset.promptGroup);
            }
            $optimizationDeletePreset.show();
            saveSettingsAndNotify_ACU();
            showToastr_ACU('success', `已加载预设 "${selectedName}"`);
          }
        });
      }

      // 导入预设
      if ($optimizationImportPresets.length) {
        $optimizationImportPresets.on('click', function() {
          $optimizationPresetFileInput.click();
        });
      }

      // 导出预设
      if ($optimizationExportPresets.length) {
        $optimizationExportPresets.on('click', function() {
          const selectedName = $optimizationPresetSelect.val();
          if (!selectedName) {
            showToastr_ACU('info', '请先选择要导出的预设。');
            return;
          }

          const presets = settings_ACU.contentOptimizationSettings.promptPresets || [];
          const selectedPreset = presets.find((p: any) => p.name === selectedName);

          if (!selectedPreset) {
            showToastr_ACU('error', '找不到选中的预设。');
            return;
          }

          const dataStr = JSON.stringify([selectedPreset], null, 2);
          const blob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);

          const a = document.createElement('a');
          a.href = url;
          a.download = `optimization_preset_${String(selectedName).replace(/[^a-z0-9]/gi, '_')}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          showToastr_ACU('success', `预设 "${selectedName}" 已成功导出。`);
        });
      }

      // 保存预设（覆盖）
      if ($optimizationSavePreset.length) {
        $optimizationSavePreset.on('click', function() {
          const selectedName = $optimizationPresetSelect.val();
          if (!selectedName) {
            // 如果没有选择预设，则等同于"另存为"
            saveOptimizationPresetAsNew_ACU();
            return;
          }

          if (!confirm(`确定要用当前设置覆盖预设 "${selectedName}" 吗？`)) {
            return;
          }

          const presets = settings_ACU.contentOptimizationSettings.promptPresets || [];
          const existingIndex = presets.findIndex((p: any) => p.name === selectedName);
          settings_ACU.contentOptimizationSettings.promptPresets = presets;
          saveSettingsAndNotify_ACU();
          showToastr_ACU('success', `预设 "${selectedName}" 已被成功覆盖。`);
        });
      }

      // 另存为新预设
      if ($optimizationSaveAsNewPreset.length) {
        $optimizationSaveAsNewPreset.on('click', function() {
          saveOptimizationPresetAsNew_ACU();
        });
      }

      // 删除预设
      if ($optimizationDeletePreset.length) {
        $optimizationDeletePreset.on('click', function() {
          const selectedName = $optimizationPresetSelect.val();
          if (!selectedName) {
            showToastr_ACU('warning', '没有选择任何预设。');
            return;
          }

          if (!confirm(`确定要删除预设 "${selectedName}" 吗？`)) {
            return;
          }

          const presets = settings_ACU.contentOptimizationSettings.promptPresets || [];
          const indexToDelete = presets.findIndex((p: any) => p.name === selectedName);

          if (indexToDelete > -1) {
            presets.splice(indexToDelete, 1);
            settings_ACU.contentOptimizationSettings.promptPresets = presets;
            saveSettingsAndNotify_ACU();

            // 刷新预设选择器
            loadOptimizationPresetSelect_ACU();
            showToastr_ACU('success', `预设 "${selectedName}" 已被删除。`);
          } else {
            showToastr_ACU('error', '找不到要删除的预设。');
          }
        });
      }

      // 恢复默认提示词
      if ($optimizationResetDefaults.length) {
        $optimizationResetDefaults.on('click', function() {
          if (!confirm('确定要恢复默认的正文替换提示词吗？这将覆盖当前的提示词设置。')) {
            return;
          }
          settings_ACU.contentOptimizationSettings.promptGroup = buildDefaultContentOptimizationPromptGroup_ACU();
          saveSettingsAndNotify_ACU();
          renderOptimizationPromptSegments_ACU(settings_ACU.contentOptimizationSettings.promptGroup);
          showToastr_ACU('success', '正文替换提示词已恢复为默认值');
        });
      }

      // 预设文件导入
      if ($optimizationPresetFileInput.length) {
        $optimizationPresetFileInput.on('change', function(e) {
          const file = (e.target as HTMLInputElement).files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = function(e) {
            try {
              const importedPresets = JSON.parse(e.target.result as string);

              if (!Array.isArray(importedPresets)) {
                throw new Error('JSON文件格式不正确，根节点必须是一个数组。');
              }

              let currentPresets = settings_ACU.contentOptimizationSettings.promptPresets || [];
              let importedCount = 0;
              let overwrittenCount = 0;

              importedPresets.forEach(preset => {
                if (preset && typeof preset.name === 'string' && preset.name.length > 0) {
                  const presetData = {
                    name: preset.name,
                    promptGroup: preset.promptGroup || buildDefaultContentOptimizationPromptGroup_ACU()
                  };

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
                settings_ACU.contentOptimizationSettings.promptPresets = currentPresets;
                saveSettingsAndNotify_ACU();
                loadOptimizationPresetSelect_ACU();

                let messages = [];
                if (importedCount > 0) messages.push(`成功导入 ${importedCount} 个新预设。`);
                if (overwrittenCount > 0) messages.push(`成功覆盖 ${overwrittenCount} 个同名预设。`);
                showToastr_ACU('success', messages.join(' '));

                // 导入后：自动选择第一个有效预设并加载到UI
                const firstValid = importedPresets.find(p => p && typeof p.name === 'string' && p.name.length > 0);
                if (firstValid && $optimizationPresetSelect && $optimizationPresetSelect.length) {
                  setTimeout(() => {
                    $optimizationPresetSelect.val(firstValid.name).trigger('change');
                  }, 50);
                }
              } else {
                showToastr_ACU('warning', '未找到有效的预设数据。');
              }
            } catch (err) {
              showToastr_ACU('error', `导入失败：${err.message}`);
            }
          };
          reader.readAsText(file);
          // 清空文件输入，允许重复导入同一文件
          (e.target as HTMLInputElement).value = '';
        });
      }

      // 保存提示词组
      const $optimizationSavePromptGroup = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-save-prompt-group`);
      if ($optimizationSavePromptGroup.length) {
        $optimizationSavePromptGroup.on('click', function() {
          const segments = getOptimizationPromptGroupFromUI_ACU();
          settings_ACU.contentOptimizationSettings.promptGroup = segments;
          saveSettingsAndNotify_ACU();
          showToastr_ACU('success', '正文替换提示词组已保存');
        });
      }

      // 恢复默认提示词组
      const $optimizationResetPromptGroup = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-reset-prompt-group`);
      if ($optimizationResetPromptGroup.length) {
        $optimizationResetPromptGroup.on('click', function() {
          if (!confirm('确定要恢复默认的正文替换提示词吗？这将覆盖当前的提示词设置。')) {
            return;
          }
          settings_ACU.contentOptimizationSettings.promptGroup = buildDefaultContentOptimizationPromptGroup_ACU();
          saveSettingsAndNotify_ACU();
          renderOptimizationPromptSegments_ACU(settings_ACU.contentOptimizationSettings.promptGroup);
          showToastr_ACU('success', '正文替换提示词已恢复为默认值');
        });
      }

      // 添加提示词段落
      $popupInstance_ACU.on('click', `.${SCRIPT_ID_PREFIX_ACU}-optimization-add-prompt-segment-btn`, function() {
        const position = jQuery_API_ACU(this).data('position');
        const newSegment = { role: 'USER', content: '', deletable: true };
        let segments = getOptimizationPromptGroupFromUI_ACU();
        if (position === 'top') segments.unshift(newSegment);
        else segments.push(newSegment);
        renderOptimizationPromptSegments_ACU(segments);
      });

      // 删除提示词段落
      $popupInstance_ACU.on('click', '.optimization-prompt-segment-delete-btn', function() {
        const indexToDelete = jQuery_API_ACU(this).data('index');
        let segments = getOptimizationPromptGroupFromUI_ACU();
        segments.splice(indexToDelete, 1);
        renderOptimizationPromptSegments_ACU(segments);
      });

      // 测试按钮
      const $optimizationTestBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-test-btn`);
      if ($optimizationTestBtn.length) {
        $optimizationTestBtn.on('click', async function() {
          const testInput = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-test-input`).val() as string;
          if (!testInput || testInput.trim().length < 10) {
            showToastr_ACU('warning', '请输入至少10个字符的测试文本');
            return;
          }

          jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
          const $resultDiv = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-test-result`);
          const $outputDiv = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-test-output`);
          $resultDiv.show();
          $outputDiv.text('正在调用AI进行优化...');

          try {
            const result = await performContentOptimization_ACU(testInput);
            if (result.success) {
              let outputText = `优化完成！共 ${result.optimizations.length} 处改进\n\n`;
              outputText += `摘要：${result.summary || '无'}\n\n`;
              outputText += `=== 优化详情 ===\n\n`;
              result.optimizations.forEach((opt: any, i: number) => {
                outputText += `[${i + 1}] 修改方案：${opt.plan || opt.reason || '未说明'}\n`;
                outputText += `原文：${opt.original.substring(0, 100)}${opt.original.length > 100 ? '...' : ''}\n`;
                outputText += `优化：${opt.optimized.substring(0, 100)}${opt.optimized.length > 100 ? '...' : ''}\n\n`;
              });
              outputText += `=== 优化后全文 ===\n\n${result.optimizedContent}`;
              $outputDiv.text(outputText);
            } else {
              $outputDiv.text(`优化失败：${result.error || '未知错误'}`);
            }
          } catch (e) {
            $outputDiv.text(`优化出错：${e.message}`);
          }

          jQuery_API_ACU(this).prop('disabled', false).text('执行优化测试');
        });
      }

      // 加载正文优化设置到UI
      loadOptimizationSettingsToUI_ACU();

      // [新增] 刷新API预设选择器
      refreshApiPresetSelectors_ACU();

}
