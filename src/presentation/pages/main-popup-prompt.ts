// main-popup-prompt.ts
// Prompt标签页（AI指令预设）HTML生成

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成 Prompt 标签页的 HTML 片段
 * 包含：数据库更新预设（任务指令）
 */
export function generatePromptTabHTML(): string {
    return `
                <div id="acu-tab-prompt" class="acu-tab-content">
                    <div class="acu-card">
                        <h3>数据库更新预设 (任务指令)</h3>
                        <div id="${SCRIPT_ID_PREFIX_ACU}-prompt-constructor-area">
                            <div class="button-group" style="margin-bottom: 10px; justify-content: center;"><button class="${SCRIPT_ID_PREFIX_ACU}-add-prompt-segment-btn" data-position="top" title="在上方添加对话轮次">+</button></div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-prompt-segments-container">
                                <!-- Segments will be dynamically inserted here -->
                            </div>
                            <div class="button-group" style="margin-top: 10px; justify-content: center;"><button class="${SCRIPT_ID_PREFIX_ACU}-add-prompt-segment-btn" data-position="bottom" title="在下方添加对话轮次">+</button></div>
                        </div>
                        <div class="button-group">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-save-char-card-prompt" class="primary">保存</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-load-char-card-prompt-from-json">读取JSON模板</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-export-char-card-prompt-to-json">导出JSON模板</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-reset-char-card-prompt">恢复默认</button>
                        </div>
                    </div>
                </div>`;
}