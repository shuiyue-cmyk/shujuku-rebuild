// main-popup-optimization.ts
// Optimization标签页（正文替换）HTML生成

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成 Optimization 标签页的 HTML 片段
 */
export function generateOptimizationTabHTML(): string {
    return `
                <!-- 正文替换Tab -->
                <div id="acu-tab-optimization">
                    <div class="acu-card">
                        <div class="acu-card-header">
                            <div>
                                <h3>正文替换设置</h3>
                                <p class="notes">AI生成正文后，自动替换内容（在填表之前执行）</p>
                            </div>
                            <div class="acu-row" style="gap: 8px;">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-optimization-enabled" style="font-weight: 500; cursor: pointer;">启用功能</label>
                                <label class="toggle-switch">
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-optimization-enabled" type="checkbox" />
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>

                        <!-- 基础设置 -->
                        <div class="acu-section">
                            <h4 class="acu-section-title"><i class="fa-solid fa-cog"></i> 基础设置</h4>
                            <div class="acu-grid-auto">
                                <div>
                                    <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-api-preset">API预设</label>
                                    <select id="${SCRIPT_ID_PREFIX_ACU}-optimization-api-preset" class="text_pole">
                                        <option value="">使用当前API配置</option>
                                    </select>
                                    <small class="notes">选择正文替换使用的API配置，留空则使用酒馆当前API</small>
                                </div>
                                <div>
                                    <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-min-length">最小优化长度</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-optimization-min-length" type="number" class="text_pole" min="0" step="10" value="100">
                                    <small class="notes">正文长度小于此值时跳过优化</small>
                                </div>
                                <div>
                                    <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-max-items">最大优化项数</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-optimization-max-items" type="number" class="text_pole" min="1" max="100" step="1" value="10">
                                    <small class="notes">单次优化的最大修改项数（1-100）</small>
                                </div>
                                <div>
                                    <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-loop-count">循环优化次数</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-optimization-loop-count" type="number" class="text_pole" min="1" max="10" step="1" value="1">
                                    <small class="notes">优化完成后再次优化，达到完整优化效果（1-10次）</small>
                                </div>
                                <div>
                                    <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-retry-count">自动重试次数</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-optimization-retry-count" type="number" class="text_pole" min="1" max="10" step="1" value="3">
                                    <small class="notes">API调用失败时自动重试（1-10次，默认3次）</small>
                                </div>
                            </div>
                        </div>

                        <!-- 优化模式 -->
                        <div class="acu-section">
                            <h4 class="acu-section-title"><i class="fa-solid fa-magic"></i> 优化模式</h4>
                            <div class="acu-col">
                                <div class="checkbox-group">
                                    <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-optimization-seamless-mode" checked>
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-optimization-seamless-mode">无感替换模式</label>
                                </div>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-optimization-auto-apply" checked>
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-optimization-auto-apply">自动应用优化结果</label>
                                </div>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-optimization-show-diff" checked>
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-optimization-show-diff">显示优化对比</label>
                                </div>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-optimization-parallel-mode">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-optimization-parallel-mode">填表与正文替换并行执行</label>
                                </div>
                                <div class="acu-divider-dashed" style="margin: 8px 0;"></div>
                                <label class="acu-label">快捷操作</label>
                                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-reoptimize-latest" title="对最近一次已执行正文替换的 AI 回复，基于替换前原文重新优化并再次替换" style="white-space: nowrap;">
                                        <i class="fa-solid fa-rotate-right"></i> 重新优化
                                    </button>
                                </div>
                                <small class="notes">定位"最近一次已经被正文替换过的 AI 回复"，使用替换前保留的原文重新优化后再次替换。取消正文优化请使用进行中提示框里的"取消优化"按钮。</small>
                            </div>
                        </div>

                        <!-- 标签筛选 -->
                        <div class="acu-section">
                            <h4 class="acu-section-title"><i class="fa-solid fa-filter"></i> 标签筛选</h4>
                            <div class="acu-grid-auto" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));">
                                <div>
                                    <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-extract-tags">标签提取</label>
                                    <input id="${SCRIPT_ID_PREFIX_ACU}-optimization-extract-tags" type="text" class="text_pole" placeholder="例如: think,plot">
                                    <small class="notes">仅提取指定标签内的内容进行优化</small>
                                </div>
                                <div>
                                    <label class="acu-label">正文标签提取规则</label>
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-optimization-extract-rules"></div>
                                    <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-optimization-extract-add-rule" class="button">添加规则</button>
                                    <small class="notes">每条规则填写开始词和结束词，仅提取最后一组匹配内容</small>
                                </div>
                                <div>
                                    <label class="acu-label">标签排除规则</label>
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-rules"></div>
                                    <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-optimization-exclude-add-rule" class="button">添加规则</button>
                                    <small class="notes">每条规则填写开始词和结束词，仅移除最后一组匹配内容</small>
                                </div>
                            </div>
                        </div>

                        <!-- 预设管理 -->
                        <div class="acu-section">
                            <h4 class="acu-section-title"><i class="fa-solid fa-bookmark"></i> 预设管理</h4>
                            <div>
                                <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-preset-select">选择预设</label>
                                <div class="acu-row-wrap" style="margin-top: 4px;">
                                    <select id="${SCRIPT_ID_PREFIX_ACU}-optimization-preset-select" class="text_pole" style="flex: 1; min-width: 160px;">
                                        <option value="">-- 选择一个预设 --</option>
                                    </select>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-save-preset" class="acu-btn-icon" title="覆盖保存当前预设"><i class="fa-solid fa-save"></i></button>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-save-as-new-preset" class="acu-btn-icon" title="另存为新预设"><i class="fa-solid fa-file-export"></i></button>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-import-presets" class="acu-btn-icon" title="导入预设"><i class="fa-solid fa-upload"></i></button>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-export-presets" class="acu-btn-icon" title="导出当前预设"><i class="fa-solid fa-download"></i></button>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-reset-defaults" class="acu-btn-icon" title="恢复默认提示词" style="color: var(--acu-warning);"><i class="fa-solid fa-undo"></i></button>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-delete-preset" class="acu-btn-icon" title="删除当前选中的预设" style="display: none; color: var(--acu-danger);"><i class="fa-solid fa-trash-alt"></i></button>
                                    <input type="file" id="${SCRIPT_ID_PREFIX_ACU}-optimization-preset-file-input" style="display: none;" accept=".json">
                                </div>
                                <small class="notes">选择预设应用提示词组设置，或保存当前配置为新预设</small>
                            </div>
                        </div>

                        <!-- 优化提示词 -->
                        <div class="acu-section">
                            <h4 class="acu-section-title"><i class="fa-solid fa-edit"></i> 优化提示词</h4>
                            <div class="acu-info-panel">
                                <small class="notes">
                                    <strong>占位符说明：</strong><br>
                                    <code>$CONTENT</code> - 需要优化的正文内容<br>
                                    <code>$1</code> - 世界书内容 &nbsp; <code>$5</code> - 纪要表/大纲 &nbsp; <code>$6</code> - 上一轮规划<br>
                                    <code>$7</code> - 前文上下文 &nbsp; <code>$8</code> - 本轮用户输入<br>
                                    <code>$U</code> - 用户设定 &nbsp; <code>$C</code> - 角色描述<br>
                                    <strong>输出格式：</strong>AI 需返回 JSON 格式的优化指令，包含 optimizations 数组
                                </small>
                            </div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-optimization-prompt-constructor-area">
                                <div class="button-group" style="margin-bottom: 10px; justify-content: center;"><button class="${SCRIPT_ID_PREFIX_ACU}-optimization-add-prompt-segment-btn" data-position="top" title="在上方添加对话轮次">+</button></div>
                                <div id="${SCRIPT_ID_PREFIX_ACU}-optimization-prompt-segments-container"></div>
                                <div class="button-group" style="margin-top: 10px; justify-content: center;"><button class="${SCRIPT_ID_PREFIX_ACU}-optimization-add-prompt-segment-btn" data-position="bottom" title="在下方添加对话轮次">+</button></div>
                            </div>
                            <div class="button-group">
                                <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-save-prompt-group" class="primary">保存提示词组</button>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-reset-prompt-group">恢复默认提示词组</button>
                            </div>
                        </div>

                        <!-- 手动测试 -->
                        <div class="acu-section">
                            <h4 class="acu-section-title"><i class="fa-solid fa-flask"></i> 手动测试</h4>
                            <div>
                                <label class="acu-label" for="${SCRIPT_ID_PREFIX_ACU}-optimization-test-input">测试文本</label>
                                <textarea id="${SCRIPT_ID_PREFIX_ACU}-optimization-test-input" class="text_pole" rows="5" placeholder="输入需要优化的文本进行测试..."></textarea>
                            </div>
                            <div class="button-group">
                                <button id="${SCRIPT_ID_PREFIX_ACU}-optimization-test-btn" class="primary">执行优化测试</button>
                            </div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-optimization-test-result" style="display: none; margin-top: 12px;">
                                <label class="acu-label">优化结果</label>
                                <div id="${SCRIPT_ID_PREFIX_ACU}-optimization-test-output" class="acu-result-panel"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
}
