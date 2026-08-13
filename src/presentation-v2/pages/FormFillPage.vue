<template>
  <section class="acu-v2-form-fill-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-form-fill-page__grid">
      <AcuPanel
        id="form-fill-status-panel"
        class="acu-v2-form-fill-page__panel--status"
        :title="formFillCopy.panels.status.title"
        :description="formFillCopy.panels.status.description"
      >
        <AcuText
          variant="status-line"
          class="acu-v2-form-fill-page__status-line"
          aria-label="表格状态概览"
        >
          当前聊天:
          <strong
            class="acu-text__value acu-v2-form-fill-page__status-chat"
            :title="dashboard.chatFileIdentifier.value || '未初始化'"
          >
            {{ dashboard.chatFileIdentifier.value || "未初始化" }}
          </strong>
          · AI回复累计层数:
          <strong class="acu-text__value">{{
            dashboard.aiMessageCount.value
          }}</strong>
          · 当前 full checkpoint:
          <strong class="acu-text__value acu-v2-form-fill-page__checkpoint-label">
            {{ manualUpdate.checkpointFloorsLabel.value }}
          </strong>
        </AcuText>

        <AcuMessage kind="info">
          按当前手动填表设置，预计处理范围：{{ manualUpdate.manualRefillRangeLabel.value }}。
        </AcuMessage>

        <AcuMessage v-if="!dashboard.hasTables.value" kind="info">
          当前尚未加载数据库表格。
        </AcuMessage>

        <div class="acu-v2-form-fill-page__table-wrap">
          <table class="acu-v2-form-fill-page__status-table">
            <thead>
              <tr>
                <th>表格</th>
                <th>频率</th>
                <th>未记录</th>
                <th>上次更新</th>
                <th>下次触发</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!dashboard.tableRows.value.length">
                <td colspan="5" class="acu-v2-form-fill-page__empty">
                  暂无数据
                </td>
              </tr>
              <tr
                v-for="row in dashboard.tableRows.value"
                :key="row.key"
                :class="{
                  'acu-v2-form-fill-page__status-row--ready': row.ready,
                }"
              >
                <td>{{ row.name }}</td>
                <td>{{ row.frequencyLabel }}</td>
                <td>{{ row.unrecordedLabel }}</td>
                <td>{{ row.lastUpdatedLabel }}</td>
                <td>
                  <AcuBadge v-if="row.ready" variant="success">就绪</AcuBadge>
                  <span v-else>{{ row.nextTriggerLabel }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AcuPanel>

      <FormFillUpdateSettingsPanel
        id="form-fill-update-panel"
        class="acu-v2-form-fill-page__panel--update"
      />

      <TableTemplatePresetPanel
        id="form-fill-template-panel"
        class="acu-v2-form-fill-page__panel--template"
      />

      <AcuPanel
        id="form-fill-manual-panel"
        class="acu-v2-form-fill-page__panel--manual"
        :title="formFillCopy.panels.manual.title"
        :description="formFillCopy.panels.manual.description"
      >
        <div class="acu-v2-form-fill-page__manual-number-grid">
          <AcuFormRow
            label="手动处理最近 N 层"
            hint="从可用 AI 回复中取最近 N 层执行手动填表。"
          >
            <AcuInput
              type="number"
              :min="0"
              :step="1"
              :model-value="manualUpdate.manualContextDepth.value"
              @change="manualUpdate.setManualContextDepth($event)"
            />
          </AcuFormRow>

          <AcuFormRow
            label="每 N 层合并为一次填表"
            hint="把多少层 AI 回复压缩成一次填表请求。"
          >
            <AcuInput
              type="number"
              :min="1"
              :step="1"
              :model-value="manualUpdate.manualBatchSize.value"
              @change="manualUpdate.setManualBatchSize($event)"
            />
          </AcuFormRow>
        </div>

        <AcuMessage kind="info">
          当前 full checkpoint：{{ manualUpdate.checkpointFloorsLabel.value }}；按当前设置预计处理范围：{{ manualUpdate.manualRefillRangeLabel.value }}。
          选中表：{{ manualUpdate.selectedSheetSummary.value }}。
        </AcuMessage>

        <TableSelector
          :sheet-keys="manualUpdate.sheetKeys.value"
          :selected-keys="manualUpdate.selectedManualTableKeys.value"
          :sheet-names="manualUpdate.sheetNames.value"
          :disabled="!manualUpdate.runtimeReady.value"
          empty-text="当前没有可手动填表的表格。"
          @update:selected-keys="manualUpdate.setManualSelectedKeys($event)"
          @select-all="manualUpdate.selectAllManualTables"
          @select-none="manualUpdate.selectNoManualTables"
        />

        <div class="acu-v2-form-fill-page__manual-extra">
          <AcuFormRow
            label="本次填表附加要求"
            hint="留空时不会给本次手动填表追加额外要求。"
          >
            <AcuTextarea
              :model-value="manualUpdate.manualExtraHint.value"
              :rows="4"
              placeholder="仅用于本次手动填表..."
              @update:model-value="manualUpdate.manualExtraHint.value = $event"
            />
          </AcuFormRow>
        </div>

        <AcuMessage v-if="manualUpdate.vectorIndexWarning.value" kind="warning">
          交火模式纪要索引启用时不建议手动更新表格；特殊场景下仍可点击执行。
        </AcuMessage>
        <AcuMessage kind="info">
          {{ formFillCopy.panels.manual.catchUpBoundary }}
        </AcuMessage>

        <div class="acu-v2-form-fill-page__actions">
          <AcuButton
            variant="secondary"
            :disabled="
              manualUpdate.manualUpdateBusy.value ||
              manualUpdate.catchUpBusy.value ||
              !manualUpdate.selectedManualTableKeys.value.length
            "
            @click="manualUpdate.runManualCatchUp"
          >
            {{
              manualUpdate.catchUpBusy.value
                ? formFillCopy.panels.manual.catchUpBusyLabel
                : formFillCopy.panels.manual.catchUpLabel
            }}
          </AcuButton>
          <AcuButton
            variant="primary"
            :disabled="
              manualUpdate.manualUpdateBusy.value ||
              manualUpdate.catchUpBusy.value ||
              !manualUpdate.selectedManualTableKeys.value.length
            "
            @click="manualUpdate.runManualUpdate"
          >
            {{
              manualUpdate.manualUpdateBusy.value
                ? "填表中..."
                : manualUpdate.vectorIndexWarning.value
                  ? "交火索引已启用"
                  : formFillCopy.panels.manual.runLabel
            }}
          </AcuButton>
        </div>
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { onMounted, watch } from "vue";
import AcuBadge from "../components/_lib/AcuBadge.vue";
import AcuButton from "../components/_lib/AcuButton.vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuMobilePanelNav from "../components/_lib/AcuMobilePanelNav.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuText from "../components/_lib/AcuText.vue";
import AcuTextarea from "../components/_lib/AcuTextarea.vue";
import FormFillUpdateSettingsPanel from "../components/FormFillUpdateSettingsPanel.vue";
import TableTemplatePresetPanel from "../components/TableTemplatePresetPanel.vue";
import TableSelector from "../components/TableSelector.vue";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useTemplateRuntimeChangeTick } from "../composables/useTemplateRuntimeChangeListener";
import { useDashboardPage } from "../composables/useDashboardPage";
import { useManualUpdate } from "../composables/useManualUpdate";
import { formFillCopy } from "../copy/form-fill-copy";
import { tableCopy } from "../copy/table-copy";

const dashboard = useDashboardPage();
const manualUpdate = useManualUpdate();
const panelNavItems = [
  { id: "form-fill-status-panel", label: formFillCopy.nav.status },
  { id: "form-fill-update-panel", label: formFillCopy.nav.update },
  { id: "form-fill-manual-panel", label: formFillCopy.nav.manual },
  { id: "form-fill-template-panel", label: tableCopy.panels.templatePreset.title },
];

async function refreshAll(): Promise<void> {
  manualUpdate.refresh();
  await dashboard.refresh();
}

onMounted(() => {
  void refreshAll();
});
watch(useChatChangedTick(), () => {
  void refreshAll();
});
watch(useTemplateRuntimeChangeTick(), () => {
  void refreshAll();
});
</script>

<style scoped>
.acu-v2-form-fill-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-form-fill-page__grid {
  grid-template-areas:
    "status update"
    "manual template"
    "manual template";
}

.acu-v2-form-fill-page__panel--status {
  grid-area: status;
}

.acu-v2-form-fill-page__panel--update {
  grid-area: update;
}

.acu-v2-form-fill-page__panel--template {
  grid-area: template;
}

.acu-v2-form-fill-page__panel--manual {
  grid-area: manual;
}

.acu-v2-form-fill-page__manual-number-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.acu-v2-form-fill-page__status-line {
  margin: 0 0 10px;
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.45);
}

.acu-v2-form-fill-page__status-chat {
  max-width: min(42ch, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-v2-form-fill-page__checkpoint-label {
  color: var(--acu-accent);
}

.acu-v2-form-fill-page__manual-extra {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acu-v2-form-fill-page__checkpoint-risk {
  color: var(--acu-danger);
  font-weight: 700;
}

.acu-v2-form-fill-page__table-wrap {
  min-width: 0;
  overflow: auto;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-0);
}

.acu-v2-form-fill-page__status-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 560px;
  font-size: var(--acu-font-size-body, 12px);
}

.acu-v2-form-fill-page__status-table th,
.acu-v2-form-fill-page__status-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--acu-border-2);
  text-align: left;
}

.acu-v2-form-fill-page__status-table th {
  color: var(--acu-text-3);
  font-weight: 600;
  background: var(--acu-bg-1);
}

.acu-v2-form-fill-page__status-table td {
  color: var(--acu-text-2);
}

.acu-v2-form-fill-page__status-table tr:last-child td {
  border-bottom: 0;
}

.acu-v2-form-fill-page__status-row--ready td {
  color: var(--acu-text-1);
}

.acu-v2-form-fill-page__empty {
  text-align: center !important;
  color: var(--acu-text-3) !important;
}

.acu-v2-form-fill-page__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  margin-top: 4px;
}

@media (max-width: 860px) {
  .acu-v2-form-fill-page {
    padding: 14px;
  }

  .acu-v2-form-fill-page__grid {
    grid-template-areas:
      "status"
      "update"
      "manual"
      "template";
  }

  .acu-v2-form-fill-page__manual-number-grid {
    grid-template-columns: 1fr;
  }
}
</style>
