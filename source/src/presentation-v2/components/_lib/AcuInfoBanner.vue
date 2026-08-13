<template>
  <div :class="['acu-info-banner', `acu-info-banner--${tone}`]" role="note">
    <i v-if="iconClass" :class="['acu-info-banner__icon', iconClass]" aria-hidden="true"></i>
    <div class="acu-info-banner__content">
      <slot>{{ text }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type Tone = 'info' | 'tip' | 'warning';

const props = withDefaults(defineProps<{
  text?: string;
  tone?: Tone;
  icon?: string;
}>(), {
  text: '',
  tone: 'info',
  icon: undefined,
});

const iconClass = computed(() => {
  if (props.icon) return props.icon;
  return '';
});
</script>

<style scoped>
.acu-info-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--acu-space-250, 10px);
  padding: var(--acu-space-225, 9px) var(--acu-space-250, 10px);
  border-radius: var(--acu-radius-sm);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.55;
  background: color-mix(in srgb, var(--acu-text-3) 12%, transparent);
  color: var(--acu-text-2);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-text-3) 18%, transparent);
  min-width: 0;
}

.acu-info-banner__icon {
  flex-shrink: 0;
  margin-top: var(--acu-space-050, 2px);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.55;
}

.acu-info-banner__content {
  min-width: 0;
  width: 100%;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}

.acu-info-banner--info {
  background: color-mix(in srgb, var(--acu-text-3) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-text-3) 18%, transparent);
}
.acu-info-banner--info .acu-info-banner__icon {
  --acu-icon-color: var(--acu-text-3);
  color: var(--acu-text-3);
}

.acu-info-banner--tip {
  background: color-mix(in srgb, var(--acu-accent) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-accent) 18%, transparent);
}
.acu-info-banner--tip .acu-info-banner__icon {
  --acu-icon-color: var(--acu-accent);
  color: var(--acu-accent);
}

.acu-info-banner--warning {
  background: color-mix(in srgb, var(--acu-warning) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-warning) 20%, transparent);
}
.acu-info-banner--warning .acu-info-banner__icon {
  --acu-icon-color: var(--acu-warning);
  color: var(--acu-warning);
}
</style>
