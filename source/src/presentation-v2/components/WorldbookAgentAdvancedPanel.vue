<template>
  <AcuDrawer
    :is-open="open"
    :title="plotCopy.agentControl.advanced.title"
    width="min(760px, 100vw)"
    :before-close="confirmClose"
    @close="$emit('close')"
  >
    <div class="acu-agent-advanced">
      <AcuMessage kind="info">
        {{ plotCopy.agentControl.advanced.description }}
      </AcuMessage>

      <section class="acu-agent-advanced__section">
        <header class="acu-agent-advanced__section-head">
          <div>
            <h4>{{ plotCopy.agentControl.executionMode.label }}</h4>
            <p>{{ plotCopy.agentControl.executionMode.hint }}</p>
          </div>
        </header>
        <AcuSegmentedControl
          :model-value="agentControl.agentPlotExecutionMode.value"
          :options="executionModeOptions"
          size="sm"
          aria-label="Agent 与剧情推进执行方式"
          :disabled="!agentControl.isReady.value"
          @update:model-value="onExecutionModeChange"
        />
      </section>

      <section class="acu-agent-advanced__section">
        <header class="acu-agent-advanced__section-head">
          <div>
            <h4>{{ plotCopy.agentControl.contextSettings.title }}</h4>
            <p>{{ plotCopy.agentControl.contextSettings.description }}</p>
          </div>
          <AcuButton size="sm" :disabled="!agentControl.isReady.value" @click="resetContextSettings">
            {{ plotCopy.agentControl.contextSettings.resetButton }}
          </AcuButton>
        </header>
        <div class="acu-agent-advanced__grid">
          <AcuFormRow
            v-for="field in contextFields"
            :key="field.key"
            :label="field.copy.label"
            :hint="field.copy.hint"
          >
            <AcuInput
              type="number"
              size="sm"
              :model-value="agentControl.contextSettings.value[field.key]"
              :min="field.limits.min"
              :step="field.step"
              :disabled="!agentControl.isReady.value"
              @change="onContextChange(field.key, $event)"
            />
          </AcuFormRow>
        </div>
      </section>

      <section class="acu-agent-advanced__section">
        <header class="acu-agent-advanced__section-head">
          <div>
            <h4>{{ plotCopy.agentControl.decisionSettings.title }}</h4>
            <p>{{ plotCopy.agentControl.decisionSettings.description }}</p>
          </div>
        </header>
        <div class="acu-agent-advanced__grid">
          <AcuFormRow
            :label="plotCopy.agentControl.decisionSettings.concurrency.label"
            :hint="plotCopy.agentControl.decisionSettings.concurrency.hint"
          >
            <AcuInput
              type="number"
              size="sm"
              :model-value="agentControl.agentDecisionConcurrency.value"
              :min="1"
              :step="1"
              :disabled="!agentControl.isReady.value"
              @change="onAgentDecisionConcurrencyChange"
            />
          </AcuFormRow>
        </div>
      </section>

      <section class="acu-agent-advanced__section">
        <header class="acu-agent-advanced__section-head">
          <div>
            <h4>{{ plotCopy.agentControl.skillifySettings.title }}</h4>
            <p>{{ plotCopy.agentControl.skillifySettings.description }}</p>
          </div>
        </header>
        <div class="acu-agent-advanced__grid">
          <AcuFormRow
            :label="plotCopy.agentControl.skillifySettings.maxConcurrency.label"
            :hint="plotCopy.agentControl.skillifySettings.maxConcurrency.hint"
          >
            <AcuInput
              type="number"
              size="sm"
              :model-value="agentControl.maxSkillifyConcurrency.value"
              :min="1"
              :step="1"
              :disabled="!agentControl.isReady.value"
              @change="onMaxSkillifyConcurrencyChange"
            />
          </AcuFormRow>
        </div>
      </section>

      <section class="acu-agent-advanced__section">
        <header class="acu-agent-advanced__section-head">
          <div>
            <h4>{{ plotCopy.agentControl.prompts.title }}</h4>
            <p>{{ plotCopy.agentControl.prompts.description }}</p>
            <p class="acu-agent-advanced__prompt-scope">{{ plotCopy.agentControl.prompts.scopeHint }}</p>
          </div>
          <div class="acu-agent-advanced__prompt-actions">
            <AcuButton size="sm" :disabled="!canSavePrompts" @click="savePromptsToCurrentWorldbook">
              {{ plotCopy.agentControl.prompts.saveCurrent }}
            </AcuButton>
            <AcuButton size="sm" variant="primary" :disabled="!canSavePrompts" @click="savePromptsAsGlobalTemplate">
              {{ plotCopy.agentControl.prompts.saveAsGlobal }}
            </AcuButton>
          </div>
        </header>
        <AcuMessage :visible="agentControl.isReady.value && isPromptDraftDirty" kind="warning">
          {{ plotCopy.agentControl.prompts.unsavedChanges }}
        </AcuMessage>
        <AcuMessage :visible="promptDraftStale" kind="danger">
          {{ plotCopy.agentControl.prompts.scopeChanged }}
        </AcuMessage>

        <AcuMessage :visible="!agentControl.isReady.value" kind="warning">
          {{ agentControl.initializationFailed.value ? plotCopy.agentControl.prompts.loadFailed : plotCopy.agentControl.prompts.loadingNotReady }}
        </AcuMessage>
        <AcuButton
          v-if="agentControl.initializationFailed.value"
          size="sm"
          @click="retryInitialization"
        >
          {{ plotCopy.agentControl.prompts.retryLoad }}
        </AcuButton>
        <template v-if="agentControl.isReady.value">
          <div class="acu-agent-advanced__prompt-head">
            <h5>{{ plotCopy.agentControl.prompts.decisionTitle }}</h5>
            <AcuButton size="sm" @click="resetPrompt('decision')">
              {{ plotCopy.agentControl.prompts.decisionReset }}
            </AcuButton>
          </div>
          <AcuPromptSegments
            :segments="decisionDraft"
            :role-options="AGENT_ROLE_OPTIONS"
            :show-slot="false"
            :allow-move="true"
            :rows="7"
            :empty-text="plotCopy.agentControl.prompts.emptyText"
            @add="(position) => addPromptSegment('decision', position)"
            @delete="(index) => deletePromptSegment('decision', index)"
            @move="(index, delta) => movePromptSegment('decision', index, delta)"
            @update="(index, patch) => updatePromptSegment('decision', index, patch)"
          />

          <div class="acu-agent-advanced__prompt-head">
            <h5>{{ plotCopy.agentControl.prompts.skillifyTitle }}</h5>
            <AcuButton size="sm" @click="resetPrompt('skillify')">
              {{ plotCopy.agentControl.prompts.skillifyReset }}
            </AcuButton>
          </div>
          <AcuPromptSegments
            :segments="skillifyDraft"
            :role-options="AGENT_ROLE_OPTIONS"
            :show-slot="false"
            :allow-move="true"
            :rows="7"
            :empty-text="plotCopy.agentControl.prompts.emptyText"
            @add="(position) => addPromptSegment('skillify', position)"
            @delete="(index) => deletePromptSegment('skillify', index)"
            @move="(index, delta) => movePromptSegment('skillify', index, delta)"
            @update="(index, patch) => updatePromptSegment('skillify', index, patch)"
          />
        </template>
      </section>
    </div>
  </AcuDrawer>
</template>


<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PromptSegment_ACU } from '../../shared/models/agent-worldbook-model';
import type { AgentContextSettingKey_ACU, AgentPlotExecutionModeSetting_ACU, AgentPromptKind_ACU } from '../composables/usePlotWorldbookAgentControl';
import { usePlotWorldbookAgentControl } from '../composables/usePlotWorldbookAgentControl';
import { plotCopy } from '../copy/plot-copy';
import { useDialogStore } from '../stores/dialog-store';
import { useToastStore } from '../stores/toast-store';
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInput from './_lib/AcuInput.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments from './_lib/AcuPromptSegments.vue';
import AcuSegmentedControl, { type AcuSegmentedOption } from './_lib/AcuSegmentedControl.vue';
import type { PromptSegment } from './_lib/AcuPromptSegments.vue';
import type { AcuSelectOption } from './_lib/AcuSelect.vue';

const props = defineProps<{
  open: boolean;
  agentControl: ReturnType<typeof usePlotWorldbookAgentControl>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'current-worldbook-changed'): void;
  (e: 'global-template-saved'): void;
}>();

const agentControl = props.agentControl;
const dialog = useDialogStore();
const toast = useToastStore();
const decisionDraft = ref<PromptSegment_ACU[]>([]);
const skillifyDraft = ref<PromptSegment_ACU[]>([]);
const promptDraftStale = ref(false);
const promptBaseline = ref<{ decision: PromptSegment_ACU[]; skillify: PromptSegment_ACU[] }>({ decision: [], skillify: [] });
const isPromptDraftDirty = computed(() => JSON.stringify({ decision: decisionDraft.value, skillify: skillifyDraft.value })
  !== JSON.stringify(promptBaseline.value));
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

watch(
  () => [agentControl.agentDecisionPromptSegments.value, agentControl.agentSkillifyPromptSegments.value],
  () => {
    if (!props.open) return;
    if (isPromptDraftDirty.value) {
      promptDraftStale.value = true;
      return;
    }
    syncPromptDraft();
  },
  { deep: true },
);

const AGENT_ROLE_OPTIONS: AcuSelectOption[] = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

const executionModeOptions: AcuSegmentedOption[] = [
  { value: 'sequential', label: plotCopy.agentControl.executionMode.options.sequential },
  { value: 'concurrent', label: plotCopy.agentControl.executionMode.options.concurrent },
];

type ContextFieldMeta = {
  key: AgentContextSettingKey_ACU;
  step: number;
  copy: { label: string; hint: string };
  limits: { min: number };
};

type VisibleContextSettingKey_ACU = Exclude<AgentContextSettingKey_ACU, 'decisionWorldbookContentPreviewLimit' | 'decisionPreviousPlotCharLimit' | 'skillifyContentPreviewLimit'>;

const visibleContextFieldKeys: VisibleContextSettingKey_ACU[] = [
  'decisionRecentContextCharLimit',
  'decisionWorldbookCandidateLimit',
  'skillifyMaxEntries',
  'plotWorldbookScanMessageLimit',
  'agentAiMaxRetries',
  'greenlightMinTkBudget',
  'greenlightMaxTkBudget',
];

const contextFieldSteps: Record<VisibleContextSettingKey_ACU, number> = {
  decisionRecentContextCharLimit: 1,
  decisionWorldbookCandidateLimit: 1,
  skillifyMaxEntries: 1,
  plotWorldbookScanMessageLimit: 1,
  agentAiMaxRetries: 1,
  greenlightMinTkBudget: 100,
  greenlightMaxTkBudget: 100,
};

const contextFields: ContextFieldMeta[] = visibleContextFieldKeys.map((key) => ({
  key,
  step: contextFieldSteps[key],
  copy: plotCopy.agentControl.contextSettings.fields[key],
  limits: agentControl.contextSettingsLimits[key],
}));

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

function resetPrompt(kind: AgentPromptKind_ACU): void {
  const segments = agentControl.getBuiltInPromptSegments(kind);
  if (kind === 'decision') decisionDraft.value = segments;
  else skillifyDraft.value = segments;
  toast.info(kind === 'decision'
    ? plotCopy.agentControl.prompts.decisionResetSuccess
    : plotCopy.agentControl.prompts.skillifyResetSuccess);
}

async function savePromptsToCurrentWorldbook(): Promise<void> {
  const saved = await agentControl.savePromptSegmentsToCurrentWorldbook(decisionDraft.value, skillifyDraft.value);
  if (!saved) return;
  syncPromptDraft();
  toast.success(plotCopy.agentControl.prompts.saveCurrentSuccess);
  emit('current-worldbook-changed');
}

async function savePromptsAsGlobalTemplate(): Promise<void> {
  const saved = await agentControl.savePromptSegmentsAsGlobalTemplate(decisionDraft.value, skillifyDraft.value);
  if (!saved) return;
  toast.success(plotCopy.agentControl.prompts.saveAsGlobalSuccess);
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

async function retryInitialization(): Promise<void> {
  await agentControl.retryInitialization();
}

function getDraft(kind: AgentPromptKind_ACU): PromptSegment_ACU[] {
  return kind === 'decision' ? decisionDraft.value : skillifyDraft.value;
}

function setDraft(kind: AgentPromptKind_ACU, segments: PromptSegment_ACU[]): void {
  if (kind === 'decision') decisionDraft.value = segments;
  else skillifyDraft.value = segments;
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
  const targetIndex = index + delta;
  if (index < 0 || index >= next.length || targetIndex < 0 || targetIndex >= next.length) return;
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  setDraft(kind, next);
}

function updatePromptSegment(
  kind: AgentPromptKind_ACU,
  index: number,
  patch: Partial<PromptSegment>,
): void {
  const next = cloneSegments(getDraft(kind));
  if (index < 0 || index >= next.length) return;
  next[index] = { ...next[index], ...patch };
  setDraft(kind, next);
}
</script>

<style scoped>
.acu-agent-advanced { display: flex; flex-direction: column; gap: 16px; min-width: 0; max-width: 100%; }
.acu-agent-advanced__section { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-width: 100%; padding: 12px; border-radius: var(--acu-radius-sm); background: var(--acu-bg-2); }
.acu-agent-advanced__section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; max-width: 100%; }
.acu-agent-advanced__section-head > div { min-width: 0; }
.acu-agent-advanced__section-head h4,
.acu-agent-advanced__prompt-head h5 { margin: 0; min-width: 0; color: var(--acu-text-1); overflow-wrap: anywhere; }
.acu-agent-advanced__section-head p { margin: 4px 0 0; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); line-height: 1.5; overflow-wrap: anywhere; }
.acu-agent-advanced__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; min-width: 0; max-width: 100%; }
.acu-agent-advanced__prompt-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; max-width: 100%; margin-top: 4px; }
.acu-agent-advanced :deep(.acu-form-row),
.acu-agent-advanced :deep(.acu-form-row__control),
.acu-agent-advanced :deep(.acu-input),
.acu-agent-advanced :deep(.acu-segmented),
.acu-agent-advanced :deep(.acu-prompt-segs) {
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 720px) {
  .acu-agent-advanced { gap: 12px; }
  .acu-agent-advanced__section { gap: 10px; padding: 10px; }
  .acu-agent-advanced__grid { grid-template-columns: minmax(0, 1fr); }
  .acu-agent-advanced__section-head,
  .acu-agent-advanced__prompt-head { flex-direction: column; align-items: stretch; }
}

@media (max-width: 420px) {
  .acu-agent-advanced__section { padding: 8px; }
}
</style>
