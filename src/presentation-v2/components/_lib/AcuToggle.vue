<template>
  <button
    type="button"
    class="acu-toggle"
    :class="{ 'acu-toggle--disabled': disabled, 'acu-toggle--on': modelValue }"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :disabled="disabled"
    v-bind="$attrs"
    @click="onClick"
  >
    <span class="acu-toggle__track" aria-hidden="true">
      <span class="acu-toggle__thumb" />
    </span>
    <span v-if="label" class="acu-toggle__label">{{ label }}</span>
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
.acu-toggle {
  display: inline-flex; align-items: center; gap: var(--acu-space-2, 8px);
  flex: 0 0 auto;
  padding: 0; border: 0; background: transparent;
  font: inherit; font-size: var(--acu-font-size-body, 12px); color: var(--acu-text-2);
  cursor: pointer; user-select: none;
}
.acu-toggle--disabled { opacity: 0.5; cursor: not-allowed; }

.acu-toggle__track {
  position: relative; flex-shrink: 0;
  width: var(--acu-toggle-width, 36px); height: var(--acu-toggle-height, 20px);
  background: var(--acu-bg-2);
  border: 0;
  border-radius: var(--acu-toggle-radius, 10px);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.acu-toggle--on .acu-toggle__track {
  background: var(--acu-accent);
}

.acu-toggle__thumb {
  position: absolute; top: var(--acu-space-050, 2px); left: var(--acu-space-050, 2px);
  width: var(--acu-toggle-thumb-size, 16px); height: var(--acu-toggle-thumb-size, 16px);
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}

.acu-toggle--on .acu-toggle__thumb {
  transform: translateX(var(--acu-toggle-thumb-shift, 16px));
}

.acu-toggle__label { white-space: nowrap; }

.acu-toggle:hover:not(.acu-toggle--disabled) .acu-toggle__track {
  box-shadow: inset 0 0 0 1px var(--acu-border-2);
}

.acu-toggle:focus-visible .acu-toggle__track {
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}
</style>
