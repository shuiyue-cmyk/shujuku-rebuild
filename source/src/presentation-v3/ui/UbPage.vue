<template>
  <div ref="root" class="ub-page" :class="{ 'ub-page--wide': wide }">
    <p v-if="lead" class="ub-page__lead">{{ lead }}</p>
    <nav v-if="sections && sections.length > 1" class="ub-page__jump" aria-label="页内跳转">
      <button
        v-for="item in sections"
        :key="item.id"
        type="button"
        class="ub-page__chip"
        @click="jumpTo(item.id)"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="ub-page__body">
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
export interface UbPageSection {
  id: string;
  label: string;
}
</script>

<script setup lang="ts">
/**
 * 页面骨架：一句话导语＋页内跳转胶囊＋单列内容。
 * 单列阅读比左右分栏更好扫，手机与桌面同一套顺序，不会出现"左列看完找右列"。
 */
import { ref } from 'vue';

withDefaults(defineProps<{
  lead?: string;
  sections?: UbPageSection[];
  wide?: boolean;
}>(), {
  lead: undefined,
  sections: undefined,
  wide: false,
});

const root = ref<HTMLElement | null>(null);

function jumpTo(id: string): void {
  const target = root.value?.ownerDocument.getElementById(id);
  if (!target) return;
  try {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    target.scrollIntoView();
  }
}
</script>

<style scoped>
.ub-page {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s4);
  width: 100%;
  max-width: var(--ub-page-max);
  min-width: 0;
  margin: 0 auto;
  padding: var(--ub-s2) var(--ub-page-pad) calc(var(--ub-s8) + var(--ub-safe-bottom));
}

.ub-page--wide {
  max-width: var(--ub-page-max-wide);
}

.ub-page__lead {
  margin: 0;
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  line-height: 1.65;
}

.ub-page__jump {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: var(--ub-s2);
  margin: 0 calc(var(--ub-page-pad) * -1);
  padding: var(--ub-s2) var(--ub-page-pad);
  overflow-x: auto;
  background: linear-gradient(var(--ub-bg) 78%, transparent);
  scrollbar-width: none;
}

.ub-page__jump::-webkit-scrollbar {
  display: none;
}

.ub-page__chip {
  flex: 0 0 auto;
  padding: var(--ub-s1) var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: 999px;
  background: var(--ub-panel);
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-xs);
  font-weight: 600;
  cursor: pointer;
  transition: color 0.14s ease, border-color 0.14s ease;
}

.ub-page__chip:hover {
  border-color: var(--ub-accent);
  color: var(--ub-accent-ink);
}

.ub-page__body {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s6);
  min-width: 0;
}
</style>
