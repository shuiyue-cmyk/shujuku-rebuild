<template>
  <div
    v-if="isRendered"
    class="acu-v2-drawer-layer"
    data-tt-mobile-surface="backdrop"
    :class="{ 'is-closing': isClosing }"
    @click.self="requestClose"
    @pointerdown.self="requestClose"
    @touchstart.self="requestClose"
  >
    <aside
      class="acu-v2-drawer"
      :style="{ width: resolvedWidth }"
      aria-modal="true"
      role="dialog"
      @click.stop
    >
      <header class="acu-v2-drawer__header">
        <div class="acu-v2-drawer__header-left">
          <AcuIconButton
            v-if="showBack"
            icon="fa-solid fa-arrow-left"
            title="返回"
            @click="requestBack"
          />
          <h3>{{ title }}</h3>
        </div>
        <AcuIconButton icon="fa-solid fa-xmark" aria-label="关闭" title="关闭" @click="requestClose" />
      </header>
      <div class="acu-v2-drawer__body">
        <slot />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from '../../bootstrap/host-env';
import AcuIconButton from './AcuIconButton.vue';

const props = withDefaults(defineProps<{
  isOpen: boolean;
  title: string;
  showBack?: boolean;
  width?: string;
  /** Return false (or a Promise resolving to false) to prevent close. */
  beforeClose?: () => boolean | Promise<boolean>;
}>(), {
  showBack: false,
  width: 'var(--acu-drawer-width, 480px)',
  beforeClose: undefined,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'back'): void;
}>();

const resolvedWidth = computed(() => props.width);
const isRendered = ref(false);
const isClosing = ref(false);
const closeGuardPending = ref(false);
const DRAWER_LEAVE_MS = 150;
let closeTimer: AcuTimerHandle | undefined;

watch(() => props.isOpen, (open) => {
  if (open) showDrawer();
  else hideDrawer();
}, { immediate: true });

onBeforeUnmount(clearCloseTimer);

async function guard(): Promise<boolean> {
  if (!props.beforeClose) return true;
  const result = props.beforeClose();
  return result instanceof Promise ? result : result;
}

async function requestClose(): Promise<void> {
  if (isClosing.value || closeGuardPending.value) return;
  closeGuardPending.value = true;
  try {
    if (await guard()) emit('close');
  } finally {
    closeGuardPending.value = false;
  }
}

async function requestBack(): Promise<void> {
  if (isClosing.value || closeGuardPending.value) return;
  closeGuardPending.value = true;
  try {
    if (await guard()) emit('back');
  } finally {
    closeGuardPending.value = false;
  }
}

function showDrawer(): void {
  clearCloseTimer();
  isRendered.value = true;
  isClosing.value = false;
}

function hideDrawer(): void {
  if (!isRendered.value) return;
  isClosing.value = true;
  clearCloseTimer();
  closeTimer = acuSetTimeout(() => {
    isRendered.value = false;
    isClosing.value = false;
    closeTimer = undefined;
  }, DRAWER_LEAVE_MS);
}

function clearCloseTimer(): void {
  if (closeTimer === undefined) return;
  acuClearTimeout(closeTimer);
  closeTimer = undefined;
}
</script>

<style scoped>
.acu-v2-drawer-layer {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; inset: 0; z-index: 9200;
  width: 100%; width: 100vw; width: 100dvw;
  height: 100%; height: var(--tt-base-viewport-height, 100vh); height: var(--tt-base-viewport-height, 100dvh);
  display: flex; justify-content: flex-end;
  /* TT Android IME 键盘避让（必须在本层就地重算，不能靠继承）：
     本层标 data-tt-mobile-surface="backdrop"。宿主 resolveImeSurfaceRoot 只有在打标值 ===
     fullscreen-window 时才把该层当 IME root（它的第一分支是 #sheld，我们不在其中），backdrop 会一路
     落到兜底分支——只看属性存在、不看值——把「最近的打标祖先」也就是本层选成 IME root
     （mobile-ime-surface-controller.js:116-152）；原生侧随后把 --tt-ime-bottom **inline 写到本元素**，
     并从上一个 target removeProperty（WebViewInsetsStyleApplier.kt applyImeBottom）⇒ 该变量是 surface-local。
     而 --acu-safe-bottom 原本只声明在 #acu-app-v2（App.vue）：CSS 自定义属性在声明处完成替换、
     后代只继承算好的值，于是本层拿到的 bottom 永远不含键盘高度，抽屉里的提示词编辑区被键盘遮住；
     宿主也救不了——bottom 钳制那条规则硬绑 fullscreen-window（mobile-geometry-firewall.js:390），
     通用规则只给 scroll-padding-bottom（:339-344），而本层 overflow:hidden、真正滚动的是 __body。
     桌面 TT / 原版 ST 下两个宿主变量都不存在，max() 退化成 env() 与 0px，取值与继承来的完全一致。 */
  --acu-native-safe-bottom: max(var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px), 0px);
  --acu-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--acu-native-safe-bottom, 0px));
  padding: var(--acu-safe-top, 0px) var(--acu-safe-right, 0px) var(--acu-safe-bottom, 0px) var(--acu-safe-left, 0px);
  background: rgba(0, 0, 0, 0.38);
  overflow: hidden;
  animation: acu-drawer-layer-in 0.18s ease-out both;
}

.acu-v2-drawer-layer.is-closing {
  pointer-events: none;
  animation: acu-drawer-layer-out 0.15s ease-in both;
}

.acu-v2-drawer {
  max-width: 100%;
  height: 100%; max-height: 100%;
  display: flex; flex-direction: column;
  background: var(--acu-bg-1);
  border-left: 0;
  box-shadow: var(--acu-shadow);
  min-width: 0; min-height: 0;
  overflow: hidden;
  animation: acu-drawer-panel-in 0.18s ease-out both;
}

.acu-v2-drawer-layer.is-closing .acu-v2-drawer {
  animation: acu-drawer-panel-out 0.15s ease-in both;
}

@supports (max-height: 100dvh) {
  .acu-v2-drawer { max-height: 100%; }
}

.acu-v2-drawer__header {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  min-width: 0;
  gap: var(--acu-panel-gap, 12px); padding: var(--acu-page-gap, 14px) var(--acu-panel-padding, 16px);
  border-bottom: 0;
}

.acu-v2-drawer__header-left { display: flex; align-items: center; gap: var(--acu-space-250, 10px); min-width: 0; }
.acu-v2-drawer__header h3 { margin: 0; min-width: 0; font-size: var(--acu-font-size-panel-title, 15px); overflow-wrap: anywhere; }

.acu-v2-drawer__body {
  flex: 1; min-height: 0;
  min-width: 0; overflow-y: auto; overflow-x: hidden; padding: var(--acu-panel-padding, 16px);
  display: flex; flex-direction: column; gap: var(--acu-page-gap, 14px);
}

@keyframes acu-drawer-layer-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes acu-drawer-panel-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes acu-drawer-layer-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes acu-drawer-panel-out {
  from { transform: translateX(0); }
  to { transform: translateX(100%); }
}

@media (max-width: 860px) {
  .acu-v2-drawer { width: 100vw !important; max-width: 100vw; border-left: 0; }
}
</style>
