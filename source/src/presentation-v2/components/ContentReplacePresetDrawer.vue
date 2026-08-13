<template>
  <AcuDrawer
    :is-open="isOpen"
    title="管理正文替换预设"
    width="560px"
    @close="$emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <div class="acu-content-replace-preset-drawer__top-actions">
      <AcuButton variant="primary" class="acu-content-replace-preset-drawer__create-btn" @click="$emit('create-from-default')">
        <i class="fa-solid fa-plus"></i>
        从默认新建
      </AcuButton>
    </div>

    <ul v-if="presets.length" class="acu-v2-manage-list">
      <li v-for="preset in presets" :key="preset.name" class="acu-v2-manage-item">
        <div class="acu-v2-manage-item__info">
          <AcuText as="span" variant="list-title" class="acu-v2-manage-item__name">{{ preset.name }}</AcuText>
          <AcuText as="span" variant="caption" class="acu-v2-manage-item__meta">{{ preset.promptGroup.length }} 段提示词</AcuText>
        </div>
        <div class="acu-v2-manage-item__actions">
          <AcuIconButton icon="fa-solid fa-upload" title="导出 JSON" @click="$emit('export', preset.name)" />
          <AcuIconButton icon="fa-solid fa-i-cursor" title="重命名" @click="$emit('rename', preset.name)" />
          <AcuIconButton icon="fa-solid fa-pen" title="编辑提示词" @click="$emit('edit', preset.name)" />
          <AcuIconButton icon="fa-solid fa-trash-can" variant="danger" title="删除" @click="$emit('delete', preset.name)" />
        </div>
      </li>
    </ul>
    <AcuText v-else variant="empty" class="acu-content-replace-preset-drawer__empty">暂无预设。点击上方"从默认新建"，或使用面板下拉栏右侧的导入按钮创建。</AcuText>
    <AcuText variant="hint" class="acu-content-replace-preset-drawer__hint">
      提示：点击"编辑提示词"会先把该预设载入为当前正文替换提示词，再打开提示词编辑器；保存后会同步更新这个预设。
    </AcuText>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuIconButton from './_lib/AcuIconButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuText from './_lib/AcuText.vue';
import type { ContentReplaceMessage, ContentReplacePreset } from '../stores/content-replace-store';

defineProps<{
  isOpen: boolean;
  presets: ContentReplacePreset[];
  message: ContentReplaceMessage | null;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'create-from-default'): void;
  (e: 'edit', name: string): void;
  (e: 'rename', name: string): void;
  (e: 'delete', name: string): void;
  (e: 'export', name: string): void;
}>();
</script>

<style scoped>
.acu-content-replace-preset-drawer__top-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-content-replace-preset-drawer__empty {
  margin: 12px 0;
}

.acu-v2-manage-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.acu-v2-manage-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: 0;
  background: transparent;
}

.acu-v2-manage-item:last-child {
  border-bottom: 0;
}

.acu-v2-manage-item__info {
  flex: 1;
  min-width: 0;
}

.acu-v2-manage-item__name {
  display: block;
  font-size: var(--acu-font-size-list-title, 13px);
  line-height: var(--acu-line-height-body, 1.45);
  font-weight: 500;
  color: var(--acu-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-v2-manage-item__meta {
  display: block;
  margin-top: 2px;
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
  color: var(--acu-text-3);
}

.acu-v2-manage-item__actions {
  display: flex;
  gap: 4px;
}
</style>
