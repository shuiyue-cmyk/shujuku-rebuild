<template>
  <span class="ub-select" :class="{ 'ub-select--disabled': disabled, 'ub-select--placeholder': !hasSelection, 'ub-select--sm': size === 'sm' }">
    <select
      class="ub-select__native"
      :value="hasSelection ? modelValue : PLACEHOLDER_VALUE"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :title="title"
      @change="onChange"
    >
      <option v-if="!hasSelection" :value="PLACEHOLDER_VALUE" disabled>{{ placeholder }}</option>
      <template v-for="block in blocks" :key="block.key">
        <optgroup v-if="block.group" :label="block.group">
          <option v-for="opt in block.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </optgroup>
        <template v-else>
          <option v-for="opt in block.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </template>
      </template>
    </select>
    <i class="fa-solid fa-chevron-down ub-select__caret" aria-hidden="true"></i>
  </span>
</template>

<script lang="ts">
export interface UbSelectOption {
  value: string;
  label: string;
  /** 相邻同名分组的选项合并成一个 optgroup。 */
  group?: string;
}
</script>

<script setup lang="ts">
/**
 * 原生 select：手机上直接调起系统选择器（大列表、可滚动、无遮挡），桌面跟随 color-scheme。
 * 占位项用哨兵值，避免与业务里合法的空串选项（如"未选择"）冲突。
 */
import { computed } from 'vue';

const PLACEHOLDER_VALUE = '__ub_placeholder__';

const props = withDefaults(defineProps<{
  options: UbSelectOption[];
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  size?: 'sm' | 'md';
}>(), {
  placeholder: '请选择',
  disabled: false,
  ariaLabel: undefined,
  title: undefined,
  size: 'md',
});

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const hasSelection = computed(() => props.options.some(o => o.value === props.modelValue));

const blocks = computed(() => {
  const out: Array<{ key: string; group: string | null; options: UbSelectOption[] }> = [];
  props.options.forEach((opt, index) => {
    const group = opt.group || null;
    const last = out[out.length - 1];
    if (last && last.group === group) last.options.push(opt);
    else out.push({ key: `${index}:${group ?? ''}`, group, options: [opt] });
  });
  return out;
});

function onChange(ev: Event): void {
  const value = (ev.target as HTMLSelectElement | null)?.value ?? '';
  if (value === PLACEHOLDER_VALUE) return;
  emit('update:modelValue', value);
}
</script>

<style scoped>
.ub-select {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.ub-select__native {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  min-width: 0;
  height: var(--ub-control-h);
  padding: 0 calc(var(--ub-s3) * 2 + 10px) 0 var(--ub-s3);
  border: 1px solid var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  text-overflow: ellipsis;
  cursor: pointer;
  outline: none;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.ub-select--sm .ub-select__native {
  height: var(--ub-control-h-sm);
  font-size: var(--ub-fs-xs);
}

.ub-select__native:focus-visible {
  border-color: var(--ub-accent);
  box-shadow: 0 0 0 3px var(--ub-accent-soft);
}

.ub-select__native option,
.ub-select__native optgroup {
  background: var(--ub-panel);
  color: var(--ub-text);
}

.ub-select--placeholder .ub-select__native {
  color: var(--ub-text-3);
}

.ub-select--disabled .ub-select__native {
  opacity: 0.5;
  cursor: not-allowed;
}

.ub-select__caret {
  position: absolute;
  right: var(--ub-s3);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  pointer-events: none;
}
</style>
