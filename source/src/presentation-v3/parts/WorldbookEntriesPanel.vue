<template>
  <WorldbookSourcePicker
    :source="config.source.value"
    :selected-names="config.manualSelection.value"
    :names="books.names.value"
    :status="books.status.value"
    :error="books.error.value"
    allow-active
    @update:source="panel.onSourceChange"
    @toggle-book="panel.onManualBookToggle"
  />
  <p class="ub-wbpanel__current">目前已选：<strong>{{ sourceLabel }}</strong></p>
  <WorldbookEntries
    :id-prefix="idPrefix"
    :groups="entries.groups.value"
    :filter="filter"
    :loading="entries.status.value === 'loading'"
    :empty-text="emptyText"
    @update:filter="filter = $event"
    @select-all="entries.selectAll($event)"
    @deselect-all="entries.deselectAll($event)"
    @toggle="(bookName, uid, checked) => entries.toggleEntry(bookName, uid, checked)"
    @toggle-group="entries.toggleGroupExpanded($event)"
  />
</template>

<script setup lang="ts">
/**
 * 「附加世界书条目」：来源（跟随角色卡 / 正文接收 / 手动选择）+ 按条目勾选。
 * 填表页与决策召回页共用；不传 getConfig 时读写当前角色的填表配置。
 * 放在 padded 的 UbSection 里用（多根节点，直接成为分节卡片的子元素）。
 */
import { onMounted } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import type { WorldbookSourceConfigReader } from '../../presentation-v2/composables/useFormFillWorldbookConfig';
import { useWorldbookEntriesPanel } from '../../presentation-v2/composables/useWorldbookEntriesPanel';
import WorldbookEntries from './WorldbookEntries.vue';
import WorldbookSourcePicker from './WorldbookSourcePicker.vue';

const props = defineProps<{
  idPrefix: string;
  getConfig?: WorldbookSourceConfigReader;
}>();

const panel = useWorldbookEntriesPanel(props.getConfig);
const { config, entries, books, filter, sourceLabel, emptyText } = panel;

onMounted(() => void panel.refresh());
watchChatChanged_ACU(() => void panel.refresh());
</script>

<style scoped>
.ub-wbpanel__current {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  overflow-wrap: anywhere;
}

.ub-wbpanel__current strong {
  color: var(--ub-text);
}
</style>
