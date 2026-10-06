<template>
  <button
    type="button"
    class="ub-icon-btn"
    :class="[`ub-icon-btn--${variant}`, `ub-icon-btn--${size}`]"
    :disabled="disabled"
    :title="title"
    :aria-label="ariaLabel || title"
  >
    <i :class="icon" aria-hidden="true"></i>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  icon: string;
  title?: string;
  ariaLabel?: string;
  variant?: 'default' | 'accent' | 'danger' | 'solid';
  size?: 'sm' | 'md';
  disabled?: boolean;
}>(), {
  title: undefined,
  ariaLabel: undefined,
  variant: 'default',
  size: 'md',
  disabled: false,
});
</script>

<style scoped>
.ub-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--ub-control-h);
  height: var(--ub-control-h);
  padding: 0;
  border: 0;
  border-radius: var(--ub-r-control);
  background: transparent;
  color: var(--ub-text-2);
  font-size: var(--ub-fs-md);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.ub-icon-btn:hover:not(:disabled) {
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-icon-btn:focus-visible {
  outline: 2px solid var(--ub-accent);
  outline-offset: 1px;
}

.ub-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ub-icon-btn--sm {
  width: var(--ub-control-h-sm);
  height: var(--ub-control-h-sm);
  font-size: var(--ub-fs-sm);
}

.ub-icon-btn--accent {
  color: var(--ub-accent-ink);
}

.ub-icon-btn--danger:hover:not(:disabled) {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-icon-btn--solid {
  border: 1px solid var(--ub-line);
  background: var(--ub-panel);
}
</style>
