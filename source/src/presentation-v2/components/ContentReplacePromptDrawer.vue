<template>
  <AcuDrawer
    :is-open="isOpen"
    title="编辑正文替换提示词"
    width="720px"
    :before-close="confirmIfDirty"
    @close="$emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <div class="acu-content-replace-prompt-drawer__meta">
      <span>{{ segments.length }} 段提示词</span>
      <code>$CONTENT</code>
      <code>$1</code>
      <code>$5</code>
      <code>$6</code>
      <code>$7</code>
      <code>$8</code>
      <code>$U</code>
      <code>$C</code>
    </div>

    <div class="acu-content-replace-prompt-drawer__toolbar">
      <AcuButton size="sm" @click="$emit('reset')">载入默认提示词</AcuButton>
    </div>

    <AcuPromptSegments
      :segments="segments"
      :show-slot="true"
      :rows="8"
      empty-text="暂无正文替换提示词段。点击下方按钮添加第一段。"
      @add="$emit('add', $event)"
      @delete="$emit('delete', $event)"
      @update="(index, patch) => $emit('update', index, patch)"
    />

    <footer class="acu-content-replace-prompt-drawer__actions">
      <AcuButton @click="requestClose">关闭</AcuButton>
      <AcuButton variant="primary" :disabled="!dirty" @click="$emit('save')">保存提示词</AcuButton>
    </footer>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments, { type PromptSegment } from './_lib/AcuPromptSegments.vue';
import { useDialogStore } from '../stores/dialog-store';
import type { ContentReplaceMessage } from '../stores/content-replace-store';

const props = defineProps<{
  isOpen: boolean;
  segments: PromptSegment[];
  dirty: boolean;
  message: ContentReplaceMessage | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save'): void;
  (e: 'reset'): void;
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

const dialogStore = useDialogStore();

async function confirmIfDirty(): Promise<boolean> {
  if (!props.dirty) return true;
  return dialogStore.confirm({
    title: '关闭提示词编辑器',
    message: '你有未保存的正文替换提示词修改，确定要关闭吗？',
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.acu-content-replace-prompt-drawer__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
}

.acu-content-replace-prompt-drawer__meta code {
  padding: 2px 5px;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
  color: var(--acu-text-2);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
}

.acu-content-replace-prompt-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-content-replace-prompt-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  background: var(--acu-bg-1);
}
</style>
