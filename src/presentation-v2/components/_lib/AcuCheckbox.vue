<template>
  <button
    type="button"
    class="acu-checkbox"
    :class="{ 'acu-checkbox--disabled': disabled, 'acu-checkbox--checked': modelValue }"
    role="checkbox"
    :aria-checked="modelValue ? 'true' : 'false'"
    :disabled="disabled"
    v-bind="$attrs"
    @click="onClick"
  >
    <span class="acu-checkbox__box" aria-hidden="true">
      <svg class="acu-checkbox__icon" viewBox="0 0 16 16" focusable="false">
        <path d="M3.75 8.25 6.75 11.25 12.25 5.45" />
      </svg>
    </span>
    <span v-if="label" class="acu-checkbox__label">{{ label }}</span>
    <slot v-else />
  </button>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  modelValue: boolean;
  label?: string;
  disabled?: boolean;
}>(), {
  label: undefined,
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

function onClick(): void {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}
</script>

<style scoped>
.acu-checkbox {
  display: inline-flex; align-items: flex-start; gap: var(--acu-space-175, 7px);
  padding: 0; border: 0; background: transparent;
  font: inherit; font-size: var(--acu-font-size-body, 12px); color: var(--acu-text-2);
  cursor: pointer; user-select: none;
  line-height: 1.5; text-align: left;
}
.acu-checkbox--disabled { opacity: 0.5; cursor: not-allowed; }

.acu-checkbox__box {
  flex-shrink: 0;
  width: var(--acu-checkbox-size, 16px); height: var(--acu-checkbox-size, 16px); margin-top: var(--acu-space-025, 1px);
  display: flex; align-items: center; justify-content: center;
  border: 0;
  border-radius: var(--acu-space-075, 3px);
  background: var(--acu-bg-2);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.acu-checkbox--checked .acu-checkbox__box {
  background: var(--acu-accent);
}

.acu-checkbox__icon {
  display: block;
  width: var(--acu-checkbox-icon-size, 12px); height: var(--acu-checkbox-icon-size, 12px);
  color: #fff;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.15;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
  transform: scale(0.82);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.acu-checkbox--checked .acu-checkbox__icon {
  opacity: 1;
  transform: scale(1);
}

.acu-checkbox__label { min-width: 0; }

.acu-checkbox:hover:not(:disabled) .acu-checkbox__box {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), var(--acu-bg-2);
}
.acu-checkbox--checked:hover:not(:disabled) .acu-checkbox__box {
  background: var(--acu-accent-2);
}

.acu-checkbox:focus-visible {
  outline: none;
}
.acu-checkbox:focus-visible .acu-checkbox__box {
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}
</style>
