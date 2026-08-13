<template>
  <component :is="as" class="acu-text" :class="variantClass">
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type AcuTextVariant =
  | 'caption'
  | 'meta'
  | 'hint'
  | 'status-line'
  | 'empty'
  | 'error'
  | 'section-label'
  | 'list-title';

const props = withDefaults(defineProps<{
  as?: string;
  variant?: AcuTextVariant;
}>(), {
  as: 'p',
  variant: 'meta',
});

const variantClass = computed(() => `acu-text--${props.variant}`);
</script>

<style scoped>
.acu-text {
  margin: 0;
  min-width: 0;
}

.acu-text--caption {
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
  color: var(--acu-text-3);
}

.acu-text--meta {
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.45);
  color: var(--acu-text-3);
}

.acu-text--hint {
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-readable, 1.55);
  color: var(--acu-text-3);
}

.acu-text--status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 22px;
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.45);
  color: var(--acu-text-3);
}

.acu-text--empty {
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: var(--acu-line-height-readable, 1.55);
  color: var(--acu-text-3);
  text-align: center;
}

.acu-text--error {
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.45);
  color: var(--acu-danger);
}

.acu-text--section-label {
  font-size: var(--acu-font-size-section-title, 12px);
  line-height: var(--acu-line-height-body, 1.45);
  font-weight: 600;
  color: var(--acu-text-2);
}

.acu-text--list-title {
  font-size: var(--acu-font-size-list-title, 13px);
  line-height: var(--acu-line-height-body, 1.45);
  font-weight: 500;
  color: var(--acu-text-1);
}

:deep(.acu-text__value) {
  color: var(--acu-text-1);
  font-weight: 500;
}
</style>
