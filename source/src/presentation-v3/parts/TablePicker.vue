<template>
  <div class="ub-tpick">
    <p v-if="!sheetKeys.length" class="ub-tpick__empty">{{ emptyText || '尚无可选表格。' }}</p>
    <template v-else>
      <div class="ub-tpick__bar">
        <span class="ub-tpick__count">已选 <strong>{{ selectedKeys.length }}</strong> / {{ sheetKeys.length }}</span>
        <UbButton size="sm" variant="ghost" :disabled="disabled" @click="emit('select-all')">全选</UbButton>
        <UbButton size="sm" variant="ghost" :disabled="disabled" @click="emit('select-none')">全不选</UbButton>
      </div>
      <p v-if="disabled" class="ub-tpick__note">仅展示模板：数据库运行时未加载，暂不可选择执行目标。</p>
      <div class="ub-tpick__chips" role="group" :aria-label="ariaLabel">
        <button
          v-for="key in sheetKeys"
          :key="key"
          type="button"
          role="checkbox"
          class="ub-tpick__chip"
          :class="{ 'is-on': selectedSet.has(key) }"
          :aria-checked="selectedSet.has(key) ? 'true' : 'false'"
          :disabled="disabled"
          @click="toggle(key)"
        >
          <i :class="selectedSet.has(key) ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'" aria-hidden="true"></i>
          {{ sheetNames?.[key] || key }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/** 表格多选：胶囊式开关，比一排复选框更好点（手机上尤其）。保持模板原始顺序。 */
import { computed } from 'vue';
import UbButton from '../ui/UbButton.vue';

const props = defineProps<{
  sheetKeys: string[];
  selectedKeys: string[];
  sheetNames: Record<string, string>;
  emptyText?: string;
  disabled?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (e: 'update:selectedKeys', value: string[]): void;
  (e: 'select-all'): void;
  (e: 'select-none'): void;
}>();

const selectedSet = computed(() => new Set(props.selectedKeys));

function toggle(key: string): void {
  const next = new Set(props.selectedKeys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  emit('update:selectedKeys', props.sheetKeys.filter(k => next.has(k)));
}
</script>

<style scoped>
.ub-tpick {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  min-width: 0;
}

.ub-tpick__bar {
  display: flex;
  align-items: center;
  gap: var(--ub-s1);
}

.ub-tpick__count {
  flex: 1 1 auto;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-tpick__count strong {
  color: var(--ub-text);
}

.ub-tpick__note,
.ub-tpick__empty {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-tpick__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s2);
}

.ub-tpick__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--ub-s2);
  max-width: 100%;
  min-height: var(--ub-control-h-sm);
  padding: var(--ub-s1) var(--ub-s3);
  border: 1px solid var(--ub-line);
  border-radius: 999px;
  background: var(--ub-input-bg);
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-xs);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.ub-tpick__chip.is-on {
  border-color: transparent;
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-tpick__chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
