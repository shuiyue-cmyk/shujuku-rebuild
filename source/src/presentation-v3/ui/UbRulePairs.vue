<template>
  <div class="ub-rules">
    <div class="ub-rules__head">
      <span class="ub-rules__label">{{ label }}</span>
      <span class="ub-rules__count">{{ modelValue.length ? `${modelValue.length} 条` : '暂无' }}</span>
    </div>
    <div v-for="(rule, index) in modelValue" :key="index" class="ub-rules__row">
      <UbInput
        :model-value="rule.start"
        :placeholder="startPlaceholder"
        :aria-label="`${label} ${index + 1} 开始`"
        @update:model-value="update(index, 'start', String($event))"
      />
      <i class="fa-solid fa-arrow-right ub-rules__sep" aria-hidden="true"></i>
      <UbInput
        :model-value="rule.end"
        :placeholder="endPlaceholder"
        :aria-label="`${label} ${index + 1} 结束`"
        @update:model-value="update(index, 'end', String($event))"
      />
      <UbIconButton icon="fa-solid fa-trash-can" variant="danger" size="sm" title="删除此规则" @click="remove(index)" />
    </div>
    <UbButton size="sm" variant="ghost" icon="fa-solid fa-plus" @click="add">{{ addLabel }}</UbButton>
  </div>
</template>

<script lang="ts">
export interface UbRulePair {
  start: string;
  end: string;
}
</script>

<script setup lang="ts">
import UbButton from './UbButton.vue';
import UbIconButton from './UbIconButton.vue';
import UbInput from './UbInput.vue';

const props = withDefaults(defineProps<{
  modelValue: UbRulePair[];
  label: string;
  startPlaceholder?: string;
  endPlaceholder?: string;
  addLabel?: string;
}>(), {
  startPlaceholder: '开始词',
  endPlaceholder: '结束词',
  addLabel: '添加规则',
});

const emit = defineEmits<{ (e: 'update:modelValue', value: UbRulePair[]): void }>();

function cloneRules(): UbRulePair[] {
  return props.modelValue.map(rule => ({ ...rule }));
}

function add(): void {
  emit('update:modelValue', [...cloneRules(), { start: '', end: '' }]);
}

function remove(index: number): void {
  const next = cloneRules();
  next.splice(index, 1);
  emit('update:modelValue', next);
}

function update(index: number, field: 'start' | 'end', value: string): void {
  const next = cloneRules();
  next[index] = { ...next[index], [field]: value };
  emit('update:modelValue', next);
}
</script>

<style scoped>
.ub-rules {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ub-s2);
  min-width: 0;
}

.ub-rules__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: 100%;
}

.ub-rules__label {
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
}

.ub-rules__count {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-rules__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ub-s2);
  width: 100%;
}

.ub-rules__sep {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}
</style>
