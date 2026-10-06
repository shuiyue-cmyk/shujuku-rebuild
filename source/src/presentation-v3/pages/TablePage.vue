<template>
  <UbPage :sections="sections">
    <UbSection
      id="tbl-entries"
      :title="tableCopy.panels.entries.title"
      :description="tableCopy.panels.entries.description"
      icon="fa-solid fa-book"
      padded
    >
      <WorldbookSourcePicker
        :source="entriesSource.source.value"
        :selected-names="entriesSource.manualSelection.value"
        :names="entriesWb.names.value"
        :status="entriesWb.status.value"
        :error="entriesWb.error.value"
        allow-active
        @update:source="onEntriesSourceChange"
        @toggle-book="onEntriesManualBookToggle"
      />
      <p class="ub-tbl__current">目前已选：<strong>{{ entriesSourceLabel }}</strong></p>
      <WorldbookEntries
        id-prefix="tbl"
        :groups="entries.groups.value"
        :filter="entryFilter"
        :loading="entries.status.value === 'loading'"
        :empty-text="entryEmptyText"
        @update:filter="entryFilter = $event"
        @select-all="entries.selectAll()"
        @deselect-all="entries.deselectAll()"
        @toggle="(bookName, uid, checked) => entries.toggleEntry(bookName, uid, checked)"
        @toggle-group="entries.toggleGroupExpanded($event)"
      />
    </UbSection>

    <UbSection
      id="tbl-target"
      :title="tableCopy.panels.injectionTarget.title"
      :description="tableCopy.panels.injectionTarget.description"
      icon="fa-solid fa-file-pen"
      padded
    >
      <WorldbookTargetSelect
        :model-value="injectionTarget.selectorValue.value"
        :names="injectionWb.names.value"
        :char-primary="injectionWb.charPrimary.value"
        :status="injectionWb.status.value"
        :error="injectionWb.error.value"
        show-character-option
        character-option-label="角色卡绑定世界书"
        filterable
        @update:model-value="onInjectionTargetChange"
      />
      <p class="ub-tbl__current">目前已选：<strong>{{ injectionTargetLabel }}</strong></p>
    </UbSection>

    <UbSection
      id="tbl-prompt"
      :title="formFillCopy.panels.prompt.title"
      :description="formFillCopy.panels.prompt.description"
      icon="fa-solid fa-scroll"
    >
      <template #actions>
        <UbBadge :variant="settings.promptTemplateMode.value === 'default' ? 'neutral' : 'accent'">{{ promptBadgeLabel }}</UbBadge>
      </template>
      <div class="ub-tbl__prompt">
        <UbCallout v-if="!promptSlotSummary.hasA || !promptSlotSummary.hasB" kind="warning">
          填表提示词缺少必要主插槽，建议在编辑器里载入默认提示词后保存。
        </UbCallout>
        <p class="ub-tbl__prompt-meta">共 {{ settings.promptSegments.value.length }} 段提示词</p>
        <UbButton variant="primary" icon="fa-solid fa-pen-to-square" @click="promptSheetOpen = true">编辑提示词</UbButton>
      </div>
    </UbSection>

    <UbSection
      id="tbl-filter"
      :title="formFillCopy.panels.filter.title"
      :description="formFillCopy.panels.filter.description"
      icon="fa-solid fa-filter"
    >
      <UbRow
        label="丢弃纯越权 SQL 语句"
        hint="默认开启。只丢弃可证明只影响非目标表的独立 SQL；跨目标表或无法归属的语句仍会拒绝并重试。"
      >
        <UbSwitch
          :model-value="settings.discardUnauthorizedTableEditsEnabled.value"
          aria-label="丢弃纯越权 SQL 语句"
          data-acu-setting-key="discardUnauthorizedTableEditsEnabled"
          @update:model-value="settings.setDiscardUnauthorizedTableEditsEnabled($event)"
        />
      </UbRow>
      <UbRow label="仅识别最后一对 <tableEdit> 标签" hint="默认开启，用于忽略前面思维链或草稿里的旧指令。">
        <UbSwitch
          :model-value="settings.tableEditLastPairOnly.value"
          aria-label="仅识别最后一对 tableEdit 标签"
          data-acu-setting-key="tableEditLastPairOnly"
          @update:model-value="settings.setTableEditLastPairOnly($event)"
        />
      </UbRow>
      <UbRow stack>
        <UbRulePairs
          label="提取规则"
          :model-value="settings.extractRules.value"
          start-placeholder="提取开始边界"
          end-placeholder="提取结束边界"
          add-label="添加提取规则"
          @update:model-value="settings.setExtractRules($event)"
        />
      </UbRow>
      <UbRow stack>
        <UbRulePairs
          label="排除规则"
          :model-value="settings.excludeRules.value"
          start-placeholder="排除开始边界"
          end-placeholder="排除结束边界"
          add-label="添加排除规则"
          @update:model-value="settings.setExcludeRules($event)"
        />
      </UbRow>
    </UbSection>

    <PromptSegmentsSheet
      :is-open="promptSheetOpen"
      title="编辑填表提示词"
      :segments="settings.promptSegments.value"
      :dirty="settings.promptDirty.value"
      :message="promptMessage"
      dirty-confirm-message="你有未保存的填表提示词修改，确定要关闭吗？"
      @close="promptSheetOpen = false"
      @save="settings.savePrompt"
      @reset="settings.resetPrompt"
      @import-file="settings.importPromptFile($event)"
      @export="settings.exportPrompt"
      @add="settings.addPromptSegment($event)"
      @delete="settings.deletePromptSegment($event)"
      @update="(index, patch) => settings.updatePromptSegment(index, patch)"
    />
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useFormFillInjectionTarget } from '../../presentation-v2/composables/useFormFillInjectionTarget';
import { useFormFillSettings } from '../../presentation-v2/composables/useFormFillSettings';
import { useFormFillWorldbookConfig } from '../../presentation-v2/composables/useFormFillWorldbookConfig';
import { useFormFillWorldbookEntries } from '../../presentation-v2/composables/useFormFillWorldbookEntries';
import { useUiCloseGuard } from '../../presentation-v2/composables/useUiCloseGuard';
import { useWorldbookSelector } from '../../presentation-v2/composables/useWorldbookSelector';
import { formFillCopy } from '../../presentation-v2/copy/form-fill-copy';
import { tableCopy } from '../../presentation-v2/copy/table-copy';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import PromptSegmentsSheet from '../parts/PromptSegmentsSheet.vue';
import WorldbookEntries from '../parts/WorldbookEntries.vue';
import WorldbookSourcePicker from '../parts/WorldbookSourcePicker.vue';
import WorldbookTargetSelect from '../parts/WorldbookTargetSelect.vue';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbRulePairs from '../ui/UbRulePairs.vue';
import UbSection from '../ui/UbSection.vue';
import UbSwitch from '../ui/UbSwitch.vue';

type WorldbookSource = 'character' | 'manual' | 'active';

const dialogStore = useDialogStore();
const settings = useFormFillSettings();
const injectionTarget = useFormFillInjectionTarget();
const entriesSource = useFormFillWorldbookConfig();
const entries = useFormFillWorldbookEntries();
const injectionWb = useWorldbookSelector();
const entriesWb = useWorldbookSelector();

const entryFilter = ref('');
const injectionTargetLabel = ref('');
const entriesSourceLabel = ref('');
const entryEmptyText = ref(tableCopy.worldbook.emptyDefault);
const promptSheetOpen = ref(false);

const sections = [
  { id: 'tbl-entries', label: '附加条目' },
  { id: 'tbl-target', label: '写入目标' },
  { id: 'tbl-prompt', label: formFillCopy.nav.prompt },
  { id: 'tbl-filter', label: formFillCopy.nav.filter },
];

const promptSlotSummary = computed(() => ({
  hasA: settings.promptSegments.value.some(s => s.mainSlot === 'A' || s.isMain === true),
  hasB: settings.promptSegments.value.some(s => s.mainSlot === 'B' || s.isMain2 === true),
}));

const promptBadgeLabel = computed(() => {
  if (settings.promptTemplateMode.value === 'default') return '使用默认提示词';
  return settings.nativeToolsEnabled.value ? '已自定义提示词（工具调用仍开着）' : '已自定义提示词';
});

const promptMessage = computed(() => (settings.message.value?.scope === 'prompt' ? settings.message.value : null));

async function refreshInjectionLabel(): Promise<void> {
  injectionTargetLabel.value = await injectionTarget.describeTarget();
}

function resolveEntryEmptyText(names: string[]): string {
  const source = entriesSource.source.value;
  if (source === 'character' && names.length === 0) return tableCopy.worldbook.emptyCharacter;
  if (source === 'active' && names.length === 0) {
    return '未找到正文能接收到的世界书（无激活全局书且角色卡未绑定）。可切回「跟随角色卡」或「手动选择」。';
  }
  if (source === 'manual' && entriesSource.manualSelection.value.length === 0) return tableCopy.worldbook.emptyManual;
  return tableCopy.worldbook.emptyDefault;
}

let entriesRefreshSeq = 0;
async function refreshEntriesGroups(): Promise<void> {
  const seq = ++entriesRefreshSeq;
  const names = await entriesSource.resolveBookNames();
  if (seq !== entriesRefreshSeq) return;
  entryEmptyText.value = resolveEntryEmptyText(names);
  await entries.loadEntries(names);
  if (seq !== entriesRefreshSeq) return;
  const source = entriesSource.source.value;
  if (source === 'character') {
    const charPrimary = entriesWb.charPrimary.value;
    entriesSourceLabel.value = charPrimary ? `角色卡所有世界书 · 主册 ${charPrimary}` : '角色卡所有世界书';
  } else if (source === 'active') {
    entriesSourceLabel.value = names.length ? names.join('、') : '（未找到正文接收的世界书）';
  } else {
    const manual = entriesSource.manualSelection.value;
    entriesSourceLabel.value = manual.length ? manual.join('、') : '（未选择）';
  }
}

function onEntriesSourceChange(value: WorldbookSource): void {
  entriesSource.setSource(value);
  void refreshEntriesGroups();
}

function onEntriesManualBookToggle(name: string, checked: boolean): void {
  entriesSource.toggleManualBook(name, checked);
  void refreshEntriesGroups();
}

async function onInjectionTargetChange(value: string): Promise<void> {
  await injectionTarget.onSelectorChange(value);
  await refreshInjectionLabel();
}

async function refreshAll(): Promise<void> {
  settings.refresh();
  injectionTarget.refreshFromSettings();
  entriesSource.refreshFromSettings();
  await Promise.all([injectionWb.refresh(), entriesWb.refresh()]);
  await Promise.all([refreshInjectionLabel(), refreshEntriesGroups()]);
}

onMounted(() => void refreshAll());
watchChatChanged_ACU(() => void refreshAll());

useUiCloseGuard(() => {
  if (!promptSheetOpen.value || !settings.promptDirty.value) return true;
  return dialogStore.confirm({
    title: '关闭 UnbirthDB',
    message: '你有未保存的填表提示词修改，确定要关闭吗？',
    confirmLabel: '仍然关闭',
    confirmVariant: 'danger',
  });
});
</script>

<style scoped>
.ub-tbl__current {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  overflow-wrap: anywhere;
}

.ub-tbl__current strong {
  color: var(--ub-text);
}

.ub-tbl__prompt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
}

.ub-tbl__prompt-meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}
</style>
