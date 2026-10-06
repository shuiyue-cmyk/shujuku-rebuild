<template>
  <UbSection
    :id="id"
    :title="formFillCopy.panels.update.title"
    :description="formFillCopy.panels.update.description"
    icon="fa-solid fa-arrows-rotate"
  >
    <UbRow label="填表 API 预设" hint="默认使用当前 API；选择后只影响填表。" :flagged="tableFillStale">
      <UbSelect
        :options="tableApiPresetOptions"
        :model-value="settings.tableApiPreset.value"
        :placeholder="followActiveApiLabel"
        aria-label="填表 API 预设"
        @update:model-value="setTableApiPreset"
      />
    </UbRow>
    <UbRow label="自动填表间隔" hint="累计到所选数量的可更新 AI 回复后，自动填表一次。">
      <UbSelect
        :options="updateEveryOptions"
        :model-value="selectedUpdateEvery"
        :placeholder="selectedUpdateEvery === 'custom' ? '自定义' : '选择更新间隔'"
        aria-label="自动填表间隔"
        @update:model-value="applyUpdateEvery"
      />
    </UbRow>
    <UbRow :label="skipLatestLayerLabel" :hint="skipLatestLayerHint">
      <UbSwitch :model-value="skipLatestLayer" aria-label="最新层不填表" @update:model-value="setSkipLatestLayer" />
    </UbRow>
    <UbRow
      label="原生工具提交"
      :hint="settings.nativeToolsLockedReason.value || '开启后改走 table_sql 原生工具提交，默认提示词同步切换为工具版；模型不调用工具时回退正文提取。仅非流式请求生效。'"
    >
      <UbSwitch
        :model-value="settings.nativeToolsEnabled.value"
        :disabled="settings.nativeToolsDisabled.value"
        aria-label="填表时调用 table_sql 原生工具"
        @update:model-value="settings.setNativeToolsEnabled($event)"
      />
    </UbRow>
    <template v-if="showAdvanced">
      <button
        type="button"
        class="ub-upd__more"
        :aria-expanded="advancedExpanded ? 'true' : 'false'"
        @click="advancedExpanded = !advancedExpanded"
      >
        <i class="fa-solid fa-chevron-right ub-upd__chevron" :class="{ 'is-open': advancedExpanded }" aria-hidden="true"></i>
        高级参数
        <UbBadge :variant="advancedMetaLabel === '自定义' ? 'accent' : 'neutral'">{{ advancedMetaLabel }}</UbBadge>
      </button>
      <template v-if="advancedExpanded">
        <UbRow v-for="field in advancedFields" :key="field.key" :label="field.label" :hint="field.hint">
          <UbInput
            type="number"
            :min="field.min"
            :step="field.step"
            :model-value="field.value"
            :aria-label="field.label"
            @change="settings.setNumber(field.key, $event)"
          />
        </UbRow>
      </template>
    </template>
  </UbSection>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApiPresetSelectOptions } from '../../presentation-v2/composables/useApiPresetSelectOptions';
import { useApiPresetStaleness } from '../../presentation-v2/composables/useApiPresetStaleness';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useFormFillSettings, type NumberSettingKey } from '../../presentation-v2/composables/useFormFillSettings';
import { formFillCopy } from '../../presentation-v2/copy/form-fill-copy';
import UbBadge from '../ui/UbBadge.vue';
import UbInput from '../ui/UbInput.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect, { type UbSelectOption } from '../ui/UbSelect.vue';
import UbSwitch from '../ui/UbSwitch.vue';

type UpdateEveryId = '1' | '3' | '5' | 'custom';

withDefaults(defineProps<{ id?: string; showAdvanced?: boolean }>(), {
  id: undefined,
  showAdvanced: true,
});

const settings = useFormFillSettings();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: tableApiPresetOptions } = useApiPresetSelectOptions();
// 防呆：API 预设在别处被改过时这一行标黄，手动重选一次即确认
const { isStale: tableFillStale, markConfirmed: markTableFillConfirmed } = useApiPresetStaleness('table-fill');
const advancedExpanded = ref(false);

const updateEveryOptions: UbSelectOption[] = [
  { value: '1', label: '每 1 层：最及时' },
  { value: '3', label: '每 3 层：均衡' },
  { value: '5', label: '每 5 层：低频省 API' },
];

const ADVANCED_KEYS = new Set<NumberSettingKey>([
  'autoUpdateThreshold',
  'autoUpdateFrequency',
  'updateBatchSize',
  'skipUpdateFloors',
  'autoUpdateTokenThreshold',
  'tableMaxRetries',
]);

const advancedFields = computed(() => settings.numberFields.value.filter(field => ADVANCED_KEYS.has(field.key)));

function numberValue(key: NumberSettingKey): number {
  return settings.numberFields.value.find(field => field.key === key)?.value ?? 0;
}

/** 预设档位与三项高级参数联动：上下文层数 / 频率 / 批处理层数。 */
function contextDepthForInterval(interval: number): number {
  return interval <= 3 ? 3 : interval;
}

function batchSizeForInterval(interval: number): number {
  return interval === 1 ? 3 : interval;
}

const selectedUpdateEvery = computed<UpdateEveryId>(() => {
  for (const id of ['1', '3', '5'] as const) {
    const interval = Number(id);
    if (
      numberValue('autoUpdateThreshold') === contextDepthForInterval(interval)
      && numberValue('autoUpdateFrequency') === interval
      && numberValue('updateBatchSize') === batchSizeForInterval(interval)
    ) {
      return id;
    }
  }
  return 'custom';
});

const isCustomSkip = computed(() => numberValue('skipUpdateFloors') > 1);
const advancedMetaLabel = computed(() => (selectedUpdateEvery.value === 'custom' || isCustomSkip.value ? '自定义' : '默认'));
const skipLatestLayer = computed(() => numberValue('skipUpdateFloors') >= 1);
const skipLatestLayerLabel = computed(() => (isCustomSkip.value ? '最新层不填表：自定义' : '最新层不填表'));
const skipLatestLayerHint = computed(() => {
  const skip = numberValue('skipUpdateFloors');
  if (skip > 1) {
    return `当前高级参数设置为跳过最新 ${skip} 层；关闭会改为不跳过，开启会改为只让最新层不填表。`;
  }
  return '开启后，最新一条 AI 回复先不写入表格，等下一层出现后再处理；经常重 roll 最新楼层时建议开启。';
});

function setTableApiPreset(value: string): void {
  settings.setTableApiPreset(value);
  markTableFillConfirmed();
}

function applyUpdateEvery(value: string): void {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval < 1) return;
  settings.setNumbers({
    autoUpdateThreshold: contextDepthForInterval(interval),
    autoUpdateFrequency: interval,
    updateBatchSize: batchSizeForInterval(interval),
  });
}

function setSkipLatestLayer(value: boolean): void {
  settings.setNumber('skipUpdateFloors', value ? 1 : 0);
}

function refreshAll(): void {
  settings.refresh();
  apiStore.refreshFromSettings();
}

onMounted(refreshAll);
watchChatChanged_ACU(refreshAll);
</script>

<style scoped>
.ub-upd__more {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  width: 100%;
  padding: var(--ub-s3) var(--ub-s4);
  border: 0;
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.ub-upd__more:hover {
  color: var(--ub-text);
}

.ub-upd__chevron {
  font-size: 0.75em;
  transition: transform 0.16s ease;
}

.ub-upd__chevron.is-open {
  transform: rotate(90deg);
}

.ub-upd__more + .ub-row,
.ub-upd__more ~ .ub-row {
  background: color-mix(in srgb, var(--ub-sunken) 50%, transparent);
}
</style>
