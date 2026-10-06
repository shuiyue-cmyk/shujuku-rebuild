<template>
  <UbSheet
    :is-open="open"
    :title="copy.advanced.title"
    :subtitle="isPromptDraftDirty ? '提示词有未保存的修改' : undefined"
    width="800px"
    :before-close="confirmClose"
    @close="emit('close')"
  >
    <UbCallout kind="info">{{ copy.advanced.description }}</UbCallout>

    <UbSection :title="copy.executionMode.label" :description="copy.executionMode.hint" padded>
      <UbSegmented
        :model-value="agentControl.agentPlotExecutionMode.value"
        :options="executionModeOptions"
        aria-label="Agent 与剧情推进执行方式"
        :disabled="!agentControl.isReady.value"
        block
        @update:model-value="onExecutionModeChange"
      />
    </UbSection>

    <UbSection :title="copy.contextSettings.title" :description="copy.contextSettings.description">
      <template #actions>
        <UbButton size="sm" variant="ghost" icon="fa-solid fa-rotate-left" :disabled="!agentControl.isReady.value" @click="resetContextSettings">
          {{ copy.contextSettings.resetButton }}
        </UbButton>
      </template>
      <UbRow v-for="field in contextFields" :key="field.key" :label="field.copy.label" :hint="field.copy.hint">
        <UbInput
          type="number"
          :model-value="agentControl.contextSettings.value[field.key]"
          :min="field.limits.min"
          :step="field.step"
          :disabled="!agentControl.isReady.value"
          :aria-label="field.copy.label"
          @change="onContextChange(field.key, $event)"
        />
      </UbRow>
    </UbSection>

    <UbSection :title="copy.decisionSettings.title" :description="copy.decisionSettings.description">
      <UbRow :label="copy.decisionSettings.concurrency.label" :hint="copy.decisionSettings.concurrency.hint">
        <UbInput
          type="number"
          :model-value="agentControl.agentDecisionConcurrency.value"
          :min="1"
          :step="1"
          :disabled="!agentControl.isReady.value"
          :aria-label="copy.decisionSettings.concurrency.label"
          @change="onAgentDecisionConcurrencyChange"
        />
      </UbRow>
    </UbSection>

    <UbSection :title="copy.skillifySettings.title" :description="copy.skillifySettings.description">
      <UbRow :label="copy.skillifySettings.maxConcurrency.label" :hint="copy.skillifySettings.maxConcurrency.hint">
        <UbInput
          type="number"
          :model-value="agentControl.maxSkillifyConcurrency.value"
          :min="1"
          :step="1"
          :disabled="!agentControl.isReady.value"
          :aria-label="copy.skillifySettings.maxConcurrency.label"
          @change="onMaxSkillifyConcurrencyChange"
        />
      </UbRow>
    </UbSection>

    <UbSection :title="copy.prompts.title" :description="`${copy.prompts.description} ${copy.prompts.scopeHint}`" padded>
      <UbCallout v-if="agentControl.isReady.value && isPromptDraftDirty" kind="warning">{{ copy.prompts.unsavedChanges }}</UbCallout>
      <UbCallout v-if="promptDraftStale" kind="error">{{ copy.prompts.scopeChanged }}</UbCallout>
      <UbCallout v-if="!agentControl.isReady.value" kind="warning">
        {{ agentControl.initializationFailed.value ? copy.prompts.loadFailed : copy.prompts.loadingNotReady }}
      </UbCallout>
      <UbButton v-if="agentControl.initializationFailed.value" size="sm" icon="fa-solid fa-rotate" @click="agentControl.retryInitialization()">
        {{ copy.prompts.retryLoad }}
      </UbButton>
      <template v-if="agentControl.isReady.value">
        <UbSegmented
          v-model="activePromptKind"
          :options="promptKindOptions"
          aria-label="提示词类别"
          block
        />
        <div class="ub-agadv__prompt-head">
          <UbButton size="sm" variant="ghost" icon="fa-solid fa-rotate-left" @click="resetPrompt(activePromptKind)">
            {{ activePromptKind === 'decision' ? copy.prompts.decisionReset : copy.prompts.skillifyReset }}
          </UbButton>
        </div>
        <UbPromptSegments
          :key="activePromptKind"
          :segments="getDraft(activePromptKind)"
          :role-options="AGENT_ROLE_OPTIONS"
          :show-slot="false"
          :allow-move="true"
          :rows="7"
          :empty-text="copy.prompts.emptyText"
          @add="(position) => addPromptSegment(activePromptKind, position)"
          @delete="(index) => deletePromptSegment(activePromptKind, index)"
          @move="(index, delta) => movePromptSegment(activePromptKind, index, delta)"
          @update="(index, patch) => updatePromptSegment(activePromptKind, index, patch)"
        />
      </template>
    </UbSection>

    <template #footer>
      <UbButton :disabled="!canSavePrompts" icon="fa-solid fa-book" @click="savePromptsToCurrentWorldbook">{{ copy.prompts.saveCurrent }}</UbButton>
      <UbButton variant="primary" :disabled="!canSavePrompts" icon="fa-solid fa-globe" @click="savePromptsAsGlobalTemplate">{{ copy.prompts.saveAsGlobal }}</UbButton>
    </template>
  </UbSheet>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  AgentContextSettingKey_ACU,
  AgentPlotExecutionModeSetting_ACU,
  AgentPromptKind_ACU,
  usePlotWorldbookAgentControl,
} from '../../presentation-v2/composables/usePlotWorldbookAgentControl';
import { plotCopy } from '../../presentation-v2/copy/plot-copy';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import type { PromptSegment_ACU } from '../../shared/models/agent-worldbook-model';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbInput from '../ui/UbInput.vue';
import UbPromptSegments, { type UbPromptSegment } from '../ui/UbPromptSegments.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSegmented, { type UbSegmentedOption } from '../ui/UbSegmented.vue';
import type { UbSelectOption } from '../ui/UbSelect.vue';
import UbSheet from '../ui/UbSheet.vue';

const props = defineProps<{
  open: boolean;
  agentControl: ReturnType<typeof usePlotWorldbookAgentControl>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'current-worldbook-changed'): void;
  (e: 'global-template-saved'): void;
}>();

const copy = plotCopy.agentControl;
const agentControl = props.agentControl;
const dialog = useDialogStore();
const toast = useToastStore();

const AGENT_ROLE_OPTIONS: UbSelectOption[] = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

const executionModeOptions: UbSegmentedOption[] = [
  { value: 'sequential', label: copy.executionMode.options.sequential },
  { value: 'concurrent', label: copy.executionMode.options.concurrent },
];

const promptKindOptions: UbSegmentedOption[] = [
  { value: 'decision', label: copy.prompts.decisionTitle },
  { value: 'skillify', label: copy.prompts.skillifyTitle },
];

type VisibleContextKey = Exclude<
  AgentContextSettingKey_ACU,
  'decisionWorldbookContentPreviewLimit' | 'decisionPreviousPlotCharLimit' | 'skillifyContentPreviewLimit'
>;

const CONTEXT_FIELD_STEPS: Record<VisibleContextKey, number> = {
  decisionRecentContextCharLimit: 1,
  decisionWorldbookCandidateLimit: 1,
  skillifyMaxEntries: 1,
  plotWorldbookScanMessageLimit: 1,
  agentAiMaxRetries: 1,
  greenlightMinTkBudget: 100,
  greenlightMaxTkBudget: 100,
};

const contextFields = (Object.keys(CONTEXT_FIELD_STEPS) as VisibleContextKey[]).map(key => ({
  key,
  step: CONTEXT_FIELD_STEPS[key],
  copy: copy.contextSettings.fields[key],
  limits: agentControl.contextSettingsLimits[key],
}));

const activePromptKind = ref<AgentPromptKind_ACU>('decision');
const decisionDraft = ref<PromptSegment_ACU[]>([]);
const skillifyDraft = ref<PromptSegment_ACU[]>([]);
const promptDraftStale = ref(false);
const promptBaseline = ref<{ decision: PromptSegment_ACU[]; skillify: PromptSegment_ACU[] }>({ decision: [], skillify: [] });

const isPromptDraftDirty = computed(() =>
  JSON.stringify({ decision: decisionDraft.value, skillify: skillifyDraft.value }) !== JSON.stringify(promptBaseline.value),
);
const canSavePrompts = computed(() => agentControl.isReady.value && isPromptDraftDirty.value && !promptDraftStale.value);

function cloneSegments(segments: PromptSegment_ACU[]): PromptSegment_ACU[] {
  return JSON.parse(JSON.stringify(segments || [])) as PromptSegment_ACU[];
}

function syncPromptDraft(): void {
  const decision = cloneSegments(agentControl.agentDecisionPromptSegments.value);
  const skillify = cloneSegments(agentControl.agentSkillifyPromptSegments.value);
  decisionDraft.value = decision;
  skillifyDraft.value = skillify;
  promptDraftStale.value = false;
  promptBaseline.value = { decision: cloneSegments(decision), skillify: cloneSegments(skillify) };
}

watch(() => props.open, (open) => {
  if (open && !isPromptDraftDirty.value) syncPromptDraft();
}, { immediate: true });

// 底层配置变了：草稿干净就同步；有未保存修改则锁定保存，避免把旧角色的草稿写进新世界书
watch(
  () => [agentControl.agentDecisionPromptSegments.value, agentControl.agentSkillifyPromptSegments.value],
  () => {
    if (!props.open) return;
    if (isPromptDraftDirty.value) promptDraftStale.value = true;
    else syncPromptDraft();
  },
  { deep: true },
);

async function onExecutionModeChange(value: string): Promise<void> {
  if (await agentControl.setAgentPlotExecutionMode(value as AgentPlotExecutionModeSetting_ACU)) emit('current-worldbook-changed');
}

async function onContextChange(key: AgentContextSettingKey_ACU, value: string | number): Promise<void> {
  if (await agentControl.setContextSetting(key, value)) emit('current-worldbook-changed');
}

async function resetContextSettings(): Promise<void> {
  await agentControl.resetContextSettings();
  emit('current-worldbook-changed');
}

async function onAgentDecisionConcurrencyChange(value: string | number): Promise<void> {
  if (await agentControl.setAgentDecisionConcurrency(value)) emit('current-worldbook-changed');
}

async function onMaxSkillifyConcurrencyChange(value: string | number): Promise<void> {
  if (await agentControl.setMaxSkillifyConcurrency(value)) emit('current-worldbook-changed');
}

function getDraft(kind: AgentPromptKind_ACU): PromptSegment_ACU[] {
  return kind === 'decision' ? decisionDraft.value : skillifyDraft.value;
}

function setDraft(kind: AgentPromptKind_ACU, segments: PromptSegment_ACU[]): void {
  if (kind === 'decision') decisionDraft.value = segments;
  else skillifyDraft.value = segments;
}

function resetPrompt(kind: AgentPromptKind_ACU): void {
  setDraft(kind, agentControl.getBuiltInPromptSegments(kind));
  toast.info(kind === 'decision' ? copy.prompts.decisionResetSuccess : copy.prompts.skillifyResetSuccess);
}

function addPromptSegment(kind: AgentPromptKind_ACU, position: 'top' | 'bottom'): void {
  const next = cloneSegments(getDraft(kind));
  const segment: PromptSegment_ACU = { role: 'user', content: '', deletable: true };
  if (position === 'top') next.unshift(segment);
  else next.push(segment);
  setDraft(kind, next);
}

function deletePromptSegment(kind: AgentPromptKind_ACU, index: number): void {
  const next = cloneSegments(getDraft(kind));
  if (index < 0 || index >= next.length || next[index]?.deletable === false) return;
  next.splice(index, 1);
  setDraft(kind, next);
}

function movePromptSegment(kind: AgentPromptKind_ACU, index: number, delta: -1 | 1): void {
  const next = cloneSegments(getDraft(kind));
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target], next[index]];
  setDraft(kind, next);
}

function updatePromptSegment(kind: AgentPromptKind_ACU, index: number, patch: Partial<UbPromptSegment>): void {
  const next = cloneSegments(getDraft(kind));
  if (index < 0 || index >= next.length) return;
  next[index] = { ...next[index], ...patch } as PromptSegment_ACU;
  setDraft(kind, next);
}

async function savePromptsToCurrentWorldbook(): Promise<void> {
  if (!(await agentControl.savePromptSegmentsToCurrentWorldbook(decisionDraft.value, skillifyDraft.value))) return;
  syncPromptDraft();
  toast.success(copy.prompts.saveCurrentSuccess);
  emit('current-worldbook-changed');
}

async function savePromptsAsGlobalTemplate(): Promise<void> {
  if (!(await agentControl.savePromptSegmentsAsGlobalTemplate(decisionDraft.value, skillifyDraft.value))) return;
  toast.success(copy.prompts.saveAsGlobalSuccess);
  emit('global-template-saved');
}

async function confirmClose(): Promise<boolean> {
  if (!isPromptDraftDirty.value && !promptDraftStale.value) return true;
  const confirmed = await dialog.confirm({
    title: '放弃未保存的提示词修改？',
    message: '关闭后，当前草稿中的提示词修改将被放弃，当前世界书和全局模板均不会变更。',
    dangerMessage: '只有点击对应保存按钮，草稿才会写入当前世界书或全局模板。',
    confirmLabel: '放弃修改并关闭',
    confirmVariant: 'danger',
  });
  if (!confirmed) return false;
  syncPromptDraft();
  return true;
}
</script>

<style scoped>
.ub-agadv__prompt-head {
  display: flex;
  justify-content: flex-end;
}
</style>
