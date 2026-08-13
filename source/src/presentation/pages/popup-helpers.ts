import { DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU } from '../../shared/defaults-json.js';
import { flushCurrentPlotTaskEditorState_ACU, loadCurrentPlotTaskToUI_ACU, renderPlotTaskList_ACU } from '../components/plot-editors';
import { showToastr_ACU } from '../theme/toast';
import { jQuery_API_ACU } from '../dom-utils';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
import { getCurrentChatPlotScopeState_ACU } from '../../service/template/chat-scope';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU, renderOption_ACU } from '../../shared/html-helpers';
import { normalizeExcludeRules_ACU, normalizeExtractRules_ACU } from '../../shared/utils';
import { DEFAULT_PRESET_OPTION_VALUE_ACU, applyGlobalPlotPresetSelectionForEditor_ACU, applyPlotPresetToSettings_ACU, ensurePlotPromptsArray_ACU, ensurePlotTasksCompat_ACU, findPlotPresetByName_ACU, getActivePlotEditorSettings_ACU, getCurrentRuntimePlotPresetName_ACU, getLegacyPromptTextsFromPromptGroup_ACU, getPlotPresetBindingForChat_ACU, getPlotPromptContentByIdFromSettings_ACU, getPlotPromptGroupFromSource_ACU, normalizePlotPresetExcludeRules_ACU, normalizePlotPresetSelectionValue_ACU, normalizePlotTasks_ACU, persistPlotPresetSelectionState_ACU, readExcludeRulesFromRows_ACU, renderExcludeRuleRows_ACU, resolveActivePlotPresetName_ACU, setActivePlotEditorSettings_ACU, setCurrentEditablePlotPresetState_ACU, setPlotPromptContentByIdForSettings_ACU } from '../components/optimization-ui';
import { getDefaultPlotContextExcludeRules_ACU, getDefaultPlotContextExtractRules_ACU } from '../../service/runtime/helpers-remaining';
import { $popupInstance_ACU, $plotPromptSegmentsContainer_ACU, $plotTaskListContainer_ACU, _assignUIPlaceholders_ACU } from '../state/ui-refs';
/**
 * presentation/pages/popup-helpers.ts — 主弹窗辅助函数
 * 从 main-popup.ts 拆出（原 openAutoCardPopup_ACU 内嵌函数）
 */
    // --- [剧情推进] 辅助函数 ---

    /**
     * 加载剧情推进设置到UI
     */
    export function loadPlotSettingsToUI_ACU(plotSettingsOverride: any = null) {
      if (!$popupInstance_ACU) return;
 
      _assignUIPlaceholders_ACU({
        $plotPromptSegmentsContainer_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-prompt-segments-container`),
        $plotTaskListContainer_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-list`),
      });
 
      const plotSettings = setActivePlotEditorSettings_ACU(plotSettingsOverride || settings_ACU.plotSettings);
      if (!plotSettings) return;

      // 功能开关是全局状态，不属于剧情预设/聊天快照。UI 回填必须以 settings_ACU.plotSettings 为权威，
      // 否则切换预设或新开对话时会被局部 snapshot.enabled 覆盖成“每次自动打开”。
      const globalPlotEnabled = settings_ACU.plotSettings?.enabled === true;
      plotSettings.enabled = globalPlotEnabled;
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-enabled`).prop('checked', globalPlotEnabled);

      renderPlotTaskList_ACU(plotSettings);
      loadCurrentPlotTaskToUI_ACU(plotSettings);
      // 最终注入指令
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-final-directive`).val(getPlotPromptContentByIdFromSettings_ACU(plotSettings, 'finalSystemDirective'));

      // 匹配替换速率
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-main`).val(plotSettings.rateMain);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-personal`).val(plotSettings.ratePersonal);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-erotic`).val(plotSettings.rateErotic);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-cuckold`).val(plotSettings.rateCuckold);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-recall-count`).val(plotSettings.recallCount ?? 20);

      // 剧情上下文
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-turn-count`).val(plotSettings.contextTurnCount);
      renderExcludeRuleRows_ACU(
        `#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules`,
        normalizeExtractRules_ACU(plotSettings.contextExtractRules, plotSettings.contextExtractTags || ''),
        {
          startPlaceholder: '开始词（例如：<think）',
          endPlaceholder: '结束词（例如：</think>）',
          fallbackRules: getDefaultPlotContextExtractRules_ACU(),
        },
      );
      renderExcludeRuleRows_ACU(
        `#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules`,
        normalizeExcludeRules_ACU(plotSettings.contextExcludeRules, plotSettings.contextExcludeTags || ''),
        {
          startPlaceholder: '开始词（例如：<thinking）',
          endPlaceholder: '结束词（例如：</thinking>）',
          fallbackRules: getDefaultPlotContextExcludeRules_ACU(),
        },
      );

      // 预设选择器
      loadPlotPresetSelect_ACU();
    }

    /**
     * 加载正文替换预设选择器
     */
    export function loadOptimizationPresetSelect_ACU() {
      if (!$popupInstance_ACU) return;

      const $select = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-preset-select`);
      const $deleteBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-delete-preset`);
      if (!$select.length) return;

      const presets = settings_ACU.contentOptimizationSettings?.promptPresets || [];
      const currentValue = $select.val();

      $select.find('option:not(:first)').remove();

      presets.forEach((preset: any) => {
        if (preset && preset.name) {
$select.append(renderOption_ACU(preset.name, preset.name));
        }
      });

      // 恢复之前选中的值（如果还存在）
      if (currentValue && presets.find((p: any) => p.name === currentValue)) {
        $select.val(currentValue);
        if ($deleteBtn.length) $deleteBtn.show();
      } else {
        $select.val('');
        if ($deleteBtn.length) $deleteBtn.hide();
      }
    }

    /**
     * 另存为新的正文替换预设
     */
    export function saveOptimizationPresetAsNew_ACU() {
      const presetName = prompt('请输入新预设的名称：');
      if (!presetName || !presetName.trim()) {
        showToastr_ACU('warning', '预设名称不能为空。');
        return;
      }

      const name = presetName.trim();
      const presets = settings_ACU.contentOptimizationSettings.promptPresets || [];
      const existingIndex = presets.findIndex((p: any) => p.name === name);

      if (existingIndex !== -1) {
        if (!confirm(`预设 "${name}" 已存在。是否覆盖？`)) {
          return;
        }
        presets[existingIndex] = {
          name: name,
          promptGroup: getOptimizationPromptGroupFromUI_ACU()
        };
        showToastr_ACU('success', `预设 "${name}" 已被覆盖。`);
      } else {
        presets.push({
          name: name,
          promptGroup: getOptimizationPromptGroupFromUI_ACU()
        });
        showToastr_ACU('success', `预设 "${name}" 已成功创建。`);
      }

      settings_ACU.contentOptimizationSettings.promptPresets = presets;
      saveSettingsAndNotify_ACU();
      loadOptimizationPresetSelect_ACU();

      // 选中新创建的预设
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-preset-select`).val(name);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-delete-preset`).show();
    }

    /**
     * 加载正文替换设置到UI
     */
    export function loadOptimizationSettingsToUI_ACU() {
      if (!$popupInstance_ACU) return;

      const config = settings_ACU.contentOptimizationSettings || {};

      // 正文替换子标签：直接显示（旧 maxRetries==49 隐藏解锁已随智能续写移除）
      const $optimizationSubtab = $popupInstance_ACU.find('.acu-subtab-button[data-subtab="advanced-optimization"]');
      if ($optimizationSubtab.length) {
        $optimizationSubtab.show();
        $popupInstance_ACU.find('#acu-subtab-advanced-optimization').show();
      }

      // 功能开关
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-enabled`).prop('checked', !!config.enabled);

      // API预设
      const $apiPreset = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-api-preset`);
      if ($apiPreset.length) {
        $apiPreset.val(config.apiPreset || '');
      }

      // 基础设置
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-min-length`).val(config.minLength || 100);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-max-items`).val(config.maxOptimizations || 10);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-loop-count`).val(config.loopCount || 1);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-retry-count`).val(config.retryCount || 3);

      // 优化模式
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-seamless-mode`).prop('checked', config.seamlessMode !== false);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-auto-apply`).prop('checked', config.autoApply !== false);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-show-diff`).prop('checked', config.showDiff !== false);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-parallel-mode`).prop('checked', config.parallelMode === true);

      // 标签筛选设置
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-tags`).val(config.extractTags || '');
      
      // 加载标签提取规则
      renderExcludeRuleRows_ACU(
        `#${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules`,
        config.extractRules || [],
        {
          startPlaceholder: '开始词（例如：<think）',
          endPlaceholder: '结束词（例如：</think）',
        },
      );
      
      // 加载标签排除规则
      renderExcludeRuleRows_ACU(
        `#${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules`,
        config.excludeRules || [],
        {
          startPlaceholder: '开始词（例如：<think）',
          endPlaceholder: '结束词（例如：</think）',
        },
      );

      // 加载预设选择器
      loadOptimizationPresetSelect_ACU();

      // 提示词组
      const promptGroup = config.promptGroup && config.promptGroup.length > 0
        ? config.promptGroup
        : DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU;
      renderOptimizationPromptSegments_ACU(promptGroup);
    }

    /**
     * 渲染正文优化提示词段落
     */
    export function renderOptimizationPromptSegments_ACU(segments: any[]) {
      if (!$popupInstance_ACU) return;
      const $container = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-prompt-segments-container`);
      if (!$container.length) return;

      $container.empty();

      if (!Array.isArray(segments)) return;

      segments.forEach((segment, index) => {
        const isMain = segment.isMain || segment.mainSlot === 'A';
        const isMain2 = segment.isMain2 || segment.mainSlot === 'B';
        const deletable = segment.deletable !== false;

        const segmentHtml = `
          <div class="optimization-prompt-segment" data-index="${index}" style="
            margin-bottom: 15px;
            padding: 15px;
            background: var(--background_default);
            border-radius: 8px;
            border: 1px solid var(--border_color_light);
            ${isMain ? 'border-left: 3px solid var(--blue);' : ''}
            ${isMain2 ? 'border-left: 3px solid var(--purple);' : ''}
          ">
            <div style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
              <select class="optimization-prompt-segment-role text_pole" data-index="${index}" style="width: 120px;">
                <option value="SYSTEM" ${segment.role === 'SYSTEM' ? 'selected' : ''}>SYSTEM</option>
                <option value="USER" ${segment.role === 'USER' ? 'selected' : ''}>USER</option>
                <option value="assistant" ${segment.role === 'assistant' ? 'selected' : ''}>assistant</option>
              </select>
              ${deletable ? `
                <button type="button" class="optimization-prompt-segment-delete-btn button" data-index="${index}" style="margin-left: auto; padding: 4px 8px; font-size: 0.85em;">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
            <textarea class="optimization-prompt-segment-content text_pole" data-index="${index}" rows="6" placeholder="输入提示词内容..." style="resize: vertical; width: 100%;">${escapeHtml_ACU(segment.content || '')}</textarea>
          </div>
        `;
        $container.append(segmentHtml);
      });

      // 绑定输入事件
      $container.find('.optimization-prompt-segment-role').on('change', function() {
        const idx = parseInt(jQuery_API_ACU(this).data('index'), 10);
        const segments = getOptimizationPromptGroupFromUI_ACU();
        if (segments[idx]) {
          segments[idx].role = jQuery_API_ACU(this).val();
          settings_ACU.contentOptimizationSettings.promptGroup = segments;
          saveSettingsAndNotify_ACU();
        }
      });

      $container.find('.optimization-prompt-segment-content').on('input change', function() {
        const idx = parseInt(jQuery_API_ACU(this).data('index'), 10);
        const segments = getOptimizationPromptGroupFromUI_ACU();
        if (segments[idx]) {
          segments[idx].content = jQuery_API_ACU(this).val();
          settings_ACU.contentOptimizationSettings.promptGroup = segments;
          saveSettingsAndNotify_ACU();
        }
      });
    }

    /**
     * 从UI获取正文优化提示词组
     */
    export function getOptimizationPromptGroupFromUI_ACU() {
      if (!$popupInstance_ACU) return [];

      const segments: any[] = [];
      const $segments = $popupInstance_ACU.find('.optimization-prompt-segment');

      $segments.each(function() {
        const $seg = jQuery_API_ACU(this);
        const index = parseInt($seg.data('index'), 10);
        const role = $seg.find('.optimization-prompt-segment-role').val();
        const content = $seg.find('.optimization-prompt-segment-content').val();

        segments.push({
          role: role || 'USER',
          content: content || '',
          deletable: true
        });
      });

      return segments;
    }

    /**
     * 加载剧情预设选择器
     */
    function getPlotPresetDisplayName_ACU(presetName: string) {
      const normalizedPresetName = normalizePlotPresetSelectionValue_ACU(presetName);
      return normalizedPresetName || '默认预设';
    }


    function populatePlotPresetSelectOptions_ACU($select: any, presets: any[], { extraPresetName = '' } = {}) {
      if (!$select || !$select.length) return;

      const normalizedExtraPresetName = normalizePlotPresetSelectionValue_ACU(extraPresetName);
      const normalizedPresetNames = new Set();
      $select.empty().append(`<option value="${DEFAULT_PRESET_OPTION_VALUE_ACU}">默认预设</option>`);

      presets.forEach((preset: any) => {
        const presetName = normalizePlotPresetSelectionValue_ACU(preset?.name);
        if (!presetName || normalizedPresetNames.has(presetName)) return;
        normalizedPresetNames.add(presetName);
$select.append(renderOption_ACU(presetName, presetName));
      });

      if (normalizedExtraPresetName && !normalizedPresetNames.has(normalizedExtraPresetName)) {
$select.append(
          renderOption_ACU(normalizedExtraPresetName, `${normalizedExtraPresetName}（仅当前聊天快照）`)
        );
      }
    }

    export function loadPlotPresetSelect_ACU() {
      if (!$popupInstance_ACU || !settings_ACU?.plotSettings) return;

      const presets = settings_ACU.plotSettings.promptPresets || [];
      const globalPresetName = normalizePlotPresetSelectionValue_ACU(settings_ACU.plotSettings.lastUsedPresetName || '');
      const chatScopeState = getCurrentChatPlotScopeState_ACU();
      const currentBinding = getPlotPresetBindingForChat_ACU();
      const effectiveChatPresetName = resolveActivePlotPresetName_ACU({ fallbackToGlobal: true });
      const explicitChatPresetName = normalizePlotPresetSelectionValue_ACU(currentBinding?.presetName || '');
      const chatSelectedPresetName = normalizePlotPresetSelectionValue_ACU(explicitChatPresetName || chatScopeState?.presetName || '');

      const $globalSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-preset-select`);
      const $chatSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-chat-preset-select`);
      const $globalDeleteBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-delete-preset`);
      const $globalStatus = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-scope-status`);
      const $chatStatus = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-chat-scope-status`);
      const $chatOriginStatus = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-chat-origin-status`);

      populatePlotPresetSelectOptions_ACU($globalSelect, presets);
      populatePlotPresetSelectOptions_ACU($chatSelect, presets, { extraPresetName: chatSelectedPresetName });

      if ($chatSelect.length) {
        $chatSelect.find(`option[value="${DEFAULT_PRESET_OPTION_VALUE_ACU}"]`).text('跟随全局');
      }

      const hasGlobalPreset = !!globalPresetName && presets.some((p: any) => normalizePlotPresetSelectionValue_ACU(p?.name) === globalPresetName);
      const hasChatPreset = !!chatSelectedPresetName && $chatSelect.find(`option[value="${chatSelectedPresetName.replace(/"/g, '\\"')}"]`).length > 0;
      const hasValidExplicitChatPreset = !!explicitChatPresetName && !!findPlotPresetByName_ACU(explicitChatPresetName);

      if ($globalSelect.length) {
        $globalSelect.val(hasGlobalPreset ? globalPresetName : DEFAULT_PRESET_OPTION_VALUE_ACU);
      }
      if ($globalDeleteBtn.length) {
        $globalDeleteBtn.toggle(hasGlobalPreset);
      }
      if ($chatSelect.length) {
        $chatSelect.val(hasChatPreset ? chatSelectedPresetName : DEFAULT_PRESET_OPTION_VALUE_ACU);
      }

      if ($globalStatus.length) {
        $globalStatus.text(`当前全局预设：${getPlotPresetDisplayName_ACU(globalPresetName)}；新聊天会默认继承这里的剧情推进配置。`);
      }

      if ($chatStatus.length) {
        if (chatScopeState?.snapshot) {
          $chatStatus.text(`当前聊天：历史聊天快照；当前实际预设为 ${getPlotPresetDisplayName_ACU(effectiveChatPresetName)}。`);
        } else if (hasValidExplicitChatPreset) {
          $chatStatus.text(`当前聊天：独立预设；当前实际预设为 ${getPlotPresetDisplayName_ACU(explicitChatPresetName)}。`);
        } else if (chatSelectedPresetName) {
          $chatStatus.text(`当前聊天：原绑定预设不存在；当前已回退为 ${getPlotPresetDisplayName_ACU(effectiveChatPresetName)}。`);
        } else {
          $chatStatus.text(`当前聊天：跟随全局；当前实际预设为 ${getPlotPresetDisplayName_ACU(effectiveChatPresetName)}。`);
        }
      }

      if ($chatOriginStatus.length) {
        if (chatScopeState?.snapshot) {
          $chatOriginStatus.text('当前聊天仍在使用旧版聊天快照；重新切换一次当前聊天预设后，将迁移为新的按预设切换模式。');
        } else if (hasValidExplicitChatPreset) {
          $chatOriginStatus.text('当前聊天已单独指定剧情推进预设；如需修改预设内容，请在左侧全局预设区操作。');
        } else if (chatSelectedPresetName) {
          $chatOriginStatus.text('当前聊天原绑定的剧情推进预设已不存在；当前运行已回退到全局预设，请重新选择一次当前聊天预设。');
        } else {
          $chatOriginStatus.text('当前聊天当前未单独指定剧情推进预设，实际会直接跟随全局。');
        }
      }
    }

    /**
     * 加载预设到UI
     */
    function loadPlotPresetToUI_ACU(preset: any) {
      if (!$popupInstance_ACU || !preset) return;

      const presetName = preset.name || '默认预设';
      const result = applyGlobalPlotPresetSelectionForEditor_ACU(preset.name || '', {
        source: 'ui_global_load',
        save: true,
      });

      if (!result) return;
      showToastr_ACU('success', `已加载全局预设 "${presetName}"。`);
    }

    /**
     * 从UI获取当前剧情设置
     */
    export function getCurrentPlotSettingsFromUI_ACU() {
      if (!$popupInstance_ACU) return {};

      flushCurrentPlotTaskEditorState_ACU({ renderTaskList: true, persist: false });
      const activeSettings = getActivePlotEditorSettings_ACU();
      const currentSettings = JSON.parse(JSON.stringify(activeSettings || settings_ACU.plotSettings || {}));
      ensurePlotTasksCompat_ACU(currentSettings, { syncLegacy: true });

      delete currentSettings.promptPresets;
      delete currentSettings.lastUsedPresetName;
      delete currentSettings.enabled;

      const promptGroup = getPlotPromptGroupFromSource_ACU(currentSettings);
      const legacyPromptTexts = getLegacyPromptTextsFromPromptGroup_ACU(promptGroup);
      currentSettings.promptGroup = promptGroup;
      currentSettings.finalSystemDirective = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-final-directive`).val() as string || '';
      currentSettings.mainPrompt = legacyPromptTexts.mainPrompt || '';
      currentSettings.systemPrompt = legacyPromptTexts.systemPrompt || '';
      currentSettings.rateMain = parseFloat($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-main`).val() as string) || 1.0;
      currentSettings.ratePersonal = parseFloat($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-personal`).val() as string) || 1.0;
      currentSettings.rateErotic = parseFloat($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-erotic`).val() as string) || 0;
      currentSettings.rateCuckold = parseFloat($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-rate-cuckold`).val() as string) || 1.0;
      currentSettings.recallCount = parseInt($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-recall-count`).val() as string, 10) || 20;
      currentSettings.contextExtractRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules`);
      currentSettings.contextExcludeRules = readExcludeRulesFromRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules`);
      currentSettings.contextTurnCount = parseInt($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-context-turn-count`).val() as string, 10) || 3;

      currentSettings.plotTasks = normalizePlotTasks_ACU(currentSettings);
      ensurePlotPromptsArray_ACU(currentSettings);
      setPlotPromptContentByIdForSettings_ACU(currentSettings, 'mainPrompt', currentSettings.mainPrompt || '');
      setPlotPromptContentByIdForSettings_ACU(currentSettings, 'systemPrompt', currentSettings.systemPrompt || '');
      setPlotPromptContentByIdForSettings_ACU(currentSettings, 'finalSystemDirective', currentSettings.finalSystemDirective || '');
      ensurePlotTasksCompat_ACU(currentSettings, { syncLegacy: true });
      currentSettings.finalSystemDirective = getPlotPromptContentByIdFromSettings_ACU(currentSettings, 'finalSystemDirective') || currentSettings.finalSystemDirective || '';

      return currentSettings;
    }

    /**
     * 另存为新的全局预设
     */
    export function savePlotPresetAsNew_ACU() {
      const presetName = prompt('请输入新的全局预设名称：');
      const name = String(presetName || '').trim();
      if (!name) return;

      const presets = settings_ACU.plotSettings.promptPresets || [];
      const existingIndex = presets.findIndex((p: any) => p.name === name);

      const currentSettings = getCurrentPlotSettingsFromUI_ACU();
      if (!currentSettings || typeof currentSettings !== 'object') {
        showToastr_ACU('error', '读取当前剧情推进设置失败。');
        return;
      }

      const savedPreset = normalizePlotPresetExcludeRules_ACU({ name, ...currentSettings });
      if (existingIndex !== -1) {
        if (!confirm(`名为 "${name}" 的全局预设已存在。是否要覆盖它？`)) {
          return;
        }
        presets[existingIndex] = savedPreset;
      } else {
        presets.push(savedPreset);
      }

      settings_ACU.plotSettings.promptPresets = presets;
      const currentRuntimePresetName = getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
      const currentChatBinding = getPlotPresetBindingForChat_ACU();
      const hasLegacyChatScope = !!getCurrentChatPlotScopeState_ACU();
      const shouldRefreshCurrentChatRuntime =
        normalizePlotPresetSelectionValue_ACU(currentRuntimePresetName) === name ||
        (!currentChatBinding && !hasLegacyChatScope);

      if (shouldRefreshCurrentChatRuntime) {
        applyPlotPresetToSettings_ACU(settings_ACU.plotSettings, savedPreset);
      }

      setCurrentEditablePlotPresetState_ACU(name, {
        scope: 'global',
        source: 'ui_global_save_as_new',
      });
      persistPlotPresetSelectionState_ACU(name, { source: 'ui_global_save_as_new', updateGlobal: true, save: false });
      saveSettingsAndNotify_ACU();

      loadPlotPresetSelect_ACU();
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-preset-select`).val(name);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-global-delete-preset`).show();

      showToastr_ACU('success', `新全局预设 "${name}" 已保存。`);
    }
