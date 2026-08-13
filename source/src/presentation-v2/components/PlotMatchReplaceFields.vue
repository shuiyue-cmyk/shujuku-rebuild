<template>
  <fieldset class="acu-v2-plot-match-fields">
    <legend>匹配替换（进阶）</legend>
    <AcuText variant="hint" class="acu-v2-plot-match-fields__hint">
      替换提示词占位符（sulv1~4、zhaohui），随当前剧情推进预设保存；导出 JSON 时默认值会自动省略。
    </AcuText>
    <div class="acu-v2-plot-match-fields__grid">
      <AcuFormRow label="sulv1">
        <AcuInput
          type="number"
          :step="0.05"
          :model-value="rateMain"
          @change="emitRate('rateMain', Number($event))"
        />
      </AcuFormRow>
      <AcuFormRow label="sulv2">
        <AcuInput
          type="number"
          :step="0.05"
          :model-value="ratePersonal"
          @change="emitRate('ratePersonal', Number($event))"
        />
      </AcuFormRow>
      <AcuFormRow label="sulv3">
        <AcuInput
          type="number"
          :step="0.05"
          :model-value="rateErotic"
          @change="emitRate('rateErotic', Number($event))"
        />
      </AcuFormRow>
      <AcuFormRow label="sulv4">
        <AcuInput
          type="number"
          :step="0.05"
          :model-value="rateCuckold"
          @change="emitRate('rateCuckold', Number($event))"
        />
      </AcuFormRow>
      <AcuFormRow label="zhaohui">
        <AcuInput
          type="number"
          :step="1"
          :min="1"
          :model-value="recallCount"
          @change="emitRate('recallCount', Math.round(Number($event)))"
        />
      </AcuFormRow>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import type { PlotRateField } from "../composables/usePlotPresetManagement";
import AcuFormRow from "./_lib/AcuFormRow.vue";
import AcuInput from "./_lib/AcuInput.vue";
import AcuText from "./_lib/AcuText.vue";

defineProps<{
  rateMain: number;
  ratePersonal: number;
  rateErotic: number;
  rateCuckold: number;
  recallCount: number;
}>();

const emit = defineEmits<{
  (e: "update-rate", field: PlotRateField, value: number): void;
}>();

function emitRate(field: PlotRateField, value: number): void {
  emit("update-rate", field, value);
}
</script>

<style scoped>
.acu-v2-plot-match-fields {
  margin: 0;
  padding: 0 0 14px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  border-radius: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.acu-v2-plot-match-fields legend {
  padding: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-section-title, 12px);
  font-weight: 600;
}

.acu-v2-plot-match-fields__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}
</style>
