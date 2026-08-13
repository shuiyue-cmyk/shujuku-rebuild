// theme/theme-selector.ts
// 主题选择器 UI 组件 — 生成 HTML 并绑定事件

import {
    getAllThemes,
    getActiveThemeId,
    setActiveThemeId,
    applyTheme,
    removeCustomTheme,
    exportThemeToFile,
    importThemeFromFile,
    getThemeById,
    BUILTIN_THEME_IDS,
} from './theme-registry';
import type { ACUTheme } from './theme-types';
import { logDebug_ACU } from '../../shared/utils';
import { topLevelWindow_ACU } from '../../shared/env';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { showToastr_ACU } from './toast';
import { showCustomConfirm_ACU } from './custom-confirm';

/**
 * 生成主题选择器的 HTML 片段
 * 放在弹窗 header 区域
 */
export function generateThemeSelectorHTML(): string {
    const currentId = getActiveThemeId();
    const themes = getAllThemes();

    const options = themes.map(t => {
        const selected = t.id === currentId ? 'selected' : '';
        const builtin = BUILTIN_THEME_IDS.has(t.id) ? '' : ' *';
        const preview = t.previewColors
            ? `style="background-image: linear-gradient(135deg, ${t.previewColors.bg} 50%, ${t.previewColors.accent} 50%);"`
            : '';
        return `<option value="${t.id}" ${selected}>${t.name}${builtin}</option>`;
    }).join('');

    return `
        <div class="acu-theme-selector" style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
            <select id="${SCRIPT_ID_PREFIX_ACU}-theme-select"
                    style="padding: 4px 8px !important; border-radius: 6px !important; border: 1px solid var(--acu-border-2, #c8cdd5) !important; background: var(--acu-control-bg, #ffffff) !important; color: var(--acu-text-1, #1a2332) !important; font-size: 12px !important; cursor: pointer !important; max-width: 140px !important; font-family: inherit !important;"
                    title="切换界面主题">
                ${options}
            </select>
            <div class="acu-theme-actions" style="display: flex; gap: 4px;">
                <button id="${SCRIPT_ID_PREFIX_ACU}-theme-import"
                        style="padding: 4px 6px !important; border-radius: 6px !important; border: 1px solid var(--acu-border-2, #c8cdd5) !important; background: var(--acu-bg-1, #ffffff) !important; color: var(--acu-text-3, #8896a8) !important; font-size: 11px !important; cursor: pointer !important; font-family: inherit !important;"
                        title="导入自定义主题">
                    <i class="fa-solid fa-upload" style="font-size: 11px;"></i>
                </button>
                <button id="${SCRIPT_ID_PREFIX_ACU}-theme-export"
                        style="padding: 4px 6px !important; border-radius: 6px !important; border: 1px solid var(--acu-border-2, #c8cdd5) !important; background: var(--acu-bg-1, #ffffff) !important; color: var(--acu-text-3, #8896a8) !important; font-size: 11px !important; cursor: pointer !important; font-family: inherit !important;"
                        title="导出当前主题模板（完整可编辑版）">
                    <i class="fa-solid fa-download" style="font-size: 11px;"></i>
                </button>
            </div>
        </div>`;
}

/**
 * 绑定主题选择器事件
 */
export function bindThemeSelectorEvents(): void {
    const prefix = SCRIPT_ID_PREFIX_ACU;

    // 主题切换
    const $select = document.getElementById(`${prefix}-theme-select`);
    if ($select) {
        $select.addEventListener('change', () => {
            const id = ($select as HTMLSelectElement).value;
            setActiveThemeId(id);
            applyTheme(id);
            refreshThemeSelector();
            logDebug_ACU(`[ThemeSelector] Switched to theme: ${id}`);
        });
    }

    // 导入
    const $import = document.getElementById(`${prefix}-theme-import`);
    if ($import) {
        $import.addEventListener('click', () => {
            importThemeFromFile();
            // 导入后刷新选择器
            setTimeout(() => refreshThemeSelector(), 500);
        });
    }

    // 导出当前主题
    const $export = document.getElementById(`${prefix}-theme-export`);
    if ($export) {
        $export.addEventListener('click', () => {
            exportThemeToFile(getActiveThemeId());
        });
    }

    // 监听主题变更事件（导入后刷新）
    document.addEventListener('acu-theme-changed', () => {
        refreshThemeSelector();
        refreshChromeThemeSelector();
    });

    // ═══ 窗口 chrome 头部的主题选择器（在 topLevelWindow 中查找） ═══
    const targetDoc = (topLevelWindow_ACU || window).document;

    const $chromeSelect = targetDoc.getElementById(`${prefix}-chrome-theme-select`);
    if ($chromeSelect) {
        $chromeSelect.addEventListener('change', () => {
            const id = ($chromeSelect as HTMLSelectElement).value;
            setActiveThemeId(id);
            applyTheme(id);
            refreshChromeThemeSelector();
            refreshThemeSelector();
            updateChromeDeleteButtonState(targetDoc);
            logDebug_ACU(`[ThemeSelector] Chrome: Switched to theme: ${id}`);
        });
    }

    const $chromeImport = targetDoc.getElementById(`${prefix}-chrome-theme-import`);
    if ($chromeImport) {
        $chromeImport.addEventListener('click', () => {
            importThemeFromFile();
            setTimeout(() => { refreshChromeThemeSelector(); refreshThemeSelector(); }, 500);
        });
    }

    const $chromeExport = targetDoc.getElementById(`${prefix}-chrome-theme-export`);
    if ($chromeExport) {
        $chromeExport.addEventListener('click', () => {
            exportThemeToFile(getActiveThemeId());
        });
    }

    // 删除自定义主题
    const $chromeDelete = targetDoc.getElementById(`${prefix}-chrome-theme-delete`);
    if ($chromeDelete) {
        $chromeDelete.addEventListener('click', async () => {
            const currentId = getActiveThemeId();
            if (BUILTIN_THEME_IDS.has(currentId)) {
                showToastr_ACU('warning', '内置主题不可删除');
                return;
            }
            const theme = getThemeById(currentId);
            const confirmed = await showCustomConfirm_ACU(
                '删除主题',
                `确定要删除主题「${theme?.name || currentId}」吗？\n删除后将恢复为默认浅色主题。`,
                { confirmLabel: '删除', cancelLabel: '取消' },
            );
            if (confirmed) {
                removeCustomTheme(currentId);
                refreshChromeThemeSelector();
                refreshThemeSelector();
                document.dispatchEvent(new CustomEvent('acu-theme-changed'));
            }
        });
    }
}

/**
 * 刷新选择器选项（导入/删除主题后调用）
 */
function refreshThemeSelector(): void {
    const $select = document.getElementById(`${SCRIPT_ID_PREFIX_ACU}-theme-select`) as HTMLSelectElement;
    if (!$select) return;

    const currentId = getActiveThemeId();
    const themes = getAllThemes();

    $select.innerHTML = themes.map(t => {
        const selected = t.id === currentId ? 'selected' : '';
        const builtin = BUILTIN_THEME_IDS.has(t.id) ? '' : ' *';
        return `<option value="${t.id}" ${selected}>${t.name}${builtin}</option>`;
    }).join('');
}

/**
 * 刷新窗口 chrome 头部的主题选择器选项
 */
function refreshChromeThemeSelector(): void {
    const targetDoc = (topLevelWindow_ACU || window).document;
    const $select = targetDoc.getElementById(`${SCRIPT_ID_PREFIX_ACU}-chrome-theme-select`) as HTMLSelectElement;
    if (!$select) return;

    const currentId = getActiveThemeId();
    const themes = getAllThemes();

    $select.innerHTML = themes.map(t => {
        const selected = t.id === currentId ? 'selected' : '';
        const builtin = BUILTIN_THEME_IDS.has(t.id) ? '' : ' *';
        return `<option value="${t.id}" ${selected}>${t.name}${builtin}</option>`;
    }).join('');

    updateChromeDeleteButtonState(targetDoc);
}

/**
 * 更新 chrome 头部删除按钮的可用状态
 */
function updateChromeDeleteButtonState(targetDoc: Document): void {
    const btn = targetDoc.getElementById(`${SCRIPT_ID_PREFIX_ACU}-chrome-theme-delete`);
    if (!btn) return;
    const currentId = getActiveThemeId();
    const isBuiltin = BUILTIN_THEME_IDS.has(currentId);
    btn.style.opacity = isBuiltin ? '0.3' : '1';
    btn.style.pointerEvents = isBuiltin ? 'none' : 'auto';
    btn.setAttribute('title', isBuiltin ? '内置主题不可删除' : '删除当前自定义主题');
}
