<template>
  <span class="ub-field" :class="{ 'ub-field--disabled': disabled, 'ub-field--number': type === 'number' }">
    <i v-if="icon" :class="[icon, 'ub-field__icon']" aria-hidden="true"></i>
    <input
      class="ub-field__input"
      :type="type"
      :value="displayValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      :autocomplete="autocomplete"
      :aria-label="ariaLabel"
      :inputmode="type === 'number' ? 'decimal' : undefined"
      @input="onInput"
      @change="onChange"
      @wheel="onWheel"
    >
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string | number;
  type?: 'text' | 'number' | 'password';
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  autocomplete?: string;
  ariaLabel?: string;
  icon?: string;
}>(), {
  type: 'text',
  placeholder: undefined,
  disabled: false,
  min: undefined,
  max: undefined,
  step: undefined,
  autocomplete: undefined,
  ariaLabel: undefined,
  icon: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
  (e: 'change', value: string | number): void;
}>();

const displayValue = computed(() => (props.modelValue == null ? '' : String(props.modelValue)));

/** 数字框返回 number，中间态（空串 / 单个负号 / 非法值）原样返回由业务层兜底。 */
function parseValue(raw: string): string | number {
  if (props.type !== 'number') return raw;
  if (raw === '' || raw === '-') return raw;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

function onInput(ev: Event): void {
  emit('update:modelValue', parseValue((ev.target as HTMLInputElement | null)?.value ?? ''));
}

function onChange(ev: Event): void {
  emit('change', parseValue((ev.target as HTMLInputElement | null)?.value ?? ''));
}

/** 聚焦的数字框上滚轮会偷偷改值：直接失焦，让滚轮去滚页面。 */
function onWheel(ev: WheelEvent): void {
  if (props.type !== 'number') return;
  const input = ev.currentTarget as HTMLInputElement | null;
  if (!input || input.ownerDocument.activeElement !== input) return;
  ev.preventDefault();
  input.blur();
}
</script>

<style scoped>
.ub-field {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  width: 100%;
}

.ub-field--number {
  width: calc(var(--ub-u) * 112);
  max-width: 100%;
}

.ub-field__icon {
  position: absolute;
  left: var(--ub-s3);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  pointer-events: none;
}

.ub-field__input {
  width: 100%;
  min-width: 0;
  height: var(--ub-control-h);
  padding: 0 var(--ub-s3);
  border: 1px solid var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  outline: none;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.ub-field__icon + .ub-field__input {
  padding-left: calc(var(--ub-s3) * 2 + var(--ub-fs-sm));
}

.ub-field--number .ub-field__input {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.ub-field__input:focus {
  border-color: var(--ub-accent);
  box-shadow: 0 0 0 3px var(--ub-accent-soft);
}

.ub-field__input::placeholder {
  color: var(--ub-text-3);
  opacity: 1;
}

.ub-field--disabled .ub-field__input {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
