<template>
  <div ref="rootRef" class="ub-vdata" @pointerdown.capture="onPointerDownCapture">
    <div class="ub-vdata__bar">
      <span class="ub-vdata__range">{{ rangeText }}</span>
      <div v-if="win.pageCount > 1" class="ub-vdata__pager" aria-label="数据分页">
        <UbIconButton icon="fa-solid fa-chevron-left" size="sm" title="上一页" :disabled="win.page <= 1" @click="setPage(win.page - 1)" />
        <span class="ub-vdata__pager-text">第</span>
        <span class="ub-vdata__pager-input">
          <UbInput
            type="number"
            :model-value="pageJump"
            :min="1"
            :max="win.pageCount"
            :step="1"
            aria-label="跳转到页码"
            @update:model-value="pageJump = $event"
            @change="commitPageJump"
          />
        </span>
        <span class="ub-vdata__pager-text">/ {{ win.pageCount }} 页</span>
        <UbIconButton icon="fa-solid fa-chevron-right" size="sm" title="下一页" :disabled="win.page >= win.pageCount" @click="setPage(win.page + 1)" />
      </div>
    </div>

    <p v-if="rowCount === 0" class="ub-vdata__empty">
      <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
      这张表还没有数据。点下面的「新增一行」，再逐个字段填写。
    </p>

    <ol v-else class="ub-vdata__cards">
      <li
        v-for="row in rows"
        :key="row.index"
        class="ub-vcard"
        :class="{ 'is-locked': row.locked }"
        data-ub-viz-card
      >
        <header class="ub-vcard__head">
          <span class="ub-vcard__no">#{{ row.index + 1 }}</span>
          <UbBadge v-if="row.locked" variant="accent">整行已锁定</UbBadge>
          <span class="ub-vcard__spacer"></span>
          <UbIconButton
            data-ub-viz-row-lock
            :icon="row.locked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"
            size="sm"
            :variant="row.locked ? 'accent' : 'default'"
            :title="row.locked ? '取消这一行的自动更新保护' : '锁定这一行，阻止自动更新改动整行'"
            @click="visualizer.toggleRowLock(visualizer.currentSheetKey, row.index)"
          />
          <UbIconButton icon="fa-solid fa-trash" size="sm" variant="danger" title="删除这一行" @click="deleteRow(row.index)" />
        </header>

        <div class="ub-vcard__fields">
          <div
            v-for="fieldRow in row.fieldRows"
            :key="fieldRow.key"
            class="ub-vcard__line"
            :class="{ 'is-wide': fieldRow.wide }"
            :data-ub-viz-line="fieldRow.wide ? 'wide' : 'half'"
          >
            <div
              v-for="field in fieldRow.fields"
              :key="field.columnIndex"
              class="ub-vfield"
              :class="{ 'is-locked': field.locked, 'is-active': isActiveField(row.index, field.columnIndex) }"
              data-ub-viz-field
              :data-ub-viz-field-layout="fieldRow.wide ? 'wide' : 'half'"
              @pointerdown="setActiveField(row.index, field.columnIndex)"
              @focusin="setActiveField(row.index, field.columnIndex)"
            >
              <div class="ub-vfield__label">
                <span class="ub-vfield__name">{{ field.header }}</span>
                <span class="ub-vfield__locks">
                  <UbBadge v-if="field.specialIndexLocked" variant="warning">
                    <span title="编码索引由系统维护；保存、AI 更新或行数变化时会按 AM 序列重排">自动编号</span>
                  </UbBadge>
                  <template v-else-if="field.locked || isActiveField(row.index, field.columnIndex)">
                    <UbIconButton
                      data-ub-viz-col-lock
                      class="ub-vfield__lock"
                      icon="fa-solid fa-table-columns"
                      size="sm"
                      :variant="field.columnLocked ? 'accent' : 'default'"
                      :title="field.columnLocked ? '取消整列的自动更新保护' : '锁定整列，阻止自动更新改动这一列'"
                      @pointerdown.stop.prevent="lockByPointer('column', row.index, field.columnIndex)"
                      @click.stop.prevent="lockByClick('column', row.index, field.columnIndex)"
                    />
                    <UbIconButton
                      data-ub-viz-cell-lock
                      class="ub-vfield__lock"
                      icon="fa-solid fa-lock"
                      size="sm"
                      :variant="field.cellLocked ? 'accent' : 'default'"
                      :title="field.cellLocked ? '取消这个格子的自动更新保护' : '锁定这个格子，阻止自动更新改动这个值'"
                      @pointerdown.stop.prevent="lockByPointer('cell', row.index, field.columnIndex)"
                      @click.stop.prevent="lockByClick('cell', row.index, field.columnIndex)"
                    />
                  </template>
                </span>
              </div>
              <textarea
                v-if="isEditing(row.index, field.columnIndex)"
                :ref="setEditorRef"
                class="ub-vfield__editor"
                rows="1"
                :value="field.value"
                :aria-label="`编辑${field.header}`"
                @input="onCellInput(row.index, field.columnIndex, $event)"
                @blur="stopEditing(row.index, field.columnIndex)"
              ></textarea>
              <div
                v-else
                class="ub-vfield__value"
                :class="{ 'is-empty': !field.value }"
                role="button"
                tabindex="0"
                title="点击编辑"
                data-ub-viz-field-preview
                @pointerdown.stop="startEditing(row.index, field.columnIndex)"
                @click="startEditing(row.index, field.columnIndex)"
                @keydown.enter.prevent="startEditing(row.index, field.columnIndex)"
                @keydown.space.prevent="startEditing(row.index, field.columnIndex)"
              >{{ field.value || '未填写' }}</div>
            </div>
          </div>
        </div>
      </li>
    </ol>

    <button type="button" class="ub-vdata__add" @click="addRow">
      <i class="fa-solid fa-plus" aria-hidden="true"></i>
      新增一行
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 数据视图：每行一张卡片，字段点一下就地编辑；短字段两两并排。
 * 行/列/单元格锁存在 visualizer store 的锁草稿里；30 行一页。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { getSheetColumnProjection_ACU } from '../../../shared/ddl-utils';
import { useVisualizerConfigEditing } from '../../../presentation-v2/composables/visualizer/useVisualizerConfigEditing';
import { useDialogStore } from '../../../presentation-v2/stores/dialog-store';
import { useVisualizerStore } from '../../../presentation-v2/stores/visualizer-store';
import UbBadge from '../../ui/UbBadge.vue';
import UbIconButton from '../../ui/UbIconButton.vue';
import UbInput from '../../ui/UbInput.vue';
import { isShortDataField, pageWindow, pairFieldRows } from './data-layout';

const visualizer = useVisualizerStore();
const config = useVisualizerConfigEditing();
const dialogStore = useDialogStore();

const rootRef = ref<HTMLElement | null>(null);
const page = ref(1);
const pageJump = ref<string | number>(1);

type Cell = { rowIndex: number; columnIndex: number };
const editingCell = ref<Cell | null>(null);
const activeField = ref<Cell | null>(null);
const editorRef = ref<HTMLTextAreaElement | null>(null);
/** 编辑期间冻结当前列的长短判定，避免边打字边在"并排/独占"之间跳。 */
const layoutSnapshot = ref<boolean[] | null>(null);
let lockPointer: { kind: 'column' | 'cell'; rowIndex: number; columnIndex: number; at: number } | null = null;

const rowCount = computed(() => {
  const content = visualizer.currentSheet?.content;
  return Array.isArray(content) ? Math.max(0, content.length - 1) : 0;
});

const win = computed(() => pageWindow(rowCount.value, page.value));

const rangeText = computed(() => (rowCount.value === 0
  ? '共 0 行'
  : `第 ${win.value.start + 1}–${win.value.end} 行 · 共 ${rowCount.value} 行`));

const pageRows = computed<any[][]>(() => {
  const content = visualizer.currentSheet?.content;
  if (!Array.isArray(content)) return [];
  return content.slice(win.value.start + 1, win.value.end + 1);
});

const visibleColumns = computed(() => {
  const sheet = visualizer.currentSheet;
  if (!sheet) return [];
  return getSheetColumnProjection_ACU(sheet).visibleColumns
    .filter(column => column.sourceIndex > 0)
    .map(column => ({ ...column, columnIndex: column.sourceIndex - 1 }));
});

function columnIsShort(dataRows: any[][]): boolean[] {
  return visibleColumns.value.map(column => dataRows.every(row =>
    isShortDataField(String(Array.isArray(row) ? (row[column.sourceIndex] ?? '') : ''))));
}

const rows = computed(() => {
  const sheetKey = visualizer.currentSheetKey;
  const special = config.specialIndex.value;
  const lockDraft = sheetKey ? visualizer.getLockDraft(sheetKey) : null;
  const lockedRows = new Set(lockDraft?.rows || []);
  const lockedColumns = new Set(lockDraft?.cols || []);
  const lockedCells = new Set(lockDraft?.cells || []);
  const specialLocked = lockDraft?.specialIndexLocked !== false;

  let isShort = columnIsShort(pageRows.value);
  const editing = editingCell.value;
  const snapshot = layoutSnapshot.value;
  if (editing && snapshot && snapshot.length === isShort.length) {
    isShort = isShort.map((value, i) => (visibleColumns.value[i]?.columnIndex === editing.columnIndex ? snapshot[i] : value));
  }

  return pageRows.value.map((row, offset) => {
    const index = win.value.start + offset;
    const rowLocked = lockedRows.has(index);
    const fields = visibleColumns.value.map(column => {
      const columnLocked = lockedColumns.has(column.columnIndex);
      const cellLocked = lockedCells.has(`${index}:${column.columnIndex}`);
      const specialIndexLocked = special.enabled && special.index === column.columnIndex && specialLocked;
      return {
        header: column.header,
        columnIndex: column.columnIndex,
        value: String(Array.isArray(row) ? (row[column.sourceIndex] ?? '') : ''),
        columnLocked,
        cellLocked,
        specialIndexLocked,
        locked: rowLocked || columnLocked || cellLocked || specialIndexLocked,
      };
    });
    return { index, locked: rowLocked, fieldRows: pairFieldRows(fields, isShort) };
  });
});

function sameCell(cell: Cell | null, rowIndex: number, columnIndex: number): boolean {
  return !!cell && cell.rowIndex === rowIndex && cell.columnIndex === columnIndex;
}

function isEditing(rowIndex: number, columnIndex: number): boolean {
  return sameCell(editingCell.value, rowIndex, columnIndex);
}

function isActiveField(rowIndex: number, columnIndex: number): boolean {
  return sameCell(activeField.value, rowIndex, columnIndex);
}

function setActiveField(rowIndex: number, columnIndex: number): void {
  if (!isActiveField(rowIndex, columnIndex)) activeField.value = { rowIndex, columnIndex };
}

function onPointerDownCapture(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest('[data-ub-viz-field]')) return;
  activeField.value = null;
}

function autoSize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

function setEditorRef(el: unknown): void {
  editorRef.value = el instanceof HTMLTextAreaElement ? el : null;
}

async function startEditing(rowIndex: number, columnIndex: number): Promise<void> {
  setActiveField(rowIndex, columnIndex);
  if (isEditing(rowIndex, columnIndex)) return;
  layoutSnapshot.value = columnIsShort(pageRows.value);
  editingCell.value = { rowIndex, columnIndex };
  await nextTick();
  const el = editorRef.value;
  if (!el) return;
  autoSize(el);
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

function stopEditing(rowIndex: number, columnIndex: number): void {
  if (!isEditing(rowIndex, columnIndex)) return;
  editingCell.value = null;
  editorRef.value = null;
  layoutSnapshot.value = null;
}

function clearEditing(): void {
  editingCell.value = null;
  editorRef.value = null;
  layoutSnapshot.value = null;
  activeField.value = null;
}

function onCellInput(rowIndex: number, columnIndex: number, event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  visualizer.updateCell(rowIndex, columnIndex, el.value);
  autoSize(el);
}

// 锁按钮在 pointerdown 时就切换（避免编辑框失焦重排吞掉点击），随后 1 秒内的同一次 click 忽略；
// 键盘触发只有 click，照常切换。
function toggleLock(kind: 'column' | 'cell', rowIndex: number, columnIndex: number): void {
  setActiveField(rowIndex, columnIndex);
  if (kind === 'column') visualizer.toggleColumnLock(visualizer.currentSheetKey, columnIndex);
  else visualizer.toggleCellLock(visualizer.currentSheetKey, rowIndex, columnIndex);
}

function lockByPointer(kind: 'column' | 'cell', rowIndex: number, columnIndex: number): void {
  lockPointer = { kind, rowIndex, columnIndex, at: Date.now() };
  toggleLock(kind, rowIndex, columnIndex);
}

function lockByClick(kind: 'column' | 'cell', rowIndex: number, columnIndex: number): void {
  const recent = lockPointer;
  lockPointer = null;
  if (recent && recent.kind === kind && recent.rowIndex === rowIndex && recent.columnIndex === columnIndex
    && Date.now() - recent.at < 1000) return;
  toggleLock(kind, rowIndex, columnIndex);
}

function scrollToTop(): void {
  void nextTick(() => {
    const scroller = rootRef.value?.closest<HTMLElement>('[data-ub-viz-scroll]');
    if (scroller) scroller.scrollTop = 0;
  });
}

function setPage(target: number): void {
  const next = pageWindow(rowCount.value, target).page;
  pageJump.value = next;
  if (next === page.value) return;
  page.value = next;
  clearEditing();
  scrollToTop();
}

function commitPageJump(value: string | number): void {
  if (value === '' || value === '-') {
    pageJump.value = page.value;
    return;
  }
  setPage(Number(value));
}

function refreshSpecialIndexDraft(): void {
  const sheet = visualizer.currentSheet;
  const info = config.specialIndex.value;
  if (!sheet || !info.enabled || !visualizer.isSpecialIndexLocked(visualizer.currentSheetKey)) return;
  if (!Array.isArray(sheet.content) || info.index < 0) return;
  for (let rowIndex = 1; rowIndex < sheet.content.length; rowIndex += 1) {
    const row = sheet.content[rowIndex];
    if (Array.isArray(row)) row[info.index + 1] = `AM${String(rowIndex).padStart(4, '0')}`;
  }
}

function addRow(): void {
  visualizer.addRow();
  refreshSpecialIndexDraft();
  clearEditing();
  page.value = win.value.pageCount;
  void nextTick(() => {
    const cards = rootRef.value?.querySelectorAll<HTMLElement>('[data-ub-viz-card]');
    cards?.[cards.length - 1]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  });
}

async function deleteRow(rowIndex: number): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: '删除数据行',
    message: `确定要删除第 ${rowIndex + 1} 行吗？这只改动编辑器草稿，保存之前都还能放弃。`,
    confirmLabel: '删除这一行',
    confirmVariant: 'danger',
  });
  if (!confirmed) return;
  visualizer.deleteRow(rowIndex);
  refreshSpecialIndexDraft();
  clearEditing();
}

watch(() => visualizer.currentSheetKey, () => {
  page.value = 1;
  clearEditing();
});

watch(page, value => {
  pageJump.value = value;
});

watch(rowCount, () => {
  const clamped = pageWindow(rowCount.value, page.value).page;
  if (clamped !== page.value) page.value = clamped;
  clearEditing();
});
</script>

<style scoped>
.ub-vdata {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  min-width: 0;
}

.ub-vdata__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ub-s2) var(--ub-s3);
  min-height: var(--ub-control-h-sm);
}

.ub-vdata__range {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ub-vdata__pager {
  display: flex;
  align-items: center;
  gap: var(--ub-s1);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
}

.ub-vdata__pager-input {
  width: calc(var(--ub-u) * 64);
}

.ub-vdata__pager-text {
  white-space: nowrap;
}

.ub-vdata__empty {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s5) var(--ub-s4);
  border: 1px dashed var(--ub-line);
  border-radius: var(--ub-r-card);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
}

.ub-vdata__cards {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ub-vcard {
  min-width: 0;
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--ub-card-shadow);
  scroll-margin: var(--ub-s4);
}

.ub-vcard.is-locked {
  border-color: color-mix(in srgb, var(--ub-accent) 45%, var(--ub-line-soft));
}

.ub-vcard__head {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s4);
  border-bottom: 1px solid var(--ub-line-soft);
}

.ub-vcard__no {
  color: var(--ub-text);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-sm);
  font-weight: 700;
}

.ub-vcard__spacer {
  flex: 1 1 auto;
}

.ub-vcard__fields {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s3) var(--ub-s4) var(--ub-s4);
}

.ub-vcard__line {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ub-s3);
}

.ub-vcard__line.is-wide {
  grid-template-columns: minmax(0, 1fr);
}

.ub-vfield {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  min-width: 0;
}

.ub-vfield__label {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  min-height: var(--ub-control-h-sm);
}

.ub-vfield__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-vfield.is-locked .ub-vfield__name {
  color: var(--ub-accent-ink);
}

.ub-vfield__locks {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.ub-vfield__value,
.ub-vfield__editor {
  width: 100%;
  min-height: var(--ub-control-h);
  padding: calc(var(--ub-u) * 7) var(--ub-s3);
  border: 1px solid transparent;
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ub-vfield__value {
  cursor: text;
  transition: border-color 0.14s ease, background 0.14s ease;
}

.ub-vfield__value:hover {
  border-color: var(--ub-line);
}

.ub-vfield__value:focus-visible {
  border-color: var(--ub-accent);
  outline: none;
}

.ub-vfield__value.is-empty {
  color: var(--ub-text-3);
  font-style: italic;
}

.ub-vfield__editor {
  display: block;
  resize: none;
  overflow: hidden;
  border-color: var(--ub-accent);
  background: var(--ub-input-bg);
  box-shadow: 0 0 0 3px var(--ub-accent-soft);
  outline: none;
}

.ub-vdata__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--ub-s2);
  width: 100%;
  min-height: calc(var(--ub-u) * 48);
  border: 1.5px dashed var(--ub-line);
  border-radius: var(--ub-r-card);
  background: transparent;
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-sm);
  font-weight: 650;
  cursor: pointer;
  transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
}

.ub-vdata__add:hover {
  border-color: var(--ub-accent);
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

@media (max-width: 560px) {
  .ub-vcard__fields {
    padding: var(--ub-s3);
  }
}
</style>
