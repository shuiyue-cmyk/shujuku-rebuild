// main-popup-import.ts
// Import标签页（外部导入）HTML生成

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成 Import 标签页的 HTML 片段
 * 包含：TXT文件导入、世界书注入目标、拆分设置、注入表选择
 */
export function generateImportTabHTML(): string {
    return `
                <div id="acu-tab-import" class="acu-tab-content">
                    <div class="acu-card">
                        <h3>从TXT文件导入</h3>
                        <p class="notes">从外部TXT文件导入内容，按指定字符数分割，并作为独立条目注入指定的世界书。这些条目独立于聊天记录，不会被自动清除。</p>
                        
                        <hr style="border-color: var(--acu-border-2); margin: 15px 0;">
                        
                        <div>
                            <label for="${SCRIPT_ID_PREFIX_ACU}-import-worldbook-injection-target">导入数据注入目标世界书:</label>
                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-import-worldbook-injection-target-filter" placeholder="筛选世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                            <div class="input-group">
                                <select id="${SCRIPT_ID_PREFIX_ACU}-import-worldbook-injection-target" style="width: 100%;"></select>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-refresh-import-worldbooks" title="刷新世界书列表">刷新</button>
                            </div>
                            <small class="notes">选择导入的数据将被注入到哪个世界书里（独立于常规更新的世界书设置）。<strong>注意：不推荐使用角色卡绑定世界书，建议使用新建的其它世界书。</strong></small>
                        </div>
                        <div class="qrf_settings_block" style="margin-top: 12px; margin-bottom: 12px;">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-import-prompt-exclude-imported-worldbook-entries"><strong>屏蔽外部导入世界书条目占位符</strong></label>
                            <label class="toggle-switch">
                                <input id="${SCRIPT_ID_PREFIX_ACU}-import-prompt-exclude-imported-worldbook-entries" type="checkbox" />
                                <span class="slider"></span>
                            </label>
                            <small class="notes">仅对外部导入流程生效。开启后，填表提示词中的世界书条目占位符会自动屏蔽所有带有"外部导入-"标签的世界书条目，避免导入流程反复读取既有导入条目。</small>
                        </div>
                        
                        <div class="acu-grid" style="grid-template-columns: 1fr 1fr; align-items: end; gap: 20px; margin-bottom: 10px;">
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-import-split-size">每段字符数:</label>
                                <div class="input-group">
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-import-split-size" min="100" step="100" value="10000">
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-save-import-split-size">保存</button>
                                </div>
                            </div>
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-import-encoding">文件编码:</label>
                                <select id="${SCRIPT_ID_PREFIX_ACU}-import-encoding">
                                    <option value="UTF-8">UTF-8 (默认)</option>
                                    <option value="GBK" selected>GBK (简体中文)</option>
                                    <option value="Big5">Big5 (繁体中文)</option>
                                </select>
                            </div>
                        </div>
                        
                        <div id="${SCRIPT_ID_PREFIX_ACU}-import-status" class="notes" style="margin-bottom: 15px; font-weight: bold;">状态：尚未加载文件。</div>

                        <div class="button-group">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-import-txt-button" class="primary">1. 选择并拆分TXT文件</button>
                        </div>
                        <div style="margin: 10px 0 8px 0; font-weight: 700;">注入表选择（自选表格）</div>
                        <div class="notes" style="margin-bottom:6px;">选择需要写入世界书的表（可多选；未曾选择过则默认全选）。</div>
                        <div class="button-group" style="justify-content:flex-start; gap:8px; margin-bottom:6px;">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-import-table-select-all" class="button">全选</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-import-table-select-none" class="button">全不选</button>
                        </div>
                        <div id="${SCRIPT_ID_PREFIX_ACU}-import-table-selector" style="min-height:60px;">加载表格列表中...</div>

                        <div class="button-group" style="margin-top: 10px;">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-inject-imported-txt-button" disabled>2. 注入（自选表格）</button>
                        </div>
                        <div class="button-group">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-delete-imported-entries" class="btn-danger">删除注入条目</button>
                        </div>
                        <div class="button-group">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-clear-imported-cache-button" class="btn-danger" style="font-weight: bold;">清空导入暂存缓存</button>
                        </div>
                        <input type="file" id="${SCRIPT_ID_PREFIX_ACU}-hidden-file-input" style="display: none;" accept=".txt">
                    </div>
                </div>`;
}