import { computed } from 'vue';
import {
  getSheetColumnProjection_ACU,
  validateDDLTextAgainstHeaders_ACU,
  parseDDLColumnNames,
  removeDDLColumnAtIndex_ACU,
  updateDDLColumnComment,
} from '../../../shared/ddl-utils';
import { isSummaryOrOutlineTable_ACU } from '../../../shared/utils';
import { settings_ACU } from '../../../service/runtime/state-manager';
import {
  applySummaryIndexSequenceToTable_ACU,
  getSummaryIndexColumnIndex_ACU,
} from '../../../service/runtime/helpers-remaining';
import { saveSettings_ACU } from '../../../service/settings/settings-service';
import { isSqliteMode } from '../../../service/table/storage-mode';
import {
  DEFAULT_ENTRY_PLACEMENT_ACU,
  DEFAULT_EXTRA_INDEX_PLACEMENT_ACU,
  buildDefaultGlobalInjectionConfig_ACU,
  ensureExportConfigDefaults_ACU,
  getFixedPlacementDefaultsForTable_ACU,
  getGlobalInjectionConfigFromData_ACU,
  isImportantPersonsTableName_ACU,
  isOutlineTableName_ACU,
  isSummaryTableName_ACU,
  normalizeLorebookPosition_ACU,
  normalizePlacementConfig_ACU,
} from '../../../service/worldbook/injection-engine';
import { assertVisualizerDataOpsEditable_ACU } from '../../../service/visualizer/visualizer-data-ops';
import { useToastStore } from '../../stores/toast-store';
import { useVisualizerStore } from '../../stores/visualizer-store';

type SourceDataKey = 'note' | 'initNode' | 'insertNode' | 'updateNode' | 'deleteNode' | 'ddl';
type UpdateConfigKey = 'contextDepth' | 'updateFrequency' | 'batchSize' | 'groupId' | 'skipFloors' | 'sendLatestRows' | 'sendRowsSqlTemplate';
type PlacementKey = 'entryPlacement' | 'extraIndexPlacement' | 'fixedEntryPlacement' | 'fixedIndexPlacement';
type GlobalPlacementKey = 'readableEntryPlacement' | 'wrapperPlacement';
type ExtraIndexMode = 'both' | 'index_only';

export interface VisualizerPlacementDraft {
  position: string;
  depth: number;
  order: number;
}

function intValue(value: unknown, fallback = -1): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown): string {
  return String(value ?? '');
}

function ensureSheetContent(sheet: any): any[][] {
  if (!Array.isArray(sheet.content)) sheet.content = [[null, '列1']];
  if (!Array.isArray(sheet.content[0])) sheet.content[0] = [null, '列1'];
  return sheet.content;
}

function clonePlacement(value: any, fallback: any): VisualizerPlacementDraft {
  const normalized = normalizePlacementConfig_ACU(value, fallback);
  return {
    position: normalized.position,
    depth: normalized.depth,
    order: normalized.order,
  };
}

function getPlacementFallback(key: PlacementKey, tableName: string): VisualizerPlacementDraft {
  const fixedDefaults = getFixedPlacementDefaultsForTable_ACU(tableName);
  const fallback = key === 'extraIndexPlacement'
    ? DEFAULT_EXTRA_INDEX_PLACEMENT_ACU
    : key === 'fixedEntryPlacement'
      ? fixedDefaults.entry
      : key === 'fixedIndexPlacement'
        ? fixedDefaults.index
        : DEFAULT_ENTRY_PLACEMENT_ACU;
  return clonePlacement(fallback, fallback);
}

function ensureEditableExportConfig(sheet: any): any {
  if (!sheet || typeof sheet !== 'object') return {};
  if (!sheet.exportConfig || typeof sheet.exportConfig !== 'object') sheet.exportConfig = {};
  const target = sheet.exportConfig;
  const normalized = ensureExportConfigDefaults_ACU(target, sheet.name || sheet.uid || '');
  Object.keys(normalized).forEach(key => {
    target[key] = normalized[key];
  });
  return target;
}

export function useVisualizerConfigEditing() {
  const visualizer = useVisualizerStore();
  const toastStore = useToastStore();

  const isSQLite = computed(() => isSqliteMode());
  const currentSheet = computed(() => visualizer.currentSheet);
  const headers = computed<string[]>(() => {
    const headerRow = Array.isArray(currentSheet.value?.content?.[0])
      ? currentSheet.value.content[0]
      : [];
    return headerRow.slice(1).map((item: any, index: number) => stringValue(item || `字段 ${index + 1}`));
  });
  const visibleColumnEntries = computed(() => {
    const sheet = currentSheet.value;
    if (!sheet) return [];
    return getSheetColumnProjection_ACU(sheet).visibleColumns
      .filter(column => column.sourceIndex > 0)
      .map(column => ({ header: column.header, columnIndex: column.sourceIndex - 1 }));
  });

  const exportConfig = computed(() =>
    currentSheet.value
      ? ensureExportConfigDefaults_ACU(
        currentSheet.value.exportConfig,
        currentSheet.value.name || currentSheet.value.uid || '',
      )
      : null,
  );

  const fixedConfigEnabled = computed(() => {
    const name = stringValue(currentSheet.value?.name).trim();
    return isSummaryTableName_ACU(name) || isOutlineTableName_ACU(name) || isImportantPersonsTableName_ACU(name);
  });

  const importantPersonsFixedIndexEnabled = computed(() =>
    isImportantPersonsTableName_ACU(stringValue(currentSheet.value?.name)),
  );

  const specialIndex = computed(() => {
    const sheet = currentSheet.value;
    const key = visualizer.currentSheetKey;
    const enabled = !!sheet?.name && isSummaryOrOutlineTable_ACU(stringValue(sheet.name));
    const index = enabled ? getSummaryIndexColumnIndex_ACU(sheet) : -1;
    return {
      enabled,
      index,
      header: index >= 0 ? stringValue(headers.value[index]) : '',
      locked: enabled && key ? visualizer.isSpecialIndexLocked(key) : false,
    };
  });

  const apiPresetOptions = computed(() => [
    { value: '', label: '使用填表整体 API 配置' },
    ...(Array.isArray(settings_ACU.apiPresets) ? settings_ACU.apiPresets : [])
      .map((preset: any) => stringValue(preset?.name).trim())
      .filter(Boolean)
      .map((name: string) => ({ value: name, label: name })),
  ]);

  const currentTableApiPreset = computed(() => {
    const sheetName = stringValue(currentSheet.value?.name).trim();
    if (!sheetName || !settings_ACU.tableApiPresetOverridesByName) return '';
    return stringValue(settings_ACU.tableApiPresetOverridesByName[sheetName]).trim();
  });

  const globalConfig = computed(() =>
    visualizer.tempData
      ? getGlobalInjectionConfigFromData_ACU(visualizer.tempData, { ensureWriteBack: true })
      : getGlobalInjectionConfigFromData_ACU({}, { ensureWriteBack: false }),
  );

  const placementOptions = [
    { value: 'at_depth_as_system', label: '系统深度' },
    { value: 'before_character_definition', label: '角色定义前' },
    { value: 'after_character_definition', label: '角色定义后' },
  ];

  const entryTypeOptions = [
    { value: 'constant', label: '常量条目' },
    { value: 'keyword', label: '关键词触发条目' },
  ];

  const extraIndexModeOptions = [
    { value: 'both', label: '原条目和索引条目都保留' },
    { value: 'index_only', label: '仅放到索引条目' },
  ];

  function markDirty(): void {
    visualizer.setDirty(true);
  }

  function withSheet(mutator: (sheet: any) => void): void {
    const sheet = currentSheet.value;
    if (!sheet) return;
    assertVisualizerDataOpsEditable_ACU(visualizer);
    mutator(sheet);
    markDirty();
  }

  function withExportConfig(mutator: (config: any, sheet: any) => void): void {
    withSheet(sheet => {
      const config = ensureEditableExportConfig(sheet);
      mutator(config, sheet);
    });
  }

  function renameSheet(value: string | number): void {
    const nextName = stringValue(value).trim();
    if (!nextName) return;
    withSheet(sheet => {
      const previousName = stringValue(sheet.name).trim();
      sheet.name = nextName;
      const config = ensureEditableExportConfig(sheet);
      if (!config.entryName || config.entryName === previousName) config.entryName = nextName;
      if (!config.extraIndexEntryName || config.extraIndexEntryName === `${previousName}-索引`) {
        config.extraIndexEntryName = `${nextName}-索引`;
      }
      if (previousName && previousName !== nextName && settings_ACU.tableApiPresetOverridesByName?.[previousName]) {
        settings_ACU.tableApiPresetOverridesByName[nextName] = settings_ACU.tableApiPresetOverridesByName[previousName];
        delete settings_ACU.tableApiPresetOverridesByName[previousName];
        saveSettings_ACU();
      }
    });
  }

  function updateHeader(index: number, value: string | number): void {
    withSheet(sheet => {
      const content = ensureSheetContent(sheet);
      const headerIndex = Math.trunc(index) + 1;
      if (headerIndex < 1) return;
      content[0][headerIndex] = stringValue(value);
      if (String(sheet.sourceData?.ddl || '').trim()) {
        const ddlColumns = parseDDLColumnNames(sheet.sourceData.ddl);
        const ddlColumn = ddlColumns[headerIndex];
        if (ddlColumn && ddlColumn.toLowerCase() !== 'row_id') {
          sheet.sourceData.ddl = updateDDLColumnComment(sheet.sourceData.ddl, ddlColumn, stringValue(value));
        }
      }
    });
  }

  function addColumn(name: string): void {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    withSheet(sheet => {
      const content = ensureSheetContent(sheet);
      content[0].push(normalizedName);
      content.slice(1).forEach((row: any) => {
        if (Array.isArray(row)) row.push(null);
      });
    });
  }

  function deleteColumn(index: number): void {
    const sheet = currentSheet.value;
    if (!sheet) return;
    assertVisualizerDataOpsEditable_ACU(visualizer);
    const content = ensureSheetContent(sheet);
    const targetIndex = Math.trunc(index) + 1;
    if (targetIndex < 1 || targetIndex >= content[0].length) return;

    let nextDDL: string | null = null;
    if (String(sheet.sourceData?.ddl || '').trim()) {
      const currentValidation = validateDDLTextAgainstHeaders_ACU(sheet.sourceData.ddl, content[0]);
      if (!currentValidation.valid) {
        toastStore.error(`删除列已拒绝：当前 DDL 与表头不一致：${currentValidation.message}`, { muteable: false });
        return;
      }
      try {
        nextDDL = removeDDLColumnAtIndex_ACU(sheet.sourceData.ddl, targetIndex);
      } catch (error: any) {
        toastStore.error(`删除列已拒绝：${error?.message || String(error)}`, { muteable: false });
        return;
      }
    }

    withSheet(current => {
      const currentContent = ensureSheetContent(current);
      if (nextDDL !== null) {
        if (!current.sourceData || typeof current.sourceData !== 'object') current.sourceData = {};
        current.sourceData.ddl = nextDDL;
      }
      currentContent.forEach((row: any) => {
        if (Array.isArray(row)) row.splice(targetIndex, 1);
      });
    });
  }

  function updateUpdateConfig(key: UpdateConfigKey, value: string | number): void {
    withSheet(sheet => {
      if (!sheet.updateConfig || typeof sheet.updateConfig !== 'object') sheet.updateConfig = {};
      sheet.updateConfig.uiSentinel = -1;
      sheet.updateConfig[key] = key === 'sendRowsSqlTemplate' ? stringValue(value) : intValue(value, -1);
    });
  }

  function updateSourceData(key: SourceDataKey, value: string): void {
    withSheet(sheet => {
      if (!sheet.sourceData || typeof sheet.sourceData !== 'object') sheet.sourceData = {};
      sheet.sourceData[key] = value;
    });
  }

  function validateDDL(): { valid: boolean; message: string } {
    const sheet = currentSheet.value;
    // 统一契约：validator 只接受完整表头（首列为 row_id/行号/null 占位）；
    // headers.value 是 slice(1) 业务表头，不能直接传入。
    const headerRow = Array.isArray(sheet?.content?.[0]) ? sheet.content[0] : [];
    return validateDDLTextAgainstHeaders_ACU(stringValue(sheet?.sourceData?.ddl), headerRow);
  }

  function setSpecialIndexLock(enabled: boolean): void {
    const key = visualizer.currentSheetKey;
    const info = specialIndex.value;
    if (!key || !info.enabled) return;
    visualizer.applyLockChangesToDraft([{ sheetKey: key, specialIndexLocked: enabled === true }]);
    if (enabled === true && currentSheet.value && info.index >= 0) {
      applySummaryIndexSequenceToTable_ACU(currentSheet.value, info.index);
    }
  }

  function setTableApiPreset(value: string): void {
    assertVisualizerDataOpsEditable_ACU(visualizer);
    const sheetName = stringValue(currentSheet.value?.name).trim();
    if (!sheetName) return;
    if (!settings_ACU.tableApiPresetOverridesByName || typeof settings_ACU.tableApiPresetOverridesByName !== 'object') {
      settings_ACU.tableApiPresetOverridesByName = {};
    }
    const preset = stringValue(value).trim();
    if (preset) settings_ACU.tableApiPresetOverridesByName[sheetName] = preset;
    else delete settings_ACU.tableApiPresetOverridesByName[sheetName];
    const result = saveSettings_ACU();
    if (!result.saved && result.warning) {
      toastStore.warning(result.warning, { muteable: false });
    }
  }

  function updateExportConfig(key: string, value: unknown): void {
    withExportConfig(config => {
      config[key] = value;
    });
  }

  function getPlacement(key: PlacementKey): VisualizerPlacementDraft {
    const config = exportConfig.value || {};
    const sheetName = stringValue(currentSheet.value?.name);
    const fallback = getPlacementFallback(key, sheetName);
    return clonePlacement(config[key], fallback);
  }

  function updatePlacement(key: PlacementKey, field: keyof VisualizerPlacementDraft, value: string | number): void {
    withExportConfig((config, sheet) => {
      const current = clonePlacement(config[key], getPlacementFallback(key, stringValue(sheet.name)));
      const next = {
        ...current,
        [field]: field === 'position'
          ? normalizeLorebookPosition_ACU(value, current.position)
          : intValue(value, current[field]),
      };
      config[key] = normalizePlacementConfig_ACU(next, current);
    });
  }

  function setExtraIndexColumn(column: string, enabled: boolean): void {
    withExportConfig(config => {
      const header = stringValue(column);
      const columns = Array.isArray(config.extraIndexColumns) ? [...config.extraIndexColumns] : [];
      const modes = config.extraIndexColumnModes && typeof config.extraIndexColumnModes === 'object'
        ? { ...config.extraIndexColumnModes }
        : {};
      if (enabled && !columns.includes(header)) columns.push(header);
      if (!enabled) {
        const index = columns.indexOf(header);
        if (index !== -1) columns.splice(index, 1);
        delete modes[header];
      } else if (!modes[header]) {
        modes[header] = 'both';
      }
      config.extraIndexColumns = columns;
      config.extraIndexColumnModes = modes;
    });
  }

  function setExtraIndexColumnMode(column: string, mode: ExtraIndexMode): void {
    withExportConfig(config => {
      const header = stringValue(column);
      const columns = Array.isArray(config.extraIndexColumns) ? [...config.extraIndexColumns] : [];
      if (!columns.includes(header)) columns.push(header);
      config.extraIndexColumns = columns;
      config.extraIndexColumnModes = {
        ...(config.extraIndexColumnModes && typeof config.extraIndexColumnModes === 'object'
          ? config.extraIndexColumnModes
          : {}),
        [header]: mode === 'index_only' ? 'index_only' : 'both',
      };
    });
  }

  function getGlobalPlacement(key: GlobalPlacementKey): VisualizerPlacementDraft {
    const fallback = buildDefaultGlobalInjectionConfig_ACU()[key];
    return clonePlacement((globalConfig.value as any)?.[key], fallback);
  }

  function updateGlobalPlacement(key: GlobalPlacementKey, field: keyof VisualizerPlacementDraft, value: string | number): void {
    if (!visualizer.tempData) return;
    assertVisualizerDataOpsEditable_ACU(visualizer);
    const cfg = getGlobalInjectionConfigFromData_ACU(visualizer.tempData, { ensureWriteBack: true });
    const current = getGlobalPlacement(key);
    const next = {
      ...current,
      [field]: field === 'position'
        ? normalizeLorebookPosition_ACU(value, current.position)
        : intValue(value, current[field]),
    };
    cfg[key] = normalizePlacementConfig_ACU(next, current);
    if (!visualizer.tempData.mate || typeof visualizer.tempData.mate !== 'object') {
      visualizer.tempData.mate = { type: 'chatSheets', version: 1 };
    }
    visualizer.tempData.mate.globalInjectionConfig = cfg;
    markDirty();
  }

  return {
    isSQLite,
    currentSheet,
    headers,
    visibleColumnEntries,
    exportConfig,
    fixedConfigEnabled,
    importantPersonsFixedIndexEnabled,
    specialIndex,
    apiPresetOptions,
    currentTableApiPreset,
    globalConfig,
    placementOptions,
    entryTypeOptions,
    extraIndexModeOptions,
    renameSheet,
    updateHeader,
    addColumn,
    deleteColumn,
    updateUpdateConfig,
    updateSourceData,
    validateDDL,
    setSpecialIndexLock,
    setTableApiPreset,
    updateExportConfig,
    getPlacement,
    updatePlacement,
    setExtraIndexColumn,
    setExtraIndexColumnMode,
    getGlobalPlacement,
    updateGlobalPlacement,
  };
}
