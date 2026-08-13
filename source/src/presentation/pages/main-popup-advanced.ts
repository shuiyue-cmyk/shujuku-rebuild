// main-popup-advanced.ts
// 高级工具标签页 HTML生成
// 聚合：正文替换(optimization) + SQL控制台 + 运行日志
// 使用内部子tab切换三个子页面

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { isSqliteMode } from '../../service/table/storage-mode';

// 子页面 HTML 生成
import { generateOptimizationTabHTML } from './main-popup-optimization';
import { generateSqlConsoleTabHTML } from './sql-console';
import { generateLogViewerTabHTML, cleanupLogViewer_ACU } from './log-viewer';

// 重导出 cleanupLogViewer_ACU 供 main-popup.ts 的 onClose 使用
export { cleanupLogViewer_ACU };

/**
 * 生成高级工具标签页的 HTML 片段
 * 包含：正文替换、SQL控制台（仅SQLite模式）、运行日志
 * 使用内部子导航切换
 * 
 * 重要：子模块（optimization/sql-console/log-viewer）内部使用固定 id
 * （acu-tab-optimization, acu-tab-sql-console, acu-tab-log-viewer），
 * 绑定代码通过这些 id 查找元素，不能修改。
 * 子tab切换通过 acu-subtab-* 容器控制显示/隐藏。
 */
export function generateAdvancedTabHTML(): string {
    const sqlSection = isSqliteMode() ? `
                    <button class="acu-subtab-button" data-subtab="advanced-sql">SQL 控制台</button>` : '';

    const sqlContent = isSqliteMode() ? `
                <div id="acu-subtab-advanced-sql" class="acu-subtab-content">
                    ${generateSqlConsoleTabHTML()}
                </div>` : '';

    return `
                <div id="acu-tab-advanced" class="acu-tab-content">
                    <!-- 内部子导航 -->
                    <div class="acu-subtabs-nav">
                    <button class="acu-subtab-button active" data-subtab="advanced-optimization">正文替换</button>
                    ${sqlSection}
                    <button class="acu-subtab-button" data-subtab="advanced-log">运行日志</button>
                    </div>

                    <!-- 子页面内容 — 保持子模块原始 id 不变 -->
                    <div class="acu-subtabs-container">
                <div id="acu-subtab-advanced-optimization" class="acu-subtab-content active">
                    ${generateOptimizationTabHTML()}
                </div>
                    ${sqlContent}
                <div id="acu-subtab-advanced-log" class="acu-subtab-content">
                    ${generateLogViewerTabHTML()}
                </div>
                    </div>
                </div>`;
}
