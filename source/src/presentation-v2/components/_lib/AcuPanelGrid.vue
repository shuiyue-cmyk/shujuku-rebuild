<template>
  <div :class="['acu-panel-grid', `acu-panel-grid--collapse-${collapseAt}`]" :style="gridStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  columns?: number;
  collapseAt?: 'md' | 'lg';
}>(), {
  columns: 2,
  collapseAt: 'md',
});

const gridStyle = computed<Record<string, string>>(() => ({
  '--acu-panel-grid-columns': String(Math.max(1, Math.floor(props.columns))),
}));
</script>

<style scoped>
.acu-panel-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(var(--acu-panel-grid-columns), minmax(0, 1fr));
  gap: var(--acu-panel-grid-gap, 16px);
  align-items: stretch;
}

.acu-panel-grid > :deep(*) {
  min-width: 0;
}

@media (max-width: 860px) {
  .acu-panel-grid--collapse-md {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1080px) {
  .acu-panel-grid--collapse-lg {
    grid-template-columns: 1fr;
  }
}
</style>
