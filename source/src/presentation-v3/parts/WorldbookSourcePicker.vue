<template>
  <div class="ub-wbsrc">
    <UbSegmented
      :options="sourceOptions"
      :model-value="source"
      aria-label="世界书来源"
      block
      @update:model-value="onSourceChange"
    />
    <div v-if="source === 'manual'" class="ub-wbsrc__manual">
      <UbInput v-if="filterable" v-model="filter" icon="fa-solid fa-magnifying-glass" placeholder="筛选世界书..." aria-label="筛选世界书" />
      <div class="ub-wbsrc__list" :class="{ 'is-loading': status === 'loading' }">
        <button
          v-for="name in filteredNames"
          :key="name"
          type="button"
          role="checkbox"
          class="ub-wbsrc__book"
          :class="{ 'is-on': selectedSet.has(name) }"
          :aria-checked="selectedSet.has(name) ? 'true' : 'false'"
          :disabled="status === 'loading'"
          @click="emit('toggle-book', name, !selectedSet.has(name))"
        >
          <i :class="selectedSet.has(name) ? 'fa-solid fa-square-check' : 'fa-regular fa-square'" aria-hidden="true"></i>
          <span>{{ name }}</span>
        </button>
        <p v-if="!filteredNames.length" class="ub-wbsrc__empty">{{ status === 'loading' ? '正在加载世界书...' : '无可选世界书' }}</p>
      </div>
    </div>
    <p v-if="status === 'error'" class="ub-wbsrc__error">{{ error || '加载失败' }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WorldbookLoadStatus } from '../../presentation-v2/composables/useWorldbookSelector';
import UbInput from '../ui/UbInput.vue';
import UbSegmented, { type UbSegmentedOption } from '../ui/UbSegmented.vue';

type WorldbookSource = 'character' | 'manual' | 'active';

const props = withDefaults(defineProps<{
  source: WorldbookSource;
  selectedNames: string[];
  names: string[];
  status: WorldbookLoadStatus;
  error: string;
  filterable?: boolean;
  /** 是否提供「正文接收」来源（仅填表页） */
  allowActive?: boolean;
}>(), {
  filterable: true,
  allowActive: false,
});

const emit = defineEmits<{
  (e: 'update:source', value: WorldbookSource): void;
  (e: 'toggle-book', name: string, checked: boolean): void;
}>();

const filter = ref('');

const sourceOptions = computed<UbSegmentedOption[]>(() => [
  { value: 'character', label: '跟随角色卡' },
  ...(props.allowActive ? [{ value: 'active', label: '正文接收' }] : []),
  { value: 'manual', label: '手动选择' },
]);

const selectedSet = computed(() => new Set(props.selectedNames.filter(Boolean)));

const filteredNames = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return q ? props.names.filter(name => name.toLowerCase().includes(q)) : props.names;
});

function onSourceChange(value: string): void {
  if (value === 'active' && !props.allowActive) return;
  emit('update:source', value === 'manual' || value === 'active' ? value : 'character');
}
</script>

<style scoped>
.ub-wbsrc {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  min-width: 0;
}

.ub-wbsrc__manual {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
}

.ub-wbsrc__list {
  display: flex;
  flex-direction: column;
  max-height: calc(var(--ub-u) * 220);
  padding: var(--ub-s1);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  overflow-y: auto;
}

.ub-wbsrc__list.is-loading {
  opacity: 0.6;
}

.ub-wbsrc__book {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  min-height: var(--ub-control-h-sm);
  padding: var(--ub-s1) var(--ub-s2);
  border: 0;
  border-radius: calc(var(--ub-r-control) - 3px);
  background: transparent;
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-sm);
  text-align: left;
  cursor: pointer;
}

.ub-wbsrc__book:hover {
  background: var(--ub-hover);
}

.ub-wbsrc__book.is-on {
  color: var(--ub-text);
  font-weight: 600;
}

.ub-wbsrc__book.is-on i {
  color: var(--ub-accent-ink);
}

.ub-wbsrc__book span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-wbsrc__empty {
  padding: var(--ub-s3);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  text-align: center;
}

.ub-wbsrc__error {
  color: var(--ub-danger);
  font-size: var(--ub-fs-xs);
}
</style>
