<template>
  <UbRow :label="title" :hint="hint" stack>
    <div class="ub-vplace">
      <label class="ub-vplace__cell ub-vplace__cell--pos">
        <span class="ub-vplace__cap">位置</span>
        <UbSelect
          :model-value="placement.position"
          :options="options"
          :aria-label="`${title}：位置`"
          @update:model-value="value => updateField('position', value)"
        />
      </label>
      <label class="ub-vplace__cell">
        <span class="ub-vplace__cap">深度 Depth</span>
        <UbInput
          type="number"
          :model-value="placement.depth"
          :step="1"
          :aria-label="`${title}：深度`"
          @update:model-value="value => updateField('depth', value)"
        />
      </label>
      <label class="ub-vplace__cell">
        <span class="ub-vplace__cap">顺序 Order</span>
        <UbInput
          type="number"
          :model-value="placement.order"
          :min="1"
          :step="1"
          :aria-label="`${title}：顺序`"
          @update:model-value="value => updateField('order', value)"
        />
      </label>
    </div>
  </UbRow>
</template>

<script setup lang="ts">
/** 世界书条目位置：位置＋深度＋顺序三项一行。 */
import type { VisualizerPlacementDraft } from '../../../presentation-v2/composables/visualizer/useVisualizerConfigEditing';
import UbInput from '../../ui/UbInput.vue';
import UbRow from '../../ui/UbRow.vue';
import UbSelect from '../../ui/UbSelect.vue';

withDefaults(defineProps<{
  title: string;
  hint?: string;
  placement: VisualizerPlacementDraft;
  options: Array<{ value: string; label: string }>;
  updateField: (field: keyof VisualizerPlacementDraft, value: string | number) => void;
}>(), {
  hint: undefined,
});
</script>

<style scoped>
.ub-vplace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 120px) minmax(0, 120px);
  gap: var(--ub-s2);
}

.ub-vplace__cell {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  min-width: 0;
}

.ub-vplace__cap {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

@media (max-width: 560px) {
  .ub-vplace {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .ub-vplace__cell--pos {
    grid-column: 1 / -1;
  }
}
</style>
