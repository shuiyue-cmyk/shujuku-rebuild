<template>
  <UbSheet :is-open="isOpen" :title="title" subtitle="全局表格模板预设" width="600px" @close="emit('close')">
    <UbCallout v-if="message" :kind="message.kind">{{ message.text }}</UbCallout>
    <UbButton variant="primary" icon="fa-solid fa-plus" :disabled="busy" @click="emit('create-blank')">从默认新建</UbButton>

    <ul v-if="presetMeta.length" class="ub-plist">
      <li v-for="meta in presetMeta" :key="meta.name" class="ub-plist__item">
        <div class="ub-plist__info">
          <span class="ub-plist__name">
            <i v-if="meta.kind !== 'runtime' && meta.name === defaultPresetName" class="fa-solid fa-star ub-plist__star" aria-hidden="true"></i>
            {{ meta.label ?? meta.name }}
          </span>
          <span class="ub-plist__meta">
            <template v-if="meta.kind === 'runtime'">{{ meta.meta ?? '当前生效（内存）' }}</template>
            <template v-else-if="meta.name === defaultPresetName">全局默认</template>
            <template v-else>全局预设</template>
          </span>
        </div>
        <div class="ub-plist__actions">
          <template v-if="meta.kind === 'runtime'">
            <UbIconButton icon="fa-solid fa-upload" title="导出当前生效模板" :disabled="busy" @click="emit('export', meta.name)" />
          </template>
          <template v-else>
            <UbIconButton
              :icon="meta.name === defaultPresetName ? 'fa-solid fa-star' : 'fa-regular fa-star'"
              title="设为全局默认"
              :variant="meta.name === defaultPresetName ? 'accent' : 'default'"
              :disabled="busy"
              @click="emit('set-default', meta.name)"
            />
            <UbIconButton icon="fa-solid fa-upload" title="导出 JSON" :disabled="busy" @click="emit('export', meta.name)" />
            <UbIconButton icon="fa-solid fa-i-cursor" title="重命名" :disabled="busy" @click="emit('rename', meta.name)" />
            <UbIconButton icon="fa-solid fa-pen" title="编辑（打开可视化表格编辑器）" :disabled="busy" @click="emit('edit', meta.name)" />
            <UbIconButton icon="fa-solid fa-trash-can" variant="danger" title="删除" :disabled="busy" @click="emit('delete', meta.name)" />
          </template>
        </div>
      </li>
    </ul>
    <p v-else class="ub-plist__empty">暂无全局预设。点上方「从默认新建」，或在模板卡片里用「导入」创建。</p>

    <UbCallout kind="info">
      模板的表头与表级参数在「可视化表格编辑器」里编辑。点某一行的「编辑」会先把当前聊天切到该预设，再打开编辑器。
    </UbCallout>
  </UbSheet>
</template>

<script setup lang="ts">
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbSheet from '../ui/UbSheet.vue';

defineProps<{
  isOpen: boolean;
  title: string;
  busy: boolean;
  message: { kind: 'success' | 'error' | 'info' | 'warning'; text: string } | null;
  presetMeta: Array<{ name: string; kind?: 'preset' | 'runtime'; label?: string; meta?: string; readOnly?: boolean }>;
  defaultPresetName: string;
}>();

const emit = defineEmits<{
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
.ub-plist {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  list-style: none;
  overflow: hidden;
}

.ub-plist__item {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s4);
}

.ub-plist__item + .ub-plist__item {
  border-top: 1px solid var(--ub-line-soft);
}

.ub-plist__info {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.ub-plist__name {
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-plist__star {
  color: var(--ub-warn);
  font-size: 0.85em;
}

.ub-plist__meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-plist__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}

.ub-plist__empty {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
}

@media (max-width: 480px) {
  .ub-plist__item {
    flex-wrap: wrap;
  }

  .ub-plist__actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
