<template>
  <label class="ub-check" :class="{ 'is-on': modelValue, 'is-disabled': disabled }" :title="title">
    <input
      type="checkbox"
      class="ub-check__native"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    >
    <span class="ub-check__box" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
    <span v-if="label || $slots.default" class="ub-check__label"><slot>{{ label }}</slot></span>
  </label>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean;
  label?: string;
  title?: string;
  disabled?: boolean;
}>(), {
  label: undefined,
  title: undefined,
  disabled: false,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();
</script>

<style scoped>
.ub-check {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--ub-s2);
  min-width: 0;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  line-height: 1.45;
  cursor: pointer;
  user-select: none;
}

.ub-check.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ub-check__native {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
}

.ub-check__box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 18);
  height: calc(var(--ub-u) * 18);
  margin-top: 1px;
  border: 1.5px solid var(--ub-line-strong);
  border-radius: calc(var(--ub-u) * 5);
  background: var(--ub-input-bg);
  color: transparent;
  font-size: calc(var(--ub-u) * 11);
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.ub-check.is-on .ub-check__box {
  border-color: var(--ub-accent);
  background: var(--ub-accent);
  color: var(--ub-on-accent);
}

.ub-check__native:focus-visible + .ub-check__box {
  outline: 2px solid var(--ub-accent);
  outline-offset: 2px;
}

.ub-check__label {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
