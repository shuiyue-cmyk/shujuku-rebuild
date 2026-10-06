<template>
  <UbPage :lead="apiCopy.panels.preset.description" :sections="sections">
    <ApiPresetEditor id-prefix="api" />
  </UbPage>
</template>

<script setup lang="ts">
import { apiCopy } from '../../presentation-v2/copy/api-copy';
import ApiPresetEditor from '../parts/ApiPresetEditor.vue';
import UbPage from '../ui/UbPage.vue';

const sections = [
  { id: 'api-preset', label: '预设' },
  { id: 'api-connection', label: '连接' },
  { id: 'api-generation', label: '生成参数' },
  { id: 'api-behavior', label: '请求行为' },
  { id: 'api-advanced', label: '请求改写' },
];
</script>
