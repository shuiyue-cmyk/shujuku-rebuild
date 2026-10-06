<template>
  <button
    type="button"
    role="switch"
    class="ub-switch"
    :class="{ 'is-on': modelValue }"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="ariaLabel"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="ub-switch__thumb" aria-hidden="true"></span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}>(), {
  ariaLabel: undefined,
  disabled: false,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();
</script>

<style scoped>
.ub-switch {
  position: relative;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 44);
  height: calc(var(--ub-u) * 26);
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--ub-switch-off);
  cursor: pointer;
  transition: background 0.18s ease;
}

.ub-switch.is-on {
  background: var(--ub-accent);
}

.ub-switch:focus-visible {
  outline: 2px solid var(--ub-accent);
  outline-offset: 2px;
}

.ub-switch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ub-switch__thumb {
  position: absolute;
  top: calc(var(--ub-u) * 3);
  left: calc(var(--ub-u) * 3);
  width: calc(var(--ub-u) * 20);
  height: calc(var(--ub-u) * 20);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  transition: transform 0.18s cubic-bezier(0.3, 0.7, 0.4, 1.2);
}

.ub-switch.is-on .ub-switch__thumb {
  transform: translateX(calc(var(--ub-u) * 18));
}
</style>
