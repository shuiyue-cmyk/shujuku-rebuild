/**
 * presentation/triggers/settings-ui-sync/settings-ui-api.ts
 */
import {
  refreshCurrentPlotTaskApiPresetSelect_ACU
} from '../../components/plot-editors';
import {
  showToastr_ACU
} from '../../theme/toast';
import {
  SCRIPT_ID_PREFIX_ACU
} from '../../../shared/constants';
import {
  jQuery_API_ACU
} from '../../dom-utils';
import {
  settings_ACU
} from '../../../service/runtime/state-manager';
import {
  $popupInstance_ACU
} from '../../state/ui-refs';
import {
  renderOption_ACU
} from '../../../shared/html-helpers';

import {
  getCurrentVectorMemoryConfig_ACU
} from '../../../service/vector/vector-memory-config';
// V1 API 写权限已收敛到 service 层；此处仅保留事务式委托与 fail-closed 提示。
import {
  saveApiPreset_ACU as serviceSaveApiPreset_ACU,
  deleteApiPreset_ACU as serviceDeleteApiPreset_ACU,
  setActivePresetForCurrentChat_ACU,
  saveCurrentConfigAsPreset_ACU
} from '../../../service/settings/api-preset-service';
/**
 * presentation/triggers/settings-ui-sync.ts — UI读写/保存/刷新函数
 * 从 service/runtime/helpers-remaining.ts 提取的纯 UI 函数
 */


  // --- API / 设置 UI ---
  export function updateApiModeView_ACU(_apiMode: string) {
    if (!$popupInstance_ACU) return;
    const $customApiBlock = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-custom-api-settings-block`);
    const $tavernApiBlock = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-block`);

    // 酒馆主 API（tavern）已剥离，恒显示自定义 API 配置块
    $customApiBlock.show();
    $tavernApiBlock.hide();
  }

  export function updateCustomApiInputsState_ACU() {
    if (!$popupInstance_ACU) return;
    // 酒馆主 API 已剥离，自定义 API 字段恒可编辑
    const $customApiFields = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-custom-api-fields`);
    $customApiFields.css('opacity', '1.0');
    $customApiFields.find('input, select, button').prop('disabled', false);
  }

  // [V1 收敛] API 配置写权限已迁移至 V2（service 层单一权威）。
  // 旧 popup 不再直接读写 settings_ACU.apiConfig；调用方应跳转 V2 配置面板。
  export function saveApiConfig_ACU() {
    showToastr_ACU('warning', '旧UI的API配置编辑已停用，请使用 扩展菜单 → 幻想·数据库 管理API配置。');
  }

  export function clearApiConfig_ACU() {
    showToastr_ACU('warning', '旧UI的API配置清除已停用，请使用 扩展菜单 → 幻想·数据库 管理API配置。');
  }

  // --- [V1 收敛] API预设管理函数 ---
  // 写权限已收敛到 service 层单一权威。以下函数只做事务式委托与 UI 提示：
  // 保存失败时 service 已回滚内存状态，V1 不再显示错误的成功提示，
  // 也不再触发 loadSettingsAndRefreshUI_ACU() 全量重载覆盖内存配置。
  export function saveApiPreset_ACU(presetName: string): boolean {
    if (!presetName || !presetName.trim()) {
      showToastr_ACU('warning', '请输入预设名称。');
      return false;
    }
    const result = saveCurrentConfigAsPreset_ACU(presetName.trim());
    if (!result.ok) {
      showToastr_ACU('error', result.message || '保存API预设失败，已回滚。');
      return false;
    }
    refreshApiPresetSelectors_ACU();
    showToastr_ACU('success', `API预设 "${presetName.trim()}" 已保存。`);
    return true;
  }

  export function loadApiPreset_ACU(presetName: string): boolean {
    if (!presetName) {
      showToastr_ACU('warning', '请先选择一个预设。');
      return false;
    }
    const result = setActivePresetForCurrentChat_ACU(presetName);
    if (!result.ok) {
      showToastr_ACU('error', result.message || `加载预设 "${presetName}" 失败，已回滚。`);
      return false;
    }
    refreshApiPresetSelectors_ACU();
    showToastr_ACU('success', `已加载API预设 "${presetName}" 并绑定到当前聊天。`);
    return true;
  }

  export function deleteApiPreset_ACU(presetName: string): boolean {
    if (!presetName) {
      showToastr_ACU('warning', '请先选择一个预设。');
      return false;
    }
    const result = serviceDeleteApiPreset_ACU(presetName);
    if (!result.ok) {
      showToastr_ACU('error', result.message || `删除预设 "${presetName}" 失败，已回滚。`);
      return false;
    }
    refreshApiPresetSelectors_ACU();
    showToastr_ACU('info', `API预设 "${presetName}" 已删除。`);
    return true;
  }

  export function refreshApiPresetSelectors_ACU() {
    if (!$popupInstance_ACU) return;
    
    const presets = settings_ACU.apiPresets || [];
    
    // 刷新API配置页面的预设选择器
    const $apiPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-preset-select`);
    if ($apiPresetSelect.length) {
      $apiPresetSelect.empty().append('<option value="">-- 选择预设 --</option>');
      presets.forEach((p: any) => {
$apiPresetSelect.append(renderOption_ACU(p.name, p.name));
      });
    }
    
    // 刷新填表的API预设选择器
    const $tableApiPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-table-api-preset-select`);
    if ($tableApiPresetSelect.length) {
      $tableApiPresetSelect.empty().append('<option value="">使用当前API配置</option>');
      presets.forEach((p: any) => {
$tableApiPresetSelect.append(renderOption_ACU(p.name, p.name));
      });
      $tableApiPresetSelect.val(settings_ACU.tableApiPreset || '');
    }
    
    // 刷新剧情推进的API预设选择器
    const $plotApiPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-api-preset-select`);
    if ($plotApiPresetSelect.length) {
      $plotApiPresetSelect.empty().append('<option value="">使用当前API配置</option>');
      presets.forEach((p: any) => {
$plotApiPresetSelect.append(renderOption_ACU(p.name, p.name));
      });
      $plotApiPresetSelect.val(settings_ACU.plotApiPreset || '');
    }

    // 刷新任务级数据库API预设选择器
    const $plotTaskApiPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset`);
    if ($plotTaskApiPresetSelect.length) {
      const currentTaskApiPreset = $plotTaskApiPresetSelect.val() || '';
      $plotTaskApiPresetSelect.empty().append('<option value="">继承全局剧情推进API预设</option>');
      presets.forEach((p: any) => {
$plotTaskApiPresetSelect.append(renderOption_ACU(p.name, p.name));
      });
      $plotTaskApiPresetSelect.val(currentTaskApiPreset);
      refreshCurrentPlotTaskApiPresetSelect_ACU();
    }

    // 刷新正文替换的API预设选择器
    const $optimizationApiPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-optimization-api-preset`);
    if ($optimizationApiPresetSelect.length) {
      $optimizationApiPresetSelect.empty().append('<option value="">使用当前API配置</option>');
      presets.forEach((p: any) => {
$optimizationApiPresetSelect.append(renderOption_ACU(p.name, p.name));
      });
      $optimizationApiPresetSelect.val(settings_ACU.contentOptimizationSettings?.apiPreset || '');
    }

    // 刷新交火关键词生成的 API 预设选择器
    const $keywordApiPresetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-api-preset`);
    if ($keywordApiPresetSelect.length) {
      const vectorMemoryConfig = getCurrentVectorMemoryConfig_ACU();
      const currentKeywordPreset = String(vectorMemoryConfig.keywordApiPreset || $keywordApiPresetSelect.val() || '');
      $keywordApiPresetSelect.empty().append('<option value="">使用当前API配置</option>');
      presets.forEach((p: any) => {
$keywordApiPresetSelect.append(renderOption_ACU(p.name, p.name));
      });
      $keywordApiPresetSelect.val(currentKeywordPreset);
    }

    // [新增] 刷新可视化编辑器配置面板中的表级 API 预设覆盖选择器
    // 该 select 可能不在 popup 中，而是在可视化编辑器容器里
    const $cfgTableApiPreset = jQuery_API_ACU('#cfg-table-api-preset');
    if ($cfgTableApiPreset.length) {
      const currentVal = String($cfgTableApiPreset.val() || '');
      $cfgTableApiPreset.empty().append('<option value="">使用填表整体API配置</option>');
      presets.forEach((p: any) => {
        $cfgTableApiPreset.append(renderOption_ACU(p.name, p.name));
      });
      $cfgTableApiPreset.val(currentVal);
    }
  }

  /**
   * 根据预设名称获取API配置
   * @param {string} presetName - 预设名称，空字符串表示使用当前配置
   * @returns {object} - 包含 apiMode, apiConfig, tavernProfile 的配置对象
   */

