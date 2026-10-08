<template>
  <UbSection :id="id" :title="plotCopy.panels.preset.title" :description="plotCopy.panels.preset.description" icon="fa-solid fa-route">
    <template #actions>
      <UbBadge v-if="!store.hasPresets">使用默认预设</UbBadge>
      <UbBadge :variant="store.isChatOverridden ? 'accent' : 'neutral'">{{ store.isChatOverridden ? '已覆盖全局' : '跟随全局' }}</UbBadge>
    </template>
    <div class="ub-plotp" :class="{ 'has-below': showApiPreset }">
      <dl class="ub-plotp__facts">
        <div>
          <dt>当前聊天</dt>
          <dd>{{ store.activePresetName || '默认预设' }}</dd>
        </div>
        <div>
          <dt>全局默认</dt>
          <dd>{{ store.defaultPresetName || '默认预设' }}</dd>
        </div>
      </dl>
      <div class="ub-plotp__picker">
        <UbPresetPicker
          title="选择剧情推进预设"
          :items="presetItems"
          :model-value="store.activePresetName"
          :default-name="store.defaultPresetName"
          @update:model-value="store.setActivePresetForCurrentChat($event)"
          @set-default="store.setDefaultPreset($event)"
        />
        <UbIconButton
          v-if="showEdit"
          icon="fa-solid fa-pen"
          variant="solid"
          :title="store.activePreset ? '编辑当前预设' : '从默认新建预设'"
          @click="management.openEditCurrent"
        />
        <UbFileButton icon-only icon="fa-solid fa-download" title="导入预设 JSON" accept="application/json,.json" @file="onImportFile" />
        <UbIconButton icon="fa-solid fa-gear" title="管理预设" @click="management.openManage" />
      </div>
    </div>
    <UbRow v-if="showApiPreset" label="剧情推进 API 预设" hint="默认使用当前 API；选择后只影响剧情推进。" :flagged="plotStale">
      <UbSelect
        :options="pageApiSelectOptions"
        :model-value="store.pageApiPresetName"
        :placeholder="followActiveApiLabel"
        aria-label="剧情推进 API 预设"
        @update:model-value="setPageApiPreset"
      />
    </UbRow>

    <PlotPresetSheet
      :is-open="management.isDrawerOpen.value"
      :view="management.drawerView.value"
      :title="management.title.value"
      :error="management.error.value"
      :draft-meta="management.draftMeta"
      :context-rules="management.contextRules"
      :preset-meta="management.presetMeta.value"
      :default-preset-name="store.defaultPresetName"
      :api-preset-options="apiPresetOptions"
      :task-editing="management.taskEditing"
      :current-task-api-override="currentTaskApiOverride"
      :show-advanced-rates="devOptions.plotAdvanced.value"
      :rates="management.draftRates"
      :before-close="() => management.confirmIfDirty()"
      @close="management.closeDrawer"
      @back="management.backToManage"
      @open-create="management.openCreate"
      @open-edit="management.openEdit($event)"
      @set-default="store.setDefaultPreset($event)"
      @delete="onDelete"
      @export="onExport"
      @save="management.saveDraft"
      @update-name="management.draftMeta.name = $event"
      @update-context-extract-rules="management.setContextExtractRules"
      @update-context-exclude-rules="management.setContextExcludeRules"
      @update-task-api-override="onTaskApiOverride"
      @update-rate="management.setDraftRate"
    />
  </UbSection>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { downloadTextToHost_ACU } from '../../presentation-v2/bootstrap/host-download';
import { useApiPresetSelectOptions } from '../../presentation-v2/composables/useApiPresetSelectOptions';
import { useApiPresetStaleness } from '../../presentation-v2/composables/useApiPresetStaleness';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useDevOptions } from '../../presentation-v2/composables/useDevOptions';
import { usePlotPresetManagement } from '../../presentation-v2/composables/usePlotPresetManagement';
import { useUiCloseGuard } from '../../presentation-v2/composables/useUiCloseGuard';
import { plotCopy } from '../../presentation-v2/copy/plot-copy';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { usePlotPresetStore } from '../../presentation-v2/stores/plot-preset-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import UbBadge from '../ui/UbBadge.vue';
import UbFileButton from '../ui/UbFileButton.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbPresetPicker from '../ui/UbPresetPicker.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect from '../ui/UbSelect.vue';
import { readFileText_UB } from '../ui/file-helpers';
import PlotPresetSheet from './PlotPresetSheet.vue';

withDefaults(defineProps<{ id?: string; showEdit?: boolean; showApiPreset?: boolean }>(), {
  id: undefined,
  showEdit: true,
  showApiPreset: true,
});

const store = usePlotPresetStore();
const dialogStore = useDialogStore();
const toast = useToastStore();
const management = usePlotPresetManagement();
const devOptions = useDevOptions();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: pageApiSelectOptions } = useApiPresetSelectOptions();
// 防呆：API 预设在别处被改过时标黄，手动重选一次即确认
const { isStale: plotStale, markConfirmed: markPlotConfirmed } = useApiPresetStaleness('plot-page');

const presetItems = computed(() => [
  { value: '', label: '默认预设', meta: `${store.defaultPresetTaskCount} 个任务` },
  ...store.presets.map(p => ({
    value: p.name,
    label: p.name,
    meta: `${Array.isArray(p.raw?.plotTasks) ? p.raw.plotTasks.length : 0} 个任务`,
  })),
]);

const apiPresetOptions = computed(() => apiStore.presets.map(p => ({ name: p.name })));

const currentTaskApiOverride = computed(() => {
  const taskId = management.taskEditing.currentTaskId.value;
  return taskId ? store.taskApiOverrides[taskId] || '' : '';
});

function setPageApiPreset(value: string): void {
  store.setPageApiPreset(value);
  markPlotConfirmed();
}

function onTaskApiOverride(value: string): void {
  const taskId = management.taskEditing.currentTaskId.value;
  if (taskId) store.setTaskApiOverride(taskId, value);
}

async function onDelete(name: string): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: '删除剧情推进预设',
    message: `删除剧情推进预设"${name}"？`,
    confirmLabel: '删除预设',
    confirmVariant: 'danger',
  });
  if (confirmed) management.deletePreset(name);
}

function onExport(name: string): void {
  const text = management.exportPresetAsText(name);
  if (!text) return;
  try {
    downloadTextToHost_ACU(`${name}.plot-preset.json`, text);
    toast.success('剧情推进预设 JSON 已导出。');
  } catch {
    toast.error('剧情推进预设 JSON 导出失败。');
  }
}

async function onImportFile(file: File): Promise<void> {
  try {
    await management.importFromJsonText(await readFileText_UB(file));
  } catch {
    toast.error('剧情推进预设导入失败。');
  }
}

function refreshAll(): void {
  store.refreshFromSettings();
  apiStore.refreshFromSettings();
}

useUiCloseGuard(() => (management.isDrawerOpen.value ? management.confirmIfDirty() : true));
onMounted(refreshAll);
watchChatChanged_ACU(refreshAll);
</script>

<style scoped>
.ub-plotp {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
}

.ub-plotp.has-below {
  border-bottom: 1px solid var(--ub-line-soft);
}

.ub-plotp__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ub-s2);
  margin: 0;
}

.ub-plotp__facts > div {
  min-width: 0;
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
}

.ub-plotp__facts dt {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

.ub-plotp__facts dd {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-plotp__picker {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
}
</style>
