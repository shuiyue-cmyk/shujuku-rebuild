/**
 * presentation/pages/visualizer-sidebar.ts — 可视化编辑器侧栏
 * 从 visualizer.ts 拆出
 */
import { renderVisualizerMain_ACU } from './visualizer-main-render';
import { TABLE_ORDER_FIELD_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { applySheetOrderNumbers_ACU } from '../../shared/utils';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import { buildDefaultExportConfig_ACU } from '../../service/worldbook/injection-engine';
import { jQuery_API_ACU } from '../dom-utils';
import { _acuVisState } from './visualizer';

  export function getOrderedSheetKeys_ACU() {
      // 新机制：顺序由每张表的 orderNo 决定；编辑器内部仍保留一个数组用于“上移/下移”
      //
      // 重要：getSortedSheetKeys_ACU() 在“聊天已存在空白指导表(guide)”时，默认会按 guide 排序并且
      // 过滤掉不在 guide 里的表。可视化编辑器允许用户新增表格，因此这里必须把“当前数据里存在但 guide
      // 里不存在”的新表追加进顺序列表，否则新增表会立刻被过滤掉，进而导致“UI不显示/保存后丢失”。

      // allKeys：忽略聊天 guide，拿到 tempData 里真实存在的全部表（含刚新增的表）
      const allKeys = getSortedSheetKeys_ACU(_acuVisState.tempData, { ignoreChatGuide: true });
      // guidedKeys：若 guide 存在，则为 guide 内已存在且在 tempData 中也存在的表（用于保持既有聊天顺序）
      const guidedKeys = getSortedSheetKeys_ACU(_acuVisState.tempData, { ignoreChatGuide: false });
      const baseOrder = (() => {
          // guidedKeys 可能为空（无 guide 或 guide 读取失败），此时用 allKeys 作为基准
          const base = (Array.isArray(guidedKeys) && guidedKeys.length) ? guidedKeys : allKeys;
          // 追加不在 guide 里的新表，确保新增表可见且可保存
          const missing = allKeys.filter((k: string) => !base.includes(k));
          return [...base, ...missing];
      })();

      if (!_acuVisState.sheetOrder || !Array.isArray(_acuVisState.sheetOrder)) {
          _acuVisState.sheetOrder = baseOrder;
      }

      // 确保顺序列表包含所有当前存在的表格，并移除已删除的表格
      // existingKeys 使用 orderNo 排序（已对缺失编号做兜底补齐）
      const existingKeys = allKeys;
      // 过滤掉已删除的
      _acuVisState.sheetOrder = _acuVisState.sheetOrder.filter((k: string) => existingKeys.includes(k));
      // 添加新增的（未在顺序列表中的）
      existingKeys.forEach((k: string) => {
          if (!_acuVisState.sheetOrder.includes(k)) {
              _acuVisState.sheetOrder.push(k);
          }
      });
      // [新增] 强制去重，防止逻辑错误导致 key 重复
      _acuVisState.sheetOrder = [...new Set(_acuVisState.sheetOrder)];

      // 同步更新 tempData 内每张表的 orderNo（保证“移动顺序即更新编号”）
      applySheetOrderNumbers_ACU(_acuVisState.tempData, _acuVisState.sheetOrder);
      return _acuVisState.sheetOrder;
  }

  // [新增] 移动表格顺序
  export function moveSheetOrder_ACU(key: string, direction: string) {
      const order = getOrderedSheetKeys_ACU();
      const currentIndex = order.indexOf(key);
      if (currentIndex === -1) return;
      
      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= order.length) return;
      
      // 交换位置
      [order[currentIndex], order[newIndex]] = [order[newIndex], order[currentIndex]];
      _acuVisState.sheetOrder = order;

      // [新机制] 移动后立即重编号（编号随调整顺序变化）
      applySheetOrderNumbers_ACU(_acuVisState.tempData, _acuVisState.sheetOrder);
      
      renderVisualizerSidebar_ACU();
  }

  export function renderVisualizerSidebar_ACU() {
      const $list = jQuery_API_ACU('#acu-vis-sidebar-list');
      $list.empty();
      
      const sheetKeys = getOrderedSheetKeys_ACU();
      const totalSheets = sheetKeys.length;
      
      sheetKeys.forEach((key: string, index: number) => {
          const sheet = _acuVisState.tempData[key];
          if (!sheet) return;
          
          const isActive = key === _acuVisState.currentSheetKey;
          const isFirst = index === 0;
          const isLast = index === totalSheets - 1;
          
          const $item = jQuery_API_ACU(`
              <div class="acu-table-nav-item ${isActive ? 'active' : ''}" data-key="${key}">
                  <div class="acu-table-nav-content">
                      <span class="acu-table-index">[${index}]</span>
                      <i class="fa-solid fa-table"></i>
                      <span class="acu-table-name" title="${escapeHtml_ACU(sheet.name)}">${escapeHtml_ACU(sheet.name)}</span>
                  </div>
                  <div class="acu-table-nav-actions">
                      <button class="acu-table-order-btn acu-move-up-btn" data-key="${key}" title="上移" ${isFirst ? 'disabled' : ''}>
                          <i class="fa-solid fa-chevron-up"></i>
                      </button>
                      <button class="acu-table-order-btn acu-move-down-btn" data-key="${key}" title="下移" ${isLast ? 'disabled' : ''}>
                          <i class="fa-solid fa-chevron-down"></i>
                      </button>
                      <button class="acu-vis-del-table-btn" data-key="${key}" title="删除表格">
                      <i class="fa-solid fa-trash"></i>
                  </button>
                  </div>
              </div>
          `);
          
          // 点击选中表格
          $item.on('click', function(e) {
              if (jQuery_API_ACU(e.target).closest('.acu-table-order-btn, .acu-vis-del-table-btn').length) return;
              _acuVisState.currentSheetKey = key;
              renderVisualizerSidebar_ACU();
              renderVisualizerMain_ACU();
          });

          // 上移按钮
          $item.find('.acu-move-up-btn').on('click', function(e) {
              e.stopPropagation();
              moveSheetOrder_ACU(key, 'up');
          });

          // 下移按钮
          $item.find('.acu-move-down-btn').on('click', function(e) {
              e.stopPropagation();
              moveSheetOrder_ACU(key, 'down');
          });

          // 删除按钮
          $item.find('.acu-vis-del-table-btn').on('click', function(e) {
              e.stopPropagation();
              const keyToDelete = jQuery_API_ACU(this).data('key');
              const tableName = _acuVisState.tempData[keyToDelete] ? _acuVisState.tempData[keyToDelete].name : '未知';
              if (confirm(`确定要删除表格 "${tableName}" 吗？此操作不可撤销。\n\n注意：删除后保存，该表格的数据和模板配置都将被移除。`)) {
                  // 记录删除队列：保存时会追溯整个聊天记录清除所有本地表格数据
                  if (!_acuVisState.deletedSheetKeys || !Array.isArray(_acuVisState.deletedSheetKeys)) {
                      _acuVisState.deletedSheetKeys = [];
                  }
                  if (keyToDelete && !_acuVisState.deletedSheetKeys.includes(keyToDelete)) {
                      _acuVisState.deletedSheetKeys.push(keyToDelete);
                  }
                  delete _acuVisState.tempData[keyToDelete];
                  // 从顺序列表中移除
      _acuVisState.sheetOrder = _acuVisState.sheetOrder.filter((k: string) => k !== keyToDelete);
                  if (_acuVisState.currentSheetKey === keyToDelete) {
                      const remainingKeys = getOrderedSheetKeys_ACU();
                      _acuVisState.currentSheetKey = remainingKeys.length > 0 ? remainingKeys[0] : null;
                  }
                  renderVisualizerSidebar_ACU();
                  renderVisualizerMain_ACU();
              }
          });

          $list.append($item);
      });
      
      // 新增表格按钮
      const $addBtn = jQuery_API_ACU(`
          <button class="acu-add-table-btn">
              <i class="fa-solid fa-plus"></i> 新增表格
          </button>
      `);

      $addBtn.on('click', function() {
          const newName = prompt("请输入新表格的名称:", "新建表格");
          if (newName) {
              const newKey = 'sheet_' + Math.random().toString(36).substr(2, 9);
              _acuVisState.tempData[newKey] = {
                  uid: newKey,
                  name: newName,
                  domain: "chat", type: "dynamic", enable: true, required: false,
                  content: [[null, "列1", "列2"]],
                  sourceData: { note: "新表格说明", initNode: "", insertNode: "", updateNode: "", deleteNode: "" },
                  // -1 = 沿用UI全局（新版默认）；updateFrequency=0 可用于"禁用该表自动更新"；groupId=-1 视为默认同组
                  updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
                  exportConfig: buildDefaultExportConfig_ACU(newName),
                  [TABLE_ORDER_FIELD_ACU]: 999999 // 临时占位，稍后会被 getOrderedSheetKeys_ACU / applySheetOrderNumbers_ACU 重编号
              };
              // 添加到顺序列表末尾 (getOrderedSheetKeys_ACU 会自动同步新增的 key，无需手动 push)
              getOrderedSheetKeys_ACU();
              _acuVisState.currentSheetKey = newKey;
              renderVisualizerSidebar_ACU();
              renderVisualizerMain_ACU();
          }
      });

      $list.append($addBtn);
  }

