<template>
  <div class="acu-viz-global" data-acu-visualizer-global>
    <AcuPanel
      title="全局注入配置"
      description="全局配置属于整套模板，不依附单张表。它会控制可读数据条目和外层包裹条目的注入位置；如果所有表的世界书内容整体位置不对，先检查本面板。"
    >
      <PlacementEditor
        title="可读数据条目位置"
        :placement="config.getGlobalPlacement('readableEntryPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updateGlobalPlacement('readableEntryPlacement', field, value)"
      />

      <PlacementEditor
        title="包裹条目位置"
        :placement="config.getGlobalPlacement('wrapperPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updateGlobalPlacement('wrapperPlacement', field, value)"
      />
    </AcuPanel>
  </div>
</template>

<script setup lang="ts">
import AcuPanel from '../../components/_lib/AcuPanel.vue';
import { useVisualizerConfigEditing } from '../../composables/visualizer/useVisualizerConfigEditing';
import PlacementEditor from './VisualizerPlacementEditor.vue';

const config = useVisualizerConfigEditing();
</script>

<style scoped>
.acu-viz-global {
  min-width: 0;
  display: grid;
  gap: 12px;
}

</style>
