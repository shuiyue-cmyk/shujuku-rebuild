<template>
  <div class="ub-wbt">
    <UbInput v-if="filterable" v-model="filter" icon="fa-solid fa-magnifying-glass" placeholder="筛选世界书..." aria-label="筛选世界书" />
    <UbSelect
      :options="options"
      :model-value="modelValue"
      :disabled="status === 'loading'"
      placeholder="未选择"
      aria-label="目标世界书"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <p v-if="status === 'error'" class="ub-wbt__error">{{ error || '加载失败' }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WorldbookLoadStatus } from '../../presentation-v2/composables/useWorldbookSelector';
import UbInput from '../ui/UbInput.vue';
import UbSelect, { type UbSelectOption } from '../ui/UbSelect.vue';

const props = defineProps<{
  modelValue: string;
  names: string[];
  charPrimary: string | null;
  status: WorldbookLoadStatus;
  error: string;
  filterable?: boolean;
  showCharacterOption?: boolean;
  characterOptionLabel?: string;
  characterFallbackLabel?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();
const filter = ref('');

const options = computed<UbSelectOption[]>(() => {
  const q = filter.value.trim().toLowerCase();
  const names = q ? props.names.filter(name => name.toLowerCase().includes(q)) : props.names;
  const out: UbSelectOption[] = [];
  if (props.charPrimary || props.showCharacterOption) {
    out.push({
      value: 'character',
      label: props.characterOptionLabel
        || (props.charPrimary ? `当前角色卡主世界书 · ${props.charPrimary}` : props.characterFallbackLabel || '当前角色卡主世界书'),
    });
  }
  for (const name of names) out.push({ value: name, label: name });
  // 当前值被筛掉时仍保留一项，避免选择框显示成"未选择"
  if (props.modelValue && !out.some(o => o.value === props.modelValue) && props.names.includes(props.modelValue)) {
    out.push({ value: props.modelValue, label: props.modelValue });
  }
  return out;
});
</script>

<style scoped>
.ub-wbt {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  min-width: 0;
  width: 100%;
}

.ub-wbt__error {
  color: var(--ub-danger);
  font-size: var(--ub-fs-xs);
}
</style>
