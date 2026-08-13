<template>
  <section class="acu-v2-agent-page">
    <AcuPanelGrid class="acu-v2-agent-page__grid">
      <AcuPanel title="Agent 世界书" description="独立管理 Agent 的世界书范围、Skill 元数据和接管状态。">
        <WorldbookAgentControlBar
          :agent-control="agentControl"
          @current-worldbook-changed="refreshAll"
        />

        <WorldbookSourcePicker
          :source="agentControl.worldbookScope.value.source"
          :selected-names="agentControl.worldbookScope.value.manualSelection"
          :names="worldbook.names.value"
          :status="worldbook.status.value"
          :error="worldbook.error.value"
          @update:source="onScopeSourceChange"
          @toggle-book="onScopeBookToggle"
        />
        <p class="acu-v2-agent-page__hint">当前范围: <strong>{{ currentScopeLabel }}</strong></p>

        <WorldbookEntryToolbar
          :filter="entryFilter"
          :show-entry-selection-controls="false"
          :show-skillify-controls="true"
          @update:filter="entryFilter = $event"
          @skillify-select-all="entries.selectAllForSkillify()"
          @skillify-deselect-all="entries.deselectAllForSkillify()"
          @skillify-selected="onSkillifySelected"
        />
        <WorldbookEntryList
          :groups="entries.groups.value"
          :filter="entryFilter"
          :loading="entries.status.value === 'loading'"
          :empty-text="entryEmptyText"
          :show-entry-toggle="false"
          @toggle-skillify="(bookName: string, uid: number, checked: boolean) => entries.toggleSkillifyEntry(bookName, uid, checked)"
          @toggle-group="entries.toggleGroupExpanded($event)"
          @save-skill="onSaveSkill"
          @delete-skill="onDeleteSkill"
        />
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import WorldbookAgentControlBar from '../components/WorldbookAgentControlBar.vue';
import WorldbookEntryList from '../components/WorldbookEntryList.vue';
import WorldbookEntryToolbar from '../components/WorldbookEntryToolbar.vue';
import WorldbookSourcePicker from '../components/WorldbookSourcePicker.vue';
import { useAgentWorldbookEntries } from '../composables/useAgentWorldbookEntries';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { usePlotWorldbookAgentControl } from '../composables/usePlotWorldbookAgentControl';
import { useWorldbookSelector } from '../composables/useWorldbookSelector';

type WorldbookSource = 'character' | 'manual';
type WorldbookSkillDraft = { description: string; triggerWhen: string };

const worldbook = useWorldbookSelector();
const agentControl = usePlotWorldbookAgentControl();
const entries = useAgentWorldbookEntries({
  onSkillMetaChanged: agentControl.syncAgentWorldbookTakeoverAfterSkillChange,
});
const entryFilter = ref('');
const entryEmptyText = ref('当前 Agent 世界书范围内无可 Skill 化的条目。');

const currentScopeLabel = computed(() => {
  if (agentControl.worldbookScope.value.source === 'character') {
    return worldbook.charPrimary.value ? `角色卡所有世界书 · 主册 ${worldbook.charPrimary.value}` : '角色卡所有世界书';
  }
  const names = agentControl.worldbookScope.value.manualSelection;
  return names.length > 0 ? names.join('、') : '（未选择）';
});

async function refreshEntries(): Promise<void> {
  const names = await entries.loadEntries();
  entryEmptyText.value = names.length === 0
    ? (agentControl.worldbookScope.value.source === 'manual' ? '尚未选择 Agent 世界书。' : '未解析到角色卡世界书。')
    : '当前 Agent 世界书范围内无可 Skill 化的条目。';
}

async function refreshAll(): Promise<void> {
  await agentControl.refresh();
  await worldbook.refresh();
  await refreshEntries();
}

async function onScopeSourceChange(source: WorldbookSource): Promise<void> {
  if (await agentControl.setWorldbookScope(source)) await refreshEntries();
}

async function onScopeBookToggle(name: string, checked: boolean): Promise<void> {
  if (await agentControl.toggleWorldbookScopeBook(name, checked)) await refreshEntries();
}

async function onSkillifySelected(): Promise<void> {
  if (await agentControl.skillifySelected(entries.getSelectedSkillifyEntries())) await refreshEntries();
}

async function onSaveSkill(bookName: string, uid: number, draft: WorldbookSkillDraft): Promise<void> {
  await entries.saveEntrySkillMeta(bookName, uid, draft, 'manual');
  await refreshEntries();
}

async function onDeleteSkill(bookName: string, uid: number): Promise<void> {
  await entries.deleteEntrySkillMeta(bookName, uid);
  await refreshEntries();
}

onMounted(() => { void refreshAll(); });
watch(useChatChangedTick(), () => { void refreshAll(); });
</script>

<style scoped>
.acu-v2-agent-page { min-height: 100%; min-width: 0; padding: 20px; display: flex; flex-direction: column; gap: 18px; }
.acu-v2-agent-page__hint { margin: 12px 0 0; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-agent-page__hint strong { color: var(--acu-text-1); font-weight: 500; }
@media (max-width: 860px) { .acu-v2-agent-page { padding: 14px; } }
</style>
