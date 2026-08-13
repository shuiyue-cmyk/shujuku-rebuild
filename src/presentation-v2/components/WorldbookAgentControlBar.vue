<template>
  <section class="acu-v2-agent-wb-control">
    <div class="acu-v2-agent-wb-control__head">
      <div>
        <div class="acu-v2-agent-wb-control__title">{{ plotCopy.agentControl.title }}</div>
        <p class="acu-v2-agent-wb-control__desc">{{ plotCopy.agentControl.description }}</p>
      </div>
      <AcuBadge :variant="statusVariant">{{ statusText }}</AcuBadge>
    </div>

    <div class="acu-v2-agent-wb-control__body">
      <p class="acu-v2-agent-wb-control__config-source">{{ agentControl.configStatusText.value }}</p>

      <AcuSegmentedControl
        :model-value="agentControl.mode.value"
        :options="modeOptions"
        size="sm"
        aria-label="Agent 世界书模式"
        @update:model-value="onModeChange"
      />
      <div class="acu-v2-agent-wb-control__api-selects">
        <AcuFormRow
          :label="plotCopy.agentControl.apiPresets.decisionLabel"
          :hint="plotCopy.agentControl.apiPresets.decisionHint"
        >
          <AcuSelect
            :options="agentControl.apiPresetOptions.value"
            :model-value="agentControl.agentApiPreset.value"
            :placeholder="plotCopy.agentControl.apiPresets.followCurrentLabel"
            size="sm"
            @update:model-value="agentControl.setAgentApiPreset"
          />
        </AcuFormRow>
        <AcuFormRow
          :label="plotCopy.agentControl.apiPresets.skillLabel"
          :hint="plotCopy.agentControl.apiPresets.skillHint"
        >
          <AcuSelect
            :options="agentControl.apiPresetOptions.value"
            :model-value="agentControl.agentSkillApiPreset.value"
            :placeholder="plotCopy.agentControl.apiPresets.followCurrentLabel"
            size="sm"
            @update:model-value="agentControl.setAgentSkillApiPreset"
          />
        </AcuFormRow>
      </div>
      <div class="acu-v2-agent-wb-control__actions">
        <AcuButton size="sm" @click="advancedOpen = true">
          {{ plotCopy.agentControl.advanced.button }}
        </AcuButton>
        <AcuButton size="sm" :loading="agentControl.busy.value === 'restore'" :disabled="agentControl.busy.value !== null" @click="runRestore">
          {{ plotCopy.agentControl.restore.button }}
        </AcuButton>
        <AcuButton size="sm" variant="primary" :loading="agentControl.busy.value === 'skillify'" :disabled="agentControl.busy.value !== null" @click="runSkillify">
          {{ plotCopy.agentControl.skillify.button }}
        </AcuButton>
        <AcuButton size="sm" variant="danger" :loading="agentControl.busy.value === 'clearSkillMeta'" :disabled="agentControl.busy.value !== null" @click="runClearSkillMeta">
          {{ plotCopy.agentControl.clearSkillMeta.button }}
        </AcuButton>
      </div>
    </div>

    <WorldbookAgentAdvancedPanel
      :open="advancedOpen"
      :agent-control="agentControl"
      @close="advancedOpen = false"
      @current-worldbook-changed="emit('current-worldbook-changed')"
      @global-template-saved="emit('global-template-saved')"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AgentWorldbookControlMode_ACU } from '../../shared/models/agent-worldbook-model';
import { usePlotWorldbookAgentControl } from '../composables/usePlotWorldbookAgentControl';
import { plotCopy } from '../copy/plot-copy';
import AcuBadge from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import WorldbookAgentAdvancedPanel from './WorldbookAgentAdvancedPanel.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuSegmentedControl, { type AcuSegmentedOption } from './_lib/AcuSegmentedControl.vue';
import AcuSelect from './_lib/AcuSelect.vue';

type AcuBadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const props = defineProps<{
  agentControl: ReturnType<typeof usePlotWorldbookAgentControl>;
}>();

const emit = defineEmits<{
  (e: 'current-worldbook-changed'): void;
  (e: 'global-template-saved'): void;
}>();

const agentControl = props.agentControl;
const advancedOpen = ref(false);

const modeOptions: AcuSegmentedOption[] = [
  { value: 'disabled', label: plotCopy.agentControl.modes.disabled },
  { value: 'passive', label: plotCopy.agentControl.modes.passive },
  { value: 'agent', label: plotCopy.agentControl.modes.agent },
];

const statusVariant = computed<AcuBadgeVariant>(() => agentControl.isAgentMode.value ? 'accent' : 'neutral');
const statusText = computed(() => agentControl.isAgentMode.value
  ? plotCopy.agentControl.status.active()
  : plotCopy.agentControl.status.inactive);

async function onModeChange(value: string): Promise<void> {
  await agentControl.setMode(value as AgentWorldbookControlMode_ACU);
  emit('current-worldbook-changed');
}

async function runRestore(): Promise<void> {
  if (await agentControl.restore()) emit('current-worldbook-changed');
}
async function runSkillify(): Promise<void> {
  if (await agentControl.skillifyAll()) emit('current-worldbook-changed');
}
async function runClearSkillMeta(): Promise<void> {
  if (await agentControl.clearSkillMeta()) emit('current-worldbook-changed');
}
</script>

<style scoped>
.acu-v2-agent-wb-control { display: flex; flex-direction: column; gap: 10px; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 10px; border-radius: var(--acu-radius-sm); background: var(--acu-bg-2); }
.acu-v2-agent-wb-control__head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; min-width: 0; max-width: 100%; }
.acu-v2-agent-wb-control__title { font-size: var(--acu-font-size-body-lg, 13px); font-weight: 600; color: var(--acu-text-1); }
.acu-v2-agent-wb-control__desc { margin: 3px 0 0; font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3); line-height: 1.5; }
.acu-v2-agent-wb-control__body { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; max-width: 100%; }
.acu-v2-agent-wb-control__config-source { flex: 1 1 100%; min-width: 0; margin: 0; font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3); line-height: 1.5; overflow-wrap: anywhere; }
.acu-v2-agent-wb-control__api-selects { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; flex: 1 1 380px; min-width: 0; max-width: 100%; }
.acu-v2-agent-wb-control__actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; }

@media (max-width: 720px) {
  .acu-v2-agent-wb-control__api-selects { flex-basis: 100%; grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 480px) {
  .acu-v2-agent-wb-control__actions { width: 100%; }
  .acu-v2-agent-wb-control__actions :deep(.acu-btn) { flex: 1 1 100%; }
}
</style>
