<template>
  <div class="ub-vmanage" data-ub-viz-manage>
    <UbSection
      title="表格顺序"
      description="调整整套数据库的表格顺序，新增或删除表格。改动只进编辑器草稿，保存之前都可以放弃。"
    >
      <template #actions>
        <UbButton size="sm" variant="soft" icon="fa-solid fa-plus" @click="emit('request-add-sheet')">新增表格</UbButton>
      </template>
      <ol v-if="sheetItems.length" class="ub-vmanage__list">
        <li v-for="(item, index) in sheetItems" :key="item.key" class="ub-vmanage__item" data-ub-viz-manage-item>
          <span class="ub-vmanage__no">{{ index + 1 }}</span>
          <button type="button" class="ub-vmanage__name" title="编辑这张表" @click="emit('open-sheet', item.key)">
            <span class="ub-vmanage__title">{{ item.name }}</span>
            <span class="ub-vmanage__meta">{{ item.rowCount }} 行 · {{ item.columnCount }} 列</span>
          </button>
          <span class="ub-vmanage__ops">
            <UbIconButton icon="fa-solid fa-arrow-up" size="sm" title="上移" :disabled="index === 0" @click="emit('move-sheet', item.key, 'up')" />
            <UbIconButton icon="fa-solid fa-arrow-down" size="sm" title="下移" :disabled="index === sheetItems.length - 1" @click="emit('move-sheet', item.key, 'down')" />
            <UbIconButton icon="fa-solid fa-trash" size="sm" variant="danger" title="删除表格" @click="emit('request-delete-sheet', item.key)" />
          </span>
        </li>
      </ol>
      <p v-else class="ub-vmanage__empty">数据库里还没有表格，点右上角「新增表格」开始。</p>
    </UbSection>

    <UbSection
      title="全局注入位置"
      description="属于整套模板、不依附单张表。所有表的世界书内容整体位置不对时，先检查这里。"
    >
      <VizPlacement
        title="可读数据条目位置"
        :placement="config.getGlobalPlacement('readableEntryPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updateGlobalPlacement('readableEntryPlacement', field, value)"
      />
      <VizPlacement
        title="包裹条目位置"
        :placement="config.getGlobalPlacement('wrapperPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updateGlobalPlacement('wrapperPlacement', field, value)"
      />
    </UbSection>
  </div>
</template>

<script setup lang="ts">
/** 数据库管理：表格排序／新增／删除，以及整套模板的全局注入位置。 */
import { useVisualizerConfigEditing } from '../../../presentation-v2/composables/visualizer/useVisualizerConfigEditing';
import type { VisualizerSheetItem } from '../../../presentation-v2/stores/visualizer-store';
import UbButton from '../../ui/UbButton.vue';
import UbIconButton from '../../ui/UbIconButton.vue';
import UbSection from '../../ui/UbSection.vue';
import VizPlacement from './VizPlacement.vue';

defineProps<{ sheetItems: VisualizerSheetItem[] }>();

const emit = defineEmits<{
  (e: 'move-sheet', key: string, direction: 'up' | 'down'): void;
  (e: 'open-sheet', key: string): void;
  (e: 'request-add-sheet'): void;
  (e: 'request-delete-sheet', key: string): void;
}>();

const config = useVisualizerConfigEditing();
</script>

<style scoped>
.ub-vmanage {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s6);
  min-width: 0;
}

.ub-vmanage__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ub-vmanage__item {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s4);
}

.ub-vmanage__item + .ub-vmanage__item {
  border-top: 1px solid var(--ub-line-soft);
}

.ub-vmanage__no {
  flex: 0 0 auto;
  min-width: 1.4em;
  color: var(--ub-text-3);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
  text-align: right;
}

.ub-vmanage__name {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--ub-s1) var(--ub-s2);
  border: 0;
  border-radius: var(--ub-r-control);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ub-vmanage__name:hover {
  background: var(--ub-hover);
}

.ub-vmanage__title {
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-vmanage__meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

.ub-vmanage__ops {
  display: inline-flex;
  gap: 2px;
  flex: 0 0 auto;
}

.ub-vmanage__empty {
  padding: var(--ub-s4);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}
</style>
