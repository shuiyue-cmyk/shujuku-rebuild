<template>
  <AcuDrawer
    :is-open="isOpen"
    :title="title"
    width="640px"
    @close="$emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">{{ message.text }}</AcuMessage>

    <div class="acu-v2-table-drawer__top-actions">
      <AcuButton variant="primary" :disabled="busy" @click="$emit('create-blank')">
        <i class="fa-solid fa-plus"></i> 从默认新建
      </AcuButton>
    </div>

    <ul v-if="presetMeta.length" class="acu-v2-manage-list">
      <li v-for="meta in presetMeta" :key="meta.name" class="acu-v2-manage-item">
        <div class="acu-v2-manage-item__info">
          <AcuText as="span" variant="list-title" class="acu-v2-manage-item__name">{{ meta.label ?? meta.name }}</AcuText>
          <AcuText as="span" variant="caption" class="acu-v2-manage-item__meta">
            <template v-if="meta.kind === 'runtime'">{{ meta.meta ?? '当前生效（内存）' }}</template>
            <template v-else-if="meta.name === defaultPresetName">全局默认</template>
            <template v-else>全局预设</template>
          </AcuText>
        </div>
        <div class="acu-v2-manage-item__actions">
          <template v-if="meta.kind === 'runtime'">
            <!-- 只读 runtime 项：仅导出，不渲染 star/rename/edit/delete -->
            <AcuIconButton icon="fa-solid fa-upload" title="导出当前生效模板" :disabled="busy" @click="$emit('export', meta.name)" />
          </template>
          <template v-else>
            <AcuIconButton
              :icon="meta.name === defaultPresetName ? 'fa-solid fa-star' : 'fa-regular fa-star'"
              title="设为全局默认"
              :variant="meta.name === defaultPresetName ? 'accent' : 'default'"
              :disabled="busy"
              @click="$emit('set-default', meta.name)"
            />
            <AcuIconButton icon="fa-solid fa-upload" title="导出 JSON" :disabled="busy" @click="$emit('export', meta.name)" />
            <AcuIconButton icon="fa-solid fa-i-cursor" title="重命名" :disabled="busy" @click="$emit('rename', meta.name)" />
            <AcuIconButton icon="fa-solid fa-pen" title="编辑（打开可视化表格编辑器）" :disabled="busy" @click="$emit('edit', meta.name)" />
            <AcuIconButton icon="fa-solid fa-trash-can" variant="danger" title="删除" :disabled="busy" @click="$emit('delete', meta.name)" />
          </template>
        </div>
      </li>
    </ul>
    <AcuText v-else variant="empty" class="acu-v2-table-drawer__empty">暂无全局预设。点击上方"从默认新建"，或使用面板下拉栏右侧的导入按钮创建。</AcuText>

    <AcuText variant="hint" class="acu-v2-table-drawer__hint">
      提示：表格模板的实际内容、表头与表级参数仍在「可视化表格编辑器」中编辑。点击行内的"编辑"会先把当前聊天切换到该预设，然后打开编辑器。
    </AcuText>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuIconButton from './_lib/AcuIconButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuText from './_lib/AcuText.vue';

defineProps<{
  isOpen: boolean;
  title: string;
  busy: boolean;
  message: { kind: 'success' | 'error' | 'info' | 'warning'; text: string } | null;
  presetMeta: Array<{ name: string; kind?: 'preset' | 'runtime'; label?: string; meta?: string; readOnly?: boolean }>;
  defaultPresetName: string;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'create-blank'): void;
  (e: 'set-default', name: string): void;
  (e: 'export', name: string): void;
  (e: 'rename', name: string): void;
  (e: 'edit', name: string): void;
  (e: 'delete', name: string): void;
}>();
</script>

<style scoped>
.acu-v2-table-drawer__top-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.acu-v2-table-drawer__empty {
  margin: 12px 0;
}

</style>
