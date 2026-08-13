<template>
  <div
    class="acu-segmented"
    :class="[`acu-segmented--${size}`, { 'acu-segmented--disabled': disabled }]"
    role="radiogroup"
    :aria-label="ariaLabel"
    :style="barStyle"
  >
    <span class="acu-segmented__thumb" aria-hidden="true" />
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="acu-segmented__item"
      :class="{ 'acu-segmented__item--active': opt.value === modelValue }"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :disabled="disabled || opt.disabled"
      @click="select(opt)"
      @keydown.left.prevent="move(-1)"
      @keydown.up.prevent="move(-1)"
      @keydown.right.prevent="move(1)"
      @keydown.down.prevent="move(1)"
    >
      <span class="acu-segmented__label">{{ opt.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface AcuSegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type Size = 'sm' | 'md';

const props = withDefaults(defineProps<{
  options: AcuSegmentedOption[];
  modelValue: string;
  disabled?: boolean;
  size?: Size;
  ariaLabel?: string;
}>(), {
  disabled: false,
  size: 'md',
  ariaLabel: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const activeIndex = computed(() => {
  const index = props.options.findIndex(opt => opt.value === props.modelValue);
  return Math.max(0, index);
});

const barStyle = computed(() => ({
  '--acu-segment-count': String(Math.max(1, props.options.length)),
  '--acu-segment-index': String(activeIndex.value),
}));

function select(opt: AcuSegmentedOption): void {
  if (props.disabled || opt.disabled || opt.value === props.modelValue) return;
  emit('update:modelValue', opt.value);
}

function move(delta: number): void {
  if (props.disabled || props.options.length === 0) return;
  const enabled = props.options.filter(opt => !opt.disabled);
  if (enabled.length === 0) return;
  const currentIndex = enabled.findIndex(opt => opt.value === props.modelValue);
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + delta + enabled.length) % enabled.length;
  emit('update:modelValue', enabled[nextIndex].value);
}
</script>

<style scoped>
.acu-segmented {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  min-width: 0;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
  padding: var(--acu-space-075, 3px);
  overflow: hidden;
}

.acu-segmented--disabled {
  opacity: 0.55;
}

.acu-segmented__thumb {
  position: absolute;
  inset: var(--acu-space-075, 3px) auto var(--acu-space-075, 3px) var(--acu-space-075, 3px);
  width: calc((100% - var(--acu-space-150, 6px)) / var(--acu-segment-count));
  border-radius: calc(var(--acu-radius-sm) - var(--acu-space-050, 2px));
  background: var(--acu-accent);
  transform: translateX(calc(var(--acu-segment-index) * 100%));
  transition: transform 0.16s ease, background 0.16s ease;
  pointer-events: none;
}

.acu-segmented__item {
  position: relative;
  min-width: 0;
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--acu-text-2);
  font: inherit;
  font-size: var(--acu-font-size-body-lg, 13px);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--acu-space-150, 6px);
  transition: background 0.15s ease, color 0.15s ease;
  z-index: 1;
}

.acu-segmented__item:not(.acu-segmented__item--active):hover:not(:disabled) {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

.acu-segmented__item:disabled {
  cursor: not-allowed;
  color: var(--acu-text-3);
}

.acu-segmented__item--active {
  color: var(--acu-on-accent);
}

.acu-segmented__item:focus-visible {
  outline: none;
}

.acu-segmented__item:focus-visible::before {
  content: '';
  position: absolute;
  inset: var(--acu-space-050, 2px);
  border-radius: var(--acu-radius-sm);
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
  pointer-events: none;
  z-index: 2;
}

.acu-segmented--md .acu-segmented__item {
  min-height: var(--acu-segment-height-md, 30px);
  padding: 0 var(--acu-space-2, 8px);
  border-radius: calc(var(--acu-radius-sm) - var(--acu-space-050, 2px));
}

.acu-segmented--sm .acu-segmented__item {
  min-height: var(--acu-segment-height-sm, 24px);
  padding: 0 var(--acu-space-175, 7px);
  font-size: var(--acu-font-size-body, 12px);
  border-radius: calc(var(--acu-radius-sm) - var(--acu-space-050, 2px));
}

.acu-segmented__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
