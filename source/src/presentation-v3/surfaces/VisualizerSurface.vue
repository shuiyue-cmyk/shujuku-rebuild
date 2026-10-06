<template>
  <ClassicVisualizerSurface @close="emit('close')" />
</template>

<script setup lang="ts">
// 临时：新版数据库编辑器完成前沿用经典实现。
import ClassicVisualizerSurface from '../../presentation-v2/surfaces/visualizer/VisualizerSurface.vue';

const emit = defineEmits<{ (e: 'close'): void }>();
</script>
