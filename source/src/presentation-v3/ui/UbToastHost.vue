<template>
  <Teleport defer to="#ub-portal">
    <div v-if="toast.items.length" class="ub-toasts" data-tt-mobile-surface="backdrop" role="status" aria-label="通知">
      <TransitionGroup name="ub-toast" tag="ol" class="ub-toasts__list">
        <li
          v-for="item in toast.items"
          :key="item.id"
          class="ub-toast"
          :class="`ub-toast--${item.kind}`"
          :role="item.kind === 'error' ? 'alert' : 'status'"
        >
          <i :class="[iconFor(item.kind), 'ub-toast__icon']" aria-hidden="true"></i>
          <p class="ub-toast__text">{{ item.text }}</p>
          <UbButton
            v-if="item.action"
            size="sm"
            :variant="item.action.variant === 'danger' ? 'danger' : 'soft'"
            @click="runAction(item)"
          >
            {{ item.action.label }}
          </UbButton>
          <UbIconButton v-if="item.dismissible" icon="fa-solid fa-xmark" size="sm" title="关闭通知" @click="toast.dismiss(item.id)" />
        </li>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToastStore, type ToastItem, type ToastKind } from '../../presentation-v2/stores/toast-store';
import UbButton from './UbButton.vue';
import UbIconButton from './UbIconButton.vue';

const toast = useToastStore();

function iconFor(kind: ToastKind): string {
  if (kind === 'success') return 'fa-solid fa-circle-check';
  if (kind === 'warning') return 'fa-solid fa-triangle-exclamation';
  if (kind === 'error') return 'fa-solid fa-circle-exclamation';
  return 'fa-solid fa-circle-info';
}

async function runAction(item: ToastItem): Promise<void> {
  const action = item.action;
  if (!action) return;
  await action.onClick();
  if (action.dismissOnClick !== false) toast.dismiss(item.id);
}
</script>

<style scoped>
.ub-toasts {
  position: fixed;
  top: calc(var(--ub-safe-top) + var(--ub-s3));
  left: 50%;
  z-index: 9410;
  width: min(420px, calc(100% - 24px));
  transform: translateX(-50%);
  pointer-events: none;
}

.ub-toasts__list {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ub-toast {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: 14px;
  background: var(--ub-toast-bg);
  color: var(--ub-text);
  box-shadow: var(--ub-overlay-shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  pointer-events: auto;
}

.ub-toast__icon {
  flex: 0 0 auto;
  color: var(--ub-accent-ink);
}

.ub-toast--success .ub-toast__icon {
  color: var(--ub-ok);
}

.ub-toast--warning .ub-toast__icon {
  color: var(--ub-warn);
}

.ub-toast--error .ub-toast__icon {
  color: var(--ub-danger);
}

.ub-toast__text {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--ub-fs-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.ub-toast-enter-active,
.ub-toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.ub-toast-enter-from,
.ub-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
