<template>
  <span class="ub-badge" :class="`ub-badge--${variant}`"><slot /></span>
</template>

<script lang="ts">
export type UbBadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
</script>

<script setup lang="ts">
withDefaults(defineProps<{ variant?: UbBadgeVariant }>(), { variant: 'neutral' });
</script>

<style scoped>
.ub-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  flex: 0 0 auto;
  max-width: 100%;
  padding: 0.2em 0.65em;
  border-radius: 999px;
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ub-badge--accent {
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-badge--success {
  background: var(--ub-ok-soft);
  color: var(--ub-ok);
}

.ub-badge--warning {
  background: var(--ub-warn-soft);
  color: var(--ub-warn);
}

.ub-badge--danger {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}
</style>
