<template>
  <nav class="ub-vnav" data-ub-viz-nav aria-label="表格列表">
    <p class="ub-vnav__label">表格 · {{ sheetItems.length }}</p>
    <ul class="ub-vnav__list">
      <li v-for="item in sheetItems" :key="item.key">
        <button
          :ref="el => setItemRef(item.key, el)"
          type="button"
          class="ub-vnav__item"
          :class="{ 'is-active': sheetMode && item.key === currentSheetKey }"
          :aria-current="sheetMode && item.key === currentSheetKey ? 'true' : undefined"
          :data-ub-viz-sheet="item.key"
          @click="emit('select-sheet', item.key)"
        >
          <i class="fa-solid fa-table ub-vnav__icon" aria-hidden="true"></i>
          <span class="ub-vnav__text">
            <span class="ub-vnav__name">{{ item.name }}</span>
            <span class="ub-vnav__meta">{{ item.rowCount }} 行 · {{ item.columnCount }} 列</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-if="sheetItems.length === 0" class="ub-vnav__empty">还没有表格，去「数据库管理」新增一张。</p>
    <div class="ub-vnav__sep" aria-hidden="true"></div>
    <button
      ref="manageRef"
      type="button"
      class="ub-vnav__item ub-vnav__item--manage"
      :class="{ 'is-active': !sheetMode }"
      @click="emit('select-manage')"
    >
      <i class="fa-solid fa-layer-group ub-vnav__icon" aria-hidden="true"></i>
      <span class="ub-vnav__text">
        <span class="ub-vnav__name">数据库管理</span>
        <span class="ub-vnav__meta">表格顺序 · 新增删除 · 全局注入</span>
      </span>
    </button>
  </nav>
</template>

<script setup lang="ts">
/** 数据库编辑器的表格列表：桌面放左栏，手机放在"选择表格"面板里。 */
import { nextTick, onMounted, ref, watch } from 'vue';
import type { VisualizerSheetItem } from '../../../presentation-v2/stores/visualizer-store';

const props = defineProps<{
  sheetItems: VisualizerSheetItem[];
  currentSheetKey: string | null;
  /** true＝正在编辑某张表；false＝数据库管理。 */
  sheetMode: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-sheet', key: string): void;
  (e: 'select-manage'): void;
}>();

const itemRefs = new Map<string, HTMLElement>();
const manageRef = ref<HTMLElement | null>(null);

function setItemRef(key: string, el: unknown): void {
  if (el instanceof HTMLElement) itemRefs.set(key, el);
  else itemRefs.delete(key);
}

async function revealActive(): Promise<void> {
  await nextTick();
  const target = props.sheetMode && props.currentSheetKey ? itemRefs.get(props.currentSheetKey) : manageRef.value;
  target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

onMounted(() => void revealActive());
watch(() => [props.currentSheetKey, props.sheetMode, props.sheetItems.length], () => void revealActive());
</script>

<style scoped>
.ub-vnav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ub-vnav__label {
  margin: 0 var(--ub-s3) var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
  letter-spacing: 0.06em;
}

.ub-vnav__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ub-vnav__item {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  width: 100%;
  min-height: calc(var(--ub-u) * 46);
  padding: var(--ub-s2) var(--ub-s3);
  border: 0;
  border-radius: var(--ub-r-control);
  background: transparent;
  color: var(--ub-text-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.ub-vnav__item:hover {
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-vnav__item.is-active {
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-vnav__icon {
  flex: 0 0 auto;
  width: 1.2em;
  font-size: var(--ub-fs-sm);
  text-align: center;
  opacity: 0.8;
}

.ub-vnav__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ub-vnav__name {
  overflow: hidden;
  font-size: var(--ub-fs-sm);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-vnav__meta {
  overflow: hidden;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-vnav__item.is-active .ub-vnav__meta {
  color: inherit;
  opacity: 0.75;
}

.ub-vnav__empty {
  padding: var(--ub-s2) var(--ub-s3);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-vnav__sep {
  height: 1px;
  margin: var(--ub-s2) var(--ub-s3);
  background: var(--ub-line-soft);
}
</style>
