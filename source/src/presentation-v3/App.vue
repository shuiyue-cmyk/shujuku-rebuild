<template>
  <div class="ub-app" :data-ub-color-scheme="themeStore.activeTheme.colorScheme">
    <div id="ub-portal" class="ub-portal"></div>
    <div v-show="rootShell.isOpen" class="ub-shell">
      <VisualizerSurface v-if="visualizer.isActive" @close="closeApp" />
      <template v-else>
        <aside class="ub-rail">
          <div class="ub-brand">
            <span class="ub-brand__mark" aria-hidden="true">UB</span>
            <span class="ub-brand__text">
              <span class="ub-brand__name">UnbirthDB</span>
              <span class="ub-brand__tag">{{ uiMode.isBasicMode ? '基础模式' : '高手模式' }}</span>
            </span>
          </div>
          <div class="ub-rail__nav">
            <NavList />
          </div>
          <div class="ub-rail__foot">
            <button type="button" class="ub-rail__foot-btn" @click="toggleMode">
              <i class="fa-solid fa-repeat" aria-hidden="true"></i>
              {{ uiMode.isBasicMode ? '切换到高手模式' : '返回基础模式' }}
            </button>
            <button type="button" class="ub-rail__foot-btn" @click="appearanceOpen = true">
              <i class="fa-solid fa-palette" aria-hidden="true"></i>
              外观与界面
            </button>
          </div>
        </aside>

        <div class="ub-main">
          <header class="ub-top">
            <UbIconButton
              class="ub-top__menu"
              icon="fa-solid fa-grip"
              title="全部页面"
              :aria-expanded="launcherOpen ? 'true' : 'false'"
              @click="launcherOpen = true"
            />
            <div class="ub-top__titles">
              <h1 class="ub-top__title">
                <i v-if="activeEntry" :class="[activeEntry.icon, 'ub-top__icon']" aria-hidden="true"></i>
                {{ router.activePage?.title || 'UnbirthDB' }}
              </h1>
            </div>
            <UbIconButton icon="fa-solid fa-palette" title="外观与界面" @click="appearanceOpen = true" />
            <UbIconButton icon="fa-solid fa-xmark" title="关闭 UnbirthDB" @click="closeApp" />
          </header>

          <main ref="scroller" class="ub-scroll" data-ub-main>
            <component
              :is="activeEntry.component"
              v-if="activeEntry"
              :key="`${router.activePageId}:${rootShell.openRefreshTick}`"
            />
            <p v-else class="ub-scroll__empty">没有可显示的页面。</p>
          </main>
        </div>
      </template>

      <div
        v-if="launcherOpen"
        class="ub-launcher"
        data-tt-mobile-surface="backdrop"
        @click.self="launcherOpen = false"
      >
        <div class="ub-launcher__panel" role="dialog" aria-modal="true" aria-label="全部页面">
          <header class="ub-launcher__head">
            <div class="ub-brand">
              <span class="ub-brand__mark" aria-hidden="true">UB</span>
              <span class="ub-brand__text">
                <span class="ub-brand__name">UnbirthDB</span>
                <span class="ub-brand__tag">{{ uiMode.isBasicMode ? '基础模式' : '高手模式' }}</span>
              </span>
            </div>
            <UbIconButton icon="fa-solid fa-xmark" title="收起" @click="launcherOpen = false" />
          </header>
          <div class="ub-launcher__body">
            <NavList variant="tiles" @navigate="launcherOpen = false" />
          </div>
          <footer class="ub-launcher__foot">
            <UbButton icon="fa-solid fa-repeat" variant="soft" block @click="toggleMode">
              {{ uiMode.isBasicMode ? '切换到高手模式' : '返回基础模式' }}
            </UbButton>
          </footer>
        </div>
      </div>

      <AppearanceSheet :is-open="appearanceOpen" @close="appearanceOpen = false" />
      <UbDialogHost />
      <UbToastHost />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 新版界面外壳（v3）。
 * 状态全部放在 presentation-v2 的 Pinia store：路由、模式、主题、可视化编辑器、提示框、对话框。
 * 桌面：左侧导航栏；手机（≤760px）：顶栏＋全屏页面目录。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { acuRequestAnimationFrame } from '../presentation-v2/bootstrap/host-env';
import { useChatChangedListener } from '../presentation-v2/composables/useChatChangedListener';
import { useDevOptions } from '../presentation-v2/composables/useDevOptions';
import { useTemplateRuntimeChangeListener } from '../presentation-v2/composables/useTemplateRuntimeChangeListener';
import { canCloseUi } from '../presentation-v2/composables/useUiCloseGuard';
import { useRootShellStore } from '../presentation-v2/stores/root-shell-store';
import { useRouterStore } from '../presentation-v2/stores/router-store';
import { useThemeStore } from '../presentation-v2/stores/theme-store';
import { useToastStore } from '../presentation-v2/stores/toast-store';
import { useUiModeStore } from '../presentation-v2/stores/ui-mode-store';
import { useVisualizerStore } from '../presentation-v2/stores/visualizer-store';
import VisualizerSurface from './surfaces/VisualizerSurface.vue';
import { ubPageEntry } from './router/page-catalog';
import AppearanceSheet from './shell/AppearanceSheet.vue';
import NavList from './shell/NavList.vue';
import UbButton from './ui/UbButton.vue';
import UbDialogHost from './ui/UbDialogHost.vue';
import UbIconButton from './ui/UbIconButton.vue';
import UbToastHost from './ui/UbToastHost.vue';

const emit = defineEmits<{ (event: 'close'): void }>();

const rootShell = useRootShellStore();
const router = useRouterStore();
const uiMode = useUiModeStore();
const themeStore = useThemeStore();
const toastStore = useToastStore();
const visualizer = useVisualizerStore();
const devOptions = useDevOptions();

const launcherOpen = ref(false);
const appearanceOpen = ref(false);
const scroller = ref<HTMLElement | null>(null);

const activeEntry = computed(() => ubPageEntry(router.activePageId));

function toggleMode(): void {
  uiMode.toggleMode();
  router.ensureActiveVisible();
  launcherOpen.value = false;
}

async function closeApp(): Promise<void> {
  if (!(await canCloseUi())) return;
  launcherOpen.value = false;
  appearanceOpen.value = false;
  if (visualizer.isActive) {
    const result = visualizer.closeSurface();
    if (result.previousPageId) router.setActivePage(result.previousPageId);
    if (result.shouldCloseShell) emit('close');
    return;
  }
  emit('close');
}

function resetScroll(): void {
  const el = scroller.value;
  if (!el) return;
  try {
    el.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch { /* 不支持 instant 的内核走下面的同步复位 */ }
  el.scrollTop = 0;
  el.scrollLeft = 0;
}

function resetScrollSettled(): void {
  resetScroll();
  void nextTick(() => {
    resetScroll();
    acuRequestAnimationFrame(() => resetScroll());
  });
}

useChatChangedListener();
useTemplateRuntimeChangeListener();

onMounted(() => {
  rootShell.markMounted();
  router.ensureActiveVisible();
});

watch(() => devOptions.developerOptionsEnabled.value, () => router.ensureActiveVisible());
watch(() => uiMode.mode, () => router.ensureActiveVisible());
watch(() => rootShell.isOpen, (isOpen) => {
  if (!isOpen) {
    toastStore.clear();
    launcherOpen.value = false;
  }
});
watch(() => router.activePageId, resetScrollSettled);
watch(() => rootShell.openRefreshTick, resetScrollSettled);
watch(() => rootShell.scrollResetTick, resetScroll);
</script>

<style>
/* ── 挂载根 ── TT 移动端 geometry firewall 会把 fullscreen-window root（本元素）强制 position:fixed
   并形成层叠上下文；预置与 shell 同级的 z-index 保持整体层级不回退。非定位元素（桌面/原版 ST）忽略此声明。 */
#acu-app-v2 {
  z-index: 9000;
  box-sizing: border-box;
}

#acu-app-v2 button {
  appearance: none;
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;
}

#acu-app-v2 button:focus:not(:focus-visible) {
  outline: none;
  box-shadow: none;
}

/* ── 设计令牌：颜色取自当前主题，尺寸随"界面缩放"等比变化 ── */
.ub-app {
  --ub-u: calc(1px * var(--acu-ui-scale, 1));

  --ub-fs-2xs: calc(var(--ub-u) * 11);
  --ub-fs-xs: calc(var(--ub-u) * 12);
  --ub-fs-sm: calc(var(--ub-u) * 13.5);
  --ub-fs-md: calc(var(--ub-u) * 14.5);
  --ub-fs-lg: calc(var(--ub-u) * 16.5);
  --ub-fs-xl: calc(var(--ub-u) * 20);
  --ub-fs-2xl: calc(var(--ub-u) * 26);

  --ub-s1: calc(var(--ub-u) * 4);
  --ub-s2: calc(var(--ub-u) * 8);
  --ub-s3: calc(var(--ub-u) * 12);
  --ub-s4: calc(var(--ub-u) * 16);
  --ub-s5: calc(var(--ub-u) * 20);
  --ub-s6: calc(var(--ub-u) * 28);
  --ub-s8: calc(var(--ub-u) * 40);

  --ub-control-h: calc(var(--ub-u) * 36);
  --ub-control-h-sm: calc(var(--ub-u) * 28);
  --ub-rail-w: calc(var(--ub-u) * 244);
  --ub-page-pad: calc(var(--ub-u) * 28);
  --ub-page-max: calc(var(--ub-u) * 800);
  --ub-page-max-wide: calc(var(--ub-u) * 1180);

  --ub-r-card: max(var(--acu-radius-lg, 0px), 14px);
  --ub-r-control: max(var(--acu-radius-sm, 0px), 9px);

  --ub-bg: var(--acu-bg-0);
  --ub-panel: var(--acu-bg-1);
  --ub-sunken: color-mix(in srgb, var(--acu-bg-2) 70%, var(--acu-bg-0));
  --ub-nav-bg: var(--acu-sidebar-bg);
  --ub-input-bg: color-mix(in srgb, var(--acu-bg-0) 55%, var(--acu-bg-1));
  --ub-hover: var(--acu-hover-overlay);
  --ub-hover-strong: color-mix(in srgb, var(--acu-text-1) 7%, var(--acu-bg-1));
  --ub-line: var(--acu-border-2);
  --ub-line-soft: var(--acu-border);
  --ub-line-strong: color-mix(in srgb, var(--acu-text-3) 55%, transparent);
  --ub-text: var(--acu-text-1);
  --ub-text-2: var(--acu-text-2);
  --ub-text-3: var(--acu-text-3);
  --ub-accent: var(--acu-accent);
  --ub-accent-2: var(--acu-accent-2);
  --ub-accent-ink: color-mix(in srgb, var(--acu-accent) 82%, var(--acu-text-1));
  --ub-on-accent: var(--acu-on-accent);
  --ub-accent-soft: color-mix(in srgb, var(--acu-accent) 14%, transparent);
  --ub-accent-soft-2: color-mix(in srgb, var(--acu-accent) 24%, transparent);
  --ub-ok: var(--acu-success);
  --ub-ok-soft: color-mix(in srgb, var(--acu-success) 15%, transparent);
  --ub-warn: var(--acu-warning);
  --ub-warn-soft: color-mix(in srgb, var(--acu-warning) 16%, transparent);
  --ub-danger: var(--acu-danger);
  --ub-danger-soft: color-mix(in srgb, var(--acu-danger) 14%, transparent);
  --ub-switch-off: color-mix(in srgb, var(--acu-text-3) 42%, transparent);
  --ub-scrim: rgba(6, 8, 12, 0.52);
  --ub-toast-bg: color-mix(in srgb, var(--acu-bg-1) 94%, transparent);
  --ub-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  --ub-overlay-shadow: var(--acu-shadow);
  --ub-font: var(--acu-font-ui);
  --ub-mono: var(--acu-font-mono);

  /* TT Layout ABI：安全区绑定宿主 --tt-inset-*，底部并入键盘高度；原版宿主回退 0 */
  --ub-safe-top: max(env(safe-area-inset-top, 0px), var(--tt-inset-top, 0px));
  --ub-safe-right: max(env(safe-area-inset-right, 0px), var(--tt-inset-right, 0px));
  --ub-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px));
  --ub-safe-left: max(env(safe-area-inset-left, 0px), var(--tt-inset-left, 0px));

  color: var(--ub-text);
  font-family: var(--ub-font);
  font-size: var(--ub-fs-md);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.ub-app *,
.ub-app *::before,
.ub-app *::after {
  box-sizing: border-box;
}

.ub-app button {
  -webkit-tap-highlight-color: transparent;
}

.ub-app :where(h1, h2, h3, h4, p) {
  margin: 0;
}

@media (max-width: 760px) {
  .ub-app {
    --ub-page-pad: calc(var(--ub-u) * 16);
  }
}

@keyframes ub-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ub-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes ub-pop-in { from { opacity: 0; transform: translateY(6px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes ub-sheet-in-right { from { transform: translateX(100%); } to { transform: none; } }
@keyframes ub-sheet-out-right { from { transform: none; } to { transform: translateX(100%); } }
@keyframes ub-sheet-in-up { from { transform: translateY(100%); } to { transform: none; } }
@keyframes ub-sheet-out-down { from { transform: none; } to { transform: translateY(100%); } }
</style>

<style scoped>
.ub-shell {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  width: 100%;
  width: 100dvw;
  height: 100%;
  height: var(--tt-base-viewport-height, 100dvh);
  padding: var(--ub-safe-top) var(--ub-safe-right) var(--ub-safe-bottom) var(--ub-safe-left);
  overflow: hidden;
  background: var(--ub-bg);
}

.ub-rail {
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--ub-rail-w);
  width: var(--ub-rail-w);
  min-height: 0;
  padding: var(--ub-s5) var(--ub-s3) var(--ub-s3);
  border-right: 1px solid var(--ub-line-soft);
  background: var(--ub-nav-bg);
}

.ub-rail__nav {
  flex: 1 1 auto;
  min-height: 0;
  margin: var(--ub-s5) calc(var(--ub-s1) * -1) 0;
  padding: 0 var(--ub-s1);
  overflow-y: auto;
}

.ub-rail__foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--ub-s3);
  padding-top: var(--ub-s3);
  border-top: 1px solid var(--ub-line-soft);
}

.ub-rail__foot-btn {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  width: 100%;
  min-height: calc(var(--ub-u) * 34);
  padding: 0 var(--ub-s3);
  border: 0;
  border-radius: var(--ub-r-control);
  background: transparent;
  color: var(--ub-text-3);
  font: inherit;
  font-size: var(--ub-fs-xs);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.ub-rail__foot-btn:hover {
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-brand {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  min-width: 0;
  padding: 0 var(--ub-s2);
}

.ub-brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 36);
  height: calc(var(--ub-u) * 36);
  border-radius: 11px;
  background: linear-gradient(140deg, var(--ub-accent), color-mix(in srgb, var(--ub-accent) 55%, var(--ub-text)));
  color: var(--ub-on-accent);
  font-size: var(--ub-fs-xs);
  font-weight: 800;
  letter-spacing: 0.04em;
}

.ub-brand__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ub-brand__name {
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  font-weight: 800;
  letter-spacing: -0.01em;
}

.ub-brand__tag {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 600;
}

.ub-main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.ub-top {
  display: flex;
  align-items: center;
  gap: var(--ub-s1);
  flex: 0 0 auto;
  min-height: calc(var(--ub-u) * 60);
  padding: var(--ub-s2) var(--ub-s3) var(--ub-s2) var(--ub-page-pad);
}

.ub-top__menu {
  display: none;
}

.ub-top__titles {
  flex: 1 1 auto;
  min-width: 0;
}

.ub-top__title {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-2xl);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-top__icon {
  color: var(--ub-accent-ink);
  font-size: 0.72em;
}

.ub-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}

.ub-scroll__empty {
  padding: var(--ub-s6);
  color: var(--ub-text-3);
}

.ub-launcher {
  --ub-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px));
  position: fixed;
  inset: 0;
  z-index: 9200;
  display: flex;
  padding: var(--ub-safe-top) var(--ub-safe-right) var(--ub-safe-bottom) var(--ub-safe-left);
  background: var(--ub-scrim);
  animation: ub-fade-in 0.16s ease-out both;
}

.ub-launcher__panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--ub-bg);
  animation: ub-sheet-in-up 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.ub-launcher__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ub-s4) var(--ub-s3) var(--ub-s3) var(--ub-s3);
}

.ub-launcher__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--ub-s2) var(--ub-s4) var(--ub-s4);
  overflow-y: auto;
}

.ub-launcher__foot {
  padding: var(--ub-s3) var(--ub-s4) var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
}

@media (max-width: 760px) {
  .ub-rail {
    display: none;
  }

  .ub-top {
    min-height: calc(var(--ub-u) * 52);
    padding: var(--ub-s1) var(--ub-s2);
  }

  .ub-top__menu {
    display: inline-flex;
  }

  .ub-top__title {
    gap: var(--ub-s2);
    font-size: var(--ub-fs-xl);
  }
}
</style>
