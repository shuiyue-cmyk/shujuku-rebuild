// main-popup-plot.ts
// 核心功能标签页 HTML生成
// 包含：剧情推进、外部导入

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { DEFAULT_PRESET_OPTION_VALUE_ACU } from '../components/optimization-ui';
import { generateImportTabHTML } from './main-popup-import';

/**
 * 生成核心功能标签页的 HTML 片段
 * 包含：剧情推进设置、预设管理、提示词设置、匹配替换、世界书选择、外部导入
 */
export function generateCoreFuncTabHTML(): string {
    return `
                <div id="acu-tab-corefunc" class="acu-tab-content">
                    <div class="acu-card">
                        <!-- 顶部标题和开关区域 -->
                        <div class="acu-plot-header-row" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--acu-border);">
                            <div>
                                <h3 style="margin: 0; color: var(--acu-text-1);">剧情推进设置</h3>
                                <p class="notes" style="margin: 5px 0 0 0;">通过AI预处理用户输入，增强故事叙述质量和剧情连贯性</p>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-plot-enabled" style="font-weight: 500; cursor: pointer;">启用功能</label>
                                <label class="toggle-switch">
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-plot-enabled" type="checkbox" />
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>

                        <!-- 预设管理区域 -->
                        <div class="settings-section" style="margin-bottom: 25px; padding: 20px; background: var(--acu-bg-2); border-radius: 8px; border: 1px solid var(--acu-border);">
                            <h4 style="margin: 0 0 15px 0; color: var(--acu-text-1); display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-bookmark"></i> 预设管理
                            </h4>
                            <div class="acu-plot-scope-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; align-items: start;">
                                <div style="padding: 16px; background: var(--acu-bg-1); border-radius: 8px; border: 1px solid var(--acu-border); display: flex; flex-direction: column; gap: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                                        <div>
                                            <div style="font-weight: 600; color: var(--acu-text-1);">全局正在使用</div>
                                            <small id="${SCRIPT_ID_PREFIX_ACU}-plot-global-scope-status" class="notes">新聊天会默认继承这里的剧情推进配置</small>
                                        </div>
                                        <span style="padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent-primary) 12%, transparent); color: var(--accent-primary); font-size: 12px; font-weight: 600;">全局</span>
                                    </div>
                                    <div class="qrf_settings_block" style="margin-bottom: 0;">
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-plot-global-preset-select" style="font-weight: 500;">全局预设</label>
                                        <select id="${SCRIPT_ID_PREFIX_ACU}-plot-global-preset-select" class="text_pole" style="width: 100%; margin-top: 5px;">
                                            <option value="${DEFAULT_PRESET_OPTION_VALUE_ACU}">默认预设</option>
                                        </select>
                                    </div>
                                    <div class="qrf_preset_selector_wrapper acu-plot-preset-wrapper" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-plot-global-save-preset" class="menu_button" title="覆盖保存到全局预设" style="padding: 8px 12px;"><i class="fa-solid fa-save"></i></button>
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-plot-global-save-as-new-preset" class="menu_button" title="另存为新的全局预设" style="padding: 8px 12px;"><i class="fa-solid fa-file-export"></i></button>
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-plot-global-import-presets" class="menu_button" title="导入到全局预设库" style="padding: 8px 12px;"><i class="fa-solid fa-upload"></i></button>
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-plot-global-export-presets" class="menu_button" title="导出当前全局预设" style="padding: 8px 12px;"><i class="fa-solid fa-download"></i></button>
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-plot-global-reset-defaults" class="menu_button" title="恢复全局默认提示词" style="padding: 8px 12px; background-color: var(--acu-warning); color: white;"><i class="fa-solid fa-undo"></i></button>
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-plot-global-delete-preset" class="menu_button" title="删除当前全局选中的预设" style="display: none; padding: 8px 12px; background-color: var(--acu-danger);"><i class="fa-solid fa-trash-alt"></i></button>
                                        <input type="file" id="${SCRIPT_ID_PREFIX_ACU}-plot-global-preset-file-input" style="display: none;" accept=".json">
                                    </div>
                                    <small class="notes">全局预设区负责导入、导出、修改与保存；切换这里只会切换全局默认使用的剧情推进预设，不会直接改动当前聊天预设。</small>
                                </div>
                                <div style="padding: 16px; background: var(--acu-bg-1); border-radius: 8px; border: 1px solid var(--acu-border); display: flex; flex-direction: column; gap: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                                        <div>
                                            <div style="font-weight: 600; color: var(--acu-text-1);">当前聊天正在使用</div>
                                            <small id="${SCRIPT_ID_PREFIX_ACU}-plot-chat-scope-status" class="notes">未单独指定时，这里会直接跟随全局剧情推进预设</small>
                                        </div>
                                        <span style="padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--acu-success) 14%, transparent); color: var(--acu-success); font-size: 12px; font-weight: 600;">聊天</span>
                                    </div>
                                    <div class="qrf_settings_block" style="margin-bottom: 0;">
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-plot-chat-preset-select" style="font-weight: 500;">当前聊天预设</label>
                                        <select id="${SCRIPT_ID_PREFIX_ACU}-plot-chat-preset-select" class="text_pole" style="width: 100%; margin-top: 5px;">
                                            <option value="${DEFAULT_PRESET_OPTION_VALUE_ACU}">跟随全局</option>
                                        </select>
                                    </div>
                                    <small id="${SCRIPT_ID_PREFIX_ACU}-plot-chat-origin-status" class="notes">当前聊天预设这里只负责切换当前聊天使用的剧情推进预设；导入、导出、保存与修改统一在全局预设侧处理。</small>
                                </div>
                            </div>
                            <div class="qrf_settings_block" style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed var(--acu-border);">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-plot-api-preset-select" style="font-weight: 500;">剧情推进API预设</label>
                                <select id="${SCRIPT_ID_PREFIX_ACU}-plot-api-preset-select" class="text_pole" style="width: 100%; margin-top: 5px;">
                                    <option value="">使用当前API配置</option>
                                </select>
                                <small class="notes">这里控制剧情推进调用时使用的API配置；剧情推进预设本身则分为全局与当前聊天两条作用域链路。</small>
                            </div>
                        </div>

                        <!-- 提示词设置区域（独立提示词组） -->
                        <div class="settings-section" style="margin-bottom: 25px; padding: 20px; background: var(--acu-bg-2); border-radius: 8px; border: 1px solid var(--acu-border);">
                            <h4 style="margin: 0 0 15px 0; color: var(--acu-text-1); display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-edit"></i> 提示词设置
                            </h4>
                            <div style="margin-bottom: 15px; padding: 12px; background: var(--acu-bg-1); border-radius: 6px; border-left: 3px solid var(--acu-text-2);">
                                <small class="notes" style="color: var(--acu-text-2);">
                                    <strong>占位符说明：</strong><br>
                                    <code>$1</code> - 自动替换为世界书内容（默认开启）<br>
                                    <code>$6</code> - 自动替换为上一轮保存的剧情规划数据<br>
                                    <code>$5</code> - 自动替换为"总体大纲"表内容（含表头）<br>
                                    <code>$7</code> - 自动替换为本次实际读取的前文上下文（仅包含历史AI输出，不含任何用户输入）<br>
                                    <code>$8</code> - 自动替换为本轮用户输入（可自由放置）<br>
                                    <code>{{标签名}}</code> - 在剧情任务提示词与最终注入指令中插入标签块内容<br>
                                    <code>sulv1-4</code> - 剧情推进速率设置<br>
                                    <code>zhaohui</code> - 记忆召回数量
                                </small>
                            </div>
                            <div class="acu-plot-task-layout" style="display:grid; grid-template-columns: minmax(240px, 280px) minmax(0, 1fr); gap:16px; align-items:start; margin-bottom:15px;">
                                <div style="padding:12px; background:var(--acu-bg-1); border-radius:8px; border:1px solid var(--acu-border);">
                                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
                                        <label style="font-weight:600; margin:0;">剧情任务列表</label>
                                        <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-plot-task-add" class="button" style="padding:4px 10px;">新增</button>
                                    </div>
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-plot-task-list"></div>
                                    <div class="button-group" style="justify-content:flex-start; gap:8px; margin-top:10px;">
                                        <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-plot-task-move-up" class="button">上移</button>
                                        <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-plot-task-move-down" class="button">下移</button>
                                        <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-plot-task-delete" class="button" style="background:var(--acu-danger); color:#fff;">删除</button>
                                    </div>
                                    <small class="notes" style="display:block; margin-top:10px;">每个任务都有独立提示词、独立标签摘取与独立重试次数；任务按阶段号执行：同阶段并发，不同阶段按编号顺序串行。</small>
                                </div>
                                <div style="padding:12px; background:var(--acu-bg-1); border-radius:8px; border:1px solid var(--acu-border);">
                                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:15px;">
                                        <div class="qrf_settings_block" style="margin-bottom:0;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-task-name" style="font-weight:500;">当前任务名称</label>
                                            <input id="${SCRIPT_ID_PREFIX_ACU}-plot-task-name" type="text" class="text_pole" placeholder="例如：记忆召回任务" style="width:100%;">
                                        </div>
                                        <div class="qrf_settings_block" style="margin-bottom:0; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-task-enabled" style="font-weight:500; margin:0;">启用当前任务</label>
                                            <label class="toggle-switch" style="margin:0;">
                                                <input id="${SCRIPT_ID_PREFIX_ACU}-plot-task-enabled" type="checkbox" />
                                                <span class="slider"></span>
                                            </label>
                                        </div>
                                        <div class="qrf_settings_block" style="margin-bottom:0;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-task-stage" style="font-weight:500;">当前任务阶段号</label>
                                            <input id="${SCRIPT_ID_PREFIX_ACU}-plot-task-stage" type="number" class="text_pole" min="1" step="1" value="1" style="width:100%;">
                                            <small class="notes">相同阶段并发，不同阶段按编号顺序串行</small>
                                        </div>
                                        <div class="qrf_settings_block" style="margin-bottom:0;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-task-max-retries" style="font-weight:500;">当前任务最大重试</label>
                                            <input id="${SCRIPT_ID_PREFIX_ACU}-plot-task-max-retries" type="number" class="text_pole" min="1" step="1" value="3" style="width:100%;">
                                        </div>
                                    </div>
                                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:15px;">
                                        <div class="qrf_settings_block" style="margin-bottom:0;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-extract-tags" style="font-weight:500;">当前任务标签摘取</label>
                                            <input id="${SCRIPT_ID_PREFIX_ACU}-plot-extract-tags" type="text" class="text_pole" placeholder="例如: recall,supplement" style="width:100%;">
                                            <small class="notes">仅作用于当前选中的剧情任务</small>
                                        </div>
                                        <div class="qrf_settings_block" style="margin-bottom:0;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-extract-inject-tags" style="font-weight:500;">提取注入标签</label>
                                            <input id="${SCRIPT_ID_PREFIX_ACU}-plot-extract-inject-tags" type="text" class="text_pole" placeholder="例如: recall,supplement" style="width:100%;">
                                            <small class="notes">优先级高于标签摘取；未使用时不自动注入末尾</small>
                                        </div>
                                        <div class="qrf_settings_block" style="margin-bottom:0;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-min-length" style="font-weight:500;">当前任务最小回复长度</label>
                                            <input id="${SCRIPT_ID_PREFIX_ACU}-plot-min-length" type="number" class="text_pole" min="0" max="2000" step="10" value="0" style="width:100%;">
                                            <small class="notes">当前任务回复少于此长度时自动重试</small>
                                        </div>
                                    </div>
                                    <div style="margin-bottom:15px;">
                                        <div class="qrf_settings_block" style="margin-bottom:0;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset" style="font-weight:500;">当前任务API预设</label>
                                            <select id="${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset" class="text_pole" style="width:100%;">
                                                <option value="">继承全局剧情推进API预设</option>
                                            </select>
                                            <small class="notes">按任务ID保存到插件全局设置；不写入聊天记录或剧情推进预设，未选择时继承全局剧情推进 API 预设。</small>
                                        </div>
                                    </div>
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-plot-prompt-constructor-area">
                                        <div class="button-group" style="margin-bottom: 10px; justify-content: center;">
                                            <button class="${SCRIPT_ID_PREFIX_ACU}-plot-add-prompt-segment-btn" data-position="top" title="在上方添加对话轮次">+</button>
                                        </div>
                                        <div id="${SCRIPT_ID_PREFIX_ACU}-plot-prompt-segments-container">
                                            <!-- Plot segments will be dynamically inserted here -->
                                        </div>
                                        <div class="button-group" style="margin-top: 10px; justify-content: center;">
                                            <button class="${SCRIPT_ID_PREFIX_ACU}-plot-add-prompt-segment-btn" data-position="bottom" title="在下方添加对话轮次">+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="qrf_settings_block" style="margin-top: 15px; margin-bottom: 0;">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-plot-final-directive" style="font-weight: 500;">最终注入指令</label>
                                <textarea id="${SCRIPT_ID_PREFIX_ACU}-plot-final-directive" class="text_pole" rows="3" placeholder="输入最终注入指令" style="resize: vertical;"></textarea>
                                <small class="notes">这段内容不会发给"剧情规划API"，只会注入给主AI。你可以用 <code>$8</code> 自行决定是否/放置位置。</small>
                            </div>
                        </div>


                        <!-- 匹配替换设置区域 -->
                        <div class="settings-section" style="margin-bottom: 25px; padding: 20px; background: var(--acu-bg-2); border-radius: 8px; border: 1px solid var(--acu-border);">
                            <h4 style="margin: 0 0 15px 0; color: var(--acu-text-1); display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-right-left"></i> 匹配替换
                            </h4>
                            <small class="notes" style="display: block; margin-bottom: 15px; color: var(--acu-text-2);">
                                在发送前，将下方设置的数值替换掉提示词中的占位符（sulv1-4、zhaohui）
                            </small>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-plot-rate-main" style="font-weight: 500;">主线剧情推进速率</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-plot-rate-main" type="number" class="text_pole" step="0.05" value="1.0" style="width: 100%;">
                                    <small class="notes" style="color: var(--acu-text-2);">占位符: sulv1</small>
                                </div>
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-plot-rate-personal" style="font-weight: 500;">个人线推进速率</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-plot-rate-personal" type="number" class="text_pole" step="0.05" value="1.0" style="width: 100%;">
                                    <small class="notes" style="color: var(--acu-text-2);">占位符: sulv2</small>
                                </div>
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-plot-rate-erotic" style="font-weight: 500;">色情事件推进速率</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-plot-rate-erotic" type="number" class="text_pole" step="0.05" value="0" style="width: 100%;">
                                    <small class="notes" style="color: var(--acu-text-2);">占位符: sulv3</small>
                                </div>
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-plot-rate-cuckold" style="font-weight: 500;">绿帽线推进速率</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-plot-rate-cuckold" type="number" class="text_pole" step="0.05" value="1.0" style="width: 100%;">
                                    <small class="notes" style="color: var(--acu-text-2);">占位符: sulv4</small>
                                </div>
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-plot-recall-count" style="font-weight: 500;">记忆召回数量</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-plot-recall-count" type="number" class="text_pole" step="1" min="1" value="20" style="width: 100%;">
                                    <small class="notes" style="color: var(--acu-text-2);">占位符: zhaohui</small>
                                </div>
                            </div>
                        </div>

                        <!-- 剧情上下文与标签规则 -->
                        <div class="settings-section" style="padding: 20px; background: var(--acu-bg-2); border-radius: 8px; border: 1px solid var(--acu-border);">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 20px;">
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-plot-context-turn-count" style="font-weight: 500;">AI上下文</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-plot-context-turn-count" type="number" class="text_pole" min="0" max="20" step="1" value="3" style="width: 100%;">
                                    <small class="notes" style="color: var(--acu-text-2);">AI输出楼层数（仅计算AI回复，不含用户输入）</small>
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 15px; margin-bottom: 25px;">
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label style="font-weight: 500;">正文标签提取规则</label>
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-rules"></div>
                                    <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-plot-context-extract-add-rule" class="button" style="margin-top: 6px;">添加规则</button>
                                    <small class="notes">作用于剧情上下文过滤，不区分任务；每条规则填写开始词和结束词，仅提取最后一组匹配内容</small>
                                </div>
                                <div class="qrf_settings_block" style="margin-bottom: 0;">
                                    <label style="font-weight: 500;">标签排除规则</label>
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-rules"></div>
                                    <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-plot-context-exclude-add-rule" class="button" style="margin-top: 6px;">添加规则</button>
                                    <small class="notes">作用于剧情上下文过滤，不区分任务；仅移除最后一组匹配内容（可与"正文标签提取"叠加）</small>
                                </div>
                            </div>

                            <!-- [新增] 剧情推进世界书选择（与填表世界书选择互不干扰；UI风格与"世界书设置"页一致） -->
                            <div class="qrf_settings_block" style="margin: 10px 0 18px 0; padding-top: 15px; border-top: 1px dashed var(--acu-border);">
                                <label style="font-weight: 600; display:flex; align-items:center; gap:8px;">
                                    <i class="fa-solid fa-book"></i> 剧情推进世界书选择（独立）
                                </label>
                                <small class="notes">仅影响"剧情推进"，不会影响"填表/读取世界书"的选择。</small>

                                <div class="qrf_settings_block_radio" style="margin-top: 10px;">
                                    <label>世界书来源 (用于剧情推进读取上下文):</label>
                                    <div class="qrf_radio_group">
                                        <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-source-character" name="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-source" value="character" checked>
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-source-character">角色卡绑定</label>
                                        <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-source-manual" name="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-source" value="manual">
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-source-manual">手动选择</label>
                                    </div>
                                </div>

                                <div id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-manual-select-block" style="display: none; margin-top: 10px;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select">选择世界书 (可多选):</label>
                                    <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select-filter" placeholder="筛选世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                                    <div class="input-group">
                                        <div id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select" class="qrf_worldbook_list"></div>
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-plot-refresh-worldbooks" title="刷新世界书列表">刷新</button>
                                    </div>
                                </div>

                                <div style="margin-top: 15px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                        <label style="margin-bottom: 0;">启用的世界书条目:</label>
                                        <div class="button-group" style="margin: 0;">
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select-all" class="button" style="padding: 2px 8px; font-size: 0.8em;">全选</button>
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-deselect-all" class="button" style="padding: 2px 8px; font-size: 0.8em;">全不选</button>
                                        </div>
                                    </div>
                                    <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-entry-filter" placeholder="筛选条目/世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-entry-list" class="qrf_worldbook_entry_list">
                                        <!-- 条目将动态加载于此 -->
                                    </div>
                                </div>
                            </div>

                        </div>

                        <!-- 外部导入区块（原独立tab，现作为核心功能区子模块） -->
                        <div class="settings-section" style="padding: 20px; background: var(--acu-bg-2); border-radius: 8px; border: 1px solid var(--acu-border);">
                            ${generateImportTabHTML().replace(/id="acu-tab-import" class="acu-tab-content"/, 'id="acu-tab-import-embedded" class="acu-import-embedded"').replace(/<div class="acu-card">/, '<div class="acu-card" style="border: none; box-shadow: none; padding: 0; margin: 0;">').replace('<h3>从TXT文件导入</h3>', '<h3 style="margin: 0 0 15px 0; padding: 0 0 10px 0; border-bottom: 1px solid var(--acu-border);">外部导入</h3>').replace('<p class="notes">从外部TXT文件导入内容', '<p class="notes" style="margin-bottom: 12px;">从外部TXT文件导入内容')}
                        </div>
                    </div>
                </div>`;
}