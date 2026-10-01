<template>
  <section class="acu-v2-plot-page">
    <AcuPanelGrid class="acu-v2-plot-page__grid">
      <PlotPresetPanel />

      <!-- 发送体验 -->
      <AcuPanel
        title="发送体验"
        description="控制剧情推进等待期间聊天区的占位反馈，纯展示开关，不改任何发送逻辑。"
      >
        <AcuFormRow
          label="伪装发送楼层"
          hint="开启后，剧情推进与纪要召回等待期间在聊天区显示伪装的用户楼层与“思考中”楼层，并拦截重复发送；关闭则保持原有行为（消息停在输入框直到规划完成）。"
        >
          <AcuToggle
            :model-value="plotPresetStore.pendingDisguiseEnabled"
            label="等待期间显示伪装发送楼层"
            @update:model-value="plotPresetStore.setPendingDisguiseEnabled($event)"
          />
        </AcuFormRow>
      </AcuPanel>

      <!-- 世界书选择 -->
      <AcuPanel
        :title="plotCopy.panels.worldbook.title"
        :description="plotCopy.panels.worldbook.description"
      >

        <WorldbookEntryPickerBody
          :source="plotWorldbook.source.value"
          :selected-names="plotWorldbook.manualSelection.value"
          :names="worldbook.names.value"
          :selector-status="worldbook.status.value"
          :selector-error="worldbook.error.value"
          :current-label="currentWorldbookLabel"
          v-model:filter="entryFilter"
          :groups="wbEntries.groups.value"
          :loading="wbEntries.status.value === 'loading'"
          :entry-status="wbEntries.status.value"
          :entry-error="wbEntries.error.value"
          :empty-text="entryEmptyText"
          @update:source="onWorldbookSourceChange($event)"
          @toggle-book="onManualWorldbookToggle"
          @select-all="wbEntries.selectAll()"
          @deselect-all="wbEntries.deselectAll()"
          @toggle="(bookName: string, uid: number, checked: boolean) => wbEntries.toggleEntry(bookName, uid, checked)"
          @toggle-group="wbEntries.toggleGroupExpanded($event)"
        />
      </AcuPanel>
    </AcuPanelGrid>

  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuToggle from '../components/_lib/AcuToggle.vue';
import { usePlotPresetStore } from '../stores/plot-preset-store';
import PlotPresetPanel from '../components/PlotPresetPanel.vue';
import WorldbookEntryPickerBody from '../components/WorldbookEntryPickerBody.vue';
import { useWorldbookSelector } from '../composables/useWorldbookSelector';
import { usePlotWorldbookConfig } from '../composables/usePlotWorldbookConfig';
import { usePlotWorldbookEntries } from '../composables/usePlotWorldbookEntries';
import { watchChatChanged_ACU } from '../composables/useChatChangedListener';
import { plotCopy } from '../copy/plot-copy';

type WorldbookSource = 'character' | 'manual';
const plotPresetStore = usePlotPresetStore();
const worldbook = useWorldbookSelector();
const plotWorldbook = usePlotWorldbookConfig();
const wbEntries = usePlotWorldbookEntries();
const entryFilter = ref('');
const entryEmptyText = ref(plotCopy.worldbook.emptyDefault);

async function refreshWorldbookEntries(): Promise<void> {
  let names: string[];
  try {
    names = await plotWorldbook.resolveBookNames();
  } catch {
    wbEntries.reportLoadFailure();
    return;
  }
  entryEmptyText.value = resolveEntryEmptyText(names);
  await wbEntries.loadEntries(names);
}

function resolveEntryEmptyText(names: string[]): string {
  if (plotWorldbook.source.value === 'character' && names.length === 0) {
    return plotCopy.worldbook.emptyCharacter;
  }
  if (plotWorldbook.source.value === 'manual' && plotWorldbook.manualSelection.value.length === 0) {
    return plotCopy.worldbook.emptyManual;
  }
  return plotCopy.worldbook.emptyDefault;
}

function onWorldbookSourceChange(value: WorldbookSource): void {
  plotWorldbook.setSource(value);
  void refreshWorldbookEntries();
}

function onManualWorldbookToggle(name: string, checked: boolean): void {
  plotWorldbook.toggleManualBook(name, checked);
  void refreshWorldbookEntries();
}


const currentWorldbookLabel = computed<string>(() => {
  if (plotWorldbook.source.value === 'character') {
    return worldbook.charPrimary.value
      ? `角色卡所有世界书 · 主册 ${worldbook.charPrimary.value}`
      : '角色卡所有世界书';
  }
  const names = plotWorldbook.manualSelection.value;
  return names.length ? names.join('、') : '（未选择）';
});

async function refreshAll(): Promise<void> {
  plotPresetStore.refreshFromSettings();
  plotWorldbook.refreshFromSettings();
  await worldbook.refresh();
  await refreshWorldbookEntries();
}

onMounted(() => { void refreshAll(); });

watchChatChanged_ACU(() => { void refreshAll(); });
</script>

<style scoped>
.acu-v2-plot-page { min-height: 100%; min-width: 0; padding: 20px; display: flex; flex-direction: column; gap: 18px; }

@media (max-width: 860px) {
  .acu-v2-plot-page { padding: 14px; }
}
</style>
