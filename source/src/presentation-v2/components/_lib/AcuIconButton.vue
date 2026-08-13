<template>
  <button
    type="button"
    :disabled="disabled"
    :title="title"
    :aria-label="ariaLabel || title"
    class="acu-icon-btn"
    :class="[`acu-icon-btn--${variant}`, `acu-icon-btn--${size}`]"
    @click="$emit('click', $event)"
  >
    <i :class="icon"></i>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  icon: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  variant?: 'default' | 'danger' | 'accent';
  size?: 'md' | 'sm';
}>(), {
  title: undefined,
  ariaLabel: undefined,
  disabled: false,
  variant: 'default',
  size: 'md',
});

defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();
</script>

<style scoped>
.acu-icon-btn {
  --acu-icon-btn-size: var(--acu-icon-button-size-md, 32px);
  --acu-icon-btn-font-size: var(--acu-icon-inline-md, 13px);
  appearance: none !important;
  -webkit-appearance: none !important;
  flex: 0 0 auto;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: var(--acu-icon-btn-size) !important;
  min-width: var(--acu-icon-btn-size) !important;
  max-width: var(--acu-icon-btn-size) !important;
  height: var(--acu-icon-btn-size) !important;
  min-height: var(--acu-icon-btn-size) !important;
  max-height: var(--acu-icon-btn-size) !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  color: var(--acu-text-2) !important;
  border-radius: var(--acu-radius-sm) !important;
  cursor: pointer;
  font: inherit !important;
  font-size: var(--acu-icon-btn-font-size) !important;
  line-height: 1 !important;
  text-align: center !important;
  vertical-align: middle !important;
  box-shadow: none !important;
  outline: none !important;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.acu-icon-btn > i {
  flex: 0 0 auto !important;
  display: inline-block !important;
  width: 1em !important;
  min-width: 1em !important;
  height: 1em !important;
  min-height: 1em !important;
  color: inherit !important;
  font-size: inherit !important;
  line-height: 1 !important;
  text-align: center !important;
  vertical-align: -0.125em !important;
}

.acu-icon-btn > i::before {
  display: block !important;
  width: 1em !important;
  height: 1em !important;
  color: inherit !important;
  font-size: inherit !important;
  line-height: 1 !important;
}

.acu-icon-btn--md {
  --acu-icon-btn-size: var(--acu-icon-button-size-md, 32px);
  --acu-icon-btn-font-size: var(--acu-icon-inline-md, 13px);
}

.acu-icon-btn--sm {
  --acu-icon-btn-size: var(--acu-icon-button-size-sm, 22px);
  --acu-icon-btn-font-size: var(--acu-icon-inline-sm, 10px);
  background: var(--acu-bg-2) !important;
}

.acu-icon-btn--default:hover:not(:disabled) {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), var(--acu-bg-2) !important;
  color: var(--acu-text-1) !important;
}

.acu-icon-btn--danger:hover:not(:disabled) {
  color: var(--acu-danger) !important;
  background: color-mix(in srgb, var(--acu-danger) 12%, transparent) !important;
}

.acu-icon-btn--accent {
  background: var(--acu-bg-2) !important;
  color: var(--acu-text-1) !important;
}
.acu-icon-btn--accent:hover:not(:disabled) {
  background: var(--acu-accent-glow) !important; color: var(--acu-accent) !important;
}

.acu-icon-btn:focus-visible {
  outline: none !important;
  box-shadow: 0 0 0 2px var(--acu-accent-glow) !important;
}

.acu-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
