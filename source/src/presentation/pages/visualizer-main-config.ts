/**
 * presentation/pages/visualizer-main-config.ts
 * 可视化编辑器配置模式
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
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
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
import { isSqliteMode } from '../../service/table/storage-mode';
import { updateDDLColumnComment, parseDDLColumnNames, validateDDLTextAgainstHeaders_ACU } from '../../shared/ddl-utils';

// 循环 import — 运行时安全
import { renderVisualizerMain_ACU } from './visualizer-main-render';
import { recordVisualizerSheetRowsUpdate_ACU } from './visualizer-data-ops';

/**
 * DDL 校验纯函数 — 从 jQuery 事件处理器中提取，方便单元测试
 * @returns { valid: boolean; message: string } 校验结果
 */
export function validateDDLText(ddlText: string, tableHeaders: string[]): { valid: boolean; message: string } {
    return validateDDLTextAgainstHeaders_ACU(ddlText, tableHeaders);
}

  export function renderVisualizerConfigMode_ACU($container: any, sheet: any) {
      const config = ensureSheetExportConfigDefaults_ACU(sheet);
      const updateConfig = sheet.updateConfig || {};
      const sourceData = sheet.sourceData || {};
      const ucVal = (v: any) => (Number.isFinite(v) ? v : -1);
      // [新增] 表级 API 预设覆盖：按标准化表名从 settings 映射中读取
      const normalizedSheetName = String(sheet.name || '').trim();
      const currentTableApiPreset = (settings_ACU.tableApiPresetOverridesByName && normalizedSheetName)
          ? (settings_ACU.tableApiPresetOverridesByName[normalizedSheetName] || '')
          : '';
      const apiPresets = settings_ACU.apiPresets || [];
      const tableApiPresetOptionsHtml = apiPresets.length > 0
          ? apiPresets.map((p: any) => `<option value="${escapeHtml_ACU(p.name)}" ${currentTableApiPreset === p.name ? 'selected' : ''}>${escapeHtml_ACU(p.name)}</option>`).join('')
          : '';
      const entryPlacement = normalizePlacementConfig_ACU(config.entryPlacement, DEFAULT_ENTRY_PLACEMENT_ACU);
      const extraIndexPlacement = normalizePlacementConfig_ACU(config.extraIndexPlacement, DEFAULT_EXTRA_INDEX_PLACEMENT_ACU);
      const fixedDefaults = getFixedPlacementDefaultsForTable_ACU(sheet.name);
      const fixedEntryPlacement = normalizePlacementConfig_ACU(config.fixedEntryPlacement, fixedDefaults.entry);
      const fixedIndexPlacement = normalizePlacementConfig_ACU(config.fixedIndexPlacement, fixedDefaults.index);
      const dataHeaders = Array.isArray(sheet?.content?.[0]) ? sheet.content[0].slice(1) : [];
      const selectedExtraIndexColumns = Array.isArray(config.extraIndexColumns)
          ? [...new Set(config.extraIndexColumns.filter((col: any) => dataHeaders.includes(col)))]
          : [];
      const extraIndexColumnModes = (config.extraIndexColumnModes && typeof config.extraIndexColumnModes === 'object')
          ? config.extraIndexColumnModes
          : {};
      const extraIndexColumnsHtml = dataHeaders.length > 0
          ? dataHeaders.map((header: any, colIdx: number) => {
                const checked = selectedExtraIndexColumns.includes(header);
                const modeVal = extraIndexColumnModes[header] === 'index_only' ? 'index_only' : 'both';
                return `
                    <div class="acu-extra-index-col-row" style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                        <label style="display:flex; align-items:center; gap:6px; margin:0; min-width: 220px;">
                            <input type="checkbox" class="cfg-extra-index-col-check" data-col-idx="${colIdx}" ${checked ? 'checked' : ''}>
                            <span>${escapeHtml_ACU(header)}</span>
                        </label>
                        <select class="acu-form-input cfg-extra-index-col-mode" data-col-idx="${colIdx}" style="max-width: 260px;" ${checked ? '' : 'disabled'}>
                            <option value="both" ${modeVal === 'both' ? 'selected' : ''}>该列在原条目和索引条目都保留</option>
                            <option value="index_only" ${modeVal === 'index_only' ? 'selected' : ''}>该列仅放到索引条目</option>
                        </select>
                    </div>
                `;
            }).join('')
          : '<div class="acu-hint">当前表格没有可选列。</div>';
      const isSummaryTable = isSummaryOrOutlineTable_ACU(sheet.name);
      const sheetKey = _acuVisState.currentSheetKey;
      const specialIndexCol = isSummaryTable ? getSummaryIndexColumnIndex_ACU(sheet) : -1;
      const specialIndexHeader = (specialIndexCol >= 0 && Array.isArray(sheet.content?.[0]))
          ? sheet.content[0][specialIndexCol + 1]
          : '';
      const specialIndexLocked = (isSummaryTable && sheetKey) ? isSpecialIndexLockEnabled_ACU(sheetKey) : false;
      const isFixedConfigTable =
          isSummaryTableName_ACU(sheet.name) ||
          isOutlineTableName_ACU(sheet.name) ||
          isImportantPersonsTableName_ACU(sheet.name);
      const specialLockHtml = isSummaryTable ? `
              <div class="acu-config-section">
                  <h4>编码索引列锁定</h4>
                  <div class="acu-form-group">
                      <label>
                          <input type="checkbox" id="cfg-special-index-lock" ${specialIndexLocked ? 'checked' : ''}>
                          启用编码索引列特殊锁定
                      </label>
                      <div class="acu-hint">锁定时该列由系统按 AM0001、AM0002... 自动生成，仅对AI更新生效。</div>
                      ${specialIndexCol >= 0
                          ? `<div class="acu-hint">当前识别列: [${specialIndexCol}] ${escapeHtml_ACU(String(specialIndexHeader || ''))}</div>`
                          : `<div class="acu-hint" style="color:#f6c177;">未识别到编码索引列，将默认使用最后一列。</div>`}
                  </div>
              </div>
      ` : '';
      const fixedPlacementHtml = isFixedConfigTable ? `
              <div class="acu-config-section">
                  <h4>固定条目注入配置（本表专用）</h4>
                  <div class="acu-form-group">
                      <label>主条目位置:</label>
                      <select class="acu-form-input" id="cfg-fixed-entry-position">
                          <option value="at_depth_as_system" ${fixedEntryPlacement.position === 'at_depth_as_system' ? 'selected' : ''}>系统</option>
                          <option value="before_character_definition" ${fixedEntryPlacement.position === 'before_character_definition' ? 'selected' : ''}>角色定义前</option>
                          <option value="after_character_definition" ${fixedEntryPlacement.position === 'after_character_definition' ? 'selected' : ''}>角色定义后</option>
                      </select>
                  </div>
                  <div class="acu-form-group">
                      <label>主条目插入深度 (Depth):</label>
                      <input type="number" class="acu-form-input" id="cfg-fixed-entry-depth" step="1" value="${fixedEntryPlacement.depth}">
                  </div>
                  <div class="acu-form-group">
                      <label>主条目插入顺序 (Order):</label>
                      <input type="number" class="acu-form-input" id="cfg-fixed-entry-order" min="1" step="1" value="${fixedEntryPlacement.order}">
                  </div>
                  ${isImportantPersonsTableName_ACU(sheet.name) ? `
                  <div class="acu-form-group" style="margin-top:10px; padding-top:10px; border-top: 1px dashed #ddd;">
                      <label>索引条目位置:</label>
                      <select class="acu-form-input" id="cfg-fixed-index-position">
                          <option value="at_depth_as_system" ${fixedIndexPlacement.position === 'at_depth_as_system' ? 'selected' : ''}>系统</option>
                          <option value="before_character_definition" ${fixedIndexPlacement.position === 'before_character_definition' ? 'selected' : ''}>角色定义前</option>
                          <option value="after_character_definition" ${fixedIndexPlacement.position === 'after_character_definition' ? 'selected' : ''}>角色定义后</option>
                      </select>
                  </div>
                  <div class="acu-form-group">
                      <label>索引条目插入深度 (Depth):</label>
                      <input type="number" class="acu-form-input" id="cfg-fixed-index-depth" step="1" value="${fixedIndexPlacement.depth}">
                  </div>
                  <div class="acu-form-group">
                      <label>索引条目插入顺序 (Order):</label>
                      <input type="number" class="acu-form-input" id="cfg-fixed-index-order" min="1" step="1" value="${fixedIndexPlacement.order}">
                  </div>` : ''}
              </div>
      ` : '';
      
      const html = `
          <div class="acu-config-panel">
              <div class="acu-config-section">
                  <h4>基本信息</h4>
                  <div class="acu-form-group">
                      <label>表格名称:</label>
                      <input type="text" class="acu-form-input" id="cfg-name" value="${escapeHtml_ACU(sheet.name)}">
                  </div>
              </div>

              <div class="acu-config-section">
                  <h4>表头/列定义</h4>
                  <div class="acu-col-list" id="cfg-col-list"></div>
                  <button id="cfg-add-col" class="acu-btn-secondary" style="margin-top:10px; width:100%;"><i class="fa-solid fa-plus"></i> 添加列</button>
              </div>
              ${specialLockHtml}

              <div class="acu-config-section">
                  <h4>自动化更新参数</h4>
                  <div class="acu-form-group">
                      <label>AI读取上下文层数 (Context Depth): <span class="acu-hint">(-1 = 沿用UI全局, 1+ = 生效；0 会被视为沿用UI)</span></label>
                      <input type="number" class="acu-form-input" id="cfg-depth" min="-1" step="1" value="${ucVal(updateConfig.contextDepth)}">
                  </div>
                  <div class="acu-form-group">
                      <label>更新频率 (Update Frequency): <span class="acu-hint">(-1 = 沿用UI全局, 0 = 禁用该表自动更新)</span></label>
                      <input type="number" class="acu-form-input" id="cfg-freq" min="-1" step="1" value="${ucVal(updateConfig.updateFrequency)}">
                  </div>
                  <div class="acu-form-group">
                      <label>批处理大小 (Batch Size): <span class="acu-hint">(-1 = 沿用UI全局, 1+ = 生效；0 会被视为沿用UI)</span></label>
                      <input type="number" class="acu-form-input" id="cfg-batch" min="-1" step="1" value="${ucVal(updateConfig.batchSize)}">
                  </div>
                  <div class="acu-form-group">
                      <label>分组编号 (groupId): <span class="acu-hint">(-1 = 默认同组；不同编号的表会拆分并发；相同编号仍会继续按上下文与 Batch Size 分组)</span></label>
                      <input type="number" class="acu-form-input" id="cfg-group-id" min="-1" step="1" value="${ucVal(updateConfig.groupId)}">
                  </div>
                  <div class="acu-form-group">
                      <label>跳过更新楼层 (Skip Floors): <span class="acu-hint">(-1 = 沿用UI全局, 0+ = 生效)</span></label>
                      <input type="number" class="acu-form-input" id="cfg-skip" min="-1" step="1" value="${ucVal(updateConfig.skipFloors)}">
                  </div>
                   <div class="acu-form-group">
                       <label>发送最新N行 (Send Latest Rows): <span class="acu-hint">(-1 = 全部发送, 0 = 沿用UI全局, 1+ = 仅发送最新N条；纪要表固定使用10条)</span></label>
                       <input type="number" class="acu-form-input" id="cfg-send-rows" min="-1" step="1" value="${ucVal(updateConfig.sendLatestRows)}">
                   </div>
                   <div class="acu-form-group">
                       <label>表级API预设覆盖: <span class="acu-hint">仅保存到数据库插件设置，不随模板导出；该表及同组其他表将使用此预设</span></label>
                       <select class="acu-form-input" id="cfg-table-api-preset">
                           <option value="">使用填表整体API配置</option>
                           ${tableApiPresetOptionsHtml}
                       </select>
                   </div>
               </div>

              <div class="acu-config-section">
                  <h4>AI提示词指令 (Source Data)</h4>
                  <div class="acu-form-group">
                      <label>表格说明 (Note):</label>
                      <textarea class="acu-form-textarea" id="cfg-note">${escapeHtml_ACU(sourceData.note || '')}</textarea>
                  </div>
                  <div class="acu-form-group">
                      <label>初始化触发 (Init):</label>
                      <textarea class="acu-form-textarea" id="cfg-init">${escapeHtml_ACU(sourceData.initNode || '')}</textarea>
                  </div>
                  <div class="acu-form-group">
                      <label>新增触发 (Insert):</label>
                      <textarea class="acu-form-textarea" id="cfg-insert">${escapeHtml_ACU(sourceData.insertNode || '')}</textarea>
                  </div>
                  <div class="acu-form-group">
                      <label>更新触发 (Update):</label>
                      <textarea class="acu-form-textarea" id="cfg-update">${escapeHtml_ACU(sourceData.updateNode || '')}</textarea>
                  </div>
                  <div class="acu-form-group">
                      <label>删除触发 (Delete):</label>
                      <textarea class="acu-form-textarea" id="cfg-delete">${escapeHtml_ACU(sourceData.deleteNode || '')}</textarea>
                  </div>
              </div>

              ${isSqliteMode() ? `
              <div class="acu-config-section" id="cfg-ddl-section">
                  <h4>DDL 定义 (SQLite 模式)</h4>
                  <div class="acu-form-group">
                      <label>CREATE TABLE 语句:</label>
                      <textarea class="acu-form-textarea" id="cfg-ddl" style="font-family: monospace; font-size: 0.85em; min-height: 120px; white-space: pre;">${escapeHtml_ACU(sourceData.ddl || '')}</textarea>
                      <div class="acu-hint">定义该表的 SQL Schema。SQLite 模式下，AI 将使用标准 SQL 语句更新此表。每张表 DDL 必须以 <code>row_id INTEGER PRIMARY KEY -- 行号</code> 作为第一列。</div>
                  </div>
                  <div class="acu-form-group" style="display: flex; gap: 8px; align-items: center;">
                      <button id="cfg-ddl-validate" class="acu-btn-secondary" style="white-space: nowrap;"><i class="fa-solid fa-check-circle"></i> 校验 DDL</button>
                      <span id="cfg-ddl-validate-result" class="acu-hint" style="flex: 1;"></span>
                  </div>
              </div>
              ` : ''}
              
              <div class="acu-config-section">
                  <h4>世界书注入配置</h4>
                  <div class="acu-form-group">
                      <label>
                          <input type="checkbox" id="cfg-inject" ${config.injectIntoWorldbook !== false ? 'checked' : ''}>
                          是否注入到世界书条目
                      </label>
                      <div class="acu-hint">勾选后，该表格会注入到世界书条目中；关闭后不会注入到任何世界书条目。</div>
                  </div>
                  
                  <div style="border-top: 1px dashed #ddd; margin: 10px 0; padding-top: 10px;">
                      <div class="acu-form-group">
                          <label>
                              <input type="checkbox" id="cfg-export-enabled" ${config.enabled ? 'checked' : ''}>
                              启用独立导出 (Custom Export)
                          </label>
                          <div class="acu-hint">勾选后，该表格将额外导出为独立的世界书条目。</div>
                      </div>

                      <div id="cfg-export-options" style="display: ${config.enabled ? 'block' : 'none'}; padding-left: 20px; border-left: 2px solid #eee;">
                          <div class="acu-form-group">
                              <label>
                                  <input type="checkbox" id="cfg-split" ${config.splitByRow ? 'checked' : ''}>
                                  按行拆分 (Split by Row)
                              </label>
                              <div class="acu-hint">勾选后，每一行数据将生成一个单独的条目。</div>
                          </div>
                          
                          <div class="acu-form-group">
                              <label>条目名称 (Entry Name):</label>
                              <input type="text" class="acu-form-input" id="cfg-entry-name" value="${escapeHtml_ACU(config.entryName || sheet.name || '')}" placeholder="例如: ${escapeHtml_ACU(sheet.name)}">
                              <div class="acu-hint">如果不拆分，此为条目名；如果拆分，自动命名为 "名称-1", "名称-2" 等。</div>
                          </div>

                          <div class="acu-form-group">
                              <label>条目类型 (Entry Type):</label>
                              <select class="acu-form-input" id="cfg-entry-type">
                                  <option value="constant" ${(!config.entryType || config.entryType === 'constant') ? 'selected' : ''}>常量条目 (Constant/Blue)</option>
                                  <option value="keyword" ${config.entryType === 'keyword' ? 'selected' : ''}>关键词条目 (Keyword/Green)</option>
                              </select>
                          </div>

                          <div class="acu-form-group">
                              <label>关键词 (Keywords):</label>
                              <input type="text" class="acu-form-input" id="cfg-keywords" value="${escapeHtml_ACU(config.keywords || '')}" placeholder="关键词1, 关键词2">
                              <div class="acu-hint">
                                  如果未拆分，填写的词就是关键词。<br>
                                  如果拆分且关键词与列名相同，则使用该行对应列的内容作为关键词。
                              </div>
                          </div>
                          
                          <div class="acu-form-group">
                              <label>
                                  <input type="checkbox" id="cfg-recursion" ${config.preventRecursion !== false ? 'checked' : ''}>
                                  防止递归 (Prevent Recursion)
                              </label>
                          </div>

                          <div class="acu-form-group">
                              <label>自定义注入模板 (可选):</label>
                              <textarea class="acu-form-textarea" id="cfg-template" placeholder="使用 $1 代表本表导出的蓝灯/绿灯条目列表，$1 上下的内容会分别生成独立的常量条目，插入到该表注入区块的最前与最后。">${escapeHtml_ACU(config.injectionTemplate || '')}</textarea>
                              <div class="acu-hint">注入词现在以独立的常量条目进行包裹。填写模板后，$1 保留为条目本身，$1 之前和之后的内容会各自成为前/后包裹条目。</div>
                          </div>
                          <div class="acu-form-group" style="margin-top:10px; padding-top:10px; border-top: 1px dashed #ddd;">
                              <label>主条目位置:</label>
                              <select class="acu-form-input" id="cfg-entry-position">
                                  <option value="at_depth_as_system" ${entryPlacement.position === 'at_depth_as_system' ? 'selected' : ''}>系统</option>
                                  <option value="before_character_definition" ${entryPlacement.position === 'before_character_definition' ? 'selected' : ''}>角色定义前</option>
                                  <option value="after_character_definition" ${entryPlacement.position === 'after_character_definition' ? 'selected' : ''}>角色定义后</option>
                              </select>
                          </div>
                          <div class="acu-form-group">
                              <label>主条目插入深度 (Depth):</label>
                              <input type="number" class="acu-form-input" id="cfg-entry-depth" step="1" value="${entryPlacement.depth}">
                          </div>
                          <div class="acu-form-group">
                              <label>主条目插入顺序 (Order):</label>
                              <input type="number" class="acu-form-input" id="cfg-entry-order" min="1" step="1" value="${entryPlacement.order}">
                              <div class="acu-hint">只需设置主条目的顺序；若存在上/下包裹条目，会自动占用前后顺序位。</div>
                          </div>

                          <div class="acu-form-group" style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #ddd;">
                              <label>
                                  <input type="checkbox" id="cfg-extra-index-enabled" ${config.extraIndexEnabled ? 'checked' : ''}>
                                  额外增加索引条目
                              </label>
                              <div class="acu-hint">启用后会在该表导出区块额外注入 1 条“索引条目”（常量条目）。</div>
                          </div>
                          <div id="cfg-extra-index-options" style="display: ${config.extraIndexEnabled ? 'block' : 'none'}; padding-left: 12px; border-left: 2px solid #eee;">
                              <div class="acu-form-group">
                                  <label>索引条目名称:</label>
                                  <input type="text" class="acu-form-input" id="cfg-extra-index-entry-name" value="${escapeHtml_ACU(config.extraIndexEntryName || `${config.entryName || sheet.name || ''}-索引`)}" placeholder="例如: ${escapeHtml_ACU((config.entryName || sheet.name || '表格') + '-索引')}">
                                  <div class="acu-hint">将作为额外注入世界书条目的名称。</div>
                              </div>
                              <div class="acu-form-group">
                                  <label>索引条目列选择（可多选）:</label>
                                  <div id="cfg-extra-index-columns-list">
                                      ${extraIndexColumnsHtml}
                                  </div>
                                  <div class="acu-hint">每列可独立设置：仅放索引条目，或原条目与索引条目都保留。</div>
                              </div>
                              <div class="acu-form-group">
                                  <label>索引条目自定义注入模板 (可选):</label>
                                  <textarea class="acu-form-textarea" id="cfg-extra-index-template" placeholder="使用 $1 代表索引条目内容；$1 上下内容会分别生成独立常量条目并放在索引条目之前/之后。">${escapeHtml_ACU(config.extraIndexInjectionTemplate || '')}</textarea>
                                  <div class="acu-hint">逻辑与独立导出条目的自定义注入模板一致。</div>
                              </div>
                              <div class="acu-form-group" style="margin-top:10px; padding-top:10px; border-top: 1px dashed #ddd;">
                                  <label>索引条目位置:</label>
                                  <select class="acu-form-input" id="cfg-extra-index-position">
                                      <option value="at_depth_as_system" ${extraIndexPlacement.position === 'at_depth_as_system' ? 'selected' : ''}>系统</option>
                                      <option value="before_character_definition" ${extraIndexPlacement.position === 'before_character_definition' ? 'selected' : ''}>角色定义前</option>
                                      <option value="after_character_definition" ${extraIndexPlacement.position === 'after_character_definition' ? 'selected' : ''}>角色定义后</option>
                                  </select>
                              </div>
                              <div class="acu-form-group">
                                  <label>索引条目插入深度 (Depth):</label>
                                  <input type="number" class="acu-form-input" id="cfg-extra-index-depth" step="1" value="${extraIndexPlacement.depth}">
                              </div>
                              <div class="acu-form-group">
                                  <label>索引条目插入顺序 (Order):</label>
                                  <input type="number" class="acu-form-input" id="cfg-extra-index-order" min="1" step="1" value="${extraIndexPlacement.order}">
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
              ${fixedPlacementHtml}
          </div>
      `;
      
      $container.html(html);
      
      // Render Columns
      const headers = sheet.content[0] || [];
      const $colList = jQuery_API_ACU('#cfg-col-list');
      
      function renderCols() {
          $colList.empty();
          headers.forEach((h: any, idx: number) => {
              if (idx === 0) return; // Skip ID
              const $item = jQuery_API_ACU(`
                  <div class="acu-col-item">
                      <span style="width:30px; text-align:center;">#${idx}</span>
                      <input type="text" class="acu-col-input" value="${escapeHtml_ACU(h)}" data-idx="${idx}">
                      <button class="acu-col-btn" style="color:#e95e5e;" data-idx="${idx}"><i class="fa-solid fa-times"></i></button>
                  </div>
              `);
              $colList.append($item);
          });
      }
      renderCols();
      
      // Bind Config Events
      $colList.on('input', '.acu-col-input', function() {
          const idx = parseInt(jQuery_API_ACU(this).data('idx'));
          const newValue = jQuery_API_ACU(this).val();
          headers[idx] = newValue;

          // [方案B] SQLite 模式下，用户改表头时自动同步更新 DDL 注释
          if (isSqliteMode() && sheet.sourceData?.ddl) {
              const ddlColumns = parseDDLColumnNames(sheet.sourceData.ddl);
              // idx 对应 content[0] 的位置（包含 row_id），DDL 列名顺序与 content[0] 一致
              if (idx >= 0 && idx < ddlColumns.length && ddlColumns[idx] !== 'row_id') {
                  sheet.sourceData.ddl = updateDDLColumnComment(sheet.sourceData.ddl, ddlColumns[idx], newValue);
                  // 同步更新 DDL 编辑器的显示（如果可见）
                  const $ddlTextarea = jQuery_API_ACU('#cfg-ddl');
                  if ($ddlTextarea.length) {
                      $ddlTextarea.val(sheet.sourceData.ddl);
                  }
              }
          }
      });
      
      $colList.on('click', '.acu-col-btn', function() {
          const idx = parseInt(jQuery_API_ACU(this).data('idx'));
          if (confirm('删除列将同时删除该列的所有数据，确定吗？')) {
              // [修复] headers 是 sheet.content[0] 的引用，只需对数据行执行splice，避免双重删除
              headers.splice(idx, 1);
              sheet.content.slice(1).forEach((row: any) => row.splice(idx, 1));
              renderCols();
          }
      });
      
      jQuery_API_ACU('#cfg-add-col').on('click', () => {
          const newName = prompt('输入新列名:');
          if (newName) {
              headers.push(newName);
              // Update all rows
              sheet.content.forEach((row: any, i: number) => {
                  if (i > 0) row.push('');
              });
              renderCols();
          }
      });
      
      // Inputs bindings
      jQuery_API_ACU('#cfg-name').on('input', function() { sheet.name = jQuery_API_ACU(this).val(); });
      if (isSummaryTable && sheetKey) {
          jQuery_API_ACU('#cfg-special-index-lock').on('change', function() {
              const enabled = jQuery_API_ACU(this).is(':checked');
              setSpecialIndexLockEnabled_ACU(sheetKey, enabled);
              if (enabled) {
                  applySpecialIndexSequenceToSummaryTables_ACU(_acuVisState.tempData);
                  recordVisualizerSheetRowsUpdate_ACU(_acuVisState, sheetKey);
              }
              renderVisualizerMain_ACU();
          });
      }
      const parseIntOrDefault_ACU = (val: any, defVal: any) => {
          const n = parseInt(val, 10);
          return Number.isFinite(n) ? n : defVal;
      };
      jQuery_API_ACU('#cfg-depth').on('input', function() { if (!sheet.updateConfig) sheet.updateConfig = {}; sheet.updateConfig.uiSentinel = -1; sheet.updateConfig.contextDepth = parseIntOrDefault_ACU(jQuery_API_ACU(this).val(), -1); });
      jQuery_API_ACU('#cfg-freq').on('input', function() { if (!sheet.updateConfig) sheet.updateConfig = {}; sheet.updateConfig.uiSentinel = -1; sheet.updateConfig.updateFrequency = parseIntOrDefault_ACU(jQuery_API_ACU(this).val(), -1); });
      jQuery_API_ACU('#cfg-batch').on('input', function() { if (!sheet.updateConfig) sheet.updateConfig = {}; sheet.updateConfig.uiSentinel = -1; sheet.updateConfig.batchSize = parseIntOrDefault_ACU(jQuery_API_ACU(this).val(), -1); });
      jQuery_API_ACU('#cfg-group-id').on('input', function() { if (!sheet.updateConfig) sheet.updateConfig = {}; sheet.updateConfig.uiSentinel = -1; sheet.updateConfig.groupId = parseIntOrDefault_ACU(jQuery_API_ACU(this).val(), -1); });
      jQuery_API_ACU('#cfg-skip').on('input', function() { if (!sheet.updateConfig) sheet.updateConfig = {}; sheet.updateConfig.uiSentinel = -1; sheet.updateConfig.skipFloors = parseIntOrDefault_ACU(jQuery_API_ACU(this).val(), -1); });
      jQuery_API_ACU('#cfg-send-rows').on('input', function() { if (!sheet.updateConfig) sheet.updateConfig = {}; sheet.updateConfig.uiSentinel = -1; sheet.updateConfig.sendLatestRows = parseIntOrDefault_ACU(jQuery_API_ACU(this).val(), -1); });
      
      // [新增] 表级 API 预设覆盖：按标准化表名写入 settings 映射（不写入模板对象）
      jQuery_API_ACU('#cfg-table-api-preset').on('change', function() {
          const presetVal = String(jQuery_API_ACU(this).val() || '').trim();
          const sheetName = String(sheet.name || '').trim();
          if (!sheetName) return;
          if (!settings_ACU.tableApiPresetOverridesByName) {
              settings_ACU.tableApiPresetOverridesByName = {};
          }
          if (presetVal) {
              settings_ACU.tableApiPresetOverridesByName[sheetName] = presetVal;
          } else {
              delete settings_ACU.tableApiPresetOverridesByName[sheetName];
          }
          saveSettingsAndNotify_ACU();
          logDebug_ACU(`[表级API预设] "${sheetName}" -> "${presetVal || '(使用整体配置)'}"`);
      });
      
      jQuery_API_ACU('#cfg-note').on('input', function() { if (!sheet.sourceData) sheet.sourceData = {}; sheet.sourceData.note = jQuery_API_ACU(this).val(); });
      jQuery_API_ACU('#cfg-init').on('input', function() { if (!sheet.sourceData) sheet.sourceData = {}; sheet.sourceData.initNode = jQuery_API_ACU(this).val(); });
      jQuery_API_ACU('#cfg-insert').on('input', function() { if (!sheet.sourceData) sheet.sourceData = {}; sheet.sourceData.insertNode = jQuery_API_ACU(this).val(); });
      jQuery_API_ACU('#cfg-update').on('input', function() { if (!sheet.sourceData) sheet.sourceData = {}; sheet.sourceData.updateNode = jQuery_API_ACU(this).val(); });
      jQuery_API_ACU('#cfg-delete').on('input', function() { if (!sheet.sourceData) sheet.sourceData = {}; sheet.sourceData.deleteNode = jQuery_API_ACU(this).val(); });
      
      // [新增] DDL 编辑器事件绑定（仅 SQLite 模式）
      if (isSqliteMode()) {
          jQuery_API_ACU('#cfg-ddl').on('input', function() {
              if (!sheet.sourceData) sheet.sourceData = {};
              sheet.sourceData.ddl = jQuery_API_ACU(this).val();
          });

          jQuery_API_ACU('#cfg-ddl-validate').on('click', function() {
              const $result = jQuery_API_ACU('#cfg-ddl-validate-result');
              const ddlText = String(jQuery_API_ACU('#cfg-ddl').val() || '').trim();
              // 统一契约：validator 只接受完整表头（首列为 row_id/行号/null 占位），
              // 不在此处 slice(1)。
              const headers = (sheet.content && sheet.content[0]) ? sheet.content[0] : [];
              const validation = validateDDLText(ddlText, headers);

              if (validation.valid) {
                  $result.html(`<span style="color: #a6e3a1;">${escapeHtml_ACU(validation.message)}</span>`);
              } else if (validation.message.startsWith('⚠')) {
                  $result.html(`<span style="color: #f6c177;">${escapeHtml_ACU(validation.message)}</span>`);
              } else {
                  $result.html(`<span style="color: #e95e5e;">${escapeHtml_ACU(validation.message)}</span>`);
              }
          });
      }
      
      // Worldbook Config Bindings
      const ensureExportConfig = () => { if (!sheet.exportConfig) sheet.exportConfig = {}; };

      jQuery_API_ACU('#cfg-inject').on('change', function() {
          ensureExportConfig();
          sheet.exportConfig.injectIntoWorldbook = jQuery_API_ACU(this).is(':checked');
      });

      jQuery_API_ACU('#cfg-export-enabled').on('change', function() {
          ensureExportConfig();
          const isEnabled = jQuery_API_ACU(this).is(':checked');
          sheet.exportConfig.enabled = isEnabled;
          if (isEnabled) jQuery_API_ACU('#cfg-export-options').slideDown(); else jQuery_API_ACU('#cfg-export-options').slideUp();
      });

      jQuery_API_ACU('#cfg-split').on('change', function() {
          ensureExportConfig();
          sheet.exportConfig.splitByRow = jQuery_API_ACU(this).is(':checked');
      });

      jQuery_API_ACU('#cfg-entry-name').on('input', function() {
          ensureExportConfig();
          sheet.exportConfig.entryName = jQuery_API_ACU(this).val();
      });

      jQuery_API_ACU('#cfg-entry-type').on('change', function() {
          ensureExportConfig();
          sheet.exportConfig.entryType = jQuery_API_ACU(this).val();
      });

      jQuery_API_ACU('#cfg-keywords').on('input', function() {
          ensureExportConfig();
          sheet.exportConfig.keywords = jQuery_API_ACU(this).val();
      });

      jQuery_API_ACU('#cfg-recursion').on('change', function() {
          ensureExportConfig();
          sheet.exportConfig.preventRecursion = jQuery_API_ACU(this).is(':checked');
      });

      jQuery_API_ACU('#cfg-template').on('input', function() {
          ensureExportConfig();
          sheet.exportConfig.injectionTemplate = jQuery_API_ACU(this).val();
      });

      const readPlacementFromInputs_ACU = (prefix: string, fallbackPlacement: any) => {
          const position = normalizeLorebookPosition_ACU(jQuery_API_ACU(`#${prefix}-position`).val(), fallbackPlacement.position);
          const depth = parseIntOrDefault_ACU(jQuery_API_ACU(`#${prefix}-depth`).val(), fallbackPlacement.depth);
          const order = parseIntOrDefault_ACU(jQuery_API_ACU(`#${prefix}-order`).val(), fallbackPlacement.order);
          return normalizePlacementConfig_ACU({ position, depth, order }, fallbackPlacement);
      };

      const syncEntryPlacementFromUi_ACU = () => {
          ensureExportConfig();
          sheet.exportConfig.entryPlacement = readPlacementFromInputs_ACU('cfg-entry', DEFAULT_ENTRY_PLACEMENT_ACU);
      };
      jQuery_API_ACU('#cfg-entry-position, #cfg-entry-depth, #cfg-entry-order').on('input change', function() {
          syncEntryPlacementFromUi_ACU();
      });

      const syncExtraIndexConfigFromUi = () => {
          ensureExportConfig();
          const enabled = jQuery_API_ACU('#cfg-extra-index-enabled').is(':checked');
          sheet.exportConfig.extraIndexEnabled = enabled;
          const selectedColumns: string[] = [];
          const modeMap: Record<string, string> = {};
          jQuery_API_ACU('.cfg-extra-index-col-check').each(function() {
              const colIdx = parseInt(jQuery_API_ACU(this).attr('data-col-idx'), 10);
              const colName = dataHeaders[colIdx];
              if (!colName) return;
              const isChecked = jQuery_API_ACU(this).is(':checked');
              const $mode = jQuery_API_ACU(`.cfg-extra-index-col-mode[data-col-idx="${colIdx}"]`);
              $mode.prop('disabled', !isChecked);
              if (!isChecked) return;
              selectedColumns.push(colName);
              const modeVal = $mode.val() === 'index_only' ? 'index_only' : 'both';
              modeMap[colName] = modeVal;
          });
          sheet.exportConfig.extraIndexColumns = selectedColumns;
          sheet.exportConfig.extraIndexColumnModes = modeMap;
          sheet.exportConfig.extraIndexPlacement = readPlacementFromInputs_ACU('cfg-extra-index', DEFAULT_EXTRA_INDEX_PLACEMENT_ACU);
      };

      jQuery_API_ACU('#cfg-extra-index-enabled').on('change', function() {
          ensureExportConfig();
          const enabled = jQuery_API_ACU(this).is(':checked');
          sheet.exportConfig.extraIndexEnabled = enabled;
          if (enabled) jQuery_API_ACU('#cfg-extra-index-options').slideDown(); else jQuery_API_ACU('#cfg-extra-index-options').slideUp();
          syncExtraIndexConfigFromUi();
      });

      jQuery_API_ACU('#cfg-extra-index-entry-name').on('input', function() {
          ensureExportConfig();
          sheet.exportConfig.extraIndexEntryName = jQuery_API_ACU(this).val();
      });

      jQuery_API_ACU('#cfg-extra-index-template').on('input', function() {
          ensureExportConfig();
          sheet.exportConfig.extraIndexInjectionTemplate = jQuery_API_ACU(this).val();
      });
      jQuery_API_ACU('#cfg-extra-index-position, #cfg-extra-index-depth, #cfg-extra-index-order').on('input change', function() {
          syncExtraIndexConfigFromUi();
      });

      jQuery_API_ACU('.cfg-extra-index-col-check').on('change', function() {
          syncExtraIndexConfigFromUi();
      });

      jQuery_API_ACU('.cfg-extra-index-col-mode').on('change', function() {
          syncExtraIndexConfigFromUi();
      });

      if (isFixedConfigTable) {
          const syncFixedEntryPlacementFromUi_ACU = () => {
              ensureExportConfig();
              const fallback = getFixedPlacementDefaultsForTable_ACU(sheet.name).entry;
              sheet.exportConfig.fixedEntryPlacement = readPlacementFromInputs_ACU('cfg-fixed-entry', fallback);
          };
          jQuery_API_ACU('#cfg-fixed-entry-position, #cfg-fixed-entry-depth, #cfg-fixed-entry-order').on('input change', function() {
              syncFixedEntryPlacementFromUi_ACU();
          });

          if (isImportantPersonsTableName_ACU(sheet.name)) {
              const syncFixedIndexPlacementFromUi_ACU = () => {
                  ensureExportConfig();
                  const fallback = getFixedPlacementDefaultsForTable_ACU(sheet.name).index;
                  sheet.exportConfig.fixedIndexPlacement = readPlacementFromInputs_ACU('cfg-fixed-index', fallback);
              };
              jQuery_API_ACU('#cfg-fixed-index-position, #cfg-fixed-index-depth, #cfg-fixed-index-order').on('input change', function() {
                  syncFixedIndexPlacementFromUi_ACU();
              });
          }
      }

  }

