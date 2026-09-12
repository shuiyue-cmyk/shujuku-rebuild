<template>
  <main ref="containerRef" class="acu-v2-main" data-acu-main>
    <component
      v-if="router.activePage"
      :is="router.activePage.component"
      :key="`${router.activePageId}:${shell.openRefreshTick}`"
    />
    <p v-else class="acu-v2-main__empty">没有可显示的页面（路由 store 异常）</p>
  </main>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from 'vue';
import { useRouterStore } from '../stores/router-store';
import { useRootShellStore } from '../stores/root-shell-store';
import { acuRequestAnimationFrame } from '../bootstrap/host-env';

const router = useRouterStore();
const shell = useRootShellStore();
const containerRef = ref<HTMLElement | null>(null);

function resetScroll() {
  const el = containerRef.value;
  if (!el) return;
  // 先断在飞的 smooth 滚动动画（面板导航的 scrollTo smooth / 手指 momentum）：
  // 直接 scrollTop=0 杀不掉它们，新页会被拖回旧位置而错位。
  try {
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  } catch { /* 无 instant 形态的引擎走下面同步复位 */ }
  el.scrollTop = 0;
  el.scrollLeft = 0;
}

function resetScrollSettled() {
  resetScroll();
  // remount/异步挂载后内容高度变化，再断言一次顶部。
  void nextTick(() => {
    resetScroll();
    acuRequestAnimationFrame(() => resetScroll());
  });
}

onMounted(resetScroll);
// 切页 / 重开 remount 时重置滚动；mount 模块在 close 时也会触发 requestScrollReset
watch(() => router.activePageId, resetScrollSettled);
watch(() => shell.openRefreshTick, resetScrollSettled);
watch(() => shell.scrollResetTick, resetScroll);
</script>

<style scoped>
.acu-v2-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  background: var(--acu-bg-0);
  color: var(--acu-text-1);
}

.acu-v2-main :deep(.acu-v2-dashboard-page),
.acu-v2-main :deep(.acu-v2-advanced-tools-page),
.acu-v2-main :deep(.acu-v2-basic-config-page),
.acu-v2-main :deep(.acu-v2-form-fill-page),
.acu-v2-main :deep(.acu-v2-api-page),
.acu-v2-main :deep(.acu-v2-content-replace-page),
.acu-v2-main :deep(.acu-v2-data-mgmt-page),
.acu-v2-main :deep(.acu-v2-developer-page),
.acu-v2-main :deep(.acu-v2-plot-page),
.acu-v2-main :deep(.acu-v2-table-page),
.acu-v2-main :deep(.acu-v2-vector-index-page) {
  padding: var(--acu-page-padding, 20px);
  gap: var(--acu-page-gap, 14px);
}

.acu-v2-main__empty {
  padding: var(--acu-space-6, 24px);
  font-size: var(--acu-font-size-body-lg, 13px);
  color: var(--acu-text-3);
}

@media (max-width: 720px) {
  .acu-v2-main :deep(.acu-v2-dashboard-page),
  .acu-v2-main :deep(.acu-v2-advanced-tools-page),
  .acu-v2-main :deep(.acu-v2-basic-config-page),
  .acu-v2-main :deep(.acu-v2-form-fill-page),
  .acu-v2-main :deep(.acu-v2-api-page),
  .acu-v2-main :deep(.acu-v2-import-page),
  .acu-v2-main :deep(.acu-v2-content-replace-page),
  .acu-v2-main :deep(.acu-v2-data-mgmt-page),
  .acu-v2-main :deep(.acu-v2-developer-page),
  .acu-v2-main :deep(.acu-v2-plot-page),
  .acu-v2-main :deep(.acu-v2-table-page),
  .acu-v2-main :deep(.acu-v2-vector-index-page) {
    padding: var(--acu-page-padding-compact, 14px);
  }
}
</style>
