<template>
  <section class="acu-panel">
    <header
      v-if="title || $slots.title || $slots.actions || hasDescription"
      class="acu-panel__header"
      :class="{ 'acu-panel__header--description-open': descriptionOpen }"
    >
      <h3 v-if="title || $slots.title" class="acu-panel__title">
        <slot name="title">{{ title }}</slot>
      </h3>
      <div v-if="$slots.actions || hasDescription" class="acu-panel__header-right">
        <div v-if="$slots.actions" class="acu-panel__actions">
          <slot name="actions" />
        </div>
        <AcuIconButton
          v-if="hasDescription"
          class="acu-panel__description-button"
          :class="{ 'acu-panel__description-button--open': descriptionOpen }"
          icon="fa-solid fa-circle-info"
          :aria-expanded="descriptionOpen"
          :aria-controls="descriptionId"
          :title="descriptionOpen ? '收起说明' : '展开说明'"
          :aria-label="descriptionOpen ? '收起说明' : '展开说明'"
          @click="toggleDescription"
        />
      </div>
    </header>
    <Transition
      :css="false"
      @before-enter="beforeDescriptionEnter"
      @enter="descriptionEnter"
      @after-enter="afterDescriptionEnter"
      @enter-cancelled="cleanupDescriptionTransition"
      @before-leave="beforeDescriptionLeave"
      @leave="descriptionLeave"
      @after-leave="afterDescriptionLeave"
      @leave-cancelled="cleanupDescriptionTransition"
    >
      <div
        v-if="hasDescription"
        v-show="descriptionOpen"
        :id="descriptionId"
        class="acu-panel__description-region"
        :aria-hidden="!descriptionOpen"
      >
        <div class="acu-panel__description-region-inner">
          <AcuInfoBanner class="acu-panel__description-banner" :tone="descriptionTone">
            <slot name="description">{{ description }}</slot>
          </AcuInfoBanner>
        </div>
      </div>
    </Transition>
    <div class="acu-panel__body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId, useSlots } from 'vue';
import AcuIconButton from './AcuIconButton.vue';
import AcuInfoBanner from './AcuInfoBanner.vue';
import { useAcuHeightTransition } from './useAcuHeightTransition';

const props = withDefaults(defineProps<{
  title?: string;
  description?: string;
  descriptionTone?: 'info' | 'tip' | 'warning';
}>(), {
  title: undefined,
  description: undefined,
  descriptionTone: 'info',
});

const slots = useSlots();
const descriptionOpen = ref(false);
const descriptionId = useId();
const hasDescriptionSlot = typeof slots.description === 'function';
const hasDescription = computed(() => Boolean(props.description) || hasDescriptionSlot);
const descriptionTransition = useAcuHeightTransition({
  collapsedTransform: 'none',
  expandedTransform: 'none',
});

const emit = defineEmits<{
  (e: 'description-toggle', open: boolean): void;
}>();

function toggleDescription(): void {
  descriptionOpen.value = !descriptionOpen.value;
  emit('description-toggle', descriptionOpen.value);
}

function beforeDescriptionEnter(el: Element): void {
  descriptionTransition.beforeEnter(el);
}

function descriptionEnter(el: Element, done: () => void): void {
  descriptionTransition.enter(el, done);
}

function afterDescriptionEnter(el: Element): void {
  descriptionTransition.afterEnter(el);
}

function beforeDescriptionLeave(el: Element): void {
  descriptionTransition.beforeLeave(el);
}

function descriptionLeave(el: Element, done: () => void): void {
  descriptionTransition.leave(el, done);
}

function afterDescriptionLeave(el: Element): void {
  descriptionTransition.afterLeave(el);
}

function cleanupDescriptionTransition(el: Element): void {
  descriptionTransition.cleanupTransition(el);
}
</script>

<style scoped>
.acu-panel {
  min-width: 0; padding: var(--acu-panel-padding, 16px);
  background: var(--acu-bg-1);
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-md);
  display: flex; flex-direction: column; gap: 0;
  height: 100%;
}
.acu-panel__header {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--acu-panel-gap, 12px); margin-bottom: var(--acu-panel-gap, 12px);
  min-height: var(--acu-control-height-md, 32px);
  transition: margin-bottom 0.15s ease;
}
.acu-panel__header--description-open {
  margin-bottom: var(--acu-space-2, 8px);
}
.acu-panel__title {
  margin: 0;
  min-width: 0;
  flex: 1 1 auto;
  font-size: var(--acu-font-size-panel-title, 15px);
  line-height: 1.3;
  color: var(--acu-text-1);
}
.acu-panel__header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--acu-space-2, 8px);
  flex-shrink: 0;
}
.acu-panel__actions { display: flex; align-items: center; gap: var(--acu-space-2, 8px); flex-shrink: 0; }
.acu-panel__description-button {
  width: var(--acu-button-height-sm, 28px);
  height: var(--acu-button-height-sm, 28px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: transparent;
  color: var(--acu-text-3);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.acu-panel__description-button:hover {
  background: var(--acu-bg-2);
  color: var(--acu-text-1);
}
.acu-panel__description-button--open {
  background: color-mix(in srgb, var(--acu-text-3) 12%, transparent);
  color: var(--acu-text-1);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-text-3) 18%, transparent);
}
.acu-panel__description-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}
.acu-panel__body { display: flex; flex-direction: column; gap: var(--acu-panel-gap, 12px); min-width: 0; flex: 1 1 auto; }
.acu-panel__description-region {
  min-width: 0;
  overflow: hidden;
}
.acu-panel__description-region-inner {
  padding-bottom: var(--acu-panel-gap, 12px);
  overflow: hidden;
}
</style>
