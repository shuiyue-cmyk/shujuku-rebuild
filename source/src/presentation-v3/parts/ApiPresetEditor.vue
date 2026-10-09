<template>
  <div class="ub-api">
    <UbSection
      :id="`${idPrefix}-preset`"
      title="当前 API 预设"
      description="数据库各功能默认用这里选中的预设。星标 = 新聊天默认使用的预设。"
      icon="fa-solid fa-plug"
    >
      <div class="ub-api__picker">
        <UbPresetPicker
          title="选择 API 预设"
          :items="presetItems"
          :model-value="formMode === 'create' ? '' : store.activePresetName"
          :default-name="store.defaultApiPresetName"
          :disabled="!store.hasPresets"
          :placeholder="formMode === 'create' ? '新建中（未保存）' : '未选择 API 预设'"
          @update:model-value="selectPreset"
          @set-default="store.setDefaultPreset($event)"
        />
        <UbIconButton icon="fa-solid fa-plus" variant="solid" title="新建预设" @click="startCreateDraft" />
        <UbIconButton
          icon="fa-solid fa-trash-can"
          variant="danger"
          title="删除当前预设"
          :disabled="!store.activePreset"
          @click="store.activePreset && deletePreset(store.activePreset.name)"
        />
      </div>
      <div v-if="formMode === 'empty'" class="ub-api__empty">
        <UbCallout kind="warning">暂无可用 API 预设，请新建并设为当前或全局默认。</UbCallout>
      </div>
      <div v-else-if="formMode === 'create'" class="ub-api__empty">
        <UbCallout kind="info">正在新建预设：填好下面的连接信息后保存，会自动切换为当前聊天使用。</UbCallout>
      </div>
    </UbSection>

    <form v-if="formMode !== 'empty'" class="ub-api__form" novalidate @submit.prevent="saveActiveDraft">
      <UbSection :id="`${idPrefix}-connection`" title="连接" icon="fa-solid fa-link">
        <UbRow label="预设名称" stack>
          <UbInput v-model="draft.name" autocomplete="off" aria-label="预设名称" />
        </UbRow>
        <UbRow
          v-if="savedEndpoints.length"
          label="已保存的端点"
          hint="复用已保存预设里用过的端点，只填端点；接口协议、API 密钥和模型名按所用模型自己选填。用新地址时选「手填」。"
          stack
        >
          <UbSelect
            :options="savedEndpointOptions"
            :model-value="matchedSavedEndpointId"
            aria-label="已保存的端点"
            @update:model-value="applySavedEndpoint($event)"
          />
        </UbRow>
        <UbRow
          label="接口协议"
          hint="决定请求变形与上游端点：OpenAI→/chat/completions；OpenAI Responses→/responses；Claude Messages→/messages；Gemini Interactions→/interactions（自动补 /v1beta）。默认兼容 OpenAI。纯原生端点下「加载模型」可能失败，可手填模型名。"
          stack
        >
          <UbSelect
            :options="customApiFormatOptions"
            :model-value="draft.customApiFormat"
            aria-label="接口协议"
            @update:model-value="draft.customApiFormat = $event"
          />
        </UbRow>
        <UbRow label="端点（基础 URL）" stack>
          <UbInput v-model="draft.url" placeholder="https://example.com/v1" aria-label="端点" />
        </UbRow>
        <UbRow label="API 密钥" stack>
          <UbInput v-model="draft.apiKey" type="password" autocomplete="off" aria-label="API 密钥" />
        </UbRow>
        <UbRow label="模型名" stack>
          <div class="ub-api__model">
            <UbInput v-model="draft.model" aria-label="模型名" />
            <UbButton :busy="store.modelLoadStatus === 'loading'" icon="fa-solid fa-cloud-arrow-down" @click="loadModelsForActive">加载模型</UbButton>
          </div>
          <UbSelect
            v-if="store.modelOptions.length"
            :options="modelSelectOptions"
            :model-value="draft.model"
            placeholder="从已加载的模型中选择"
            aria-label="模型列表"
            @update:model-value="draft.model = $event"
          />
          <p v-if="store.modelLoadStatus === 'error'" class="ub-api__error">{{ store.modelLoadError }}</p>
        </UbRow>
      </UbSection>

      <UbSection :id="`${idPrefix}-generation`" title="生成参数" icon="fa-solid fa-gauge-high">
        <UbRow label="最大回复长度">
          <UbInput v-model="draft.max_tokens" type="number" :min="1" :step="1" aria-label="最大回复长度" />
        </UbRow>
        <UbRow label="温度">
          <UbInput v-model="draft.temperature" type="number" :min="0" :max="2" :step="0.05" aria-label="温度" />
        </UbRow>
        <UbRow
          label="思考强度"
          hint="reasoning_effort，每个预设独立。小模型调高有助于输出正确；选 Auto 时不传该参数，由服务端决定。"
        >
          <UbSelect
            :options="reasoningEffortOptions"
            :model-value="draft.reasoningEffort || ''"
            aria-label="思考强度"
            @update:model-value="draft.reasoningEffort = $event"
          />
        </UbRow>
      </UbSection>

      <UbSection :id="`${idPrefix}-behavior`" title="请求行为" description="以下开关都只作用于这个预设。" icon="fa-solid fa-sliders">
        <UbRow label="流式输出" hint="AI 响应以流式方式输出（用于对话类调用）。未拨动过时跟随全局流式开关。">
          <UbSwitch
            :model-value="draft.streamingEnabled === true"
            aria-label="流式输出"
            @update:model-value="draft.streamingEnabled = $event"
          />
        </UbRow>
        <UbRow label="非预填充支持" hint="把 assistant 消息改写为 user，并在首行加「助手：」前缀。用于不支持 assistant 预填充的模型/接口。">
          <UbSwitch v-model="draft.nonPrefillSupport" aria-label="非预填充支持" />
        </UbRow>
        <UbRow label="公益站兼容" hint="限速：每分钟最多 3 次请求（各预设独立计数），超出自动排队。用于有频率限制的公益站/共享接口。">
          <UbSwitch v-model="draft.publicServiceMode" aria-label="公益站兼容" />
        </UbRow>
        <UbRow label="需要时格式化输出" hint="需要返回 JSON 的调用（正文替换 / Skill 化 / 决策 / 改表助手 / 续写 Agent）会附加 response_format json_object。后端不支持时请勿开启，或在「排除主体参数」填 response_format。">
          <UbSwitch v-model="draft.jsonFormatOutput" aria-label="需要时格式化输出" />
        </UbRow>
        <UbRow label="保留多个 system 消息" hint="默认开启。提示词后处理为严格/半严格时，中部 system 仍保留角色；关闭后按后处理模式改写。">
          <UbSwitch v-model="draft.preserveMultipleSystem" aria-label="保留多个 system 消息" />
        </UbRow>
      </UbSection>

      <UbSection :id="`${idPrefix}-advanced`" title="请求改写" description="一般不需要改，遇到特定后端兼容问题时再调整。" icon="fa-solid fa-code">
        <UbRow label="附加主体参数" hint="填写 YAML 对象，合并进最终请求体（custom_include_body）。" stack>
          <UbTextarea v-model="draft.bodyParams" :rows="3" mono aria-label="附加主体参数" placeholder="response_format:&#10;  type: json_object&#10;top_k: 50" />
        </UbRow>
        <UbRow label="排除主体参数" hint="从最终请求体删除这些字段（custom_exclude_body）。" stack>
          <UbTextarea v-model="draft.excludeBodyParams" :rows="2" mono aria-label="排除主体参数" placeholder="top_p, reasoning_effort" />
        </UbRow>
        <UbRow
          label="提示词后处理"
          hint="默认严格（与旧版一致）；未选择＝原样透传，可保留中部 system 段角色。分组只决定消息改写策略，不剥离 tools 字段。"
          stack
        >
          <UbSelect
            :options="promptPostProcessingOptions"
            :model-value="draft.promptPostProcessing"
            placeholder="未选择"
            aria-label="提示词后处理"
            @update:model-value="setPromptPostProcessing"
          />
        </UbRow>
        <UbRow label="客户端伪装" stack>
          <template #hint>
            选择客户端身份后，其特征请求头会合并进下方附加请求标头（受管身份键统一替换，其余行保留），用于部分屏蔽第三方客户端的供应商。
            <strong class="ub-api__danger-hint">不清楚用途请不要选择；启用后的风险自行评估，后果自担。</strong>
          </template>
          <UbSelect
            :options="clientPresetOptions"
            :model-value="matchedClientPresetId"
            :disabled="draft.publicServiceMode"
            :placeholder="draft.publicServiceMode ? '已开启公益站兼容，不可使用客户端伪装' : '请选择'"
            aria-label="客户端伪装"
            @update:model-value="applyClientPreset($event)"
          />
        </UbRow>
        <UbRow label="附加请求标头" hint="每行一个 Header: Value，追加到请求头。" stack>
          <UbTextarea v-model="draft.requestHeaders" :rows="2" mono aria-label="附加请求标头" placeholder="X-Custom-Header: value" />
        </UbRow>
      </UbSection>

      <div class="ub-api__savebar" :class="{ 'is-dirty': draftDirty || !!draftError }">
        <p class="ub-api__savebar-text" :class="{ 'is-error': !!draftError }">
          <template v-if="draftError">{{ draftError }}</template>
          <template v-else-if="draftDirty">有未保存的修改</template>
          <template v-else>已是最新</template>
        </p>
        <UbButton variant="ghost" :disabled="!draftDirty" @click="syncActiveDraft">放弃修改</UbButton>
        <UbButton variant="primary" native-type="submit" icon="fa-solid fa-floppy-disk" :disabled="!draftDirty">
          {{ formMode === 'create' ? '保存并选中预设' : '保存当前预设' }}
        </UbButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  CLIENT_HEADER_PRESETS_ACU,
  CLIENT_HEADER_PRESET_NONE_ACU,
  applyClientHeaderPreset_ACU,
  hasManagedClientKeys_ACU,
  matchClientHeaderPreset_ACU,
  stripManagedClientHeaders_ACU,
} from '../../presentation-v2/composables/client-header-presets';
import {
  SAVED_API_ENDPOINT_MANUAL_ACU,
  collectSavedApiEndpoints_ACU,
  matchSavedApiEndpoint_ACU,
} from '../../presentation-v2/composables/saved-api-endpoints';
import {
  apiPresetDraftFromPreset,
  apiPresetFromDraft,
  createEmptyApiPresetDraft,
  type ApiPresetDraft,
} from '../../presentation-v2/composables/useApiPresetManagement';
import { useUiCloseGuard } from '../../presentation-v2/composables/useUiCloseGuard';
import { useApiPresetStore } from '../../presentation-v2/stores/api-preset-store';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import { assertSafeHttpEndpoint_ACU } from '../../shared/utils';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbInput from '../ui/UbInput.vue';
import UbPresetPicker from '../ui/UbPresetPicker.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect, { type UbSelectOption } from '../ui/UbSelect.vue';
import UbSwitch from '../ui/UbSwitch.vue';
import UbTextarea from '../ui/UbTextarea.vue';

withDefaults(defineProps<{ idPrefix?: string }>(), { idPrefix: 'api' });

const reasoningEffortOptions: UbSelectOption[] = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
  { value: 'ultra', label: 'Ultra' },
  { value: 'auto', label: 'Auto（自动）' },
];

const customApiFormatOptions: UbSelectOption[] = [
  { value: 'openai_compat', label: '兼容 OpenAI' },
  { value: 'openai_responses', label: '兼容 OpenAI Responses' },
  { value: 'claude_messages', label: '兼容 Claude Messages' },
  { value: 'gemini_interactions', label: '兼容 Gemini Interactions' },
  { value: 'gemini_generate_content', label: '兼容 Gemini generateContent' },
];

const promptPostProcessingOptions: UbSelectOption[] = [
  { value: '', label: '未选择' },
  { value: 'merge_tools', label: '合并相同角色连续的发言（含工具）', group: '含工具消息改写' },
  { value: 'semi_tools', label: '半严格（强制对话角色交替）（含工具）', group: '含工具消息改写' },
  { value: 'strict_tools', label: '严格（强制对话角色交替、用户最先）（含工具）', group: '含工具消息改写' },
  { value: 'merge', label: '合并相同角色连续的发言', group: '纯文本消息改写' },
  { value: 'semi', label: '半严格（强制对话角色交替）', group: '纯文本消息改写' },
  { value: 'strict', label: '严格（强制对话角色交替、用户最先）', group: '纯文本消息改写' },
  { value: 'single', label: '单一用户消息（无工具）' },
];

const clientPresetOptions: UbSelectOption[] = [
  { value: CLIENT_HEADER_PRESET_NONE_ACU, label: '不使用预设' },
  ...CLIENT_HEADER_PRESETS_ACU.map(p => ({ value: p.id, label: p.label })),
];

const store = useApiPresetStore();
const dialogStore = useDialogStore();
const toast = useToastStore();

const formMode = ref<'empty' | 'edit' | 'create'>('empty');
const draft = reactive<ApiPresetDraft>(createEmptyApiPresetDraft());
const draftOriginalName = ref('');
const draftSnapshot = ref('');
const draftError = ref('');

const draftDirty = computed(() => {
  if (formMode.value === 'create') return JSON.stringify(draft) !== draftSnapshot.value;
  return !!store.activePreset && JSON.stringify(draft) !== draftSnapshot.value;
});

const presetItems = computed(() => store.presets.map(p => ({ name: p.name, meta: p.apiConfig.model || '自定义' })));
const modelSelectOptions = computed<UbSelectOption[]>(() => store.modelOptions.map(m => ({ value: m, label: m })));

const matchedClientPresetId = computed(() => {
  const matched = matchClientHeaderPreset_ACU(draft.requestHeaders);
  if (matched) return matched;
  // 没有任何受管身份键时显示「不使用预设」；手改过的残留不回显
  return hasManagedClientKeys_ACU(draft.requestHeaders) ? '' : CLIENT_HEADER_PRESET_NONE_ACU;
});

const savedEndpoints = computed(() => collectSavedApiEndpoints_ACU(store.presets));
const savedEndpointOptions = computed<UbSelectOption[]>(() => [
  { value: SAVED_API_ENDPOINT_MANUAL_ACU, label: '手填' },
  ...savedEndpoints.value.map(e => ({ value: e.id, label: e.label })),
]);
// 按当前端点回显；手改过端点即显示「手填」
const matchedSavedEndpointId = computed(
  () => matchSavedApiEndpoint_ACU(savedEndpoints.value, draft.url)?.id ?? SAVED_API_ENDPOINT_MANUAL_ACU,
);

/** 只填端点（协议按模型不同，留给用户选）；选「手填」不动已有内容。 */
function applySavedEndpoint(id: string): void {
  const endpoint = savedEndpoints.value.find(e => e.id === id);
  if (endpoint) draft.url = endpoint.url;
}

function setPromptPostProcessing(value: string): void {
  draft.promptPostProcessing = value;
}

function applyClientPreset(id: string): void {
  if (draft.publicServiceMode) return;
  if (id === CLIENT_HEADER_PRESET_NONE_ACU) {
    draft.requestHeaders = stripManagedClientHeaders_ACU(draft.requestHeaders);
    return;
  }
  const preset = CLIENT_HEADER_PRESETS_ACU.find(p => p.id === id);
  if (preset) draft.requestHeaders = applyClientHeaderPreset_ACU(draft.requestHeaders, preset);
}

function syncActiveDraft(): void {
  const preset = store.activePreset;
  if (!preset) {
    Object.assign(draft, createEmptyApiPresetDraft());
    draftOriginalName.value = '';
    formMode.value = 'empty';
  } else {
    Object.assign(draft, createEmptyApiPresetDraft(), apiPresetDraftFromPreset(preset));
    draftOriginalName.value = preset.name;
    formMode.value = 'edit';
  }
  draftSnapshot.value = JSON.stringify(draft);
  draftError.value = '';
}

function startCreateDraft(): void {
  Object.assign(draft, createEmptyApiPresetDraft());
  draftOriginalName.value = '';
  formMode.value = 'create';
  draftSnapshot.value = JSON.stringify(draft);
  draftError.value = '';
}

async function selectPreset(name: string): Promise<void> {
  if (draftDirty.value) {
    const confirmed = await dialogStore.confirm({
      title: '切换预设',
      message: '当前预设有未保存的修改，切换将丢失这些修改，确定要切换吗？',
      confirmLabel: '切换',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
  }
  store.setActivePresetForCurrentChat(name);
  // 选的若正是当前预设（如点「+」新建后又选回它），activePresetName 不变、watch 不触发，这里显式载入表单
  syncActiveDraft();
}

async function deletePreset(name: string): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: '删除 API 预设',
    message: `删除 API 预设"${name}"？`,
    confirmLabel: '删除预设',
    confirmVariant: 'danger',
  });
  if (confirmed) store.deletePreset(name);
}

function validateDraft(): boolean {
  if (!draft.name.trim()) {
    draftError.value = '预设名称不能为空。';
    return false;
  }
  if (!draft.url.trim()) {
    draftError.value = '自定义 API 需要填写端点（基础 URL）。';
    return false;
  }
  try {
    assertSafeHttpEndpoint_ACU(draft.url.trim());
  } catch (e: any) {
    draftError.value = String(e?.message || '端点地址不安全，请检查 URL。');
    return false;
  }
  if (!draft.model.trim()) {
    draftError.value = '自定义 API 需要填写模型。';
    return false;
  }
  draftError.value = '';
  return true;
}

function saveActiveDraft(): void {
  if (!validateDraft()) return;
  const preset = apiPresetFromDraft(draft);
  if (!store.savePreset(preset, draftOriginalName.value)) {
    draftError.value = '预设保存失败。';
    return;
  }
  if (formMode.value === 'create' && !store.setActivePresetForCurrentChat(preset.name)) {
    draftError.value = '预设已保存，但切换为当前聊天预设失败。';
    return;
  }
  store.refreshFromSettings();
  syncActiveDraft();
  toast.success('已保存当前 API 预设。');
}

async function loadModelsForActive(): Promise<void> {
  // 探活必须带接口协议：非 OpenAI 兼容端点的模型列表不同源
  await store.loadModelsForConfig({
    url: draft.url,
    apiKey: draft.apiKey,
    customApiFormat: draft.customApiFormat,
  });
}

onMounted(() => {
  store.refreshFromSettings();
  syncActiveDraft();
});

useUiCloseGuard(async () => {
  if (!draftDirty.value) return true;
  return dialogStore.confirm({
    title: '关闭 UnbirthDB',
    message: '你有未保存的 API 修改，确定要关闭吗？',
    confirmLabel: '仍然关闭',
    confirmVariant: 'danger',
  });
});

watch(() => store.activePresetName, () => syncActiveDraft(), { flush: 'sync' });
</script>

<style scoped>
.ub-api,
.ub-api__form {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s6);
  min-width: 0;
}

.ub-api__picker {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4);
}

.ub-api__empty {
  padding: 0 var(--ub-s4) var(--ub-s3);
}

.ub-api__model {
  display: flex;
  gap: var(--ub-s2);
  width: 100%;
}

.ub-api__model > :first-child {
  flex: 1 1 auto;
}

.ub-api__error {
  color: var(--ub-danger);
  font-size: var(--ub-fs-xs);
}

.ub-api__danger-hint {
  color: var(--ub-danger);
  font-weight: 600;
}

.ub-api__savebar {
  position: sticky;
  bottom: var(--ub-s3);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s4);
  border: 1px solid var(--ub-line-soft);
  border-radius: 999px;
  background: var(--ub-toast-bg);
  box-shadow: var(--ub-overlay-shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.ub-api__savebar:not(.is-dirty) {
  box-shadow: none;
}

.ub-api__savebar-text {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-api__savebar.is-dirty .ub-api__savebar-text {
  color: var(--ub-warn);
}

.ub-api__savebar-text.is-error {
  color: var(--ub-danger) !important;
}

@media (max-width: 560px) {
  .ub-api__savebar {
    flex-wrap: wrap;
    border-radius: var(--ub-r-card);
  }

  .ub-api__savebar-text {
    flex-basis: 100%;
  }
}
</style>
