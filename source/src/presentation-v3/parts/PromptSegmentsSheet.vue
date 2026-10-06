<template>
  <UbSheet
    :is-open="isOpen"
    :title="title"
    :subtitle="dirty ? '有未保存的修改' : undefined"
    width="760px"
    :before-close="confirmIfDirty"
    @close="emit('close')"
  >
    <template #head-actions>
      <UbFileButton v-if="allowImportExport" icon-only icon="fa-solid fa-download" title="导入 JSON" accept="application/json,.json" @file="emit('import-file', $event)" />
      <UbIconButton v-if="allowImportExport" icon="fa-solid fa-upload" title="导出 JSON" @click="emit('export')" />
    </template>
    <UbCallout v-if="message" :kind="message.kind">{{ message.text }}</UbCallout>
    <slot name="lead" />
    <UbPromptSegments
      :segments="segments"
      :rows="8"
      :show-slot="showSlot"
      :allow-move="allowMove"
      :role-options="roleOptions"
      @add="emit('add', $event)"
      @delete="emit('delete', $event)"
      @move="(index, delta) => emit('move', index, delta)"
      @update="(index, patch) => emit('update', index, patch)"
    />
    <template #footer>
      <UbButton variant="ghost" icon="fa-solid fa-rotate-left" @click="emit('reset')">{{ resetLabel }}</UbButton>
      <span class="ub-pss__spacer"></span>
      <UbButton variant="ghost" @click="requestClose">关闭</UbButton>
      <UbButton variant="primary" icon="fa-solid fa-floppy-disk" :disabled="!dirty" @click="emit('save')">{{ saveLabel }}</UbButton>
    </template>
  </UbSheet>
</template>

<script setup lang="ts">
/** 分段提示词编辑面板：填表提示词等"多段 + 角色 + 插槽"结构共用。关闭前拦截未保存修改。 */
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbFileButton from '../ui/UbFileButton.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbPromptSegments, { type UbPromptSegment } from '../ui/UbPromptSegments.vue';
import type { UbSelectOption } from '../ui/UbSelect.vue';
import UbSheet from '../ui/UbSheet.vue';

const props = withDefaults(defineProps<{
  isOpen: boolean;
  title: string;
  segments: UbPromptSegment[];
  dirty: boolean;
  message?: { kind: 'info' | 'success' | 'warning' | 'error'; text: string } | null;
  showSlot?: boolean;
  allowMove?: boolean;
  allowImportExport?: boolean;
  roleOptions?: UbSelectOption[];
  resetLabel?: string;
  saveLabel?: string;
  dirtyConfirmMessage?: string;
}>(), {
  message: null,
  showSlot: true,
  allowMove: false,
  allowImportExport: true,
  roleOptions: undefined,
  resetLabel: '载入默认提示词',
  saveLabel: '保存提示词',
  dirtyConfirmMessage: '你有未保存的提示词修改，确定要关闭吗？',
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save'): void;
  (e: 'reset'): void;
  (e: 'import-file', file: File): void;
  (e: 'export'): void;
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'move', index: number, delta: -1 | 1): void;
  (e: 'update', index: number, patch: Partial<UbPromptSegment>): void;
}>();

const dialogStore = useDialogStore();

async function confirmIfDirty(): Promise<boolean> {
  if (!props.dirty) return true;
  return dialogStore.confirm({
    title: '关闭提示词编辑器',
    message: props.dirtyConfirmMessage,
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.ub-pss__spacer {
  flex: 1 1 auto;
}
</style>
