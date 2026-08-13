/**
 * presentation/components/optimization-ui/index.ts — 统一 re-export
 */

export {
  ensureLoopPromptsArray_ACU,
  ensureTagRulesCompat_ACU,
  getLegacyPromptFromThree_ACU,
  getLegacyPromptTextsFromPromptGroup_ACU,
  getPlotPromptGroupFromSource_ACU,
  getPlotFinalDirectiveFromSource_ACU,
  normalizePlotTask_ACU,
  normalizePlotTasks_ACU,
  syncLegacyPlotSettingsFromTask_ACU,
  ensurePlotTasksCompat_ACU,
  applyPlotPresetToSettings_ACU,
  normalizePlotPresetSelectionValue_ACU,
  isDefaultPlotPresetSelection_ACU,
  ensurePlotPresetBindingsStore_ACU,
  getPlotPresetBindingForChat_ACU,
  clearPlotPresetBindingForChat_ACU,
  findPlotPresetByName_ACU,
  resolveActivePlotPresetName_ACU,
  getCurrentRuntimePlotPresetName_ACU,
  setCurrentEditablePlotPresetState_ACU,
  syncCurrentEditablePlotPresetState_ACU,
  getActivePlotEditorSettings_ACU,
  setActivePlotEditorSettings_ACU,
  getPlotGlobalRevision_ACU,
  resetPlotSettingsToDefault_ACU,
  replaceCurrentPlotSettingsWithSnapshot_ACU,
  switchCurrentChatPlotPreset_ACU,
  persistPlotPresetSelectionState_ACU,
  applyGlobalPlotPresetSelectionForEditor_ACU,
  normalizePlotPresetExcludeRules_ACU,
  stripPlotPresetWorldbookEntrySelectionForExport_ACU,
  ensurePlotPromptsArray_ACU,
  getPlotPromptContentByIdFromSettings_ACU,
  setPlotPromptContentByIdForSettings_ACU,
  getLastOptimizedMessageIndex_ACU,
  DEFAULT_PRESET_OPTION_VALUE_ACU,
} from '../../../service/plot/plot-logic';

export { showOptimizationOverlay_ACU, hideOptimizationOverlay_ACU, showOptimizationProgressToast_ACU, hideOptimizationProgressToast_ACU } from './optimization-ui-overlay';
export { reoptimizeMessage_ACU, executeContentOptimization_ACU } from './optimization-ui-exec';
export { renderExcludeRuleRows_ACU, appendExcludeRuleRow_ACU, readExcludeRulesFromRows_ACU } from './optimization-ui-rules';
