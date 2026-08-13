<template>
  <div class="acu-dashboard-toggle-row">
    <div class="acu-dashboard-toggle-row__head">
      <span class="acu-dashboard-toggle-row__label">{{ item.label }}</span>
      <AcuToggle
        :model-value="item.value"
        :aria-label="item.label"
        :data-acu-toggle-key="item.key"
        :disabled="item.disabled === true"
        @update:model-value="$emit('change', $event)"
      />
    </div>
    <p v-if="item.description" class="acu-dashboard-toggle-row__desc">{{ item.description }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 仪表盘"开关面板"专用的开关行：标题 + 右侧 toggle + 下方常驻描述。
 *
 * 这是仪表盘内的局部布局，不放进 _lib/，因为还没看到第二个消费者；按 D21.7
 * "两次出现 + 接口稳定才抽"的阈值。当其他面板（例如未来的开发者一级页）出现
 * 同形态需求时再提升到 _lib/AcuToggleRow.vue。
 */
import AcuToggle from './_lib/AcuToggle.vue';

defineProps<{
  item: {
    key: string;
    label: string;
    description: string;
    value: boolean;
    disabled?: boolean;
  };
}>();

defineEmits<{
  (e: 'change', value: boolean): void;
}>();
</script>

<style scoped>
.acu-dashboard-toggle-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acu-dashboard-toggle-row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.acu-dashboard-toggle-row__label {
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 500;
  color: var(--acu-text-1);
  min-width: 0;
}

.acu-dashboard-toggle-row__desc {
  margin: 0;
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
  color: var(--acu-text-3);
}
</style>
