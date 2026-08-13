<template>
  <span class="acu-badge" :class="variantClass">
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type AcuBadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const props = withDefaults(defineProps<{
  variant?: AcuBadgeVariant;
}>(), {
  variant: 'neutral',
});

const variantClass = computed(() => `acu-badge--${props.variant}`);
</script>

<style scoped>
.acu-badge {
  display: inline-flex; align-items: center;
  padding: var(--acu-space-050, 2px) var(--acu-space-2, 8px); border-radius: var(--acu-radius-sm);
  font-size: var(--acu-font-size-caption, 11px); font-weight: 500;
  white-space: nowrap; line-height: 1.6;
}

.acu-badge--neutral {
  background: color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  color: var(--acu-text-2);
}
.acu-badge--accent {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
}
.acu-badge--success,
.acu-badge--warning,
.acu-badge--danger {
  font-weight: 600;
}
.acu-badge--success {
  background: color-mix(in srgb, var(--acu-success) 16%, transparent);
  color: var(--acu-success);
}
.acu-badge--warning {
  background: color-mix(in srgb, var(--acu-warning) 16%, transparent);
  color: var(--acu-warning);
}
.acu-badge--danger {
  background: color-mix(in srgb, var(--acu-danger) 16%, transparent);
  color: var(--acu-danger);
}
</style>
