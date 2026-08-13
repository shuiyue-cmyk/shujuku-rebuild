/**
 * presentation/components/table-selector.ts — 表格选择器组件
 *
 * 使用 TableSelectorComponent 类消除 manual/import 两个选择器的重复代码。
 * 原有导出函数保留作为兼容层，内部委托给组件实例。
 */

import { currentJsonTableData_ACU, settings_ACU } from '../../service/runtime/state-manager';
import { saveSettingsAndNotify_ACU } from './settings-ui-helpers';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { parseTableTemplateJson_ACU } from '../../shared/utils';
import { getSelectedManualSheetKeys_ACU } from '../triggers/settings-ui-sync';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import { jQuery_API_ACU } from '../dom-utils';
import { $manualTableSelector_ACU, $importTableSelector_ACU } from '../state/ui-refs';
import type { UIComponent_ACU } from '../component-base';

// ─── 组件配置接口 ──────────────────────────────────────

interface TableSelectorConfig {
  /** 获取可用的表格数据源 */
  getDataSource: () => Record<string, any> | null;
  /** 获取当前已选中的 sheet keys */
  getSelectedKeys: () => string[];
  /** 获取容器的 jQuery 引用 */
  getContainer: () => JQuery<HTMLElement> | null;
  /** 将选中的 keys 写入 settings */
  saveSelection: (keys: string[]) => void;
  /** 数据源为空时的占位文本 */
  emptyDataText: string;
  /** 无可选表格时的占位文本 */
  emptyKeysText: string;
}

// ─── TableSelectorComponent 类 ─────────────────────────

class TableSelectorComponent implements UIComponent_ACU {
  private _config: TableSelectorConfig;
  private _$container: JQuery<HTMLElement> | null = null;
  private _mounted = false;

  constructor(config: TableSelectorConfig) {
    this._config = config;
  }

  /** 生成选择器 HTML（纯函数） */
  render(): string {
    const dataSource = this._config.getDataSource();
    if (!dataSource) return `<div class="notes">${escapeHtml_ACU(this._config.emptyDataText)}</div>`;

    const availableKeys = getSortedSheetKeys_ACU(dataSource);
    if (availableKeys.length === 0) return `<div class="notes">${escapeHtml_ACU(this._config.emptyKeysText)}</div>`;

    const selectedKeys = this._config.getSelectedKeys();
    const selectedSet = new Set(selectedKeys);

    let html = '<div class="acu-table-selector" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;max-height:240px;overflow:auto;padding:8px;border:1px solid var(--border-normal);border-radius:8px;background:var(--bg-secondary);">';
    availableKeys.forEach(key => {
      const name = dataSource[key]?.name || key;
      const checked = selectedSet.has(key) ? 'checked' : '';
      html += `<label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border-normal);border-radius:6px;background:var(--bg-primary);">
              <input type="checkbox" data-key="${key}" ${checked} style="margin:0;width:14px;height:14px;flex-shrink:0;">
              <span style="flex:1;word-break:break-all;font-weight:600;">${escapeHtml_ACU(name)}</span>
          </label>`;
    });
    html += '</div>';
    return html;
  }

  /** 挂载到容器：插入 HTML + 绑定事件 */
  mount($container: JQuery<HTMLElement>): void {
    if (this._mounted) this.unmount();
    this._$container = $container;
    this._$container.html(this.render());
    this._bindEvents();
    this._mounted = true;
  }

  /** 卸载：清理事件 + 清空内容 */
  unmount(): void {
    if (this._$container) {
      this._$container.off('change', 'input[type="checkbox"]');
      this._$container.empty();
    }
    this._mounted = false;
  }

  /** 用新数据重新渲染（保持挂载状态） */
  update(): void {
    if (!this._$container || !this._$container.length) return;
    this._$container.off('change', 'input[type="checkbox"]');
    this._$container.html(this.render());
    this._bindEvents();
  }

  /** 从 UI 读取当前勾选的 keys */
  getSelectionFromUI(): string[] {
    if (!this._$container || !this._$container.length) return [];
    const keys: string[] = [];
    this._$container.find('input[type="checkbox"]:checked').each(function () {
      const k = jQuery_API_ACU(this).data('key');
      if (k) keys.push(k);
    });
    return keys;
  }

  /** 全选 */
  selectAll(): void {
    const dataSource = this._config.getDataSource();
    if (!dataSource) return;
    const keys = getSortedSheetKeys_ACU(dataSource);
    this._config.saveSelection(keys);
    this.update();
  }

  /** 全不选 */
  selectNone(): void {
    this._config.saveSelection([]);
    this.update();
  }

  private _bindEvents(): void {
    if (!this._$container) return;
    const config = this._config;
    this._$container.off('change', 'input[type="checkbox"]').on('change', 'input[type="checkbox"]', function () {
      const checkedKeys: string[] = [];
      config.getContainer()?.find('input[type="checkbox"]:checked').each(function () {
        const key = jQuery_API_ACU(this).data('key');
        if (key) checkedKeys.push(key);
      });
      config.saveSelection(checkedKeys);
    });
  }
}

// ─── 组件实例 ──────────────────────────────────────────

const manualSelector = new TableSelectorComponent({
  getDataSource: () => currentJsonTableData_ACU || null,
  getSelectedKeys: () => {
    const resolved = getSelectedManualSheetKeys_ACU();
    // 同步到 settings（保持原有行为）
    if (!Array.isArray(settings_ACU.manualSelectedTables) || JSON.stringify(settings_ACU.manualSelectedTables) !== JSON.stringify(resolved)) {
      settings_ACU.manualSelectedTables = resolved;
      saveSettingsAndNotify_ACU();
    }
    return resolved;
  },
  getContainer: () => $manualTableSelector_ACU,
  saveSelection: (keys: string[]) => {
    settings_ACU.manualSelectedTables = keys;
    settings_ACU.hasManualSelection = true;
    saveSettingsAndNotify_ACU();
  },
  emptyDataText: '暂无表格可选。',
  emptyKeysText: '暂无表格可选。',
});

const importSelector = new TableSelectorComponent({
  getDataSource: () => getImportBaseTableData_ACU(),
  getSelectedKeys: () => {
    const resolved = getSelectedImportSheetKeys_ACU();
    if (!Array.isArray(settings_ACU.importSelectedTables) || JSON.stringify(settings_ACU.importSelectedTables) !== JSON.stringify(resolved)) {
      settings_ACU.importSelectedTables = resolved;
      saveSettingsAndNotify_ACU();
    }
    return resolved;
  },
  getContainer: () => $importTableSelector_ACU,
  saveSelection: (keys: string[]) => {
    settings_ACU.importSelectedTables = keys;
    settings_ACU.hasImportTableSelection = true;
    saveSettingsAndNotify_ACU();
  },
  emptyDataText: '尚未加载表格结构。',
  emptyKeysText: '暂无表格可选。',
});

// ─── 兼容层：保留原有导出函数签名 ─────────────────────

export function renderManualTableSelector_ACU() {
  const $container = $manualTableSelector_ACU;
  if (!$container || !$container.length || !currentJsonTableData_ACU) return;
  manualSelector.mount($container);
}

export function getManualSelectionFromUI_ACU() {
  const keys = manualSelector.getSelectionFromUI();
  if (keys.length > 0 || settings_ACU.hasManualSelection) {
    settings_ACU.manualSelectedTables = keys;
    settings_ACU.hasManualSelection = true;
    saveSettingsAndNotify_ACU();
    return keys;
  }
  return getSelectedManualSheetKeys_ACU();
}

// ─── 外部导入表格选择器 ────────────────────────────────

export function getImportBaseTableData_ACU() {
  try {
    const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true });
    if (templateData) return templateData;
  } catch (e) {
    // ignore
  }
  return currentJsonTableData_ACU || null;
}

export function getSelectedImportSheetKeys_ACU() {
  const base = getImportBaseTableData_ACU();
  if (!base) return [];
  const availableKeys = getSortedSheetKeys_ACU(base);
  const saved = Array.isArray(settings_ACU.importSelectedTables) ? settings_ACU.importSelectedTables : [];
  if (!settings_ACU.hasImportTableSelection) return availableKeys;
  const validSaved = saved.filter((k: string) => availableKeys.includes(k));
  return validSaved;
}

export function renderImportTableSelector_ACU() {
  const $container = $importTableSelector_ACU;
  if (!$container || !$container.length) return;
  importSelector.mount($container);
}

export function getImportSelectionFromUI_ACU() {
  const keys = importSelector.getSelectionFromUI();
  if (keys.length > 0 || settings_ACU.hasImportTableSelection) {
    settings_ACU.importSelectedTables = keys;
    settings_ACU.hasImportTableSelection = true;
    saveSettingsAndNotify_ACU();
    return keys;
  }
  return getSelectedImportSheetKeys_ACU();
}

export function handleImportSelectAll_ACU() {
  importSelector.selectAll();
}

export function handleImportSelectNone_ACU() {
  importSelector.selectNone();
}

export function handleManualSelectAll_ACU() {
  manualSelector.selectAll();
}

export function handleManualSelectNone_ACU() {
  manualSelector.selectNone();
}