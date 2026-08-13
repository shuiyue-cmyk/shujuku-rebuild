<template>
  <div class="acu-viz-placement">
    <h3 class="acu-viz-placement__title">{{ title }}</h3>
    <div class="acu-viz-placement__grid">
      <AcuFormRow label="位置">
        <AcuSelect
          :model-value="placement.position"
          :options="options"
          @update:model-value="value => updateField('position', value)"
        />
      </AcuFormRow>
      <AcuFormRow label="Depth">
        <AcuInput
          class="acu-viz-placement__number"
          type="number"
          :model-value="placement.depth"
          :step="1"
          @update:model-value="value => updateField('depth', value)"
        />
      </AcuFormRow>
      <AcuFormRow label="Order">
        <AcuInput
          class="acu-viz-placement__number"
          type="number"
          :model-value="placement.order"
          :min="1"
          :step="1"
          @update:model-value="value => updateField('order', value)"
        />
      </AcuFormRow>
    </div>
  </div>
</template>

<script setup lang="ts">
import AcuFormRow from '../../components/_lib/AcuFormRow.vue';
import AcuInput from '../../components/_lib/AcuInput.vue';
import AcuSelect from '../../components/_lib/AcuSelect.vue';
import type { VisualizerPlacementDraft } from '../../composables/visualizer/useVisualizerConfigEditing';

const props = defineProps<{
  title: string;
  placement: VisualizerPlacementDraft;
  options: Array<{ value: string; label: string }>;
  updateField: (field: keyof VisualizerPlacementDraft, value: string | number) => void;
}>();

function updateField(field: keyof VisualizerPlacementDraft, value: string | number): void {
  props.updateField(field, value);
}
</script>

<style scoped>
.acu-viz-placement {
  min-width: 0;
  display: grid;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--acu-border-2);
}

.acu-viz-placement:first-of-type {
  margin-top: 12px;
}

.acu-viz-placement__title {
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.35;
}

.acu-viz-placement__grid {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(96px, 120px) minmax(96px, 120px);
  gap: 10px;
}

.acu-viz-placement__number {
  max-width: 120px;
}

@media (max-width: 860px) {
  .acu-viz-placement__grid {
    grid-template-columns: 1fr;
  }

  .acu-viz-placement__number {
    max-width: 100%;
  }
}
</style>
