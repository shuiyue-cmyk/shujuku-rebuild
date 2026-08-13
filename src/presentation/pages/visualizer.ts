import { renderVisualizerMain_ACU } from './visualizer-main-render';
import { saveVisualizerDataChanges_ACU, saveVisualizerTemplateChanges_ACU } from './visualizer-main-save';
import { renderVisualizerSidebar_ACU } from './visualizer-sidebar';
import { showToastr_ACU } from '../theme/toast';
import { toggleACUTheme_ACU } from '../window/window-styles';
import { closeACUWindow, createACUWindow, ACU_WindowManager } from '../window/window-system';
import { jQuery_API_ACU } from '../dom-utils';
import { currentJsonTableData_ACU , _set_currentJsonTableData_ACU} from '../../service/runtime/state-manager';
import { getSortedSheetKeys_ACU, reorderDataBySheetKeys_ACU } from '../../service/template/chat-scope';
import { loadAllChatMessages_ACU } from '../../service/worldbook/pipeline';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getActiveTemplatePresetMeta_ACU } from '../../service/template/template-preset-service';
import { mergeAllIndependentTables_ACU } from '../../service/runtime/helpers-remaining';
import { VISUALIZER_CSS_ACU } from './visualizer-styles';
import { resetVisualizerPendingDataOps_ACU } from './visualizer-data-ops';

  // Internal state for visualizer
  export let _acuVisState: any = {
      currentSheetKey: null,
      mode: 'data', // 'data' or 'config'
      tempData: null, // Deep copy of currentJsonTableData_ACU
      pendingDataOps: null, // 用户在数据模式产生的显式增量 CRUD 操作队列
      sheetOrder: null as string[] | null, // 有序表格键列表
      deletedSheetKeys: [] as string[] // 在可视化编辑器中删除的表格key列表
  };

  // [核心重构] 定义全局刷新函数，确保无论何时调用都能从本地数据（聊天记录）中获取最新数据并刷新UI
  (window as any).ACU_Visualizer_Refresh = async function() {
      if (!jQuery_API_ACU('#acu-visualizer-content').length && !ACU_WindowManager.isOpen(`${SCRIPT_ID_PREFIX_ACU}-visualizer-window`)) return;
      
      // 1. 尝试从聊天记录重新构建完整数据
      logDebug_ACU('Visualizer: Forcing data refresh directly from chat history (Global Function)...');
      
      // 确保消息列表是最新的
      await loadAllChatMessages_ACU(); 
      
      // 使用合并逻辑从聊天记录提取最新数据
      const freshData = await mergeAllIndependentTables_ACU();
      
      if (!freshData) {
          logWarn_ACU('Visualizer refresh: Failed to merge data from chat history.');
          // 如果失败，回退到使用当前内存数据（如果存在）
          if (currentJsonTableData_ACU) {
              _acuVisState.tempData = JSON.parse(JSON.stringify(currentJsonTableData_ACU));
              resetVisualizerPendingDataOps_ACU(_acuVisState);
          } else {
              return;
          }
      } else {
          // 如果成功，更新内存数据和编辑器数据
          const stableKeys = getSortedSheetKeys_ACU(freshData);
          _set_currentJsonTableData_ACU(reorderDataBySheetKeys_ACU(freshData, stableKeys));
          _acuVisState.tempData = JSON.parse(JSON.stringify(currentJsonTableData_ACU));
          resetVisualizerPendingDataOps_ACU(_acuVisState);
      }
      
      // 2. Validate current sheet key
      if (_acuVisState.currentSheetKey && !_acuVisState.tempData[_acuVisState.currentSheetKey]) {
          const keys = getSortedSheetKeys_ACU(_acuVisState.tempData);
          _acuVisState.currentSheetKey = keys.length > 0 ? keys[0] : null;
      } else if (!_acuVisState.currentSheetKey) {
          const keys = getSortedSheetKeys_ACU(_acuVisState.tempData);
          _acuVisState.currentSheetKey = keys.length > 0 ? keys[0] : null;
      }
      
      // 3. Re-render
      renderVisualizerSidebar_ACU();
      renderVisualizerMain_ACU();
      updateVisualizerTemplatePresetIndicator_ACU();
      
      logDebug_ACU('Visualizer: Data refresh completed.');
  };

  export function updateVisualizerTemplatePresetIndicator_ACU() {
      const $indicator = jQuery_API_ACU('#acu-vis-template-preset-indicator');
      if (!$indicator.length) return;
      const activeTemplateMeta_ACU = getActiveTemplatePresetMeta_ACU();
      $indicator.text(`当前生效模板预设：${activeTemplateMeta_ACU.displayName}（${activeTemplateMeta_ACU.scopeLabel}）`);
  }

  export function openNewVisualizer_ACU() {
      if (!currentJsonTableData_ACU) {
          showToastr_ACU('warning', '数据未加载，请先进行一次对话或初始化。');
          return;
      }

      // Initial Load
      _acuVisState.tempData = JSON.parse(JSON.stringify(currentJsonTableData_ACU));
      resetVisualizerPendingDataOps_ACU(_acuVisState);
      _acuVisState.currentSheetKey = getSortedSheetKeys_ACU(_acuVisState.tempData)[0] || null; // Default to first sheet
      const activeTemplateMeta_ACU = getActiveTemplatePresetMeta_ACU();
      const activeTemplatePresetText_ACU = `当前生效模板预设：${activeTemplateMeta_ACU.displayName}（${activeTemplateMeta_ACU.scopeLabel}）`;
      
      // 构建可视化编辑器内容（不含外层容器，由独立窗口系统提供）
      const visualizerContent = `
          <div id="acu-visualizer-content" style="display: flex; flex-direction: column; height: 100%;">
              <style>${VISUALIZER_CSS_ACU}</style>
              <div class="acu-vis-toolbar" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: transparent; border-bottom: 1px solid var(--vis-border-color); flex-shrink: 0;">
                  <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                      <span class="seal" style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid var(--vis-accent); color: var(--vis-accent); font-size: 12px; border-radius: 1px; opacity: 0.85; letter-spacing: 1px;">墨</span>
                      <div style="display: flex; flex-direction: column; gap: 6px;">
                          <div class="acu-mode-switch">
                              <button class="acu-mode-btn active" data-mode="data">数据编辑</button>
                              <button class="acu-mode-btn" data-mode="config">结构/参数配置</button>
                              <button class="acu-mode-btn" data-mode="globalConfig">全局注入配置</button>
                          </div>
                          <div id="acu-vis-template-preset-indicator" class="acu-hint" style="font-size: 12px; color: var(--vis-text-mute);">${escapeHtml_ACU(activeTemplatePresetText_ACU)}</div>
                      </div>
                  </div>
                  <div class="acu-vis-actions" style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                      <button id="acu-vis-theme-btn" class="acu-btn-secondary acu-vis-theme-btn" title="切换主题"><span class="acu-theme-toggle-text">素纱</span></button>
                      <button id="acu-vis-save-data-btn" class="acu-btn-primary"><i class="fa-solid fa-database"></i> 保存数据到当前消息</button>
                      <button id="acu-vis-save-template-chat-btn" class="acu-btn-secondary"><i class="fa-solid fa-layer-group"></i> 保存模板到当前聊天</button>
                      <button id="acu-vis-save-template-global-btn" class="acu-btn-secondary"><i class="fa-solid fa-globe"></i> 保存模板到全局</button>
                  </div>
              </div>
              <div class="acu-vis-content" style="flex: 1; display: flex; overflow: hidden;">
                  <div class="acu-vis-workspace">
                      <div class="acu-vis-sidebar" id="acu-vis-sidebar-list"></div>
                      <div class="acu-vis-main" id="acu-vis-main-area"></div>
                  </div>
                  <div class="acu-vis-assistant-dock" id="acu-vis-assistant-dock"></div>
              </div>
          </div>
      `;
      
      const windowId = `${SCRIPT_ID_PREFIX_ACU}-visualizer-window`;
      
      // 如果窗口已存在，先移除
      closeACUWindow(windowId);
      
      // 创建独立窗口
      createACUWindow({
          id: windowId,
          title: '数据库编辑器',
          content: visualizerContent,
          width: 1400,  // 基础宽度
          height: 900,  // 基础高度
          modal: false,
          resizable: true,
          maximizable: true,
          startMaximized: false, // 由 rememberState 自动管理，首次打开时不全屏
          forcePhoneFullscreen: true,
          onClose: () => {
              if (!confirm('确定要关闭吗？未保存的修改将丢失。')) {
                  return false; // 阻止关闭（注意：当前实现会立即关闭，后续可优化）
              }
          },
          onReady: ($window: JQuery<HTMLElement>) => {
              // 绑定事件：数据保存与模板保存彻底分离
              $window.find('#acu-vis-save-data-btn').on('click', async () => {
                  await saveVisualizerDataChanges_ACU();
              });

              $window.find('#acu-vis-save-template-chat-btn').on('click', async () => {
                  await saveVisualizerTemplateChanges_ACU('chat');
              });

              $window.find('#acu-vis-save-template-global-btn').on('click', async () => {
                  await saveVisualizerTemplateChanges_ACU('global');
              });

              $window.find('.acu-mode-btn').on('click', function() {
                  $window.find('.acu-mode-btn').removeClass('active');
                  jQuery_API_ACU(this).addClass('active');
                  _acuVisState.mode = jQuery_API_ACU(this).data('mode');
                  renderVisualizerMain_ACU();
              });

              // 主题切换按钮绑定
              $window.find('#acu-vis-theme-btn').on('click', function(e) {
                  e.preventDefault();
                  e.stopPropagation();
                  const nextTheme = toggleACUTheme_ACU(document);
                  const nextLabel = nextTheme === 'silk' ? '墨纸' : '素纱';
                  $window.find('#acu-vis-theme-btn .acu-theme-toggle-text').text(nextLabel);
              });

              // [核心重构] 绑定事件以支持旧的触发方式，但实际逻辑委托给全局函数
              jQuery_API_ACU(document).off('acu-visualizer-refresh-data');
              jQuery_API_ACU(document).on('acu-visualizer-refresh-data', () => {
                  if (typeof (window as any).ACU_Visualizer_Refresh === 'function') {
                      (window as any).ACU_Visualizer_Refresh();
                  }
              });

              renderVisualizerSidebar_ACU();
              renderVisualizerMain_ACU();
              updateVisualizerTemplatePresetIndicator_ACU();
          }
      });
  }

  // [新增] 表格顺序管理 - 存储有序的表格键列表
