<template>
  <Teleport v-if="portalTarget" :to="portalTarget">
    <div
      v-if="renderedItems.length"
      class="acu-toast-viewport"
      role="status"
      aria-label="通知"
      :style="{ zIndex: 9410 }"
    >
      <ol class="acu-toast-viewport__list">
        <li
          v-for="entry in renderedItems"
          :key="entry.item.id"
          :class="[
            'acu-v2-toast',
            `acu-v2-toast--${entry.item.kind}`,
            { 'is-closing': entry.isClosing },
          ]"
          :role="entry.item.kind === 'error' ? 'alert' : 'status'"
        >
          <span class="acu-v2-toast__icon" aria-hidden="true">
            <i :class="iconForKind(entry.item.kind)"></i>
          </span>
          <p class="acu-v2-toast__text">{{ entry.item.text }}</p>
          <AcuButton
            v-if="entry.item.action"
            class="acu-v2-toast__action"
            size="sm"
            :variant="entry.item.action.variant || 'default'"
            @click="runAction(entry.item)"
          >
            {{ entry.item.action.label }}
          </AcuButton>
          <AcuIconButton
            v-if="entry.item.dismissible"
            class="acu-v2-toast__dismiss"
            icon="fa-solid fa-xmark"
            size="sm"
            title="关闭通知"
            @click="toast.dismiss(entry.item.id)"
          />
        </li>
      </ol>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getAcuHostDocument } from "../../bootstrap/host-document";
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from "../../bootstrap/host-env";
import {
  useToastStore,
  type ToastItem,
  type ToastKind,
} from "../../stores/toast-store";
import AcuButton from "./AcuButton.vue";
import AcuIconButton from "./AcuIconButton.vue";

interface RenderedToastItem {
  item: ToastItem;
  isClosing: boolean;
}

const TOAST_LEAVE_MS = 160;
const DEFAULT_VISIBLE_TOAST_LIMIT = 4;
const toast = useToastStore();
const portalTarget = ref<HTMLElement | null>(null);
const renderedItems = ref<RenderedToastItem[]>([]);
const leaveTimers = new Map<string, AcuTimerHandle>();
let observedClearVersion = toast.clearVersion;

function iconForKind(kind: ToastKind): string {
  if (kind === "success") return "fa-solid fa-check";
  if (kind === "warning") return "fa-solid fa-triangle-exclamation";
  if (kind === "error") return "fa-solid fa-circle-exclamation";
  return "fa-solid fa-circle-info";
}

function cancelLeaveTimer(id: string): void {
  const timer = leaveTimers.get(id);
  if (timer === undefined) return;
  acuClearTimeout(timer);
  leaveTimers.delete(id);
}

async function runAction(item: ToastItem): Promise<void> {
  const action = item.action;
  if (!action) return;
  await action.onClick();
  if (action.dismissOnClick !== false) {
    toast.dismiss(item.id);
  }
}

onMounted(() => {
  const doc = getAcuHostDocument();
  portalTarget.value = doc.getElementById("acu-app-v2") ?? doc.body;
});

onBeforeUnmount(() => {
  for (const timer of leaveTimers.values()) {
    acuClearTimeout(timer);
  }
  leaveTimers.clear();
});

watch(
  () => [toast.items, toast.clearVersion] as const,
  ([items, clearVersion]) => {
    if (clearVersion !== observedClearVersion) {
      observedClearVersion = clearVersion;
      for (const timer of leaveTimers.values()) {
        acuClearTimeout(timer);
      }
      leaveTimers.clear();
      renderedItems.value = [];
      return;
    }

    const nextById = new Map(items.map((item) => [item.id, item]));
    const currentById = new Map(renderedItems.value.map((entry) => [entry.item.id, entry]));
    const nextRendered: RenderedToastItem[] = [];
    const renderedLimit = Math.max(items.length, DEFAULT_VISIBLE_TOAST_LIMIT);

    for (const item of items) {
      const existing = currentById.get(item.id);
      if (existing) {
        cancelLeaveTimer(item.id);
        existing.item = item;
        existing.isClosing = false;
        nextRendered.push(existing);
      } else {
        nextRendered.push({ item, isClosing: false });
      }
    }

    for (const entry of renderedItems.value) {
      if (nextById.has(entry.item.id)) continue;
      if (nextRendered.length >= renderedLimit) {
        cancelLeaveTimer(entry.item.id);
        continue;
      }
      if (!entry.isClosing) {
        entry.isClosing = true;
        leaveTimers.set(entry.item.id, acuSetTimeout(() => {
          renderedItems.value = renderedItems.value.filter((current) => current.item.id !== entry.item.id);
          leaveTimers.delete(entry.item.id);
        }, TOAST_LEAVE_MS));
      }
      nextRendered.push(entry);
    }

    renderedItems.value = nextRendered;
  },
  { immediate: true, deep: true },
);
</script>

<style scoped>
.acu-toast-viewport {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  inset: 0;
  z-index: 9410;
  box-sizing: border-box;
  width: 100%;
  width: 100vw;
  width: 100dvw;
  min-height: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  color: var(--acu-text-1);
  font-family: var(--acu-font-ui);
  font-size: var(--acu-font-size-body);
  pointer-events: none;
}

.acu-toast-viewport,
.acu-toast-viewport * {
  box-sizing: border-box;
}

.acu-toast-viewport__list {
  position: absolute;
  top: calc(var(--acu-toast-top, 62px) + var(--acu-safe-top, 0px));
  right: calc(var(--acu-toast-edge-gap, 18px) + var(--acu-safe-right, 0px));
  bottom: auto;
  width: min(var(--acu-toast-width, 360px), calc(100% - var(--acu-toast-edge-gap, 18px) - var(--acu-toast-edge-gap, 18px) - var(--acu-safe-left, 0px) - var(--acu-safe-right, 0px)));
  max-height: calc(100% - var(--acu-toast-top, 62px) - var(--acu-toast-edge-gap, 18px) - var(--acu-safe-top, 0px) - var(--acu-safe-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-2, 8px);
  margin: 0;
  padding: 0;
  overflow: visible;
  list-style: none;
}

.acu-v2-toast {
  --acu-toast-tone: var(--acu-accent);
  position: relative;
  min-width: 0;
  display: grid;
  grid-template-columns: var(--acu-control-height-sm, 26px) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--acu-space-2, 8px);
  padding: var(--acu-space-250, 10px) var(--acu-space-3, 12px);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--acu-toast-tone) 22%, var(--acu-border-2));
  border-radius: var(--acu-radius-md);
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--acu-toast-tone) 7%, transparent),
      transparent 48%
    ),
    color-mix(in srgb, var(--acu-bg-1) 97%, var(--acu-text-1) 3%);
  box-shadow:
    0 18px 46px rgba(0, 0, 0, 0.18),
    0 4px 16px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 color-mix(in srgb, var(--acu-text-1) 8%, transparent);
  color: var(--acu-text-1);
  pointer-events: auto;
  animation: acu-toast-in 0.16s ease-out both;
}

.acu-v2-toast--success {
  --acu-toast-tone: var(--acu-success);
}

.acu-v2-toast--warning {
  --acu-toast-tone: var(--acu-warning);
}

.acu-v2-toast--error {
  --acu-toast-tone: var(--acu-danger);
}

.acu-v2-toast.is-closing {
  pointer-events: none;
  animation: acu-toast-out 0.16s ease-in both;
}

.acu-v2-toast__icon {
  --acu-icon-color: var(--acu-toast-tone);
  min-width: 0;
  width: var(--acu-control-height-sm, 26px);
  height: var(--acu-control-height-sm, 26px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-toast-tone) 13%, transparent);
  color: var(--acu-toast-tone);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-toast-tone) 18%, transparent);
}

.acu-v2-toast__text {
  min-width: 0;
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.acu-v2-toast__action {
  white-space: nowrap;
}

.acu-v2-toast__dismiss {
  flex: 0 0 auto;
}

@keyframes acu-toast-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes acu-toast-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-6px);
  }
}

@media (max-width: 640px) {
  .acu-toast-viewport__list {
    top: calc(var(--acu-toast-top-compact, 58px) + var(--acu-safe-top, 0px));
    right: auto;
    bottom: auto;
    left: calc(50% + (var(--acu-safe-left, 0px) - var(--acu-safe-right, 0px)) / 2);
    width: clamp(var(--acu-menu-min-width, 240px), 70vw, calc(100% - var(--acu-toast-edge-gap-compact, 12px) - var(--acu-toast-edge-gap-compact, 12px) - var(--acu-safe-left, 0px) - var(--acu-safe-right, 0px)));
    max-height: calc(100% - var(--acu-toast-top-compact, 58px) - var(--acu-toast-edge-gap-compact, 12px) - var(--acu-safe-top, 0px) - var(--acu-safe-bottom, 0px));
    transform: translateX(-50%);
  }

  .acu-v2-toast {
    grid-template-columns: var(--acu-icon-button-size-sm, 22px) minmax(0, 1fr) auto;
    gap: var(--acu-space-175, 7px);
    padding: var(--acu-space-2, 8px) var(--acu-space-225, 9px);
  }

  .acu-v2-toast__icon {
    width: var(--acu-icon-button-size-sm, 22px);
    height: var(--acu-icon-button-size-sm, 22px);
    font-size: var(--acu-font-size-body, 12px);
  }

  .acu-v2-toast__text {
    font-size: var(--acu-font-size-caption, 11px);
    line-height: 1.4;
  }

  .acu-v2-toast__action {
    grid-column: 2 / 4;
    justify-self: start;
  }
}
</style>
