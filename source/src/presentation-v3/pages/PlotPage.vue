<template>
  <UbPage :sections="sections">
    <PlotPresetSection id="plot-preset" />

    <UbSection
      id="plot-experience"
      title="发送体验"
      description="控制剧情推进等待期间聊天区的占位反馈，纯展示开关，不改任何发送逻辑。"
      icon="fa-solid fa-hourglass-half"
    >
      <UbRow
        label="伪装发送楼层"
        hint="开启后，剧情推进与纪要召回等待期间在聊天区显示伪装的用户楼层与“思考中”楼层，并拦截重复发送；关闭则消息停在输入框直到规划完成。"
      >
        <UbSwitch
          :model-value="plotPresetStore.pendingDisguiseEnabled"
          aria-label="等待期间显示伪装发送楼层"
          @update:model-value="plotPresetStore.setPendingDisguiseEnabled($event)"
        />
      </UbRow>
    </UbSection>

    <UbSection
      id="plot-worldbook"
      :title="plotCopy.panels.worldbook.title"
      :description="plotCopy.panels.worldbook.description"
      icon="fa-solid fa-book"
      padded
    >
      <WorldbookSourcePicker
        :source="plotWorldbook.source.value"
        :selected-names="plotWorldbook.manualSelection.value"
        :names="worldbook.names.value"
        :status="worldbook.status.value"
        :error="worldbook.error.value"
        @update:source="onWorldbookSourceChange($event as WorldbookSource)"
        @toggle-book="onManualWorldbookToggle"
      />
      <p class="ub-plot__current">目前已选：<strong>{{ currentWorldbookLabel }}</strong></p>
      <WorldbookEntries
        id-prefix="plot"
        :groups="wbEntries.groups.value"
        :filter="entryFilter"
        :loading="wbEntries.status.value === 'loading'"
        :status="wbEntries.status.value"
        :error="wbEntries.error.value"
        :empty-text="entryEmptyText"
        @update:filter="entryFilter = $event"
        @select-all="wbEntries.selectAll($event)"
        @deselect-all="wbEntries.deselectAll($event)"
        @toggle="(bookName, uid, checked) => wbEntries.toggleEntry(bookName, uid, checked)"
        @toggle-group="wbEntries.toggleGroupExpanded($event)"
      />
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { usePlotWorldbookConfig } from '../../presentation-v2/composables/usePlotWorldbookConfig';
import { usePlotWorldbookEntries } from '../../presentation-v2/composables/usePlotWorldbookEntries';
import { useWorldbookSelector } from '../../presentation-v2/composables/useWorldbookSelector';
import { plotCopy } from '../../presentation-v2/copy/plot-copy';
import { usePlotPresetStore } from '../../presentation-v2/stores/plot-preset-store';
import PlotPresetSection from '../parts/PlotPresetSection.vue';
import WorldbookEntries from '../parts/WorldbookEntries.vue';
import WorldbookSourcePicker from '../parts/WorldbookSourcePicker.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSwitch from '../ui/UbSwitch.vue';

type WorldbookSource = 'character' | 'manual';

const plotPresetStore = usePlotPresetStore();
const worldbook = useWorldbookSelector();
const plotWorldbook = usePlotWorldbookConfig();
const wbEntries = usePlotWorldbookEntries();
const entryFilter = ref('');
const entryEmptyText = ref(plotCopy.worldbook.emptyDefault);

const sections = [
  { id: 'plot-preset', label: '预设' },
  { id: 'plot-experience', label: '发送体验' },
  { id: 'plot-worldbook', label: '世界书' },
];

const currentWorldbookLabel = computed(() => {
  if (plotWorldbook.source.value === 'character') {
    return worldbook.charPrimary.value ? `角色卡所有世界书 · 主册 ${worldbook.charPrimary.value}` : '角色卡所有世界书';
  }
  const names = plotWorldbook.manualSelection.value;
  return names.length ? names.join('、') : '（未选择）';
});

function resolveEntryEmptyText(names: string[]): string {
  if (plotWorldbook.source.value === 'character' && names.length === 0) return plotCopy.worldbook.emptyCharacter;
  if (plotWorldbook.source.value === 'manual' && plotWorldbook.manualSelection.value.length === 0) return plotCopy.worldbook.emptyManual;
  return plotCopy.worldbook.emptyDefault;
}

let entriesRefreshSeq = 0;
async function refreshWorldbookEntries(): Promise<void> {
  // R10B-17：快速切换来源/勾选世界书时，晚到的旧解析结果不得覆盖新列表
  const seq = ++entriesRefreshSeq;
  let names: string[];
  try {
    names = await plotWorldbook.resolveBookNames();
  } catch {
    if (seq === entriesRefreshSeq) wbEntries.reportLoadFailure();
    return;
  }
  if (seq !== entriesRefreshSeq) return;
  entryEmptyText.value = resolveEntryEmptyText(names);
  await wbEntries.loadEntries(names);
}

function onWorldbookSourceChange(value: WorldbookSource): void {
  plotWorldbook.setSource(value);
  void refreshWorldbookEntries();
}

function onManualWorldbookToggle(name: string, checked: boolean): void {
  plotWorldbook.toggleManualBook(name, checked);
  void refreshWorldbookEntries();
}

async function refreshAll(): Promise<void> {
  plotPresetStore.refreshFromSettings();
  plotWorldbook.refreshFromSettings();
  await worldbook.refresh();
  await refreshWorldbookEntries();
}

onMounted(() => void refreshAll());
watchChatChanged_ACU(() => void refreshAll());
</script>

<style scoped>
.ub-plot__current {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  overflow-wrap: anywhere;
}

.ub-plot__current strong {
  color: var(--ub-text);
}
</style>
