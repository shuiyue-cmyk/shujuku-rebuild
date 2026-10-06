<template>
  <div class="ub-disc" :class="{ 'is-open': expanded, 'ub-disc--flat': flat }">
    <button
      type="button"
      class="ub-disc__head"
      :aria-expanded="expanded ? 'true' : 'false'"
      :aria-controls="bodyId"
      @click="emit('toggle')"
    >
      <i class="fa-solid fa-chevron-right ub-disc__chevron" aria-hidden="true"></i>
      <span class="ub-disc__label">{{ label }}</span>
      <span v-if="meta" class="ub-disc__meta">{{ meta }}</span>
    </button>
    <div v-if="expanded" :id="bodyId" class="ub-disc__body" :style="maxHeight ? { maxHeight, overflowY: 'auto' } : undefined">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  meta?: string;
  expanded: boolean;
  bodyId?: string;
  maxHeight?: string;
  flat?: boolean;
}>(), {
  meta: undefined,
  bodyId: undefined,
  maxHeight: undefined,
  flat: false,
});

const emit = defineEmits<{ (e: 'toggle'): void }>();
</script>

<style scoped>
.ub-disc {
  min-width: 0;
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-panel);
}

.ub-disc--flat {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.ub-disc__head {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  width: 100%;
  min-height: var(--ub-control-h);
  padding: var(--ub-s2) var(--ub-s3);
  border: 0;
  background: transparent;
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.ub-disc__head:hover {
  background: var(--ub-hover);
}

.ub-disc__chevron {
  flex: 0 0 auto;
  color: var(--ub-text-3);
  font-size: 0.75em;
  transition: transform 0.16s ease;
}

.is-open > .ub-disc__head .ub-disc__chevron {
  transform: rotate(90deg);
}

.ub-disc__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-disc__meta {
  flex: 0 0 auto;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-weight: 500;
}

.ub-disc__body {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s1) var(--ub-s3) var(--ub-s3);
}
</style>
