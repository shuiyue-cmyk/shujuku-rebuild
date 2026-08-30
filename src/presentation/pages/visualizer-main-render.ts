/**
 * presentation/pages/visualizer-main-render.ts
 * 可视化编辑器渲染入口 + 全局配置 + 数据模式
 */
/**
 * presentation/pages/visualizer-main.ts — 可视化编辑器主区域 + 保存
 * 从 visualizer.ts 拆出
 */
import { TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';
import { isDefaultTemplatePresetSelection_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../shared/template-preset-utils';
import { getOrderedSheetKeys_ACU } from './visualizer-sidebar';
import { showToastr_ACU } from '../theme/toast';
import { getChatArray_ACU } from '../../service/chat/chat-service';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU} from '../../service/runtime/state-manager';
import { buildChatSheetGuideDataFromData_ACU, getChatSheetGuideDataForIsolationKey_ACU, sanitizeTemplateSnapshotForChat_ACU, setChatSheetGuideDataForIsolationKey_ACU } from '../../service/template/chat-scope';
import { updateReadableLorebookEntry_ACU } from '../../service/worldbook/pipeline';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../components/pipeline-ui-helpers';
import { SCRIPT_ID_PREFIX_ACU, TABLE_ORDER_FIELD_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { safeJsonStringify_ACU } from '../../shared/json-helpers';
import { applySheetOrderNumbers_ACU, ensureSheetOrderNumbers_ACU, isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { saveIndependentTableToChatHistory_ACU } from '../../service/table/table-service';
import { applyTemplatePresetToCurrent_ACU, resolveActiveTemplatePresetName_ACU, upsertTemplatePreset_ACU } from '../../service/template/template-preset-service';
import { loadTemplatePresetSelect_ACU } from '../components/template-preset-ui';
import { updateCardUpdateStatusDisplay_ACU } from '../components/update-status-display';
import { applySpecialIndexSequenceToSummaryTables_ACU, getSummaryIndexColumnIndex_ACU, getTableLocksForSheet_ACU, isSpecialIndexLockEnabled_ACU, setSpecialIndexLockEnabled_ACU, toggleCellLock_ACU, toggleColLock_ACU, toggleRowLock_ACU } from '../../service/runtime/helpers-remaining';
import { getSortedSheetKeys_ACU, materializeDataFromSheetGuide_ACU } from '../../service/template/chat-scope';
import { DEFAULT_ENTRY_PLACEMENT_ACU, DEFAULT_EXTRA_INDEX_PLACEMENT_ACU, buildDefaultGlobalInjectionConfig_ACU, ensureSheetExportConfigDefaults_ACU, getFixedPlacementDefaultsForTable_ACU, getGlobalInjectionConfigFromData_ACU, isImportantPersonsTableName_ACU, isOutlineTableName_ACU, isSummaryTableName_ACU, normalizeLorebookPosition_ACU, normalizePlacementConfig_ACU, purgeSheetKeysFromChatHistoryHard_ACU } from '../../service/worldbook/injection-engine';
import { jQuery_API_ACU } from '../dom-utils';
import { _acuVisState } from './visualizer';
import { $popupInstance_ACU } from '../state/ui-refs';
import { closeACUWindow } from '../window/window-system';

// 循环 import — 运行时安全
import { renderVisualizerConfigMode_ACU } from './visualizer-main-config';
import {
    assertVisualizerDataOpsEditable_ACU,
    createVisualizerTempRowId_ACU,
    recordVisualizerCellUpdate_ACU,
    recordVisualizerRowDelete_ACU,
    recordVisualizerRowInsert_ACU,
    recordVisualizerSheetRowsUpdate_ACU,
} from './visualizer-data-ops';

  export function renderVisualizerMain_ACU() {
      const $main = jQuery_API_ACU('#acu-vis-main-area');
      $main.empty();

      if (_acuVisState.mode === 'globalConfig') {
          renderVisualizerGlobalConfigMode_ACU($main);
          return;
      }
      
      if (!_acuVisState.currentSheetKey) {
          $main.html('<div style="text-align:center; padding:50px; color:#888;">请选择一个表格</div>');
          return;
      }
      
      let sheet = _acuVisState.tempData[_acuVisState.currentSheetKey];
      if (!sheet) {
          const nextValidSheetKey = getOrderedSheetKeys_ACU().find((key: string) => !!_acuVisState.tempData[key]);
          if (nextValidSheetKey) {
              _acuVisState.currentSheetKey = nextValidSheetKey;
              sheet = _acuVisState.tempData[nextValidSheetKey];
          }
      }
      if (!sheet) {
          $main.html('<div style="text-align:center; padding:50px; color:#888;">当前表格不可用，请重新选择或刷新数据。</div>');
          return;
      }

      if (_acuVisState.mode === 'data') {
          renderVisualizerDataMode_ACU($main, sheet);
      } else {
          renderVisualizerConfigMode_ACU($main, sheet);
      }
  }

  export function renderVisualizerGlobalConfigMode_ACU($container: JQuery<HTMLElement>) {
      const cfg = getGlobalInjectionConfigFromData_ACU(_acuVisState.tempData, { ensureWriteBack: true });
      const readablePlacement = normalizePlacementConfig_ACU(cfg.readableEntryPlacement, buildDefaultGlobalInjectionConfig_ACU().readableEntryPlacement);
      const wrapperPlacement = normalizePlacementConfig_ACU(cfg.wrapperPlacement, buildDefaultGlobalInjectionConfig_ACU().wrapperPlacement);

      const html = `
          <div class="acu-config-panel">
              <div class="acu-config-section">
                  <h4>全局条目注入配置（跨表）</h4>
                  <div class="acu-hint" style="margin-bottom:10px;">该配置独立于单表，跟随当前模板预设保存。</div>
                  <div class="acu-form-group">
                      <label>全局可读条目位置:</label>
                      <select class="acu-form-input" id="cfg-global-readable-position">
                          <option value="at_depth_as_system" ${readablePlacement.position === 'at_depth_as_system' ? 'selected' : ''}>系统</option>
                          <option value="before_character_definition" ${readablePlacement.position === 'before_character_definition' ? 'selected' : ''}>角色定义前</option>
                          <option value="after_character_definition" ${readablePlacement.position === 'after_character_definition' ? 'selected' : ''}>角色定义后</option>
                      </select>
                  </div>
                  <div class="acu-form-group">
                      <label>全局可读条目插入深度 (Depth):</label>
                      <input type="number" class="acu-form-input" id="cfg-global-readable-depth" step="1" value="${readablePlacement.depth}">
                  </div>
                  <div class="acu-form-group">
                      <label>全局可读条目插入顺序 (Order):</label>
                      <input type="number" class="acu-form-input" id="cfg-global-readable-order" min="1" step="1" value="${readablePlacement.order}">
                  </div>

                  <div class="acu-form-group" style="margin-top:12px; padding-top:10px; border-top:1px dashed #ddd;">
                      <label>全局包裹条目位置:</label>
                      <select class="acu-form-input" id="cfg-global-wrapper-position">
                          <option value="at_depth_as_system" ${wrapperPlacement.position === 'at_depth_as_system' ? 'selected' : ''}>系统</option>
                          <option value="before_character_definition" ${wrapperPlacement.position === 'before_character_definition' ? 'selected' : ''}>角色定义前</option>
                          <option value="after_character_definition" ${wrapperPlacement.position === 'after_character_definition' ? 'selected' : ''}>角色定义后</option>
                      </select>
                  </div>
                  <div class="acu-form-group">
                      <label>全局包裹条目插入深度 (Depth):</label>
                      <input type="number" class="acu-form-input" id="cfg-global-wrapper-depth" step="1" value="${wrapperPlacement.depth}">
                  </div>
                  <div class="acu-form-group">
                      <label>全局包裹条目插入顺序 (Order):</label>
                      <input type="number" class="acu-form-input" id="cfg-global-wrapper-order" min="1" step="1" value="${wrapperPlacement.order}">
                  </div>
              </div>
          </div>
      `;
      $container.html(html);

      const parseIntOrDefault_ACU = (val: any, defVal: number) => {
          const n = parseInt(val, 10);
          return Number.isFinite(n) ? n : defVal;
      };
      const readPlacementFromInputs_ACU = (prefix: string, fallbackPlacement: any) => {
          const position = normalizeLorebookPosition_ACU(jQuery_API_ACU(`#${prefix}-position`).val(), fallbackPlacement.position);
          const depth = parseIntOrDefault_ACU(jQuery_API_ACU(`#${prefix}-depth`).val(), fallbackPlacement.depth);
          const order = parseIntOrDefault_ACU(jQuery_API_ACU(`#${prefix}-order`).val(), fallbackPlacement.order);
          return normalizePlacementConfig_ACU({ position, depth, order }, fallbackPlacement);
      };

      const syncGlobalInjectionConfigFromUi_ACU = () => {
          const nextCfg = getGlobalInjectionConfigFromData_ACU(_acuVisState.tempData, { ensureWriteBack: true });
          nextCfg.readableEntryPlacement = readPlacementFromInputs_ACU('cfg-global-readable', buildDefaultGlobalInjectionConfig_ACU().readableEntryPlacement);
          nextCfg.wrapperPlacement = readPlacementFromInputs_ACU('cfg-global-wrapper', buildDefaultGlobalInjectionConfig_ACU().wrapperPlacement);
          _acuVisState.tempData.mate.globalInjectionConfig = nextCfg;
      };

      jQuery_API_ACU('#cfg-global-readable-position, #cfg-global-readable-depth, #cfg-global-readable-order').on('input change', function() {
          syncGlobalInjectionConfigFromUi_ACU();
      });
      jQuery_API_ACU('#cfg-global-wrapper-position, #cfg-global-wrapper-depth, #cfg-global-wrapper-order').on('input change', function() {
          syncGlobalInjectionConfigFromUi_ACU();
      });
  }

  export function renderVisualizerDataMode_ACU($container: JQuery<HTMLElement>, sheet: any) {
      // Headers
      const headers = sheet.content[0] || [];
      const dataHeaders = headers.slice(1);
      const rows = sheet.content.slice(1);
      const sheetKey = _acuVisState.currentSheetKey;
      // 传入编辑器工作副本 content：未保存的新增行也能按身份正确解析锁定索引。
      const lockState = sheetKey ? getTableLocksForSheet_ACU(sheetKey, sheet.content) : { rows: new Set(), cols: new Set(), cells: new Set() };
      const isSummaryTable = isSummaryOrOutlineTable_ACU(sheet.name);
      const specialIndexCol = (isSummaryTable ? getSummaryIndexColumnIndex_ACU(sheet) : -1);
      const specialIndexLocked = (isSummaryTable && sheetKey) ? isSpecialIndexLockEnabled_ACU(sheetKey) : false;
      
      let html = `<div class="acu-card-grid">`;
      
      // Add "Add Row" card
      html += `
          <div class="acu-data-card" style="justify-content:center; align-items:center; cursor:pointer; background:#f0f6ff; border:2px dashed #4a90e2;" id="acu-vis-add-row">
              <i class="fa-solid fa-plus" style="font-size:30px; color:#4a90e2;"></i>
              <div style="margin-top:10px; color:#4a90e2; font-weight:bold;">添加新行</div>
          </div>
      `;

      rows.forEach((row: any[], rIdx: number) => {
          const rowLocked = lockState.rows.has(rIdx);
          html += `<div class="acu-data-card">
                      <div class="acu-card-header">
                          <span>#${rIdx + 1}</span>
                          <div style="display:flex; align-items:center; gap:8px;">
                              <button class="acu-lock-btn acu-vis-lock-row ${rowLocked ? 'active' : ''}" data-idx="${rIdx}" title="锁定行（仅update）">
                                  <i class="fa-solid ${rowLocked ? 'fa-lock' : 'fa-unlock'}"></i>
                              </button>
                              <button class="acu-vis-del-row" data-idx="${rIdx}" style="background:none; border:none; color:#e95e5e; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
                          </div>
                      </div>
                      <div class="acu-card-body">`;
          
          // Render fields (Skip index 0 usually internal ID or null)
          dataHeaders.forEach((header: any, colIdx: number) => {
              const val = row[colIdx + 1] || '';
              const colLocked = lockState.cols.has(colIdx);
              const cellLocked = lockState.cells.has(`${rIdx}:${colIdx}`);
              const isSpecialIndex = (isSummaryTable && colIdx === specialIndexCol);
              const lockedClass = (rowLocked || colLocked || cellLocked || (isSpecialIndex && specialIndexLocked)) ? 'acu-locked-field' : '';
              const colLockButton = isSpecialIndex
                  ? `<button class="acu-lock-btn special acu-vis-lock-special ${specialIndexLocked ? 'active' : ''}" data-col="${colIdx}" title="编码索引列特殊锁定">
                         <i class="fa-solid ${specialIndexLocked ? 'fa-lock' : 'fa-unlock'}"></i>
                         <span>特锁</span>
                     </button>`
                  : `<button class="acu-lock-btn acu-vis-lock-col ${colLocked ? 'active' : ''}" data-col="${colIdx}" title="锁定列（仅update）">
                         <i class="fa-solid ${colLocked ? 'fa-lock' : 'fa-unlock'}"></i>
                     </button>`;
              const cellLockButton = isSpecialIndex
                  ? ''
                  : `<button class="acu-lock-btn acu-vis-lock-cell ${cellLocked ? 'active' : ''}" data-row="${rIdx}" data-col="${colIdx}" title="锁定单元格（仅update）">
                         <i class="fa-solid ${cellLocked ? 'fa-lock' : 'fa-unlock'}"></i>
                     </button>`;
              html += `
                  <div class="acu-field-row ${lockedClass}">
                      <div class="acu-field-label" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                          <span>${escapeHtml_ACU(header)}</span>
                          ${colLockButton}
                      </div>
                      <div class="acu-field-value-wrap">
                          <div class="acu-field-value" contenteditable="true" data-row="${rIdx}" data-col="${colIdx}">${escapeHtml_ACU(String(val))}</div>
                          ${cellLockButton}
                      </div>
                  </div>
              `;
          });
          
          html += `</div></div>`;
      });
      
      html += `</div>`;
      $container.html(html);
      
      // Bind Data Events
      $container.find('.acu-field-value').on('input', function() {
          const rIdx = parseInt(jQuery_API_ACU(this).data('row'));
          const cIdx = parseInt(jQuery_API_ACU(this).data('col'));
          const val = jQuery_API_ACU(this).text(); // Use text() to avoid HTML injection
          
          // Update temp data (rIdx + 1 because row 0 is header)
          if (sheet.content[rIdx + 1]) {
              assertVisualizerDataOpsEditable_ACU(_acuVisState);
              const rowId = sheet.content[rIdx + 1][0];
              const columnName = headers[cIdx + 1];
              sheet.content[rIdx + 1][cIdx + 1] = val;
              if (sheetKey) recordVisualizerCellUpdate_ACU(_acuVisState, sheetKey, rowId, columnName, val);
          }
      });
      
      $container.find('#acu-vis-add-row').on('click', () => {
          assertVisualizerDataOpsEditable_ACU(_acuVisState);
          const newRow = new Array(headers.length).fill('');
          newRow[0] = createVisualizerTempRowId_ACU();
          sheet.content.push(newRow);
          if (sheetKey) recordVisualizerRowInsert_ACU(_acuVisState, sheetKey, String(newRow[0]));
          if (isSummaryTable && sheetKey && isSpecialIndexLockEnabled_ACU(sheetKey)) {
              applySpecialIndexSequenceToSummaryTables_ACU(_acuVisState.tempData);
              recordVisualizerSheetRowsUpdate_ACU(_acuVisState, sheetKey);
          }
          renderVisualizerDataMode_ACU($container, sheet);
      });
      
      $container.find('.acu-vis-del-row').on('click', function() {
          const rIdx = parseInt(jQuery_API_ACU(this).data('idx'));
          if (confirm('确定删除此行吗？')) {
              const rowId = sheet.content[rIdx + 1]?.[0];
              assertVisualizerDataOpsEditable_ACU(_acuVisState);
              if (sheetKey) recordVisualizerRowDelete_ACU(_acuVisState, sheetKey, rowId);
              sheet.content.splice(rIdx + 1, 1);
              if (isSummaryTable && sheetKey && isSpecialIndexLockEnabled_ACU(sheetKey)) {
                  applySpecialIndexSequenceToSummaryTables_ACU(_acuVisState.tempData);
                  recordVisualizerSheetRowsUpdate_ACU(_acuVisState, sheetKey);
              }
              renderVisualizerDataMode_ACU($container, sheet);
          }
      });

      // 行锁定
      $container.find('.acu-vis-lock-row').on('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          const rIdx = parseInt(jQuery_API_ACU(this).data('idx'));
          if (!sheetKey || Number.isNaN(rIdx)) return;
          toggleRowLock_ACU(sheetKey, rIdx, sheet.content);
          renderVisualizerDataMode_ACU($container, sheet);
      });

      // 列锁定
      $container.find('.acu-vis-lock-col').on('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          const cIdx = parseInt(jQuery_API_ACU(this).data('col'));
          if (!sheetKey || Number.isNaN(cIdx)) return;
          toggleColLock_ACU(sheetKey, cIdx, sheet.content);
          renderVisualizerDataMode_ACU($container, sheet);
      });

      // 单元格锁定
      $container.find('.acu-vis-lock-cell').on('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          const rIdx = parseInt(jQuery_API_ACU(this).data('row'));
          const cIdx = parseInt(jQuery_API_ACU(this).data('col'));
          if (!sheetKey || Number.isNaN(rIdx) || Number.isNaN(cIdx)) return;
          toggleCellLock_ACU(sheetKey, rIdx, cIdx, sheet.content);
          renderVisualizerDataMode_ACU($container, sheet);
      });

      // 编码索引列特殊锁定
      $container.find('.acu-vis-lock-special').on('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (!sheetKey) return;
          const next = !isSpecialIndexLockEnabled_ACU(sheetKey);
          setSpecialIndexLockEnabled_ACU(sheetKey, next);
          if (next) {
              applySpecialIndexSequenceToSummaryTables_ACU(_acuVisState.tempData);
              recordVisualizerSheetRowsUpdate_ACU(_acuVisState, sheetKey);
          }
          renderVisualizerDataMode_ACU($container, sheet);
      });
  }

