<template>
  <nav class="ub-nav" :class="`ub-nav--${variant}`" aria-label="页面导航">
    <template v-for="group in router.groups" :key="group.id">
      <div v-if="(router.visiblePagesByGroup[group.id] || []).length" class="ub-nav__group">
        <div v-if="showGroupTitles" class="ub-nav__group-title">{{ group.title }}</div>
        <div class="ub-nav__items">
          <button
            v-for="page in router.visiblePagesByGroup[group.id]"
            :key="page.id"
            type="button"
            class="ub-nav__item"
            :class="{ 'is-active': page.id === router.activePageId }"
            :aria-current="page.id === router.activePageId ? 'page' : undefined"
            :data-page-id="page.id"
            @click="go(page.id)"
          >
            <span class="ub-nav__icon" aria-hidden="true"><i :class="iconOf(page.id)"></i></span>
            <span class="ub-nav__text">
              <span class="ub-nav__title">{{ page.title }}</span>
              <span v-if="variant === 'tiles'" class="ub-nav__blurb">{{ blurbOf(page.id) }}</span>
            </span>
          </button>
        </div>
      </div>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouterStore } from '../../presentation-v2/stores/router-store';
import { useUiModeStore } from '../../presentation-v2/stores/ui-mode-store';
import { ubPageEntry } from '../router/page-catalog';

const props = withDefaults(defineProps<{ variant?: 'rail' | 'tiles' }>(), { variant: 'rail' });
const emit = defineEmits<{ (e: 'navigate', pageId: string): void }>();

const router = useRouterStore();
const uiMode = useUiModeStore();
const showGroupTitles = computed(() => !uiMode.isBasicMode || props.variant === 'tiles');

function iconOf(id: string): string {
  return ubPageEntry(id)?.icon ?? 'fa-solid fa-circle';
}

function blurbOf(id: string): string {
  return ubPageEntry(id)?.blurb ?? '';
}

function go(id: string): void {
  router.setActivePage(id);
  emit('navigate', id);
}
</script>

<style scoped>
.ub-nav {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s4);
}

.ub-nav__group-title {
  margin: 0 var(--ub-s3) var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.ub-nav__items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ub-nav__item {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  width: 100%;
  min-height: calc(var(--ub-u) * 38);
  padding: var(--ub-s1) var(--ub-s3);
  border: 0;
  border-radius: var(--ub-r-control);
  background: transparent;
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.ub-nav__item:hover:not(.is-active) {
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-nav__item.is-active {
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-nav__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 20);
  font-size: var(--ub-fs-sm);
  opacity: 0.9;
}

.ub-nav__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ub-nav__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 平铺（手机目录）：两列卡片，带一句话说明 */
.ub-nav--tiles .ub-nav__items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ub-s2);
}

.ub-nav--tiles .ub-nav__item {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ub-s2);
  min-height: calc(var(--ub-u) * 96);
  padding: var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
}

.ub-nav--tiles .ub-nav__item.is-active {
  border-color: var(--ub-accent);
  background: var(--ub-accent-soft);
}

.ub-nav--tiles .ub-nav__icon {
  width: calc(var(--ub-u) * 32);
  height: calc(var(--ub-u) * 32);
  border-radius: 10px;
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-nav--tiles .ub-nav__title {
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  white-space: normal;
}

.ub-nav--tiles .ub-nav__blurb {
  display: -webkit-box;
  margin-top: 2px;
  overflow: hidden;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 500;
  line-height: 1.45;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
