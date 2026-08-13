<template>
  <nav class="acu-visualizer-nav" aria-label="数据库导航">
    <div class="acu-visualizer-nav__brand">
      <span class="acu-visualizer-nav__brand-mark" aria-hidden="true">DB</span>
      <span class="acu-visualizer-nav__brand-copy">
        <span class="acu-visualizer-nav__brand-title">数据库编辑器</span>
        <span class="acu-visualizer-nav__brand-tag">
          {{ sheetItems.length }} 张表 · {{ dirty ? "未保存" : "已同步" }}
        </span>
      </span>
    </div>

    <div class="acu-visualizer-nav__head">
      <h2>表格列表</h2>
      <AcuBadge variant="neutral">{{ sheetItems.length }} 张</AcuBadge>
    </div>

    <div
      v-for="item in sheetItems"
      :key="item.key"
      :ref="(el) => setSheetRowRef(item.key, el)"
      class="acu-visualizer-nav__sheet-row"
      :class="{
        'is-active': item.key === currentSheetKey && isSheetEditingMode,
      }"
    >
      <AcuButton
        class="acu-visualizer-nav__sheet-select"
        size="sm"
        @click="$emit('select-sheet', item.key)"
      >
        <span>{{ item.name }}</span>
        <small>{{ item.rowCount }} 行 · {{ item.columnCount }} 列</small>
      </AcuButton>
    </div>

    <div class="acu-visualizer-nav__head acu-visualizer-nav__head--management">
      <h2>数据库管理</h2>
    </div>

    <AcuButton
      :ref="setTableManagementNavRef"
      class="acu-visualizer-nav__global-item"
      size="sm"
      :class="{ 'is-active': mode === 'table-management' || mode === 'global' }"
      @click="$emit('select-table-management')"
    >
      数据库管理
    </AcuButton>
  </nav>
</template>

<script setup lang="ts">
import { nextTick, onMounted, watch, ref } from "vue";
import AcuBadge from "../../components/_lib/AcuBadge.vue";
import AcuButton from "../../components/_lib/AcuButton.vue";
import type {
  VisualizerMode,
  VisualizerSheetItem,
} from "../../stores/visualizer-store";

const props = defineProps<{
  sheetItems: VisualizerSheetItem[];
  currentSheetKey: string | null;
  dirty: boolean;
  isSheetEditingMode: boolean;
  mode: VisualizerMode;
}>();

defineEmits<{
  (e: "select-sheet", key: string): void;
  (e: "select-table-management"): void;
}>();

const tableManagementNavRef = ref<HTMLElement | null>(null);
const sheetRowRefs = new Map<string, HTMLElement>();

function asElement(el: unknown): HTMLElement | null {
  if (el instanceof HTMLElement) return el;
  const root = (el as { $el?: unknown } | null)?.$el;
  return root instanceof HTMLElement ? root : null;
}

function setSheetRowRef(key: string, el: unknown): void {
  const element = asElement(el);
  if (element) sheetRowRefs.set(key, element);
  else sheetRowRefs.delete(key);
}

function setTableManagementNavRef(el: unknown): void {
  tableManagementNavRef.value = asElement(el);
}

async function scrollActiveNavItemIntoView(): Promise<void> {
  await nextTick();
  const target =
    props.mode === "global" || props.mode === "table-management"
      ? tableManagementNavRef.value
      : props.currentSheetKey
        ? sheetRowRefs.get(props.currentSheetKey) || null
        : null;
  target?.scrollIntoView?.({
    block: "nearest",
    inline: "nearest",
  });
}

onMounted(() => {
  void scrollActiveNavItemIntoView();
});

watch(
  () => [
    props.currentSheetKey,
    props.mode,
    props.sheetItems.map((item) => item.key).join("\u0001"),
  ],
  () => {
    void scrollActiveNavItemIntoView();
  },
);
</script>

<style scoped>
.acu-visualizer-nav {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
}

.acu-visualizer-nav__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px 20px;
  margin-bottom: 14px;
}

.acu-visualizer-nav__brand-mark {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--acu-radius-md);
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.acu-visualizer-nav__brand-copy {
  min-width: 0;
  display: block;
}

.acu-visualizer-nav__brand-title {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-panel-title, 15px);
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-visualizer-nav__brand-tag {
  display: block;
  min-width: 0;
  margin-top: 3px;
  overflow: hidden;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-visualizer-nav__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acu-visualizer-nav__head--management {
  margin-top: auto;
}

.acu-visualizer-nav__head h2 {
  margin: 0;
  padding: 7px 0 6px;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1.3;
  text-transform: uppercase;
}

.acu-visualizer-nav__sheet-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  border-radius: var(--acu-radius-sm);
  color: var(--acu-text-2);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.acu-visualizer-nav__sheet-row:not(.is-active):hover {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

.acu-visualizer-nav__sheet-row.is-active {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-weight: 600;
}

.acu-visualizer-nav__sheet-select,
.acu-visualizer-nav__global-item {
  font: inherit;
  border: 0;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.acu-visualizer-nav__sheet-select {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px;
  border-radius: var(--acu-radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  box-shadow: none;
}

.acu-visualizer-nav__sheet-select.acu-btn:hover:not(:disabled) {
  background: transparent;
}

.acu-visualizer-nav__sheet-select span,
.acu-visualizer-nav__sheet-select small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-visualizer-nav__sheet-select small {
  color: currentColor;
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 400;
  opacity: 0.72;
}

.acu-visualizer-nav__global-item {
  padding: 8px 9px;
  border-radius: var(--acu-radius-sm);
  background: transparent;
  color: var(--acu-text-2);
  text-align: left;
}

.acu-visualizer-nav__global-item:not(.is-active).acu-btn:hover:not(
    :disabled
  ) {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

.acu-visualizer-nav__global-item.is-active {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-weight: 600;
}

.acu-visualizer-nav__sheet-select:focus-visible,
.acu-visualizer-nav__global-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}
</style>
