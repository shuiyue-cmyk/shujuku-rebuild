<template>
  <AcuPromptSegments
    :segments="segments"
    :show-slot="true"
    :allow-move="true"
    :rows="6"
    empty-text="当前任务还没有提示词段。点击下方按钮添加第一段。"
    @add="$emit('add', $event)"
    @delete="$emit('delete', $event)"
    @move="(index, delta) => $emit('move', index, delta)"
    @update="(i, p) => $emit('update', i, p)"
  />
</template>

<script setup lang="ts">
import AcuPromptSegments from './_lib/AcuPromptSegments.vue';
import type { PromptSegment } from './_lib/AcuPromptSegments.vue';

export type { PromptSegment as PlotPromptSegment };

defineProps<{
  segments: PromptSegment[];
}>();

defineEmits<{
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'move', index: number, delta: -1 | 1): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();
</script>
