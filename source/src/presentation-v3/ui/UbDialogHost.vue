<template>
  <Teleport defer to="#ub-portal">
    <div
      v-if="shown"
      class="ub-dialog-layer"
      data-tt-mobile-surface="backdrop"
      :class="{ 'is-closing': closing }"
      role="presentation"
      @click.self="dialog.cancelActive"
    >
      <section class="ub-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" @click.stop>
        <header class="ub-dialog__head">
          <span class="ub-dialog__glyph" :class="`is-${tone}`" aria-hidden="true"><i :class="glyph"></i></span>
          <h2 :id="titleId" class="ub-dialog__title">{{ shown.title }}</h2>
          <UbBadge v-if="shown.badge" :variant="shown.badge.variant || 'neutral'">{{ shown.badge.label }}</UbBadge>
        </header>
        <p class="ub-dialog__message">{{ shown.message }}</p>
        <p v-if="shown.dangerMessage" class="ub-dialog__danger">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          {{ shown.dangerMessage }}
        </p>
        <label v-if="shown.kind === 'prompt'" class="ub-dialog__field">
          <span class="ub-dialog__field-label">{{ shown.label }}</span>
          <input
            ref="promptInput"
            v-model="dialog.inputValue"
            class="ub-dialog__input"
            autocomplete="off"
            :placeholder="shown.placeholder"
            @keydown.enter="onPromptEnter"
          >
        </label>
        <div v-if="shown.kind === 'multiselect'" class="ub-dialog__checks">
          <UbCheck
            v-for="option in shown.checkboxOptions || []"
            :key="option.value"
            :model-value="dialog.checkedValues[option.value] === true"
            :disabled="option.disabled"
            @update:model-value="dialog.setCheckedValue(option.value, $event)"
          >
            <span class="ub-dialog__check-label">{{ option.label }}</span>
            <span v-if="option.description" class="ub-dialog__check-desc">{{ option.description }}</span>
          </UbCheck>
        </div>
        <footer class="ub-dialog__actions" :class="{ 'is-stacked': shown.kind === 'choice' }">
          <template v-if="shown.kind === 'choice'">
            <UbButton
              v-for="action in shown.actions"
              :key="action.value"
              :variant="mapVariant(action.variant)"
              block
              @click="dialog.submitActive(action.value)"
            >
              {{ action.label }}
            </UbButton>
            <UbButton variant="ghost" block @click="dialog.cancelActive">{{ shown.cancelLabel || '取消' }}</UbButton>
          </template>
          <template v-else>
            <UbButton variant="ghost" @click="dialog.cancelActive">{{ shown.cancelLabel || '取消' }}</UbButton>
            <UbButton
              :variant="mapVariant(shown.confirmVariant || 'primary')"
              :disabled="dialog.confirmDisabled"
              @click="dialog.submitActive()"
            >
              {{ confirmText }}
            </UbButton>
          </template>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from '../../presentation-v2/bootstrap/host-env';
import { useDialogStore, type AcuDialogRequest, type AcuDialogVariant } from '../../presentation-v2/stores/dialog-store';
import UbBadge from './UbBadge.vue';
import UbButton from './UbButton.vue';
import UbCheck from './UbCheck.vue';

const LEAVE_MS = 150;
const titleId = 'ub-dialog-title';
const dialog = useDialogStore();
const shown = ref<AcuDialogRequest | null>(null);
const closing = ref(false);
const promptInput = ref<HTMLInputElement | null>(null);
let leaveTimer: AcuTimerHandle | undefined;

const tone = computed(() => {
  const d = shown.value;
  if (!d) return 'info';
  if (d.confirmVariant === 'danger' || d.dangerMessage) return 'danger';
  if (d.kind === 'prompt') return 'accent';
  return 'info';
});

const glyph = computed(() => ({
  danger: 'fa-solid fa-triangle-exclamation',
  accent: 'fa-solid fa-pen',
  info: 'fa-solid fa-circle-question',
}[tone.value]));

const confirmText = computed(() => {
  const label = shown.value?.confirmLabel || '确认';
  return dialog.confirmCountdownRemaining > 0 ? `${label}（${dialog.confirmCountdownRemaining}）` : label;
});

function mapVariant(variant: AcuDialogVariant | undefined): 'default' | 'primary' | 'danger' {
  if (variant === 'danger') return 'danger';
  if (variant === 'primary') return 'primary';
  return 'default';
}

watch(() => dialog.active, (active) => {
  acuClearTimeout(leaveTimer);
  if (active) {
    shown.value = active;
    closing.value = false;
    if (active.kind === 'prompt') void nextTick(() => promptInput.value?.focus());
    return;
  }
  if (!shown.value) return;
  closing.value = true;
  leaveTimer = acuSetTimeout(() => {
    shown.value = null;
    closing.value = false;
  }, LEAVE_MS);
}, { immediate: true });

/** R10B-11：输入法组字中的回车只是上屏，不能提交半截输入。 */
function onPromptEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  dialog.submitActive();
}

onBeforeUnmount(() => acuClearTimeout(leaveTimer));
</script>

<style scoped>
.ub-dialog-layer {
  --ub-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px));
  position: fixed;
  inset: 0;
  z-index: 9400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(var(--ub-safe-top), 16px) 16px max(var(--ub-safe-bottom), 16px);
  background: var(--ub-scrim);
  animation: ub-fade-in 0.15s ease-out both;
}

.ub-dialog-layer.is-closing {
  animation: ub-fade-out 0.15s ease-in both;
}

.ub-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  width: min(440px, 100%);
  max-height: 100%;
  padding: var(--ub-s5);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--ub-overlay-shadow);
  overflow-y: auto;
  animation: ub-pop-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.ub-dialog__head {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
}

.ub-dialog__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 34);
  height: calc(var(--ub-u) * 34);
  border-radius: 50%;
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-dialog__glyph.is-danger {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-dialog__title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--ub-text);
  font-size: var(--ub-fs-lg);
  font-weight: 700;
}

.ub-dialog__message {
  margin: 0;
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  line-height: 1.65;
  white-space: pre-wrap;
}

.ub-dialog__danger {
  display: flex;
  gap: var(--ub-s2);
  margin: 0;
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  line-height: 1.55;
}

.ub-dialog__field {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
}

.ub-dialog__field-label {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-dialog__input {
  height: var(--ub-control-h);
  padding: 0 var(--ub-s3);
  border: 1px solid var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  outline: none;
}

.ub-dialog__input:focus {
  border-color: var(--ub-accent);
  box-shadow: 0 0 0 3px var(--ub-accent-soft);
}

.ub-dialog__checks {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  max-height: 320px;
  overflow-y: auto;
}

.ub-dialog__check-label {
  display: block;
  font-weight: 600;
}

.ub-dialog__check-desc {
  display: block;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ub-s2);
  margin-top: var(--ub-s1);
}

.ub-dialog__actions.is-stacked {
  flex-direction: column;
}
</style>
