<template>
  <div class="acu-form-row">
    <span v-if="label" class="acu-form-row__label">{{ label }}</span>
    <slot />
    <span v-if="hint" class="acu-form-row__hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label?: string;
  hint?: string;
}>();
</script>

<style scoped>
.acu-form-row {
  display: flex; flex-direction: column; gap: var(--acu-space-125, 5px);
  color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px);
  min-width: 0;
}
.acu-form-row__label { font-weight: 500; }
.acu-form-row__hint { color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); line-height: var(--acu-line-height-caption, 1.5); }

.acu-form-row :deep(input[type="text"]),
.acu-form-row :deep(input[type="password"]),
.acu-form-row :deep(input[type="number"]),
.acu-form-row :deep(select),
.acu-form-row :deep(textarea) {
  min-width: 0; min-height: var(--acu-control-height-md, 32px); padding: var(--acu-control-padding-y-md, 6px) var(--acu-control-padding-x-md, 9px);
  border: 0 !important;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2) !important;
  color: var(--acu-text-1) !important;
  font: inherit;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.acu-form-row :deep(textarea) {
  min-height: unset;
  resize: none;
}
.acu-form-row :deep(select) {
  appearance: none;
  -webkit-appearance: none;
  padding-right: var(--acu-space-7, 28px);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b7280' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: right var(--acu-control-padding-x-md, 9px) center !important;
  background-size: var(--acu-space-250, 10px) var(--acu-space-150, 6px) !important;
  cursor: pointer;
}
.acu-form-row :deep(input:focus),
.acu-form-row :deep(select:focus),
.acu-form-row :deep(textarea:focus) {
  outline: none;
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}
</style>
