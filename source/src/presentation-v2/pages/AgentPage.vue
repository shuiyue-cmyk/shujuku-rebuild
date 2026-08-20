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

        <div class="acu-v2-agent-page__editing">
          <h4 class="acu-v2-agent-page__editing-title">世界书编辑</h4>
          <p class="acu-v2-agent-page__editing-hint">
            仅在 Agent 接管关闭时可编辑。开启下列条目/转换状态后，可在重新开启 Agent 接管时按需放行。
          </p>
          <div class="acu-v2-agent-page__editing-actions">
            <AcuButton
              :disabled="!editingEnabled || disabledSkillCount === 0"
              @click="onEnableDisabledSkills"
            >
              <i class="fa-solid fa-power-off"></i> 启用关闭的 Skill 世界书
              <span v-if="disabledSkillCount > 0" class="acu-v2-agent-page__editing-count">{{ disabledSkillCount }}</span>
            </AcuButton>
            <AcuButton
              :disabled="!editingEnabled || blueSkillCount === 0"
              @click="onConvertBlueToGreen"
            >
              <i class="fa-solid fa-wand-magic-sparkles"></i> 蓝灯 Skill 转绿灯
              <span v-if="blueSkillCount > 0" class="acu-v2-agent-page__editing-count">{{ blueSkillCount }}</span>
            </AcuButton>
            <AcuButton
              :disabled="!editingEnabled || combinedCount === 0"
              @click="onCombined"
            >
              <i class="fa-solid fa-layer-group"></i> 二合一
              <span v-if="combinedCount > 0" class="acu-v2-agent-page__editing-count">{{ combinedCount }}</span>
            </AcuButton>
          </div>
        </div>
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import { useToastStore } from '../stores/toast-store';
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

// 无 active Pinia（如单元测试直接 createApp）时优雅降级，不弹 toast
function safeToast(success: boolean, message: string): void {
  try {
    useToastStore()[success ? 'success' : 'error'](message);
  } catch { /* 无 pinia 环境跳过 */ }
}

// ─── 世界书编辑（仅 Agent 接管关闭时可用） ───
const editingEnabled = computed(() => !agentControl.isAgentMode.value);
const disabledSkillCount = computed(() => entries.groups.value.reduce(
  (sum, group) => sum + group.entries.filter(entry => entry.hasSkill === true && entry.agentTakeoverState === 'initial_disabled').length, 0,
));
const blueSkillCount = computed(() => entries.groups.value.reduce(
  (sum, group) => sum + group.entries.filter(entry => entry.hasSkill === true && entry.isConstant === true).length, 0,
));
const combinedCount = computed(() => {
  const seen = new Set<string>();
  for (const group of entries.groups.value) {
    for (const entry of group.entries) {
      if (entry.hasSkill === true && (entry.isConstant === true || entry.agentTakeoverState === 'initial_disabled')) {
        seen.add(`${entry.bookName}\u0000${String(entry.uid)}`);
      }
    }
  }
  return seen.size;
});

async function onEnableDisabledSkills(): Promise<void> {
  const changed = await entries.batchEnableDisabledSkillEntries();
  safeToast(true, `已启用 ${changed} 个关闭状态的 Skill 世界书条目。`);
}

async function onConvertBlueToGreen(): Promise<void> {
  const changed = await entries.batchConvertBlueToGreenEntries();
  safeToast(true, `已将 ${changed} 个蓝灯 Skill 世界书条目转为绿灯。`);
}

async function onCombined(): Promise<void> {
  const { converted, enabled } = await entries.batchCombinedBlueToGreenAndEnable();
  safeToast(true, `二合一完成：${converted} 个蓝灯转绿灯，${enabled} 个绿灯已启用。`);
}

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
.acu-v2-agent-page__editing {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.acu-v2-agent-page__editing-title { margin: 0; font-size: var(--acu-font-size-body, 12px); color: var(--acu-text-1); }
.acu-v2-agent-page__editing-hint { margin: 0; font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3); }
.acu-v2-agent-page__editing-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.acu-v2-agent-page__editing-count {
  margin-left: 4px; padding: 0 5px; border-radius: 8px; font-size: 10px;
  background: color-mix(in srgb, var(--acu-accent) 18%, transparent);
  color: var(--acu-accent);
}
@media (max-width: 860px) { .acu-v2-agent-page { padding: 14px; } }
</style>
