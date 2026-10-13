<template>
  <UbPage lead="独立管理 Agent 的世界书范围、Skill 元数据和接管状态。" :sections="sections">
    <UbSection id="agent-control" :title="copy.title" :description="copy.description" icon="fa-solid fa-robot">
      <template #actions>
        <UbBadge :variant="agentControl.isAgentMode.value ? 'accent' : 'neutral'">
          {{ agentControl.isAgentMode.value ? copy.status.active() : copy.status.inactive }}
        </UbBadge>
      </template>
      <div class="ub-agent__mode">
        <p class="ub-agent__config">{{ agentControl.configStatusText.value }}</p>
        <UbSegmented
          :model-value="agentControl.mode.value"
          :options="modeOptions"
          aria-label="Agent 世界书模式"
          block
          @update:model-value="onModeChange"
        />
      </div>
      <UbRow :label="copy.apiPresets.decisionLabel" :hint="copy.apiPresets.decisionHint" :flagged="agentStale">
        <UbSelect
          :options="apiPresetOptions"
          :model-value="agentControl.agentApiPreset.value"
          :placeholder="followActiveApiLabel"
          :aria-label="copy.apiPresets.decisionLabel"
          @update:model-value="setDecisionApi"
        />
      </UbRow>
      <UbRow :label="copy.apiPresets.skillLabel" :hint="copy.apiPresets.skillHint" :flagged="agentStale">
        <UbSelect
          :options="apiPresetOptions"
          :model-value="agentControl.agentSkillApiPreset.value"
          :placeholder="followActiveApiLabel"
          :aria-label="copy.apiPresets.skillLabel"
          @update:model-value="setSkillApi"
        />
      </UbRow>
      <div class="ub-agent__actions">
        <UbButton size="sm" icon="fa-solid fa-sliders" @click="advancedOpen = true">{{ copy.advanced.button }}</UbButton>
        <UbButton size="sm" icon="fa-solid fa-broom" :busy="agentControl.busy.value === 'restore'" :disabled="agentControl.busy.value !== null" @click="runRestore">
          {{ copy.restore.button }}
        </UbButton>
        <UbButton size="sm" variant="primary" icon="fa-solid fa-wand-sparkles" :busy="agentControl.busy.value === 'skillify'" :disabled="agentControl.busy.value !== null" @click="runSkillify">
          {{ copy.skillify.button }}
        </UbButton>
        <UbButton size="sm" variant="danger" icon="fa-solid fa-eraser" :busy="agentControl.busy.value === 'clearSkillMeta'" :disabled="agentControl.busy.value !== null" @click="runClearSkillMeta">
          {{ copy.clearSkillMeta.button }}
        </UbButton>
      </div>
    </UbSection>

    <UbSection id="agent-scope" title="世界书范围" description="Agent 读取与接管哪些世界书。" icon="fa-solid fa-book" padded>
      <WorldbookSourcePicker
        :source="agentControl.worldbookScope.value.source"
        :selected-names="agentControl.worldbookScope.value.manualSelection"
        :names="worldbook.names.value"
        :status="worldbook.status.value"
        :error="worldbook.error.value"
        @update:source="onScopeSourceChange($event as WorldbookSource)"
        @toggle-book="onScopeBookToggle"
      />
      <p class="ub-agent__current">当前范围：<strong>{{ currentScopeLabel }}</strong></p>
    </UbSection>

    <UbSection
      id="agent-favorites"
      title="常用世界书"
      description="把常用的 Skill 世界书放进来，换新角色卡时勾选几本，一键复制成「角色卡名-原书名」并挂成这张卡的附加世界书。副本与原书互不影响。"
      icon="fa-solid fa-star"
      padded
    >
      <div class="ub-agent-fav">
        <p v-if="favorites.favorites.value.length === 0" class="ub-agent__current">还没有常用世界书，从下面选一本加入。</p>
        <div v-else class="ub-agent-fav__list">
          <div v-for="name in favorites.favorites.value" :key="name" class="ub-agent-fav__item">
            <button
              type="button"
              role="checkbox"
              class="ub-agent-fav__check"
              :class="{ 'is-on': favorites.selected.value.includes(name) }"
              :aria-checked="favorites.selected.value.includes(name) ? 'true' : 'false'"
              :aria-label="`挂载 ${name}`"
              :disabled="favoriteStatus(name)?.exists === false"
              @click="favorites.toggleSelected(name, !favorites.selected.value.includes(name))"
            >
              <i :class="favorites.selected.value.includes(name) ? 'fa-solid fa-square-check' : 'fa-regular fa-square'" aria-hidden="true"></i>
              <span>{{ name }}</span>
            </button>
            <UbBadge :variant="favoriteBadge(name).variant">{{ favoriteBadge(name).label }}</UbBadge>
            <UbButton
              v-if="favoriteNeedsSkillify(name)"
              size="sm"
              variant="soft"
              icon="fa-solid fa-wand-sparkles"
              :busy="skillifyingFavorite === name"
              :disabled="agentControl.busy.value !== null"
              @click="onSkillifyFavorite(name)"
            >Skill 化</UbButton>
            <UbButton size="sm" variant="ghost" icon="fa-solid fa-xmark" :aria-label="`移出 ${name}`" @click="favorites.remove(name)">移出</UbButton>
          </div>
        </div>
        <div class="ub-agent-fav__add">
          <UbSelect
            :options="favoriteAddOptions"
            :model-value="favoriteToAdd"
            placeholder="选择要加入常用的世界书"
            aria-label="加入常用世界书"
            @update:model-value="favoriteToAdd = $event"
          />
          <UbButton size="sm" icon="fa-solid fa-plus" :disabled="!favoriteToAdd" @click="onAddFavorite">加入常用</UbButton>
        </div>
        <div class="ub-agent-fav__mount">
          <p class="ub-agent__current">
            当前角色卡：<strong>{{ favorites.characterName.value || '（未打开单人角色卡）' }}</strong>
          </p>
          <UbButton
            size="sm"
            variant="primary"
            icon="fa-solid fa-link"
            :busy="favorites.mounting.value"
            :disabled="!favorites.canMount.value || favorites.selected.value.length === 0"
            @click="onMountFavorites"
          >挂载所选到当前角色卡（{{ favorites.selected.value.length }}）</UbButton>
        </div>
      </div>
    </UbSection>

    <UbSection id="agent-entries" title="条目与 Skill" description="勾选「Skill 化」后点「对所选 Skill 化」；也可逐条手写 Skill 描述与触发时机。" icon="fa-solid fa-list-check" padded>
      <WorldbookEntries
        id-prefix="agent"
        :groups="entries.groups.value"
        :filter="entryFilter"
        :loading="entries.status.value === 'loading'"
        :status="entries.status.value"
        :error="entries.error.value"
        :empty-text="entryEmptyText"
        :show-entry-toggle="false"
        show-skillify-controls
        show-agent-takeover-state
        show-skill-editor
        @update:filter="entryFilter = $event"
        @skillify-select-all="entries.selectAllForSkillify($event)"
        @skillify-deselect-all="entries.deselectAllForSkillify($event)"
        @skillify-selected="onSkillifySelected"
        @toggle-skillify="(bookName, uid, checked) => entries.toggleSkillifyEntry(bookName, uid, checked)"
        @toggle-group="entries.toggleGroupExpanded($event)"
        @save-skill="onSaveSkill"
        @delete-skill="onDeleteSkill"
      />
    </UbSection>

    <UbSection
      id="agent-editing"
      title="世界书编辑"
      description="仅在 Agent 接管关闭时可用。处理下列条目后，重新开启 Agent 接管时可按需放行。"
      icon="fa-solid fa-pen-ruler"
    >
      <UbRow label="启用关闭的 Skill 世界书" :hint="`${disabledSkillCount} 个条目可处理`">
        <UbButton size="sm" icon="fa-solid fa-power-off" :disabled="!editingEnabled || disabledSkillCount === 0" @click="onEnableDisabledSkills">执行</UbButton>
      </UbRow>
      <UbRow label="蓝灯 Skill 转绿灯" :hint="`${blueSkillCount} 个条目可处理`">
        <UbButton size="sm" icon="fa-solid fa-wand-magic-sparkles" :disabled="!editingEnabled || blueSkillCount === 0" @click="onConvertBlueToGreen">执行</UbButton>
      </UbRow>
      <UbRow label="二合一" :hint="`同时完成上面两项，共 ${combinedCount} 个条目`">
        <UbButton size="sm" variant="soft" icon="fa-solid fa-layer-group" :disabled="!editingEnabled || combinedCount === 0" @click="onCombined">执行</UbButton>
      </UbRow>
    </UbSection>

    <AgentAdvancedSheet
      :open="advancedOpen"
      :agent-control="agentControl"
      @close="advancedOpen = false"
      @current-worldbook-changed="refreshAll"
    />
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAgentWorldbookEntries } from '../../presentation-v2/composables/useAgentWorldbookEntries';
import { useApiPresetSelectOptions } from '../../presentation-v2/composables/useApiPresetSelectOptions';
import { useApiPresetStaleness } from '../../presentation-v2/composables/useApiPresetStaleness';
import { useFavoriteWorldbooks } from '../../presentation-v2/composables/useFavoriteWorldbooks';
import type { FavoriteWorldbookSkillStatus_ACU } from '../../service/agent/agent-favorite-worldbooks';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { usePlotWorldbookAgentControl } from '../../presentation-v2/composables/usePlotWorldbookAgentControl';
import { useWorldbookSelector } from '../../presentation-v2/composables/useWorldbookSelector';
import { plotCopy } from '../../presentation-v2/copy/plot-copy';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import type { AgentWorldbookControlMode_ACU } from '../../shared/models/agent-worldbook-model';
import AgentAdvancedSheet from '../parts/AgentAdvancedSheet.vue';
import WorldbookEntries from '../parts/WorldbookEntries.vue';
import WorldbookSourcePicker from '../parts/WorldbookSourcePicker.vue';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSegmented from '../ui/UbSegmented.vue';
import UbSelect from '../ui/UbSelect.vue';

type WorldbookSource = 'character' | 'manual';
type SkillDraft = { description: string; triggerWhen: string };

const copy = plotCopy.agentControl;
const worldbook = useWorldbookSelector();
const agentControl = usePlotWorldbookAgentControl();
const toast = useToastStore();
const entries = useAgentWorldbookEntries({
  onSkillMetaChanged: agentControl.syncAgentWorldbookTakeoverAfterSkillChange,
});
// 「跟随当前」项显示当前活动预设名，与其它页面的 API 预设下拉同一口径
const { apiStore, followActiveApiLabel } = useApiPresetSelectOptions();
const apiPresetOptions = computed(() => agentControl.apiPresetOptions.value.map(option =>
  option.value === '' ? { ...option, label: followActiveApiLabel.value } : option));
// 防呆：API 预设在别处被改过时标黄，重选决策或 Skill 任一即确认
const { isStale: agentStale, markConfirmed: markAgentConfirmed } = useApiPresetStaleness('agent-wb-control');

const favorites = useFavoriteWorldbooks({ skillifyBooks: agentControl.skillifyBooks });
const favoriteToAdd = ref('');
const skillifyingFavorite = ref('');
const favoriteAddOptions = computed(() => favorites.addableNames.value.map(name => ({ value: name, label: name })));

const advancedOpen = ref(false);
const entryFilter = ref('');
const entryEmptyText = ref('当前 Agent 世界书范围内无可 Skill 化的条目。');

const sections = [
  { id: 'agent-control', label: '总控' },
  { id: 'agent-scope', label: '范围' },
  { id: 'agent-favorites', label: '常用世界书' },
  { id: 'agent-entries', label: '条目与 Skill' },
  { id: 'agent-editing', label: '世界书编辑' },
];

const modeOptions = [
  { value: 'disabled', label: copy.modes.disabled },
  { value: 'passive', label: copy.modes.passive },
  { value: 'agent', label: copy.modes.agent },
];

const editingEnabled = computed(() =>
  !agentControl.isAgentMode.value
  && entries.status.value !== 'loading'
  && worldbook.status.value !== 'loading'
  && !entries.batchBusy.value,
);

// 三个计数一次遍历：条目可能上千
const entryStats = computed(() => {
  let disabled = 0;
  let blue = 0;
  const seen = new Set<string>();
  for (const group of entries.groups.value) {
    for (const entry of group.entries) {
      if (entry.hasSkill !== true) continue;
      const isDisabled = entry.agentTakeoverState === 'initial_disabled';
      const isBlue = entry.isConstant === true;
      if (isDisabled) disabled += 1;
      if (isBlue) blue += 1;
      if (isDisabled || isBlue) seen.add(`${entry.bookName}\u0000${String(entry.uid)}`);
    }
  }
  return { disabled, blue, combined: seen.size };
});
const disabledSkillCount = computed(() => entryStats.value.disabled);
const blueSkillCount = computed(() => entryStats.value.blue);
const combinedCount = computed(() => entryStats.value.combined);

const currentScopeLabel = computed(() => {
  if (agentControl.worldbookScope.value.source === 'character') {
    return worldbook.charPrimary.value ? `角色卡所有世界书 · 主册 ${worldbook.charPrimary.value}` : '角色卡所有世界书';
  }
  const names = agentControl.worldbookScope.value.manualSelection;
  return names.length > 0 ? names.join('、') : '（未选择）';
});

function setDecisionApi(value: string): void {
  agentControl.setAgentApiPreset(value);
  markAgentConfirmed();
}

function setSkillApi(value: string): void {
  agentControl.setAgentSkillApiPreset(value);
  markAgentConfirmed();
}

async function onModeChange(value: string): Promise<void> {
  if (await agentControl.setMode(value as AgentWorldbookControlMode_ACU)) await refreshAll();
}

async function runRestore(): Promise<void> {
  if (await agentControl.restore()) await refreshAll();
}

async function runSkillify(): Promise<void> {
  if (await agentControl.skillifyAll()) await refreshAll();
}

async function runClearSkillMeta(): Promise<void> {
  if (await agentControl.clearSkillMeta()) await refreshAll();
}

/** R10A-07：有书写入失败时如实提示（成功部分一并说明），返回 true 表示已提示。 */
function reportBatchFailedBooks(donePart: string): boolean {
  const failed = entries.lastBatchFailedBooks.value;
  if (!failed.length) return false;
  toast.error(`${donePart ? `${donePart}；` : ''}以下世界书写入失败，未改动：${failed.join('、')}。详情见运行日志。`);
  return true;
}

async function onEnableDisabledSkills(): Promise<void> {
  if (!editingEnabled.value) return;
  const changed = await entries.batchEnableDisabledSkillEntries();
  if (reportBatchFailedBooks(changed > 0 ? `已启用 ${changed} 个条目` : '')) return;
  if (changed === 0) toast.error('没有可启用的关闭状态 Skill 条目。');
  else toast.success(`已启用 ${changed} 个关闭状态的 Skill 世界书条目。`);
}

async function onConvertBlueToGreen(): Promise<void> {
  if (!editingEnabled.value) return;
  const changed = await entries.batchConvertBlueToGreenEntries();
  if (reportBatchFailedBooks(changed > 0 ? `已转换 ${changed} 个条目` : '')) return;
  if (changed === 0) toast.error('没有可转换的蓝灯 Skill 条目。');
  else toast.success(`已将 ${changed} 个蓝灯 Skill 世界书条目转为绿灯。`);
}

async function onCombined(): Promise<void> {
  if (!editingEnabled.value) return;
  const { converted, enabled } = await entries.batchCombinedBlueToGreenAndEnable();
  if (reportBatchFailedBooks(converted > 0 || enabled > 0 ? `${converted} 个蓝灯转绿灯，${enabled} 个绿灯已启用` : '')) return;
  if (converted === 0 && enabled === 0) toast.error('没有可处理的 Skill 条目。');
  else toast.success(`二合一完成：${converted} 个蓝灯转绿灯，${enabled} 个绿灯已启用。`);
}

async function refreshEntries(): Promise<void> {
  const names = await entries.loadEntries();
  if (names === null) return; // 已被更新的加载取代
  entryEmptyText.value = names.length === 0
    ? (agentControl.worldbookScope.value.source === 'manual' ? '尚未选择 Agent 世界书。' : '未解析到角色卡世界书。')
    : '当前 Agent 世界书范围内无可 Skill 化的条目。';
}

async function refreshAll(): Promise<void> {
  apiStore.refreshFromSettings();
  await Promise.all([agentControl.refresh(), worldbook.refresh(), favorites.refresh()]);
  await refreshEntries();
}

function favoriteStatus(name: string): FavoriteWorldbookSkillStatus_ACU | undefined {
  return favorites.statuses.value[name];
}

function favoriteNeedsSkillify(name: string): boolean {
  const status = favoriteStatus(name);
  return !!status?.exists && status.skilledCount < status.candidateCount;
}

function favoriteBadge(name: string): { variant: 'neutral' | 'success' | 'warning' | 'danger'; label: string } {
  const status = favoriteStatus(name);
  if (!status) return { variant: 'neutral', label: '读取中' };
  if (!status.exists) return { variant: 'danger', label: '找不到这本书' };
  if (status.candidateCount === 0) return { variant: 'neutral', label: '无可 Skill 化条目' };
  if (status.skilledCount >= status.candidateCount) return { variant: 'success', label: `已 Skill 化 ${status.skilledCount}/${status.candidateCount}` };
  return { variant: 'warning', label: `Skill ${status.skilledCount}/${status.candidateCount}` };
}

async function onAddFavorite(): Promise<void> {
  const name = favoriteToAdd.value;
  if (!name) return;
  favoriteToAdd.value = '';
  await favorites.add(name);
}

async function onSkillifyFavorite(name: string): Promise<void> {
  skillifyingFavorite.value = name;
  try {
    await favorites.skillify(name);
  } finally {
    skillifyingFavorite.value = '';
  }
  await refreshEntries();
}

async function onMountFavorites(): Promise<void> {
  if (await favorites.mountSelected()) await refreshAll();
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

async function onSaveSkill(bookName: string, uid: number, draft: SkillDraft): Promise<void> {
  try {
    await entries.saveEntrySkillMeta(bookName, uid, draft, 'manual');
  } catch (cause: any) {
    toast.error(`保存 Skill 失败：${cause?.message || '未知错误'}`, { muteable: false });
    return;
  }
  await refreshEntries();
}

async function onDeleteSkill(bookName: string, uid: number): Promise<void> {
  try {
    await entries.deleteEntrySkillMeta(bookName, uid);
  } catch (cause: any) {
    toast.error(`删除 Skill 失败：${cause?.message || '未知错误'}`, { muteable: false });
    return;
  }
  await refreshEntries();
}

onMounted(() => void refreshAll());
watchChatChanged_ACU(() => void refreshAll());
</script>

<style scoped>
.ub-agent__mode {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4);
  border-bottom: 1px solid var(--ub-line-soft);
}

.ub-agent__config {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-agent__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-sunken);
}

.ub-agent__current {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  overflow-wrap: anywhere;
}

.ub-agent__current strong {
  color: var(--ub-text);
}

.ub-agent-fav {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  min-width: 0;
}

.ub-agent-fav__list {
  display: flex;
  flex-direction: column;
  padding: var(--ub-s1);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
}

.ub-agent-fav__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s1) 0;
}

.ub-agent-fav__item + .ub-agent-fav__item {
  border-top: 1px solid var(--ub-line-soft);
}

.ub-agent-fav__check {
  display: flex;
  flex: 1 1 calc(var(--ub-u) * 120);
  align-items: center;
  gap: var(--ub-s2);
  min-width: 0;
  min-height: var(--ub-control-h-sm);
  padding: var(--ub-s1) var(--ub-s2);
  border: 0;
  border-radius: calc(var(--ub-r-control) - 3px);
  background: transparent;
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-sm);
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.ub-agent-fav__check:hover:not(:disabled) {
  background: var(--ub-hover);
}

.ub-agent-fav__check:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.ub-agent-fav__check.is-on {
  color: var(--ub-text);
  font-weight: 600;
}

.ub-agent-fav__check.is-on i {
  color: var(--ub-accent-ink);
}

.ub-agent-fav__add,
.ub-agent-fav__mount {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2);
}

.ub-agent-fav__add > :first-child {
  flex: 1 1 calc(var(--ub-u) * 140);
  min-width: 0;
}

.ub-agent-fav__mount .ub-agent__current {
  flex: 1 1 auto;
}
</style>
