<template>
  <UbPage :sections="sections">
    <UbSection
      id="ff-status"
      :title="formFillCopy.panels.status.title"
      :description="formFillCopy.panels.status.description"
      icon="fa-solid fa-chart-simple"
    >
      <div class="ub-ff-facts" aria-label="表格状态概览">
        <div class="ub-ff-fact ub-ff-fact--wide">
          <span>当前聊天</span>
          <strong :title="dashboard.chatFileIdentifier.value || '未初始化'">{{ dashboard.chatFileIdentifier.value || '未初始化' }}</strong>
        </div>
        <div class="ub-ff-fact">
          <span>AI 回复累计</span>
          <strong>{{ dashboard.aiMessageCount.value }} 层</strong>
        </div>
        <div class="ub-ff-fact">
          <span>full checkpoint</span>
          <strong>{{ manualUpdate.checkpointFloorsLabel.value }}</strong>
        </div>
      </div>
      <div class="ub-ff-notes">
        <UbCallout kind="info">按当前手动填表设置，预计处理范围：{{ manualUpdate.manualRefillRangeLabel.value }}。</UbCallout>
        <UbCallout v-if="!dashboard.hasTables.value" kind="info">当前尚未加载数据库表格。</UbCallout>
      </div>
      <div class="ub-ff-table" role="table" aria-label="各表更新状态">
        <div class="ub-ff-table__row ub-ff-table__row--head" role="row">
          <span role="columnheader">表格</span>
          <span role="columnheader">频率</span>
          <span role="columnheader">未记录</span>
          <span role="columnheader">上次更新</span>
          <span role="columnheader">下次触发</span>
        </div>
        <div v-if="!dashboard.tableRows.value.length" class="ub-ff-table__empty" role="row">暂无数据</div>
        <div
          v-for="row in dashboard.tableRows.value"
          :key="row.key"
          class="ub-ff-table__row"
          :class="{ 'is-ready': row.ready, 'is-off': row.disabled }"
          role="row"
        >
          <span class="ub-ff-table__name" role="cell">{{ row.name }}</span>
          <span role="cell" data-label="频率">{{ row.frequencyLabel }}</span>
          <span role="cell" data-label="未记录">{{ row.unrecordedLabel }}</span>
          <span role="cell" data-label="上次更新">{{ row.lastUpdatedLabel }}</span>
          <span role="cell" data-label="下次触发">
            <UbBadge v-if="row.ready" variant="success">就绪</UbBadge>
            <template v-else>{{ row.nextTriggerLabel }}</template>
          </span>
        </div>
      </div>
    </UbSection>

    <UpdateSettingsSection id="ff-update" />

    <UbSection
      id="ff-manual"
      :title="formFillCopy.panels.manual.title"
      :description="formFillCopy.panels.manual.description"
      icon="fa-solid fa-hand-pointer"
    >
      <UbRow label="手动处理最近 N 层" hint="从可用 AI 回复中取最近 N 层执行手动填表。">
        <UbInput
          type="number"
          :min="0"
          :step="1"
          :model-value="manualUpdate.manualContextDepth.value"
          aria-label="手动处理最近 N 层"
          @change="manualUpdate.setManualContextDepth($event)"
        />
      </UbRow>
      <UbRow label="每 N 层合并为一次填表" hint="把多少层 AI 回复压缩成一次填表请求。">
        <UbInput
          type="number"
          :min="1"
          :step="1"
          :model-value="manualUpdate.manualBatchSize.value"
          aria-label="每 N 层合并为一次填表"
          @change="manualUpdate.setManualBatchSize($event)"
        />
      </UbRow>
      <UbRow label="要处理的表" stack>
        <template #hint>
          full checkpoint：{{ manualUpdate.checkpointFloorsLabel.value }}；预计处理范围：{{ manualUpdate.manualRefillRangeLabel.value }}。选中表：{{ manualUpdate.selectedSheetSummary.value }}。
        </template>
        <TablePicker
          :sheet-keys="manualUpdate.sheetKeys.value"
          :selected-keys="manualUpdate.selectedManualTableKeys.value"
          :sheet-names="manualUpdate.sheetNames.value"
          :disabled="!manualUpdate.runtimeReady.value"
          aria-label="手动填表目标表"
          empty-text="当前没有可手动填表的表格。"
          @update:selected-keys="manualUpdate.setManualSelectedKeys($event)"
          @select-all="manualUpdate.selectAllManualTables"
          @select-none="manualUpdate.selectNoManualTables"
        />
      </UbRow>
      <UbRow label="本次填表附加要求" hint="留空时不追加额外要求；只对这一次手动填表生效。" stack>
        <UbTextarea
          :model-value="manualUpdate.manualExtraHint.value"
          :rows="3"
          auto-resize
          :max-rows="10"
          placeholder="仅用于本次手动填表..."
          aria-label="本次填表附加要求"
          @update:model-value="manualUpdate.manualExtraHint.value = $event"
        />
      </UbRow>
      <div class="ub-ff-run">
        <UbCallout v-if="manualUpdate.vectorIndexWarning.value" kind="warning">
          交火模式纪要索引启用时不建议手动更新表格；特殊场景下仍可点击执行。
        </UbCallout>
        <UbCallout kind="info">{{ formFillCopy.panels.manual.catchUpBoundary }}</UbCallout>
        <div class="ub-ff-run__buttons">
          <UbButton
            icon="fa-solid fa-forward-fast"
            :busy="manualUpdate.catchUpBusy.value"
            :disabled="runDisabled"
            @click="manualUpdate.runManualCatchUp"
          >
            {{ manualUpdate.catchUpBusy.value ? formFillCopy.panels.manual.catchUpBusyLabel : formFillCopy.panels.manual.catchUpLabel }}
          </UbButton>
          <UbButton
            variant="primary"
            icon="fa-solid fa-play"
            :busy="manualUpdate.manualUpdateBusy.value"
            :disabled="runDisabled"
            @click="manualUpdate.runManualUpdate"
          >
            {{
              manualUpdate.manualUpdateBusy.value
                ? '填表中...'
                : manualUpdate.vectorIndexWarning.value
                  ? '交火索引已启用'
                  : formFillCopy.panels.manual.runLabel
            }}
          </UbButton>
        </div>
      </div>
    </UbSection>

    <TableTemplateSection id="ff-template" />
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useDashboardPage } from '../../presentation-v2/composables/useDashboardPage';
import { useManualUpdate } from '../../presentation-v2/composables/useManualUpdate';
import { useTemplateRuntimeChangeTick } from '../../presentation-v2/composables/useTemplateRuntimeChangeListener';
import { formFillCopy } from '../../presentation-v2/copy/form-fill-copy';
import { tableCopy } from '../../presentation-v2/copy/table-copy';
import TablePicker from '../parts/TablePicker.vue';
import TableTemplateSection from '../parts/TableTemplateSection.vue';
import UpdateSettingsSection from '../parts/UpdateSettingsSection.vue';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbTextarea from '../ui/UbTextarea.vue';

const dashboard = useDashboardPage();
const manualUpdate = useManualUpdate();

const sections = [
  { id: 'ff-status', label: formFillCopy.nav.status },
  { id: 'ff-update', label: formFillCopy.nav.update },
  { id: 'ff-manual', label: formFillCopy.nav.manual },
  { id: 'ff-template', label: tableCopy.panels.templatePreset.title },
];

const runDisabled = computed(() =>
  manualUpdate.manualUpdateBusy.value
  || manualUpdate.catchUpBusy.value
  || !manualUpdate.selectedManualTableKeys.value.length,
);

async function refreshAll(): Promise<void> {
  manualUpdate.refresh();
  await dashboard.refresh();
}

onMounted(() => void refreshAll());
watchChatChanged_ACU(() => void refreshAll());
watch(useTemplateRuntimeChangeTick(), () => void refreshAll());
</script>

<style scoped>
.ub-ff-facts {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--ub-line-soft);
  background: var(--ub-line-soft);
}

.ub-ff-fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: var(--ub-s3) var(--ub-s4);
  background: var(--ub-panel);
}

.ub-ff-fact span {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

.ub-ff-fact strong {
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-ff-notes {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4) 0;
}

.ub-ff-table {
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s3);
  font-size: var(--ub-fs-sm);
}

.ub-ff-table__row {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) repeat(4, minmax(0, 1fr));
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s2);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-2);
  font-variant-numeric: tabular-nums;
}

.ub-ff-table__row--head {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

.ub-ff-table__row:not(.ub-ff-table__row--head):hover {
  background: var(--ub-hover);
}

.ub-ff-table__row.is-ready {
  background: var(--ub-ok-soft);
}

.ub-ff-table__row.is-off {
  opacity: 0.6;
}

.ub-ff-table__name {
  overflow: hidden;
  color: var(--ub-text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-ff-table__empty {
  padding: var(--ub-s4);
  color: var(--ub-text-3);
  text-align: center;
}

.ub-ff-run {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4) var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
}

.ub-ff-run__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ub-s2);
  margin-top: var(--ub-s1);
}

@media (max-width: 600px) {
  .ub-ff-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ub-ff-fact--wide {
    grid-column: 1 / -1;
  }

  .ub-ff-table__row--head {
    display: none;
  }

  .ub-ff-table__row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    row-gap: var(--ub-s1);
    padding: var(--ub-s3) var(--ub-s2);
  }

  .ub-ff-table__row + .ub-ff-table__row {
    border-top: 1px solid var(--ub-line-soft);
    border-radius: 0;
  }

  .ub-ff-table__name {
    grid-column: 1 / -1;
  }

  .ub-ff-table__row [data-label]::before {
    content: attr(data-label);
    display: block;
    color: var(--ub-text-3);
    font-size: var(--ub-fs-2xs);
    font-weight: 700;
  }

  .ub-ff-run__buttons > * {
    flex: 1 1 100%;
  }
}
</style>
