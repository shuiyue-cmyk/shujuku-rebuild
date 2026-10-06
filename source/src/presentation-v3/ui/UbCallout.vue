<template>
  <div class="ub-callout" :class="`ub-callout--${kind}`" :role="kind === 'error' ? 'alert' : 'status'">
    <i :class="[iconClass, 'ub-callout__icon']" aria-hidden="true"></i>
    <div class="ub-callout__body"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  kind?: 'info' | 'success' | 'warning' | 'error';
}>(), {
  kind: 'info',
});

const iconClass = computed(() => ({
  info: 'fa-solid fa-circle-info',
  success: 'fa-solid fa-circle-check',
  warning: 'fa-solid fa-triangle-exclamation',
  error: 'fa-solid fa-circle-exclamation',
}[props.kind]));
</script>

<style scoped>
.ub-callout {
  display: flex;
  align-items: flex-start;
  gap: var(--ub-s2);
  min-width: 0;
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-callout__icon {
  flex: 0 0 auto;
  margin-top: 0.22em;
  color: var(--ub-text-3);
}

.ub-callout__body {
  min-width: 0;
  overflow-wrap: anywhere;
}

.ub-callout--success {
  background: var(--ub-ok-soft);
}

.ub-callout--success .ub-callout__icon {
  color: var(--ub-ok);
}

.ub-callout--warning {
  background: var(--ub-warn-soft);
  color: var(--ub-text);
}

.ub-callout--warning .ub-callout__icon {
  color: var(--ub-warn);
}

.ub-callout--error {
  background: var(--ub-danger-soft);
  color: var(--ub-text);
}

.ub-callout--error .ub-callout__icon {
  color: var(--ub-danger);
}
</style>
