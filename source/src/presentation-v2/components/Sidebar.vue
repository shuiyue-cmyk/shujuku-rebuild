<template>
  <nav :class="['acu-v2-sidebar', `acu-v2-sidebar--${variant}`]" aria-label="一级页导航">
    <div class="acu-v2-sidebar__brand">
      <span class="acu-v2-sidebar__brand-mark" aria-hidden="true">SP</span>
      <span class="acu-v2-sidebar__brand-copy">
        <span class="acu-v2-sidebar__brand-title">SP·数据库 VIII</span>
        <span class="acu-v2-sidebar__brand-tag">新 UI · {{ uiMode.modeLabel }}</span>
      </span>
    </div>

    <button
      type="button"
      class="acu-v2-sidebar__mode"
      @click="toggleMode"
    >
      <i class="fa-solid fa-repeat" aria-hidden="true"></i>
      {{ uiMode.isBasicMode ? '切换到高手模式' : '返回基础模式' }}
    </button>

    <template v-for="group in router.groups" :key="group.id">
      <div
        v-if="(router.visiblePagesByGroup[group.id] || []).length"
        class="acu-v2-sidebar__group"
      >
        <div class="acu-v2-sidebar__group-title">{{ group.title }}</div>
        <button
          v-for="page in router.visiblePagesByGroup[group.id]"
          :key="page.id"
          type="button"
          :class="[
            'acu-v2-sidebar__item',
            page.id === router.activePageId ? 'acu-v2-sidebar__item--active' : '',
          ]"
          :aria-current="page.id === router.activePageId ? 'page' : undefined"
          :data-page-id="page.id"
          @click="setActivePage(page.id)"
        >
          {{ page.title }}
        </button>
      </div>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { useRouterStore } from '../stores/router-store';
import { useUiModeStore } from '../stores/ui-mode-store';

withDefaults(defineProps<{
  variant?: 'desktop' | 'drawer';
}>(), {
  variant: 'desktop',
});

const emit = defineEmits<{
  (event: 'navigate'): void;
}>();

const router = useRouterStore();
const uiMode = useUiModeStore();

function setActivePage(pageId: string): void {
  router.setActivePage(pageId);
  emit('navigate');
}

function toggleMode(): void {
  uiMode.toggleMode();
  router.ensureActiveVisible();
  emit('navigate');
}
</script>

<style scoped>
.acu-v2-sidebar {
  min-width: 0;
  min-height: 0;
  background: var(--acu-sidebar-bg);
  padding: var(--acu-space-6, 24px) var(--acu-space-3, 12px) var(--acu-panel-padding, 16px);
  overflow-y: auto;
}

.acu-v2-sidebar--desktop {
  width: var(--acu-sidebar-width, 220px);
  flex: 0 0 var(--acu-sidebar-width, 220px);
  border-right: 1px solid var(--acu-border-2);
}

.acu-v2-sidebar--drawer {
  width: 100%;
  flex: 1 1 auto;
}

.acu-v2-sidebar__brand {
  display: flex;
  align-items: center;
  gap: var(--acu-space-250, 10px);
  padding: var(--acu-space-1, 4px) var(--acu-space-1, 4px) var(--acu-space-5, 20px);
  margin-bottom: var(--acu-page-gap, 14px);
}

.acu-v2-sidebar__brand-mark {
  width: var(--acu-space-850, 34px);
  height: var(--acu-space-850, 34px);
  flex: 0 0 var(--acu-space-850, 34px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--acu-radius-md);
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.acu-v2-sidebar__brand-copy {
  min-width: 0;
  display: block;
}

.acu-v2-sidebar__brand-title {
  display: block;
  font-size: var(--acu-font-size-panel-title, 15px);
  line-height: 1.25;
  font-weight: 700;
  color: var(--acu-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-v2-sidebar__brand-tag {
  display: block;
  margin-top: var(--acu-space-075, 3px);
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
}

.acu-v2-sidebar__group {
  margin-bottom: var(--acu-panel-gap, 12px);
}

.acu-v2-sidebar__mode {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--acu-space-175, 7px);
  min-height: var(--acu-control-height-md, 32px);
  margin: 0 0 var(--acu-page-gap, 14px);
  padding: var(--acu-space-175, 7px) var(--acu-space-250, 10px);
  border: 1px solid var(--acu-border-2);
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-bg-1) 72%, transparent);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.acu-v2-sidebar__mode:hover {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
  border-color: var(--acu-border);
}

.acu-v2-sidebar__group-title {
  padding: var(--acu-space-175, 7px) var(--acu-space-3, 12px) var(--acu-space-150, 6px);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--acu-text-3);
  text-transform: uppercase;
}

.acu-v2-sidebar__item {
  display: block;
  width: 100%;
  padding: var(--acu-space-250, 10px) var(--acu-space-3, 12px);
  border: 0;
  background: transparent;
  text-align: left;
  font-size: var(--acu-font-size-body-lg, 13px);
  color: var(--acu-text-2);
  cursor: pointer;
  border-radius: var(--acu-radius-sm);
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.acu-v2-sidebar__item:not(.acu-v2-sidebar__item--active):hover {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

.acu-v2-sidebar__item--active {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-weight: 600;
}
</style>
