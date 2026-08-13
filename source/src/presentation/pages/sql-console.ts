/**
 * presentation/pages/sql-console.ts
 * SQL 控制台标签页 — 输入 SQL、执行、结果展示、历史记录
 */

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { jQuery_API_ACU } from '../dom-utils';
import { showToastr_ACU } from '../theme/toast';
import { ensureStorageProviderReady_ACU } from '../../service/table/table-storage-strategy';
import { isSqliteMode } from '../../service/table/storage-mode';
import { $popupInstance_ACU } from '../state/ui-refs';
import { createSqlApi } from '../bootstrap/api-groups/sql-api';
import { isReadOnlySqlStatement_ACU } from '../../service/runtime/template-vars/read-only-sql-validation';
import { resolveCurrentRuntimeReadSql_ACU } from '../../service/runtime/read-query-resolver';

/** SQL 执行历史记录（内存中保留，不持久化） */
export const sqlHistory: { sql: string; timestamp: number; success: boolean }[] = [];
export const MAX_HISTORY = 50;

/**
 * 生成 SQL 控制台标签页的 HTML 片段
 */
export function generateSqlConsoleTabHTML(): string {
    return `
                <div id="acu-tab-sql-console">
                    <div class="acu-card">
                        <h3><i class="fa-solid fa-terminal" style="margin-right: 6px;"></i>SQL 控制台</h3>
                        <p class="notes" style="margin-bottom: 12px;">在 SQLite 内存数据库上直接执行 SQL 语句。支持 SELECT 查询和 INSERT/UPDATE/DELETE 变更。</p>

                        <!-- 快捷操作 -->
                        <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-sql-show-tables" class="button" style="font-size: 0.85em; padding: 4px 10px;">
                                <i class="fa-solid fa-list"></i> 查看所有表
                            </button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-sql-show-schema" class="button" style="font-size: 0.85em; padding: 4px 10px;">
                                <i class="fa-solid fa-sitemap"></i> 查看表结构
                            </button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-sql-show-history" class="button" style="font-size: 0.85em; padding: 4px 10px;">
                                <i class="fa-solid fa-clock-rotate-left"></i> 历史记录
                            </button>
                        </div>

                        <!-- SQL 输入区 -->
                        <div style="position: relative;">
                            <textarea id="${SCRIPT_ID_PREFIX_ACU}-sql-input"
                                style="width: 100%; min-height: 120px; font-family: monospace; font-size: 0.9em; padding: 10px; border: 1px solid var(--border-normal); border-radius: 6px; background: var(--input-background); color: var(--input-text-color); resize: vertical; white-space: pre;"
                                placeholder="输入 SQL 语句...&#10;&#10;示例:&#10;  SELECT * FROM 背包物品表;&#10;  INSERT INTO 背包物品表 (物品名, 数量) VALUES ('药水', 3);"></textarea>
                        </div>

                        <!-- 执行按钮 -->
                        <div style="display: flex; gap: 8px; margin-top: 8px; align-items: center;">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-sql-execute" class="primary" style="padding: 8px 20px;">
                                <i class="fa-solid fa-play" style="margin-right: 4px;"></i> 执行
                            </button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-sql-clear-input" class="button" style="padding: 8px 12px;">
                                <i class="fa-solid fa-eraser"></i> 清空
                            </button>
                            <span id="${SCRIPT_ID_PREFIX_ACU}-sql-exec-status" class="notes" style="flex: 1; text-align: right;"></span>
                        </div>

                        <!-- 结果展示区 -->
                        <div id="${SCRIPT_ID_PREFIX_ACU}-sql-result-area" style="margin-top: 16px; border: 1px solid var(--border-normal); border-radius: 6px; background: var(--background-color-light); min-height: 60px; max-height: 400px; overflow: auto; padding: 10px;">
                            <div class="notes" style="text-align: center; padding: 20px;">执行 SQL 后结果将显示在这里</div>
                        </div>
                    </div>
                </div>`;
}

/**
 * 绑定 SQL 控制台的所有事件
 */
export async function bindSqlConsoleEvents_ACU(): Promise<void> {
    if (!$popupInstance_ACU) return;

    const $sqlInput = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-input`);
    const $executeBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-execute`);
    const $clearBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-clear-input`);
    const $resultArea = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-result-area`);
    const $execStatus = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-exec-status`);
    const $showTablesBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-show-tables`);
    const $showSchemaBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-show-schema`);
    const $showHistoryBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-show-history`);

    // 执行 SQL
    $executeBtn.on('click', function() {
        const sql = String($sqlInput.val() || '').trim();
        if (!sql) {
            showToastr_ACU('warning', 'SQL 语句不能为空');
            return;
        }

        if (!isSqliteMode()) {
            showToastr_ACU('error', 'SQL 控制台仅在 SQLite 模式下可用');
            return;
        }

        void executeSql(sql, $resultArea, $execStatus);
    });

    // Ctrl+Enter 快捷键执行
    $sqlInput.on('keydown', function(e: any) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            $executeBtn.trigger('click');
        }
    });

    // 清空输入
    $clearBtn.on('click', function() {
        $sqlInput.val('');
        $sqlInput.trigger('focus');
    });

    // 查看所有表
    $showTablesBtn.on('click', function() {
        if (!isSqliteMode()) {
            showToastr_ACU('error', '仅在 SQLite 模式下可用');
            return;
        }
        $sqlInput.val("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_acu_%' ORDER BY name;");
        $executeBtn.trigger('click');
    });

    // 查看表结构
    $showSchemaBtn.on('click', function() {
        if (!isSqliteMode()) {
            showToastr_ACU('error', '仅在 SQLite 模式下可用');
            return;
        }
        $sqlInput.val("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_acu_%' ORDER BY name;");
        $executeBtn.trigger('click');
    });

    // 历史记录
    $showHistoryBtn.on('click', function() {
        renderHistory($resultArea);
    });
}

/**
 * 判断 SQL 是否为查询语句（SELECT/PRAGMA/EXPLAIN）
 */
export function isSelectQuery(sql: string): boolean {
    return isReadOnlySqlStatement_ACU(sql);
}

/**
 * 执行 SQL 并渲染结果
 */
export async function executeSql(sql: string, $resultArea: any, $execStatus: any): Promise<void> {
    const startTime = performance.now();

    try {
        const provider = await ensureStorageProviderReady_ACU();
        const isSelect = isSelectQuery(sql);

        if (isSelect) {
            // SELECT 查询
            const result = provider.executeQuery(resolveCurrentRuntimeReadSql_ACU(sql).sql);
            const elapsed = (performance.now() - startTime).toFixed(1);

            // 记录历史
            addHistory(sql, true);

            // 渲染表格结果
            if (result.rowCount === 0) {
                $resultArea.html(`<div class="notes" style="text-align: center; padding: 12px;">查询成功，无结果 (0 行)</div>`);
            } else {
                renderQueryResult(result.columns, result.values, $resultArea);
            }

            $execStatus.html(`<span style="color: #a6e3a1;">✓ ${result.rowCount} 行, ${elapsed}ms</span>`);
            logDebug_ACU(`[SQL Console] SELECT 成功: ${result.rowCount} 行, ${elapsed}ms`);
        } else {
            // INSERT/UPDATE/DELETE 变更：走统一 update+persist 提交模型
            const result = await createSqlApi({} as any).executeSqlMutation({ sql, trackingSheetKeys: [] });
            const elapsed = (performance.now() - startTime).toFixed(1);

            if (result.errors.length > 0) {
                addHistory(sql, false);
                $resultArea.html(`<div style="color: #e95e5e; padding: 12px; font-family: monospace; white-space: pre-wrap;">${escapeHtml_ACU(result.errors.join('\n'))}</div>`);
                $execStatus.html(`<span style="color: #e95e5e;">✗ 执行失败</span>`);
            } else {
                addHistory(sql, true);
                $resultArea.html(`<div style="padding: 12px; color: #a6e3a1;">✓ 执行成功，${result.changes} 行受影响</div>`);
                $execStatus.html(`<span style="color: #a6e3a1;">✓ ${result.changes} 行受影响, ${elapsed}ms</span>`);
                logDebug_ACU(`[SQL Console] 变更成功: ${result.changes} 行, ${elapsed}ms`);
            }
        }
    } catch (e: any) {
        const elapsed = (performance.now() - startTime).toFixed(1);
        addHistory(sql, false);
        const errMsg = e?.message || String(e);
        $resultArea.html(`<div style="color: #e95e5e; padding: 12px; font-family: monospace; white-space: pre-wrap;">错误: ${escapeHtml_ACU(errMsg)}</div>`);
        $execStatus.html(`<span style="color: #e95e5e;">✗ 失败, ${elapsed}ms</span>`);
        logError_ACU(`[SQL Console] 执行失败: ${errMsg}`);
    }
}

/**
 * 渲染 SELECT 查询结果为 HTML 表格
 */
export function renderQueryResult(columns: string[], values: any[][], $container: any): void {
    const headerCells = columns.map(col => `<th style="padding: 6px 10px; text-align: left; border-bottom: 2px solid var(--border-normal); font-weight: 600; white-space: nowrap;">${escapeHtml_ACU(String(col))}</th>`).join('');

    const rows = values.map((row, idx) => {
        const cells = row.map(val => {
            const display = val === null ? '<span style="color: #888; font-style: italic;">NULL</span>' : escapeHtml_ACU(String(val));
            return `<td style="padding: 4px 10px; border-bottom: 1px solid var(--border-normal); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${display}</td>`;
        }).join('');
        const bgColor = idx % 2 === 0 ? 'transparent' : 'rgba(128, 128, 128, 0.05)';
        return `<tr style="background: ${bgColor};">${cells}</tr>`;
    }).join('');

    $container.html(`
        <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 0.85em;">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="notes" style="text-align: right; margin-top: 6px; font-size: 0.8em;">${values.length} 行</div>
    `);
}

/**
 * 添加到历史记录
 */
export function addHistory(sql: string, success: boolean): void {
    sqlHistory.unshift({ sql, timestamp: Date.now(), success });
    if (sqlHistory.length > MAX_HISTORY) {
        sqlHistory.length = MAX_HISTORY;
    }
}

/**
 * 渲染历史记录
 */
function renderHistory($container: any): void {
    if (sqlHistory.length === 0) {
        $container.html('<div class="notes" style="text-align: center; padding: 12px;">暂无执行历史</div>');
        return;
    }

    const items = sqlHistory.map((item, idx) => {
        const time = new Date(item.timestamp).toLocaleTimeString();
        const statusIcon = item.success ? '<span style="color: #a6e3a1;">✓</span>' : '<span style="color: #e95e5e;">✗</span>';
        const sqlPreview = item.sql.length > 80 ? item.sql.substring(0, 80) + '...' : item.sql;
        return `
            <div class="acu-sql-history-item" data-idx="${idx}" style="padding: 6px 10px; border-bottom: 1px solid var(--border-normal); cursor: pointer; display: flex; gap: 8px; align-items: flex-start;" title="点击填入输入框">
                ${statusIcon}
                <span style="color: #888; font-size: 0.8em; white-space: nowrap;">${time}</span>
                <code style="font-size: 0.85em; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml_ACU(sqlPreview)}</code>
            </div>
        `;
    }).join('');

    $container.html(`
        <div style="font-weight: 600; padding: 6px 10px; border-bottom: 2px solid var(--border-normal);">执行历史 (最近 ${sqlHistory.length} 条)</div>
        ${items}
    `);

    // 点击历史项填入输入框
    $container.find('.acu-sql-history-item').on('click', function(this: HTMLElement) {
        const idx = parseInt(jQuery_API_ACU(this).data('idx'), 10);
        if (idx >= 0 && idx < sqlHistory.length) {
            const $input = $popupInstance_ACU?.find(`#${SCRIPT_ID_PREFIX_ACU}-sql-input`);
            if ($input && $input.length) {
                $input.val(sqlHistory[idx].sql);
                $input.trigger('focus');
            }
        }
    });
}
