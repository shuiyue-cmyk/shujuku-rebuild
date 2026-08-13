import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { buildDefaultPlotWorldbookConfig_ACU } from '../../shared/defaults';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { jQuery_API_ACU } from '../dom-utils';
import { getCharLorebooks_ACU, getCurrentCharacterWorldbookBinding_ACU } from '../../service/worldbook/worldbook-service';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettingsAndNotify_ACU } from './settings-ui-helpers';
import { getLorebookEntriesByNames_ACU, getWorldbookNames_ACU } from '../../service/worldbook/pipeline';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { logError_ACU } from '../../shared/utils';
import { $popupInstance_ACU } from '../state/ui-refs';
/**
 * presentation/components/worldbook-selector.ts — 世界书选择 UI
 * 从 features/worldbook/01~03 + 04 迁移而来
 */
  export async function updateWorldbookSourceView_ACU() {
      if (!$popupInstance_ACU) return;
      const worldbookConfig = getCurrentWorldbookConfig_ACU();
      const source = worldbookConfig.source;
      const $manualBlock = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-manual-select-block`);
      if (source === 'manual') {
          $manualBlock.slideDown();
          await populateWorldbookList_ACU();
      } else {
          $manualBlock.slideUp();
      }
      await populateWorldbookEntryList_ACU();
  }

  // =========================
  // [剧情推进] 世界书选择 UI（独立于填表 worldbookConfig）
  // 复用现有加载逻辑，但使用不同的 DOM id 与不同的配置对象
  // =========================
  export function getPlotWorldbookConfig_ACU() {
      if (!settings_ACU.plotSettings) settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
      if (!settings_ACU.plotSettings.plotWorldbookConfig) {
          settings_ACU.plotSettings.plotWorldbookConfig = buildDefaultPlotWorldbookConfig_ACU();
      }
      return settings_ACU.plotSettings.plotWorldbookConfig;
  }

  export async function updatePlotWorldbookSourceView_ACU() {
      if (!$popupInstance_ACU) return;
      const cfg = getPlotWorldbookConfig_ACU();
      const source = cfg.source;
      const $manualBlock = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-manual-select-block`);
      if (source === 'manual') {
          $manualBlock.slideDown();
          await populatePlotWorldbookList_ACU();
      } else {
          $manualBlock.slideUp();
      }
      await populatePlotWorldbookEntryList_ACU();
  }

  async function populatePlotWorldbookList_ACU() {
      if (!$popupInstance_ACU) return;
      const $listContainer = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select`);
      if (!$listContainer.length) return;
      $listContainer.empty().html('<em>正在加载...</em>');
      try {
          const bookNames = await getWorldbookNames_ACU();
          $listContainer.empty();
          if (bookNames.length === 0) {
              $listContainer.html('<em>未找到世界书</em>');
              return;
          }
          const cfg = getPlotWorldbookConfig_ACU();
          bookNames.forEach((bookName: string) => {
              const isSelected = (cfg.manualSelection || []).includes(bookName);
              const itemHtml = `
                  <div class="qrf_worldbook_list_item ${isSelected ? 'selected' : ''}" data-book-name="${escapeHtml_ACU(bookName)}">
                      ${escapeHtml_ACU(bookName)}
                  </div>`;
              $listContainer.append(itemHtml);
          });
          // 应用筛选（若存在）
          try {
              const $filter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-select-filter`);
              if ($filter.length) applyWorldbookListFilter_ACU($listContainer, $filter.val());
          } catch (e) {}
      } catch (error) {
          logError_ACU('[剧情推进] 加载手动世界书列表失败:', { phase: 'plot_worldbook_list', error: { category: 'unknown' } });
          $listContainer.html('<em>加载失败</em>');
      }
  }

  export async function populatePlotWorldbookEntryList_ACU() {
      if (!$popupInstance_ACU) return;
      const $list = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-entry-list`);
      if (!$list.length) return;
      $list.empty().html('<em>正在加载条目...</em>');

      const cfg = getPlotWorldbookConfig_ACU();
      const source = cfg.source;
              let bookNames: string[] = [];

      try {
          if (source === 'character') {
              bookNames = (await getCurrentCharacterWorldbookBinding_ACU()).orderedNames;
          } else if (source === 'manual') {
              bookNames = cfg.manualSelection || [];
          }
      } catch (error) {
          logError_ACU('[剧情推进] 读取角色绑定世界书失败:', { phase: 'plot_character_binding', error: { category: 'unknown' } });
          $list.html('<em>加载条目失败。</em>');
          return;
      }

      bookNames = [...new Set((Array.isArray(bookNames) ? bookNames : []).filter(Boolean))];
      if (bookNames.length === 0) {
          $list.html('<em>请先选择世界书或为角色绑定世界书。</em>');
          return;
      }

      try {
          if (!cfg.enabledEntries) cfg.enabledEntries = {} as Record<string, any>;
          const entriesMap: Record<string, any[]> = await getLorebookEntriesByNames_ACU(bookNames) as Record<string, any[]>;
              const groups: Record<string, any>[] = [];
          const expandByDefault = bookNames.length === 1;
          let settingsChanged = false;

          for (const bookName of bookNames) {
              const bookEntries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
              if (typeof (cfg.enabledEntries as Record<string, any>)[bookName] === 'undefined') {
                  // 默认启用时：仅对"非数据库生成条目"做默认勾选（数据库生成条目不在UI显示，也不需要用户勾选）
                  (cfg.enabledEntries as Record<string, any>)[bookName] = bookEntries                      .filter((entry: Record<string, any>) => {
                          const comment = entry?.comment || entry?.name || '';
                          let normalizedComment = String(comment).replace(/^ACU-\[[^\]]+\]-/, '');
                          normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');

                          // UI 不显示：数据库生成条目（含隔离/外部导入前缀），以及 OutlineTable
                          if (normalizedComment.startsWith('TavernDB-ACU-OutlineTable')) return false;
                          const isDbGenerated =
                              normalizedComment.startsWith('TavernDB-ACU-') ||
                              normalizedComment.startsWith('重要人物条目') ||
                              normalizedComment.startsWith('总结条目') ||
                              normalizedComment.startsWith('小总结条目');
                          if (isDbGenerated) return false;

                          if (isEntryBlocked_ACU(entry)) return false;
                          return true;
                      })
                      .map((entry: Record<string, any>) => entry.uid);
                  settingsChanged = true;
              }

              const enabledEntries = Array.isArray((cfg.enabledEntries as Record<string, any>)[bookName]) ? (cfg.enabledEntries as Record<string, any>)[bookName] : [];
              const visibleEntries: Record<string, any>[] = [];
              bookEntries.forEach((entry: Record<string, any>) => {
                  const comment = entry?.comment || entry?.name || '';
                  let normalizedComment = String(comment).replace(/^ACU-\[[^\]]+\]-/, '');
                  normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');

                  // UI 不显示：数据库生成条目（含隔离/外部导入前缀），以及 OutlineTable
                  if (normalizedComment.startsWith('TavernDB-ACU-OutlineTable')) return;
                  const isDbGenerated =
                      normalizedComment.startsWith('TavernDB-ACU-') ||
                      normalizedComment.startsWith('重要人物条目') ||
                      normalizedComment.startsWith('总结条目') ||
                      normalizedComment.startsWith('小总结条目');
                  if (isDbGenerated) return;

                  if (isEntryBlocked_ACU(entry)) return;

                  visibleEntries.push({
                      uid: entry.uid,
                      bookName,
                      label: entry.comment || `条目 ${entry.uid}`,
                      searchText: `${bookName} ${entry.comment || entry.name || `条目 ${entry.uid}`}`,
                      checked: enabledEntries.includes(entry.uid),
                      disabled: !entry.enabled,
                      checkboxId: buildWorldbookEntryCheckboxId_ACU('plot-wb-entry', bookName, entry.uid),
                  });
              });

              if (visibleEntries.length > 0) {
                  groups.push({
                      bookName,
                      entries: visibleEntries,
                      expanded: expandByDefault,
                  });
              }
          }

          if (settingsChanged) {
              saveSettingsAndNotify_ACU();
          }
          renderLazyWorldbookEntryList_ACU($list, groups, {
              checkboxIdPrefix: 'plot-wb-entry',
              emptyText: '<em>所选世界书中无条目。</em>',
          });
          // 应用筛选（若存在）
          try {
              const $filter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-worldbook-entry-filter`);
              if ($filter.length) applyWorldbookEntryFilter_ACU($list, $filter.val());
          } catch (e) {}
      } catch (error) {
          logError_ACU('[剧情推进] 加载剧情世界书条目失败:', { phase: 'plot_worldbook_entries', error: { category: 'unknown' } });
          $list.html('<em>加载条目失败。</em>');
      }
  }

  // [新增] 填充注入目标选择器
  export async function populateInjectionTargetSelector_ACU() {
      if (!$popupInstance_ACU) return;
      const $select = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target`);
      $select.empty();
      try {
          const bookNames = await getWorldbookNames_ACU();
          // 添加默认选项
          $select.append(`<option value="character">角色卡绑定世界书</option>`);
          bookNames.forEach((bookName: string) => {
              $select.append(`<option value="${escapeHtml_ACU(bookName)}">${escapeHtml_ACU(bookName)}</option>`);
          });
          // 设置当前选中的值
          const worldbookConfig = getCurrentWorldbookConfig_ACU();
          $select.val(worldbookConfig.injectionTarget || 'character');
          // 应用筛选（若存在）
          try {
              const $filter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target-filter`);
              if ($filter.length) applyWorldbookSelectFilter_ACU($select, $filter.val());
          } catch (e) {}
      } catch (error) {
          logError_ACU('Failed to populate injection target selector:', error);
          $select.append('<option value="character">加载列表失败</option>');
      }
  }

  // [新增] 辅助函数：检查条目是否包含屏蔽词
  export function isEntryBlocked_ACU(entry: Record<string, any> | null) {
      if (!entry) return false;
      const blockedKeywords = ["规则", "思维链", "cot", "MVU", "mvu", "变量", "状态", "Status", "Rule", "rule", "检定", "判断", "叙事", "文风", "InitVar", "格式"];
      const name = String(entry.comment || entry.name || ''); // In ST, 'comment' is often the display name
      return blockedKeywords.some(keyword => name.includes(keyword));
  }

  const WORLDBOOK_ENTRY_LAZY_PAGE_SIZE_ACU = 80;

  function buildWorldbookEntryCheckboxId_ACU(prefix: string, bookName: string, uid: any) {
      const safePrefix = String(prefix || 'wb-entry').replace(/[^a-zA-Z0-9_-]+/g, '-');
      const safeBook = String(bookName || 'book')
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || 'book';
      return `${safePrefix}-${safeBook}-${uid}`;
  }

  function createLazyWorldbookEntryViewState_ACU(groups: any[] = [], options: any = {}) {
      const normalizedGroups = (Array.isArray(groups) ? groups : []).map(group => ({
          bookName: String(group?.bookName || ''),
          entries: Array.isArray(group?.entries) ? group.entries.map((entry: any) => ({ ...entry })) : [],
          filteredEntries: null as any[] | null,
          loadedCount: 0,
          expanded: group?.expanded === true,
          expandedBeforeFilter: undefined as boolean | undefined,
      })).filter((group: any) => group.bookName);

      return {
          groups: normalizedGroups,
          pageSize: Number(options?.pageSize) > 0 ? Number(options.pageSize) : WORLDBOOK_ENTRY_LAZY_PAGE_SIZE_ACU,
          checkboxIdPrefix: String(options?.checkboxIdPrefix || 'wb-entry'),
          emptyText: options?.emptyText || '<em>所选世界书中无条目。</em>',
          emptyGroupText: options?.emptyGroupText || '<em>当前分组没有可显示的条目。</em>',
          isFiltering: false,
      };
  }

  function getLazyWorldbookEntrySource_ACU(group: Record<string, any> | null) {
      if (!group) return [];
      if (Array.isArray(group.filteredEntries)) return group.filteredEntries;
      return Array.isArray(group.entries) ? group.entries : [];
  }

  function findLazyWorldbookEntryGroupState_ACU($list: JQuery<HTMLElement>, bookName: string) {
      if (!$list || !$list.length) return null;
      const state = $list.data('acuLazyWorldbookState');
      if (!state || !Array.isArray(state.groups)) return null;
      return state.groups.find((group: any) => String(group.bookName) === String(bookName)) || null;
  }

  function findLazyWorldbookEntryGroupElement_ACU($list: JQuery<HTMLElement>, bookName: string) {
      if (!$list || !$list.length) return jQuery_API_ACU();
      return $list.find('.qrf_worldbook_entry_group').filter(function() {
          return String(jQuery_API_ACU(this).data('book-name') || '') === String(bookName);
      }).first();
  }

  function updateLazyWorldbookEntryGroupMeta_ACU($list: JQuery<HTMLElement>, bookName: string) {
      if (!$list || !$list.length) return;
      const state = $list.data('acuLazyWorldbookState');
      const group = findLazyWorldbookEntryGroupState_ACU($list, bookName);
      const $group = findLazyWorldbookEntryGroupElement_ACU($list, bookName);
      if (!state || !group || !$group.length) return;

      const sourceEntries = getLazyWorldbookEntrySource_ACU(group);
      const loadedCount = Math.min(group.loadedCount || 0, sourceEntries.length);
      const metaText = sourceEntries.length === 0
          ? '0 条'
          : (loadedCount < sourceEntries.length ? `已加载 ${loadedCount} / ${sourceEntries.length} 条` : `共 ${sourceEntries.length} 条`);

      $group.find('.qrf_worldbook_entry_group_meta').text(metaText);
      $group.find('.qrf_worldbook_entry_toggle').text(group.expanded ? '收起' : '展开');
      $group.find('.qrf_worldbook_entry_group_body').toggle(group.expanded);
      $group.find('.qrf_worldbook_entry_group_footer').toggle(group.expanded && sourceEntries.length > 0);
      $group.find('.qrf_worldbook_entry_load_more').toggle(group.expanded && loadedCount < sourceEntries.length);
  }

  export function renderLazyWorldbookEntryItems_ACU($list: any, bookName: any, options: any = {}) {
      if (!$list || !$list.length) return;
      const state = $list.data('acuLazyWorldbookState');
      const group = findLazyWorldbookEntryGroupState_ACU($list, bookName);
      const $group = findLazyWorldbookEntryGroupElement_ACU($list, bookName);
      if (!state || !group || !$group.length) return;

      const sourceEntries = getLazyWorldbookEntrySource_ACU(group);
      if (options.reset === true) {
          group.loadedCount = 0;
      }

      const nextCount = options.renderAll === true
          ? sourceEntries.length
          : Math.min(sourceEntries.length, (group.loadedCount || 0) + state.pageSize);
      group.loadedCount = nextCount;

          const visibleEntries = sourceEntries.slice(0, nextCount);
      const html = visibleEntries.length > 0
          ? visibleEntries.map((entry: Record<string, any>) => {
              const checkboxId = entry.checkboxId || buildWorldbookEntryCheckboxId_ACU(state.checkboxIdPrefix, entry.bookName || bookName, entry.uid);
              const labelText = entry.label || `条目 ${entry.uid}`;
              const disabledStyle = entry.disabled ? 'style="opacity:0.6; text-decoration: line-through;"' : '';
              return `
                  <div class="qrf_worldbook_entry_item" data-book-name="${escapeHtml_ACU(String(entry.bookName || bookName))}" data-entry-uid="${escapeHtml_ACU(String(entry.uid ?? ''))}">
                      <input type="checkbox" id="${escapeHtml_ACU(String(checkboxId))}" data-book="${escapeHtml_ACU(String(entry.bookName || bookName))}" data-uid="${escapeHtml_ACU(String(entry.uid ?? ''))}" ${entry.checked ? 'checked' : ''} ${entry.disabled ? 'disabled' : ''}>
                      <label for="${escapeHtml_ACU(String(checkboxId))}" ${disabledStyle}>${escapeHtml_ACU(String(labelText))}</label>
                  </div>`;
          }).join('')
          : state.emptyGroupText;

      $group.find('.qrf_worldbook_entry_group_body').html(html);
      updateLazyWorldbookEntryGroupMeta_ACU($list, bookName);
  }

  function renderLazyWorldbookEntryList_ACU($list: any, groups: any, options: any = {}) {
      if (!$list || !$list.length) return;
      const state = createLazyWorldbookEntryViewState_ACU(groups, options);
      $list.data('acuLazyWorldbookState', state);

      if (!state.groups.length) {
          $list.html(state.emptyText);
          return;
      }

      const html = state.groups.map((group: Record<string, any>) => `
          <div class="qrf_worldbook_entry_group" data-book-name="${escapeHtml_ACU(group.bookName)}" style="margin-bottom: 8px;">
              <div class="qrf_worldbook_entry_header" data-book-name="${escapeHtml_ACU(group.bookName)}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-weight: bold; border-bottom: 1px solid; padding-bottom: 4px;">
                  <button type="button" class="qrf_worldbook_entry_toggle button" style="padding: 2px 8px; font-size: 0.8em;">${group.expanded ? '收起' : '展开'}</button>
                  <span class="qrf_worldbook_entry_header_text" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml_ACU(group.bookName)}</span>
                  <span class="qrf_worldbook_entry_group_meta" style="font-weight: normal; font-size: 0.85em; color: var(--text_secondary);"></span>
              </div>
              <div class="qrf_worldbook_entry_group_body" style="display: ${group.expanded ? 'block' : 'none'};"></div>
              <div class="qrf_worldbook_entry_group_footer" style="display: ${group.expanded ? 'block' : 'none'}; margin-top: 6px;">
                  <button type="button" class="qrf_worldbook_entry_load_more button" style="padding: 2px 8px; font-size: 0.8em; display: none;">继续加载</button>
              </div>
          </div>`).join('');

      $list.html(html);
      state.groups.forEach((group: Record<string, any>) => {
          if (group.expanded) {
              renderLazyWorldbookEntryItems_ACU($list, group.bookName, { reset: true });
          } else {
              updateLazyWorldbookEntryGroupMeta_ACU($list, group.bookName);
          }
      });
  }

  export function toggleLazyWorldbookEntryGroup_ACU($list: JQuery<HTMLElement>, bookName: string, expanded: boolean | null = null) {
      if (!$list || !$list.length) return;
      const group = findLazyWorldbookEntryGroupState_ACU($list, bookName);
      if (!group) return;
      const nextExpanded = (typeof expanded === 'boolean') ? expanded : !group.expanded;
      group.expanded = nextExpanded;
      if (group.expanded && (group.loadedCount || 0) === 0) {
          renderLazyWorldbookEntryItems_ACU($list, bookName, { reset: true });
      } else {
          updateLazyWorldbookEntryGroupMeta_ACU($list, bookName);
      }
  }

  export function updateLazyWorldbookEntryCheckedState_ACU($list: JQuery<HTMLElement>, bookName: string, uid: any, checked: boolean) {
      const group = findLazyWorldbookEntryGroupState_ACU($list, bookName);
      if (!group) return;
      const syncCheckedState = (entries: any[]) => {
          if (!Array.isArray(entries)) return;
          entries.forEach(entry => {
              if (String(entry?.uid) === String(uid)) {
                  entry.checked = checked;
              }
          });
      };
      syncCheckedState(group.entries);
      syncCheckedState(group.filteredEntries);
  }

  function applyLazyWorldbookEntryFilter_ACU($list: JQuery<HTMLElement>, rawQuery: any) {
      if (!$list || !$list.length) return false;
      const state = $list.data('acuLazyWorldbookState');
      if (!state || !Array.isArray(state.groups)) return false;

      const q = normalizeFilterText_ACU(rawQuery);
      const wasFiltering = state.isFiltering === true;

      if (q && !wasFiltering) {
      state.groups.forEach((group: Record<string, any>) => {
              group.expandedBeforeFilter = group.expanded;
          });
      }

      if (!q) {
          state.isFiltering = false;
          state.groups.forEach((group: Record<string, any>) => {
              group.filteredEntries = null;
              group.loadedCount = 0;
              if (typeof group.expandedBeforeFilter === 'boolean') {
                  group.expanded = group.expandedBeforeFilter;
              }
              group.expandedBeforeFilter = undefined;
              const $group = findLazyWorldbookEntryGroupElement_ACU($list, group.bookName);
              if ($group.length) $group.show();
              if (group.expanded) {
                  renderLazyWorldbookEntryItems_ACU($list, group.bookName, { reset: true });
              } else {
                  updateLazyWorldbookEntryGroupMeta_ACU($list, group.bookName);
              }
          });
          return true;
      }

      state.isFiltering = true;
      state.groups.forEach((group: Record<string, any>) => {
          const bookText = String(group.bookName || '').toLowerCase();
          if (bookText.includes(q)) {
              group.filteredEntries = Array.isArray(group.entries) ? group.entries.slice() : [];
          } else {
              group.filteredEntries = (Array.isArray(group.entries) ? group.entries : []).filter((entry: any) => {
                  const hay = String(entry.searchText || entry.label || `条目 ${entry.uid}`).toLowerCase();
                  return hay.includes(q);
              });
          }

          const sourceEntries = getLazyWorldbookEntrySource_ACU(group);
          const $group = findLazyWorldbookEntryGroupElement_ACU($list, group.bookName);
          group.loadedCount = 0;
          group.expanded = sourceEntries.length > 0;
          if ($group.length) $group.toggle(sourceEntries.length > 0);
          if (sourceEntries.length > 0) {
              renderLazyWorldbookEntryItems_ACU($list, group.bookName, { reset: true });
          } else {
              updateLazyWorldbookEntryGroupMeta_ACU($list, group.bookName);
          }
      });
      return true;
  }

  // =========================
  // [UI] 世界书筛选工具：注入目标(select) / 手动选择(list) / 条目列表(entry list)
  // =========================
  function normalizeFilterText_ACU(v: any) {
      return String(v ?? '').trim().toLowerCase();
  }

  export function applyWorldbookSelectFilter_ACU($select: JQuery<HTMLElement>, rawQuery: any) {
      if (!$select || !$select.length) return;
      const q = normalizeFilterText_ACU(rawQuery);
      const currentVal = String($select.val() ?? '');
      $select.find('option').each(function() {
          const val = String(jQuery_API_ACU(this).attr('value') ?? '');
          const text = String(jQuery_API_ACU(this).text() ?? '');
          const hay = (val + ' ' + text).toLowerCase();
          const match = (!q) || hay.includes(q);
          const keepSelected = (val === currentVal);
          this.hidden = !(match || keepSelected);
      });
  }

  export function applyWorldbookListFilter_ACU($listContainer: JQuery<HTMLElement>, rawQuery: any) {
      if (!$listContainer || !$listContainer.length) return;
      const q = normalizeFilterText_ACU(rawQuery);
      $listContainer.find('.qrf_worldbook_list_item').each(function() {
          const $it = jQuery_API_ACU(this);
          const name = String($it.data('book-name') || $it.text() || '').toLowerCase();
          $it.toggle(!q || name.includes(q));
      });
  }

  export function applyWorldbookEntryFilter_ACU($entryList: JQuery<HTMLElement>, rawQuery: any) {
      if (!$entryList || !$entryList.length) return;
      if (applyLazyWorldbookEntryFilter_ACU($entryList, rawQuery)) return;

      const q = normalizeFilterText_ACU(rawQuery);
      const $items = $entryList.find('.qrf_worldbook_entry_item');
      const $headers = $entryList.find('.qrf_worldbook_entry_header');

      if (!q) {
          $items.show();
          $headers.show();
          return;
      }

      const matchedBooks = new Set();
      $items.each(function() {
          const $row = jQuery_API_ACU(this);
          const $cb = $row.find('input[type="checkbox"]');
          const book = String($cb.data('book') || '');
          const labelText = String($row.find('label').text() || '').toLowerCase();
          const bookText = book.toLowerCase();
          const match = labelText.includes(q) || bookText.includes(q);
          $row.toggle(match);
          if (match) matchedBooks.add(book);
      });

      $headers.each(function() {
          const $h = jQuery_API_ACU(this);
          const book = String($h.data('book-name') || $h.text() || '');
          const bookText = book.toLowerCase();
          const match = bookText.includes(q) || matchedBooks.has(book);
          $h.toggle(match);
      });
  }

  // [新增] 填充外部导入专用的世界书选择器
  export async function populateImportWorldbookTargetSelector_ACU() {
      if (!$popupInstance_ACU) return;
      const $select = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-worldbook-injection-target`);
      if (!$select.length) return;
      $select.empty();
      try {
          const bookNames = await getWorldbookNames_ACU();
          // 只添加世界书选项，不添加角色卡绑定和常规更新目标选项
          bookNames.forEach((bookName: string) => {
              $select.append(`<option value="${escapeHtml_ACU(bookName)}">${escapeHtml_ACU(bookName)}</option>`);
          });
          // 设置当前选中的值
          $select.val(settings_ACU.importWorldbookTarget || '');
          // 应用筛选（若存在）
          try {
              const $filter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-worldbook-injection-target-filter`);
              if ($filter.length) applyWorldbookSelectFilter_ACU($select, $filter.val());
          } catch (e) {}
      } catch (error) {
          logError_ACU('Failed to populate import worldbook target selector:', error);
      }
  }

  export async function populateWorldbookList_ACU() {
      if (!$popupInstance_ACU) return;
      const $listContainer = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-select`);
      $listContainer.empty().html('<em>正在加载...</em>');
      try {
          const bookNames = await getWorldbookNames_ACU();
          $listContainer.empty();
          if (bookNames.length === 0) {
              $listContainer.html('<em>未找到世界书</em>');
              return;
          }
          const worldbookConfig = getCurrentWorldbookConfig_ACU();
          bookNames.forEach((bookName: string) => {
              const isSelected = worldbookConfig.manualSelection.includes(bookName);
              const itemHtml = `
                  <div class="qrf_worldbook_list_item ${isSelected ? 'selected' : ''}" data-book-name="${escapeHtml_ACU(bookName)}">
                      ${escapeHtml_ACU(bookName)}
                  </div>`;
              $listContainer.append(itemHtml);
          });
          // 应用筛选（若存在）
          try {
              const $filter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-select-filter`);
              if ($filter.length) applyWorldbookListFilter_ACU($listContainer, $filter.val());
          } catch (e) {}
      } catch (error) {
          logError_ACU('Failed to populate worldbook list:', error);
          $listContainer.html('<em>加载失败</em>');
      }
  }

  export async function populateWorldbookEntryList_ACU() {
      if (!$popupInstance_ACU) return;
      const $list = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-list`);
      $list.empty().html('<em>正在加载条目...</em>');
      
      const worldbookConfig = getCurrentWorldbookConfig_ACU();
      const source = worldbookConfig.source;
              let bookNames: string[] = [];

      if (source === 'character') {
        const charLorebooks = await getCharLorebooks_ACU({ type: 'all' });
          if (charLorebooks.primary) bookNames.push(charLorebooks.primary);
          if (charLorebooks.additional?.length) bookNames.push(...charLorebooks.additional);
      } else if (source === 'manual') {
          bookNames = worldbookConfig.manualSelection || [];
      }

      bookNames = [...new Set((Array.isArray(bookNames) ? bookNames : []).filter(Boolean))];
      if (bookNames.length === 0) {
          $list.html('<em>请先选择世界书或为角色绑定世界书。</em>');
          return;
      }

      try {
          if (!worldbookConfig.enabledEntries) worldbookConfig.enabledEntries = {};
          const entriesMap: Record<string, any[]> = await getLorebookEntriesByNames_ACU(bookNames) as Record<string, any[]>;
              const groups: Record<string, any>[] = [];
          const expandByDefault = bookNames.length === 1;
          let settingsChanged = false; // Flag to check if we need to save settings
          for (const bookName of bookNames) {
              const bookEntries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
              // If no setting exists for this book, default to all entries enabled.
              if (typeof (worldbookConfig.enabledEntries as Record<string, any>)[bookName] === 'undefined') {
                  // [修改] 默认启用时，过滤掉自动生成的条目
                  (worldbookConfig.enabledEntries as Record<string, any>)[bookName] = bookEntries
                      .filter((entry: Record<string, any>) => {
                          const comment = entry.comment || '';
                          // 过滤自动生成的条目
                          if (comment.startsWith('TavernDB-ACU-') || comment.startsWith('重要人物条目') || comment.startsWith('总结条目')) {
                              return false;
                          }
                          // [新增] 过滤屏蔽词条目
                          if (isEntryBlocked_ACU(entry)) {
                              return false;
                          }
                          return true;
                      })
                      .map((entry: Record<string, any>) => entry.uid);
                  settingsChanged = true;
              }
              
              const enabledEntries = Array.isArray((worldbookConfig.enabledEntries as Record<string, any>)[bookName]) ? (worldbookConfig.enabledEntries as Record<string, any>)[bookName] : [];
              const visibleEntries: Record<string, any>[] = [];
              bookEntries.forEach((entry: Record<string, any>) => {
                  // [新增] 在UI列表显示时，也过滤掉自动生成的条目，不显示给用户
                  const comment = entry.comment || '';
                  if (comment.startsWith('TavernDB-ACU-') || comment.startsWith('重要人物条目') || comment.startsWith('总结条目')) {
                      return;
                  }

                  // [新增] 过滤屏蔽词条目，不显示在列表中
                  if (isEntryBlocked_ACU(entry)) {
                      return;
                  }

                  visibleEntries.push({
                      uid: entry.uid,
                      bookName,
                      label: entry.comment || `条目 ${entry.uid}`,
                      searchText: `${bookName} ${entry.comment || `条目 ${entry.uid}`}`,
                      checked: enabledEntries.includes(entry.uid),
                      disabled: !entry.enabled,
                      checkboxId: buildWorldbookEntryCheckboxId_ACU('wb-entry', bookName, entry.uid),
                  });
              });

              if (visibleEntries.length > 0) {
                  groups.push({
                      bookName,
                      entries: visibleEntries,
                      expanded: expandByDefault,
                  });
              }
          }
          
          if (settingsChanged) {
              saveSettingsAndNotify_ACU();
          }

          renderLazyWorldbookEntryList_ACU($list, groups, {
              checkboxIdPrefix: 'wb-entry',
              emptyText: '<em>所选世界书中无条目。</em>',
          });
          // 应用筛选（若存在）
          try {
              const $filter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-filter`);
              if ($filter.length) applyWorldbookEntryFilter_ACU($list, $filter.val());
          } catch (e) {}
      } catch (error) {
          logError_ACU('Failed to populate worldbook entry list:', error);
          $list.html('<em>加载条目失败。</em>');
      }
  }



  // --- [新增] 世界书相关功能 ---










  // --- [新增] 世界书相关功能结束 ---
