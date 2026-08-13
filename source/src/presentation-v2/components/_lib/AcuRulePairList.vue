<template>
  <AcuDisclosureGroup
    v-if="label"
    root-class="acu-rule-pair-list"
    header-class="acu-rule-pair-list__header"
    body-class="acu-rule-pair-list__body"
    chevron-class="acu-rule-pair-list__chevron"
    chevron-open-class="acu-rule-pair-list__chevron--open"
    label-class="acu-rule-pair-list__label"
    meta-class="acu-rule-pair-list__count"
    :label="label"
    :meta="ruleCountText"
    :expanded="expanded"
    body-mode="show"
    @toggle="toggle"
  >
    <div
      v-for="(rule, index) in modelValue" :key="index"
      class="acu-rule-pair-list__row"
    >
      <AcuInput
        :model-value="rule.start"
        type="text"
        :placeholder="startPlaceholder"
        class="acu-rule-pair-list__field"
        @update:model-value="updateField(index, 'start', $event as string)"
      />
      <span class="acu-rule-pair-list__sep">→</span>
      <AcuInput
        :model-value="rule.end"
        type="text"
        :placeholder="endPlaceholder"
        class="acu-rule-pair-list__field"
        @update:model-value="updateField(index, 'end', $event as string)"
      />
      <AcuIconButton
        icon="fa-solid fa-trash-can"
        variant="danger"
        size="sm"
        title="删除此规则"
        @click="remove(index)"
      />
    </div>
    <div v-if="!modelValue.length" class="acu-rule-pair-list__empty">
      暂无规则，点击下方按钮添加。
    </div>
    <AcuButton size="sm" class="acu-rule-pair-list__add" @click="add">
      <i class="fa-solid fa-plus"></i> {{ addLabel }}
    </AcuButton>
  </AcuDisclosureGroup>

  <div v-else class="acu-rule-pair-list acu-rule-pair-list--standalone">
    <div class="acu-rule-pair-list__body">
      <div
        v-for="(rule, index) in modelValue" :key="index"
        class="acu-rule-pair-list__row"
      >
        <AcuInput
          :model-value="rule.start"
          type="text"
          :placeholder="startPlaceholder"
          class="acu-rule-pair-list__field"
          @update:model-value="updateField(index, 'start', $event as string)"
        />
        <span class="acu-rule-pair-list__sep">→</span>
        <AcuInput
          :model-value="rule.end"
          type="text"
          :placeholder="endPlaceholder"
          class="acu-rule-pair-list__field"
          @update:model-value="updateField(index, 'end', $event as string)"
        />
        <AcuIconButton
          icon="fa-solid fa-trash-can"
          variant="danger"
          size="sm"
          title="删除此规则"
          @click="remove(index)"
        />
      </div>
      <div v-if="!modelValue.length" class="acu-rule-pair-list__empty">
        暂无规则，点击下方按钮添加。
      </div>
      <AcuButton size="sm" class="acu-rule-pair-list__add" @click="add">
        <i class="fa-solid fa-plus"></i> {{ addLabel }}
      </AcuButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuButton from './AcuButton.vue';
import AcuDisclosureGroup from './AcuDisclosureGroup.vue';
import AcuIconButton from './AcuIconButton.vue';
import AcuInput from './AcuInput.vue';

export interface RulePair {
  start: string;
  end: string;
}

const props = withDefaults(defineProps<{
  modelValue: RulePair[];
  label?: string;
  startPlaceholder?: string;
  endPlaceholder?: string;
  addLabel?: string;
}>(), {
  label: '',
  startPlaceholder: '开始词',
  endPlaceholder: '结束词',
  addLabel: '添加规则',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: RulePair[]): void;
}>();

// 默认始终折叠（包括空规则）。规则编辑是低频操作，折叠态减少视觉噪声；
// 空状态用户点 header 展开后即可见添加按钮。不持久化：MainArea / 抽屉重挂载
// 时该 ref 自然回到折叠态（D25）。
const expanded = ref(false);
const ruleCountText = computed(() => props.modelValue.length === 0 ? '暂无' : `${props.modelValue.length} 条`);

function toggle(): void {
  expanded.value = !expanded.value;
}

function clone(): RulePair[] {
  return props.modelValue.map(r => ({ ...r }));
}

function add(): void {
  if (props.label && !expanded.value) expanded.value = true;
  const next = clone();
  next.push({ start: '', end: '' });
  emit('update:modelValue', next);
}

function remove(index: number): void {
  const next = clone();
  next.splice(index, 1);
  emit('update:modelValue', next);
}

function updateField(index: number, field: 'start' | 'end', value: string): void {
  const next = clone();
  next[index] = { ...next[index], [field]: value };
  emit('update:modelValue', next);
}
</script>

<style scoped>
.acu-rule-pair-list--standalone {
  display: flex; flex-direction: column; gap: 6px;
}

.acu-rule-pair-list__body {
  display: flex; flex-direction: column; gap: 6px;
}

.acu-rule-pair-list--standalone .acu-rule-pair-list__body {
  /* 老接口：未提供 label 时直接展示，无外层 padding */
  border-top: 0;
  padding: 0;
}

.acu-rule-pair-list__row {
  display: flex; align-items: center; gap: 6px;
}

.acu-rule-pair-list__field { flex: 1; min-width: 0; }

.acu-rule-pair-list__sep {
  flex-shrink: 0; font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3);
}

.acu-rule-pair-list__empty {
  padding: 8px; text-align: center;
  color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px);
}

.acu-rule-pair-list__add {
  align-self: flex-start;
}
</style>
