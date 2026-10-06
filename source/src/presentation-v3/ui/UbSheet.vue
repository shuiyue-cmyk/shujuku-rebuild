<template>
  <Teleport defer to="#ub-portal">
    <div
      v-if="rendered"
      class="ub-sheet-layer"
      data-tt-mobile-surface="backdrop"
      :class="{ 'is-closing': closing }"
      @click.self="requestClose"
      @keydown.esc.stop="requestClose"
    >
      <aside
        class="ub-sheet"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        :style="{ '--ub-sheet-width': width }"
        @click.stop
      >
        <header class="ub-sheet__head">
          <UbIconButton v-if="showBack" icon="fa-solid fa-arrow-left" title="返回" @click="requestBack" />
          <div class="ub-sheet__titles">
            <h3 class="ub-sheet__title">{{ title }}</h3>
            <p v-if="subtitle" class="ub-sheet__subtitle">{{ subtitle }}</p>
          </div>
          <slot name="head-actions" />
          <UbIconButton icon="fa-solid fa-xmark" title="关闭" @click="requestClose" />
        </header>
        <div class="ub-sheet__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="ub-sheet__foot">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 侧滑面板：桌面从右侧滑入，手机占满全屏自下而上。
 * beforeClose 返回 false 可拦截关闭（未保存修改确认）。
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from '../../presentation-v2/bootstrap/host-env';
import UbIconButton from './UbIconButton.vue';

const props = withDefaults(defineProps<{
  isOpen: boolean;
  title: string;
  subtitle?: string;
  width?: string;
  showBack?: boolean;
  beforeClose?: () => boolean | Promise<boolean>;
}>(), {
  subtitle: undefined,
  width: '560px',
  showBack: false,
  beforeClose: undefined,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'back'): void;
}>();

const LEAVE_MS = 180;
const rendered = ref(false);
const closing = ref(false);
let guardPending = false;
let leaveTimer: AcuTimerHandle | undefined;

watch(() => props.isOpen, (open) => {
  acuClearTimeout(leaveTimer);
  if (open) {
    rendered.value = true;
    closing.value = false;
    return;
  }
  if (!rendered.value) return;
  closing.value = true;
  leaveTimer = acuSetTimeout(() => {
    rendered.value = false;
    closing.value = false;
  }, LEAVE_MS);
}, { immediate: true });

onBeforeUnmount(() => acuClearTimeout(leaveTimer));

async function passGuard(): Promise<boolean> {
  if (!props.beforeClose) return true;
  return await props.beforeClose();
}

async function requestClose(): Promise<void> {
  if (closing.value || guardPending) return;
  guardPending = true;
  try {
    if (await passGuard()) emit('close');
  } finally {
    guardPending = false;
  }
}

async function requestBack(): Promise<void> {
  if (closing.value || guardPending) return;
  guardPending = true;
  try {
    if (await passGuard()) emit('back');
  } finally {
    guardPending = false;
  }
}
</script>

<style scoped>
.ub-sheet-layer {
  --ub-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px));
  position: fixed;
  inset: 0;
  z-index: 9300;
  display: flex;
  justify-content: flex-end;
  padding: var(--ub-safe-top) var(--ub-safe-right) var(--ub-safe-bottom) var(--ub-safe-left);
  background: var(--ub-scrim);
  animation: ub-fade-in 0.18s ease-out both;
}

.ub-sheet-layer.is-closing {
  animation: ub-fade-out 0.18s ease-in both;
}

.ub-sheet {
  display: flex;
  flex-direction: column;
  width: min(var(--ub-sheet-width), 100%);
  height: 100%;
  min-height: 0;
  background: var(--ub-bg);
  box-shadow: var(--ub-overlay-shadow);
  animation: ub-sheet-in-right 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.is-closing .ub-sheet {
  animation: ub-sheet-out-right 0.18s ease-in both;
}

.ub-sheet__head {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s3) var(--ub-s3) var(--ub-s5);
  border-bottom: 1px solid var(--ub-line-soft);
}

.ub-sheet__titles {
  flex: 1 1 auto;
  min-width: 0;
}

.ub-sheet__title {
  margin: 0;
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-lg);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-sheet__subtitle {
  margin: 2px 0 0;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-sheet__body {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s4);
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--ub-s5);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ub-sheet__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--ub-s2);
  flex-wrap: wrap;
  padding: var(--ub-s3) var(--ub-s5);
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-panel);
}

@media (max-width: 760px) {
  .ub-sheet {
    width: 100%;
    animation-name: ub-sheet-in-up;
  }

  .is-closing .ub-sheet {
    animation-name: ub-sheet-out-down;
  }

  .ub-sheet__head {
    padding-left: var(--ub-s4);
  }

  .ub-sheet__body {
    padding: var(--ub-s4);
  }

  .ub-sheet__foot {
    padding: var(--ub-s3) var(--ub-s4);
  }
}
</style>
