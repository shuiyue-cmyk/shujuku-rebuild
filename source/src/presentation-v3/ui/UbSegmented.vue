<template>
  <div class="ub-seg" :class="{ 'ub-seg--sm': size === 'sm', 'ub-seg--block': block }" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      class="ub-seg__item"
      :class="{ 'is-active': opt.value === modelValue }"
      :aria-checked="opt.value === modelValue ? 'true' : 'false'"
      :disabled="disabled || opt.disabled"
      @click="select(opt.value)"
    >
      <i v-if="opt.icon" :class="opt.icon" aria-hidden="true"></i>
      {{ opt.label }}
    </button>
  </div>
</template>

<script lang="ts">
export interface UbSegmentedOption {
  value: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}
</script>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  options: UbSegmentedOption[];
  modelValue: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  block?: boolean;
}>(), {
  ariaLabel: undefined,
  disabled: false,
  size: 'md',
  block: false,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

function select(value: string): void {
  if (props.disabled || value === props.modelValue) return;
  emit('update:modelValue', value);
}
</script>

<style scoped>
.ub-seg {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  max-width: 100%;
  padding: 3px;
  border-radius: calc(var(--ub-r-control) + 3px);
  background: var(--ub-sunken);
  overflow-x: auto;
  scrollbar-width: none;
}

.ub-seg--block {
  display: flex;
  width: 100%;
}

.ub-seg--block .ub-seg__item {
  flex: 1 1 0;
}

.ub-seg__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ub-s1);
  min-height: calc(var(--ub-control-h) - 6px);
  padding: 0 var(--ub-s3);
  border: 0;
  border-radius: var(--ub-r-control);
  background: transparent;
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;
}

.ub-seg--sm .ub-seg__item {
  min-height: calc(var(--ub-control-h-sm) - 6px);
  font-size: var(--ub-fs-xs);
}

.ub-seg__item:hover:not(:disabled):not(.is-active) {
  color: var(--ub-text);
}

.ub-seg__item.is-active {
  background: var(--ub-panel);
  color: var(--ub-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--ub-line-soft);
}

.ub-seg__item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
