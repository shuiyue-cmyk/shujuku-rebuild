// main-popup-status.ts
// 仪表盘标签页 HTML生成
// 原status页拆分：仪表盘（本文件）+ 更新（main-popup-update.ts）

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成仪表盘标签页的 HTML 片段
 * 包含：数据库状态总览、快速操作、核心功能开关、API快照
 */
export function generateDashboardTabHTML(): string {
    return `
                <div id="acu-tab-dashboard" class="acu-tab-content active">
                    <!-- A. 数据库状态 -->
                    <div class="acu-card">
                        <h3>数据库状态</h3>
                        <div class="acu-row-between" style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--acu-border);">
                            <span id="${SCRIPT_ID_PREFIX_ACU}-total-messages-display">上下文总层数: N/A (仅计算AI回复楼层)</span>
                            <span id="${SCRIPT_ID_PREFIX_ACU}-card-update-status-display">正在获取状态...</span>
                        </div>
                        
                        <table class="acu-table">
                            <thead>
                                <tr>
                                    <th>表格名称</th>
                                    <th>更新频率</th>
                                    <th>未记录楼层</th>
                                    <th>上次更新</th>
                                    <th>下次触发</th>
                                </tr>
                            </thead>
                            <tbody id="${SCRIPT_ID_PREFIX_ACU}-granular-status-table-body">
                                <tr><td colspan="5" style="text-align: center; padding: 10px;">正在加载数据...</td></tr>
                            </tbody>
                        </table>

                        <p id="${SCRIPT_ID_PREFIX_ACU}-next-update-display" class="notes" style="border-top: 1px dashed var(--acu-border); padding-top: 10px; margin-top: 10px; text-align: right;">下一次更新: 计算中...</p>
                    </div>

                    <!-- B. 快速操作 -->
                    <div class="acu-card">
                        <h3>快速操作</h3>
                        <div class="acu-row" style="margin-bottom: 10px;">
                            <label style="white-space: nowrap;">填表API预设:</label>
                            <select id="${SCRIPT_ID_PREFIX_ACU}-table-api-preset-select" style="flex: 1;">
                                <option value="">使用当前API配置</option>
                            </select>
                        </div>
                        <div class="button-group" style="margin-bottom: 8px;">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-manual-update-card" class="primary">立即手动更新</button>
                        </div>
                        <div class="checkbox-group">
                            <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-manual-extra-hint-checkbox">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-manual-extra-hint-checkbox">额外提示词（仅手动更新时临时追加）</label>
                        </div>
                        <p class="notes">手动更新会使用当前UI参数，对勾选的表进行更新；未勾选则默认更新全部表。</p>
                    </div>

                    <!-- C. 手动更新表选择 -->
                    <div class="acu-card">
                        <h3>手动更新表选择</h3>
                        <p class="notes" style="margin-bottom:6px;">选择需要手动更新的表（可多选，默认全选新表）：</p>
                        <div class="button-group" style="justify-content:flex-start; margin-bottom:8px;">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-manual-table-select-all" class="button">全选</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-manual-table-select-none" class="button">全不选</button>
                        </div>
                        <div id="${SCRIPT_ID_PREFIX_ACU}-manual-table-selector" style="min-height:60px;">加载表格列表中...</div>
                    </div>

                    <!-- D. 核心功能开关 -->
                    <div class="acu-card">
                        <h3>核心功能开关</h3>
                        <div class="acu-col">
                            <div class="checkbox-group">
                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-auto-update-enabled-checkbox">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-auto-update-enabled-checkbox">启用自动更新</label>
                            </div>
                            <div class="checkbox-group">
                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-standardized-table-fill-enabled-checkbox">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-standardized-table-fill-enabled-checkbox">规范填表功能（总结表与总体大纲必须同步新增）</label>
                            </div>
                            <div class="checkbox-group">
                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-toast-mute-enabled-checkbox">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-toast-mute-enabled-checkbox">静默提示框（除填表/规划/导入/报错外，其它提示不弹窗）</label>
                            </div>
                            <div class="checkbox-group">
                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-prompt-template-enabled-checkbox">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-prompt-template-enabled-checkbox">启用条件模板功能（&lt;if&gt;条件判断）</label>
                            </div>
                        </div>
                    </div>
                </div>`;
}
