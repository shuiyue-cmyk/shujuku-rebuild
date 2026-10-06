<template>
  <div class="ub-segs">
    <UbButton size="sm" variant="ghost" icon="fa-solid fa-plus" class="ub-segs__add" @click="emit('add', 'top')">在最上方插入</UbButton>
    <ol class="ub-segs__list">
      <li v-for="(seg, index) in segments" :key="index" class="ub-segs__item" :class="[`ub-segs__item--${roleTone(seg.role)}`, { 'is-disabled': showEnabled && seg.enabled === false }]">
        <header class="ub-segs__head">
          <span class="ub-segs__index">{{ index + 1 }}</span>
          <div class="ub-segs__role">
            <UbSelect
              size="sm"
              :options="roleOptions"
              :model-value="seg.role"
              :aria-label="`第 ${index + 1} 段角色`"
              @update:model-value="emit('update', index, { role: $event })"
            />
          </div>
          <div v-if="showSlot" class="ub-segs__slot">
            <UbSelect
              size="sm"
              :options="slotOptions"
              :model-value="seg.mainSlot || ''"
              title="主插槽 A=主提示词；B=拦截任务详细指令"
              :aria-label="`第 ${index + 1} 段插槽`"
              @update:model-value="onSlot(index, $event)"
            />
          </div>
          <span class="ub-segs__spacer"></span>
          <label v-if="showEnabled" class="ub-segs__enabled" :title="seg.enabled === false ? '该段已停用，不参与调用' : '该段参与调用'">
            启用
            <UbSwitch
              :model-value="seg.enabled !== false"
              :aria-label="`第 ${index + 1} 段启用`"
              @update:model-value="emit('update', index, { enabled: $event })"
            />
          </label>
          <template v-if="allowMove">
            <UbIconButton
              icon="fa-solid fa-arrow-up"
              size="sm"
              :disabled="index === 0"
              :title="index === 0 ? '已经是第一段' : '上移该段'"
              @click="emit('move', index, -1)"
            />
            <UbIconButton
              icon="fa-solid fa-arrow-down"
              size="sm"
              :disabled="index === segments.length - 1"
              :title="index === segments.length - 1 ? '已经是最后一段' : '下移该段'"
              @click="emit('move', index, 1)"
            />
          </template>
          <UbIconButton
            icon="fa-solid fa-trash-can"
            variant="danger"
            size="sm"
            :disabled="seg.deletable === false"
            :title="seg.deletable === false ? '该段不可删除' : '删除该段'"
            @click="emit('delete', index)"
          />
        </header>
        <UbTextarea
          :model-value="seg.content"
          :rows="rows"
          mono
          placeholder="提示词内容..."
          :aria-label="`第 ${index + 1} 段内容`"
          @update:model-value="emit('update', index, { content: $event })"
        />
      </li>
      <li v-if="!segments.length" class="ub-segs__empty">{{ emptyText }}</li>
    </ol>
    <UbButton size="sm" variant="ghost" icon="fa-solid fa-plus" class="ub-segs__add" @click="emit('add', 'bottom')">在最下方插入</UbButton>
  </div>
</template>

<script lang="ts">
import type { UbSelectOption } from './UbSelect.vue';

export interface UbPromptSegment {
  role: string;
  content: string;
  deletable?: boolean;
  mainSlot?: 'A' | 'B' | '';
  isMain?: boolean;
  isMain2?: boolean;
  /** 段启用开关（仅 showEnabled 时可编辑）；undefined 视为启用。 */
  enabled?: boolean;
}

const DEFAULT_ROLE_OPTIONS: UbSelectOption[] = [
  { value: 'SYSTEM', label: 'SYSTEM' },
  { value: 'USER', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

const DEFAULT_SLOT_OPTIONS: UbSelectOption[] = [
  { value: '', label: '普通段' },
  { value: 'A', label: '主插槽 A' },
  { value: 'B', label: '主插槽 B' },
];
</script>

<script setup lang="ts">
import UbButton from './UbButton.vue';
import UbIconButton from './UbIconButton.vue';
import UbSelect from './UbSelect.vue';
import UbSwitch from './UbSwitch.vue';
import UbTextarea from './UbTextarea.vue';

withDefaults(defineProps<{
  segments: UbPromptSegment[];
  roleOptions?: UbSelectOption[];
  slotOptions?: UbSelectOption[];
  showSlot?: boolean;
  allowMove?: boolean;
  showEnabled?: boolean;
  rows?: number;
  emptyText?: string;
}>(), {
  roleOptions: () => DEFAULT_ROLE_OPTIONS,
  slotOptions: () => DEFAULT_SLOT_OPTIONS,
  showSlot: true,
  allowMove: false,
  showEnabled: false,
  rows: 6,
  emptyText: '暂无提示词段。点击按钮添加第一段。',
});

const emit = defineEmits<{
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'move', index: number, delta: -1 | 1): void;
  (e: 'update', index: number, patch: Partial<UbPromptSegment>): void;
}>();

function onSlot(index: number, raw: string): void {
  emit('update', index, { mainSlot: raw === 'A' || raw === 'B' ? raw : '' });
}

function roleTone(role: string): string {
  const r = String(role || '').toLowerCase();
  if (r === 'system') return 'system';
  if (r === 'user') return 'user';
  return 'assistant';
}
</script>

<style scoped>
.ub-segs {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--ub-s2);
}

.ub-segs__add {
  align-self: flex-start;
}

.ub-segs__list {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ub-segs__item {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-left: 3px solid var(--ub-seg-tone, var(--ub-line));
  border-radius: var(--ub-r-control);
  background: var(--ub-panel);
}

.ub-segs__item--system {
  --ub-seg-tone: var(--ub-accent);
}

.ub-segs__item--user {
  --ub-seg-tone: var(--ub-ok);
}

.ub-segs__item--assistant {
  --ub-seg-tone: var(--ub-warn);
}

.ub-segs__head {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  flex-wrap: wrap;
}

.ub-segs__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.8em;
  height: 1.8em;
  border-radius: 999px;
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ub-segs__role {
  width: calc(var(--ub-u) * 130);
}

.ub-segs__slot {
  width: calc(var(--ub-u) * 110);
}

.ub-segs__spacer {
  flex: 1 1 auto;
}

.ub-segs__item.is-disabled > :deep(.ub-textarea) {
  opacity: 0.5;
}

.ub-segs__enabled {
  display: inline-flex;
  align-items: center;
  gap: var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

.ub-segs__empty {
  padding: var(--ub-s5);
  border: 1px dashed var(--ub-line);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  text-align: center;
}
</style>
