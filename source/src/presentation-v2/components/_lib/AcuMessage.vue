<template>
  <div v-if="visible" :class="['acu-message', `acu-message--${kind}`]" role="status">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type Kind = 'info' | 'success' | 'warning' | 'error';

const props = withDefaults(defineProps<{
  kind?: Kind;
  visible?: boolean;
}>(), {
  kind: 'info',
  visible: true,
});

const visible = computed(() => props.visible);
</script>

<style scoped>
.acu-message {
  padding: 8px 0 8px 10px;
  border-radius: 0;
  font-size: var(--acu-font-size-body, 12px);
  border: 0;
  border-left: 2px solid color-mix(in srgb, var(--acu-text-3) 28%, transparent);
  line-height: 1.5;
  background: transparent;
  color: var(--acu-text-2);
}
.acu-message--info {
  border-left-color: color-mix(in srgb, var(--acu-text-3) 28%, transparent);
}
.acu-message--success {
  border-left-color: var(--acu-success);
}
.acu-message--warning {
  border-left-color: var(--acu-warning);
}
.acu-message--error {
  border-left-color: var(--acu-danger);
}
</style>
