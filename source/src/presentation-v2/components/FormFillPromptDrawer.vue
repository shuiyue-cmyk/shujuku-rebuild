<template>
  <AcuDrawer
    :is-open="isOpen"
    title="编辑填表提示词"
    width="720px"
    :before-close="confirmIfDirty"
    @close="emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <div class="acu-form-fill-prompt-drawer__toolbar">
      <AcuFileButton size="sm" accept="application/json,.json" @file="$emit('import-file', $event)">
        <i class="fa-solid fa-download"></i> 导入 JSON
      </AcuFileButton>
      <AcuButton size="sm" @click="$emit('export')">
        <i class="fa-solid fa-upload"></i> 导出 JSON
      </AcuButton>
      <AcuButton size="sm" @click="$emit('reset')">载入默认提示词</AcuButton>
    </div>

    <AcuPromptSegments
      :segments="segments"
      :rows="8"
      @add="$emit('add', $event)"
      @delete="$emit('delete', $event)"
      @update="(index, patch) => $emit('update', index, patch)"
    />

    <footer class="acu-form-fill-prompt-drawer__actions">
      <AcuButton @click="requestClose">关闭</AcuButton>
      <AcuButton variant="primary" :disabled="!dirty" @click="$emit('save')">保存提示词</AcuButton>
    </footer>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuFileButton from './_lib/AcuFileButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments from './_lib/AcuPromptSegments.vue';
import type { PromptSegment } from './_lib/AcuPromptSegments.vue';
import type { FormFillMessage } from '../composables/useFormFillSettings';
import { useDialogStore } from '../stores/dialog-store';

const props = defineProps<{
  isOpen: boolean;
  segments: PromptSegment[];
  dirty: boolean;
  message: FormFillMessage | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save'): void;
  (e: 'reset'): void;
  (e: 'import-file', file: File): void;
  (e: 'export'): void;
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

const dialogStore = useDialogStore();

async function confirmIfDirty(): Promise<boolean> {
  if (!props.dirty) return true;
  return dialogStore.confirm({
    title: '关闭提示词编辑器',
    message: '你有未保存的填表提示词修改，确定要关闭吗？',
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.acu-form-fill-prompt-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-form-fill-prompt-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  background: var(--acu-bg-1);
}
</style>
