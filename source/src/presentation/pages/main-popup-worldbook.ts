// main-popup-worldbook.ts
// Worldbook标签页（世界书）HTML生成

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成 Worldbook 标签页的 HTML 片段
 * 包含：世界书设置、注入目标、来源选择、条目管理
 */
export function generateWorldbookTabHTML(): string {
    return `
                <div id="acu-tab-worldbook" class="acu-tab-content">
                    <div class="acu-card">
                        <h3>世界书设置</h3>
                        <div>
                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target">数据注入目标:</label>
                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target-filter" placeholder="筛选世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                            <div class="input-group">
                                <select id="${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target" style="width: 100%;"></select>
                            </div>
                            <small class="notes">选择数据库条目（如全局、人物、大纲等）将被创建或更新到哪个世界书里。</small>
                        </div>
                        <div class="qrf_settings_block checkbox-group" style="margin-top: 12px; margin-bottom: 6px;">
                            <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-outline-entry-enabled">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-outline-entry-enabled"><strong>0TK占用模式</strong></label>
                        </div>
                        <hr style="border-color: var(--acu-border-2); margin: 15px 0;">
                         <div class="qrf_settings_block_radio">
                            <label>世界书来源 (用于AI读取上下文):</label>
                            <div class="qrf_radio_group">
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-character" name="${SCRIPT_ID_PREFIX_ACU}-worldbook-source" value="character" checked>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-character">角色卡绑定</label>
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-manual" name="${SCRIPT_ID_PREFIX_ACU}-worldbook-source" value="manual">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-manual">手动选择</label>
                            </div>
                        </div>
                        <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-manual-select-block" style="display: none; margin-top: 10px;">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-select">选择世界书 (可多选):</label>
                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-select-filter" placeholder="筛选世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                            <div class="input-group">
                                <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-select" class="qrf_worldbook_list"></div>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-refresh-worldbooks" title="刷新世界书列表">刷新</button>
                            </div>
                        </div>
                        <div style="margin-top: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <label style="margin-bottom: 0;">启用的世界书条目:</label>
                                <div class="button-group" style="margin: 0;">
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-worldbook-select-all" class="button" style="padding: 2px 8px; font-size: 0.8em;">全选</button>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-worldbook-deselect-all" class="button" style="padding: 2px 8px; font-size: 0.8em;">全不选</button>
                                </div>
                            </div>
                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-filter" placeholder="筛选条目/世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                            <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-list" class="qrf_worldbook_entry_list">
                                <!-- 条目将动态加载于此 -->
                            </div>
                        </div>
                    </div>
                </div>`;
}