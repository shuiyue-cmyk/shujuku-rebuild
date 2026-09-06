<template>
  <AcuPanel
    :title="apiCopy.panels.preset.title"
    :description="apiCopy.panels.preset.description"
  >
    <AcuMessage v-if="!store.hasPresets" kind="warning">
      暂无可用 API 预设，请新建并设为当前或全局默认。
    </AcuMessage>

    <AcuFormRow label="当前 API 预设" hint="星标表示新聊天默认使用的预设。">
      <div class="acu-api-config-panel__select-row">
        <AcuPresetDropdown
          :items="presetDropdownItems"
          :model-value="store.activePresetName"
          :default-name="store.defaultApiPresetName"
          :disabled="!store.hasPresets"
          placeholder="未选择 API 预设"
          @update:model-value="selectPreset"
          @set-default="store.setDefaultPreset($event)"
        />
        <AcuIconButton
          icon="fa-solid fa-plus"
          title="新建预设"
          @click="startCreateDraft"
        />
        <AcuIconButton
          icon="fa-solid fa-trash-can"
          variant="danger"
          title="删除当前预设"
          :disabled="!store.activePreset"
          @click="store.activePreset && deletePreset(store.activePreset.name)"
        />
      </div>
    </AcuFormRow>


    <form
      v-if="formMode !== 'empty'"
      class="acu-api-config-panel__editor"
      @submit.prevent="saveActiveDraft"
    >
      <AcuFormRow label="预设名称">
        <AcuInput v-model="activeDraft.name" type="text" autocomplete="off" />
      </AcuFormRow>

      <div class="acu-api-config-panel__editor-section">
        <AcuFormRow
          label="接口协议"
          hint="决定请求变形与上游端点：OpenAI→/chat/completions；OpenAI Responses→/responses；Claude Messages→/messages；Gemini Interactions→/interactions（自动补 /v1beta）。默认兼容 OpenAI。注意：纯原生端点下「加载模型」可能失败，可手填模型名。"
        >
          <AcuSelect
            :options="customApiFormatOptions"
            :model-value="activeDraft.customApiFormat"
            @update:model-value="activeDraft.customApiFormat = $event"
          />
        </AcuFormRow>
        <AcuFormRow label="端点(基础URL)">
          <AcuInput
            v-model="activeDraft.url"
            type="text"
            placeholder="https://example.com/v1"
          />
        </AcuFormRow>
        <AcuFormRow label="API 密钥">
          <AcuInput
            v-model="activeDraft.apiKey"
            type="password"
            autocomplete="off"
          />
        </AcuFormRow>
        <AcuFormRow label="模型名">
          <AcuInput v-model="activeDraft.model" type="text" />
        </AcuFormRow>
        <div class="acu-api-config-panel__inline-action">
          <AcuButton @click="loadModelsForActive">加载模型</AcuButton>
          <span
            v-if="store.modelLoadStatus === 'loading'"
            class="acu-api-config-panel__muted"
            >加载中...</span
          >
          <span
            v-else-if="store.modelLoadStatus === 'error'"
            class="acu-api-config-panel__danger"
            >{{ store.modelLoadError }}</span
          >
        </div>
        <AcuFormRow v-if="store.modelOptions.length" label="模型列表">
          <AcuSelect
            :options="modelSelectOptions"
            :model-value="activeDraft.model"
            placeholder="请选择"
            @update:model-value="activeDraft.model = $event"
          />
        </AcuFormRow>
      </div>

      <div class="acu-api-config-panel__two-col">
        <AcuFormRow label="最大回复长度">
          <AcuInput
            v-model="activeDraft.max_tokens"
            type="number"
            :min="1"
            :step="1"
          />
        </AcuFormRow>
        <AcuFormRow label="温度">
          <AcuInput
            v-model="activeDraft.temperature"
            type="number"
            :min="0"
            :max="2"
            :step="0.05"
          />
        </AcuFormRow>
      </div>

      <AcuFormRow label="思考强度" hint="reasoning_effort，随预设保存。每个 API 预设独立。偏小尺寸的模型拉高思考强度有助于保证输出内容正确性。选 Auto 时不传输思考强度参数，由服务端自动决定">
        <AcuSelect
          :options="reasoningEffortOptions"
          :model-value="activeDraft.reasoningEffort || ''"
          placeholder="请选择"
          @update:model-value="activeDraft.reasoningEffort = $event"
        />
      </AcuFormRow>

      <div class="acu-api-config-panel__two-col">
      <AcuToggle
        :model-value="activeDraft.streamingEnabled === true"
        @update:model-value="activeDraft.streamingEnabled = $event"
        label="流式输出"
        description="该预设开启后 AI 响应以流式方式输出（用于对话类调用）。每个 API 预设独立。未显式拨动过则跟随全局流式开关。"
      />
      <AcuToggle
        v-model="activeDraft.nonPrefillSupport"
        label="非预填充支持"
        description="该预设开启后，所有使用本预设的调用（剧情推进/填表等）会把 assistant 消息改写为 user，并在首行加上「助手：」前缀。用于不支持 assistant 预填充的模型/接口。"
      />
      <AcuToggle
        v-model="activeDraft.publicServiceMode"
        label="公益站兼容"
        description="该预设开启后限速：每分钟最多发送 3 次请求（各预设独立计数），超出时自动排队等待。用于有频率限制的公益站/共享接口。默认关闭。"
      />
      <AcuToggle
        v-model="activeDraft.jsonFormatOutput"
        label="需要时格式化输出"
        description="该预设开启后，需要明确返回 JSON 的调用（正文替换/Skill 化/决策/改表助手/续写 Agent 协议）会在请求体附加 response_format json_object，与 MVU 格式化输出同参。不支持该参数的后端请勿开启，或用「排除主体参数」填 response_format 剔除。"
      />
      <AcuToggle
        v-model="activeDraft.enhancedThinking"
        label="增强思考"
        description="该预设开启后，所有经本库发出的 API 调用都会在消息最前面插入一条 system 提示，要求模型最大限度深入思考并写出完整推演过程；会增加输入 token 消耗。建议仅在自家流程使用的预设上开启；若该预设同时给第三方调用共用，请保持关闭。"
      />
      </div>

      <div class="acu-api-config-panel__editor-section">
        <AcuFormRow label="附加主体参数" hint="SillyTavern custom_include_body，填写 YAML object，会合并到最终模型请求体。">
          <AcuTextarea
            v-model="activeDraft.bodyParams"
            :rows="3"
            placeholder="response_format:&#10;  type: json_object&#10;top_k: 50"
          />
        </AcuFormRow>
        <AcuFormRow label="排除主体参数" hint="会转换为 SillyTavern custom_exclude_body，从最终模型请求体删除指定字段。">
          <AcuTextarea
            v-model="activeDraft.excludeBodyParams"
            :rows="2"
            placeholder="top_p, reasoning_effort"
          />
        </AcuFormRow>
        <AcuFormRow
          label="提示词后处理"
          hint="随请求体 custom_prompt_post_processing 透传。默认严格（与旧版本行为一致）；未选择=省略该字段、后端原样透传消息，可保留提示词组中部 system 段的角色。严格等模式会把中部 system 消息改写为 user。"
        >
          <AcuSelect
            :options="promptPostProcessingOptions"
            :model-value="activeDraft.promptPostProcessing"
            placeholder="未选择"
            @update:model-value="setPromptPostProcessing"
          />
        </AcuFormRow>
        <AcuFormRow label="客户端伪装">
          <AcuSelect
            :options="clientPresetOptions"
            :model-value="matchedClientPresetId"
            :disabled="activeDraft.publicServiceMode"
            :placeholder="activeDraft.publicServiceMode ? '已开启公益站兼容，不可使用客户端伪装' : '请选择'"
            @update:model-value="applyClientPreset($event)"
          />
          <template #hint>
            <span class="acu-api-config-panel__hint">
              选择一个客户端身份后，其特征请求头（User-Agent / HTTP-Referer / X-Title 等）会合并进下方附加请求标头：受管身份键统一替换、其余行保留。用于部分屏蔽第三方客户端的供应商。
              <span class="acu-api-config-panel__hint-danger">如果您不清楚这是做什么用的请不要选择。选择启用后的风险自行评估，后果自担。</span>
            </span>
          </template>
        </AcuFormRow>
        <AcuFormRow label="附加请求标头" hint="每行一个 Header: Value，追加到请求头中。">
          <AcuTextarea
            v-model="activeDraft.requestHeaders"
            :rows="2"
            placeholder="X-Custom-Header: value"
          />
        </AcuFormRow>
      </div>

      <AcuMessage v-if="activeDraftError" kind="error">{{
        activeDraftError
      }}</AcuMessage>

      <div class="acu-api-config-panel__actions">
        <AcuButton :disabled="!activeDraftDirty" @click="syncActiveDraft"
          >放弃修改</AcuButton
        >
        <AcuButton
          variant="primary"
          native-type="submit"
          :disabled="!activeDraftDirty"
        >
          {{ formMode === "create" ? "保存并选中预设" : "保存当前预设" }}
        </AcuButton>
      </div>
    </form>

    <AcuMessage v-else kind="warning">
      暂无可用 API 预设，请新建并设为当前或全局默认。
    </AcuMessage>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  apiPresetDraftFromPreset,
  apiPresetFromDraft,
  createEmptyApiPresetDraft,
  type ApiPresetDraft,
} from "../composables/useApiPresetManagement";
import { useUiCloseGuard } from "../composables/useUiCloseGuard";
import { apiCopy } from "../copy/api-copy";
import {
  useApiPresetStore,
  type AcuV2ApiPreset,
} from "../stores/api-preset-store";
import { useDialogStore } from "../stores/dialog-store";
import { useToastStore } from "../stores/toast-store";
import AcuButton from "./_lib/AcuButton.vue";
import AcuFormRow from "./_lib/AcuFormRow.vue";
import AcuIconButton from "./_lib/AcuIconButton.vue";
import AcuInput from "./_lib/AcuInput.vue";
import AcuMessage from "./_lib/AcuMessage.vue";
import AcuPanel from "./_lib/AcuPanel.vue";
import AcuTextarea from "./_lib/AcuTextarea.vue";
import type { PresetDropdownItem } from "./_lib/AcuPresetDropdown.vue";
import AcuPresetDropdown from "./_lib/AcuPresetDropdown.vue";
import AcuSelect, { type AcuSelectOption } from "./_lib/AcuSelect.vue";
import AcuToggle from "./_lib/AcuToggle.vue";
import { assertSafeHttpEndpoint_ACU } from "../../shared/utils";
import {
  CLIENT_HEADER_PRESETS_ACU,
  CLIENT_HEADER_PRESET_NONE_ACU,
  applyClientHeaderPreset_ACU,
  matchClientHeaderPreset_ACU,
  stripManagedClientHeaders_ACU,
  hasManagedClientKeys_ACU,
} from "../composables/client-header-presets";

// ─── 思考强度选项（每个 API 预设独立；Auto 档不传输 reasoning_effort 参数） ───
const reasoningEffortOptions: AcuSelectOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
  { value: "false", label: "False（关闭思考）" },
  { value: "auto", label: "Auto（自动）" },
];

// ─── 接口协议选项（对齐 TT 主 API 四个「自定义」选项，custom_api_format 契约） ───
const customApiFormatOptions: AcuSelectOption[] = [
  { value: "openai_compat", label: "兼容 OpenAI" },
  { value: "openai_responses", label: "兼容 OpenAI Responses" },
  { value: "claude_messages", label: "兼容 Claude Messages" },
  { value: "gemini_interactions", label: "兼容 Gemini Interactions" },
];

// ─── 提示词后处理选项（custom_prompt_post_processing 八值契约；'' 为「未选择」，默认 'strict'） ───
const promptPostProcessingOptions: AcuSelectOption[] = [
  { value: "", label: "未选择" },
  { value: "merge_tools", label: "合并相同角色连续的发言（含工具）", group: "With Tools" },
  { value: "semi_tools", label: "半严格（强制对话角色交替）（含工具）", group: "With Tools" },
  { value: "strict_tools", label: "严格（强制对话角色交替、用户最先）（含工具）", group: "With Tools" },
  { value: "merge", label: "合并相同角色连续的发言", group: "No Tools" },
  { value: "semi", label: "半严格（强制对话角色交替）", group: "No Tools" },
  { value: "strict", label: "严格（强制对话角色交替、用户最先）", group: "No Tools" },
  { value: "single", label: "单一用户消息（无工具）" },
];

function setPromptPostProcessing(value: string): void {
  activeDraft.promptPostProcessing = value;
  activeDraftSavedAt.value = null;
}

// ─── 客户端伪装预设（附加请求标头的可选填充） ───
const clientPresetOptions: AcuSelectOption[] = [
  { value: CLIENT_HEADER_PRESET_NONE_ACU, label: "不使用预设" },
  ...CLIENT_HEADER_PRESETS_ACU.map((p) => ({ value: p.id, label: p.label })),
];
const matchedClientPresetId = computed(() => {
  const matched = matchClientHeaderPreset_ACU(activeDraft.requestHeaders);
  if (matched) return matched;
  // 无任何受管身份键时回显「不使用预设」；部分残留（手改过值）则不回显
  return hasManagedClientKeys_ACU(activeDraft.requestHeaders) ? "" : CLIENT_HEADER_PRESET_NONE_ACU;
});
function applyClientPreset(id: string | number | null): void {
  if (activeDraft.publicServiceMode) return;
  if (String(id ?? "") === CLIENT_HEADER_PRESET_NONE_ACU) {
    activeDraft.requestHeaders = stripManagedClientHeaders_ACU(activeDraft.requestHeaders);
    return;
  }
  const preset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === String(id ?? ""));
  if (!preset) return;
  activeDraft.requestHeaders = applyClientHeaderPreset_ACU(activeDraft.requestHeaders, preset);
}

const store = useApiPresetStore();
const dialogStore = useDialogStore();
const toast = useToastStore();
const formMode = ref<"empty" | "edit" | "create">("empty");
const activeDraft = reactive<ApiPresetDraft>(createEmptyApiPresetDraft());
const activeDraftOriginalName = ref("");
const activeDraftSnapshot = ref("");
const activeDraftError = ref("");
const activeDraftSavedAt = ref<number | null>(null);

const activeDraftDirty = computed(() => {
  if (formMode.value === "create")
    return JSON.stringify(activeDraft) !== activeDraftSnapshot.value;
  return (
    !!store.activePreset &&
    JSON.stringify(activeDraft) !== activeDraftSnapshot.value
  );
});
const modelSelectOptions = computed<AcuSelectOption[]>(() =>
  store.modelOptions.map((m) => ({ value: m, label: m })),
);
const presetDropdownItems = computed<PresetDropdownItem[]>(() =>
  store.presets.map((p) => ({
    name: p.name,
    meta: presetMeta(p),
  })),
);

function refreshAll(): void {
  store.refreshFromSettings();
  syncActiveDraft();
}

onMounted(() => {
  refreshAll();
});
useUiCloseGuard(async () => {
  if (!activeDraftDirty.value) return true;
  return dialogStore.confirm({
    title: "关闭新 UI",
    message: "你有未保存的当前 API 修改，确定要关闭新 UI 吗？",
    confirmLabel: "关闭新 UI",
    confirmVariant: "danger",
  });
});

function syncActiveDraft(): void {
  const preset = store.activePreset;
  if (!preset) {
    Object.assign(activeDraft, createEmptyApiPresetDraft());
    activeDraftOriginalName.value = "";
    formMode.value = "empty";
  } else {
    Object.assign(
      activeDraft,
      createEmptyApiPresetDraft(),
      apiPresetDraftFromPreset(preset),
    );
    activeDraftOriginalName.value = preset.name;
    formMode.value = "edit";
  }
  activeDraftSnapshot.value = JSON.stringify(activeDraft);
  activeDraftError.value = "";
  activeDraftSavedAt.value = null;
}

function startCreateDraft(): void {
  Object.assign(activeDraft, createEmptyApiPresetDraft());
  activeDraftOriginalName.value = "";
  formMode.value = "create";
  activeDraftSnapshot.value = JSON.stringify(activeDraft);
  activeDraftError.value = "";
  activeDraftSavedAt.value = null;
}

async function selectPreset(name: string): Promise<void> {
  if (activeDraftDirty.value) {
    const confirmed = await dialogStore.confirm({
      title: '切换预设',
      message: '当前预设有未保存的修改，切换将丢失这些修改，确定要切换吗？',
      confirmLabel: '切换',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
  }
  store.setActivePresetForCurrentChat(name);
}

async function deletePreset(name: string): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: "删除 API 预设",
    message: `删除 API 预设"${name}"？`,
    confirmLabel: "删除预设",
    confirmVariant: "danger",
  });
  if (!confirmed) return;
  store.deletePreset(name);
}

function presetMeta(preset: AcuV2ApiPreset): string {
  return preset.apiConfig.model || "自定义";
}

function validateActiveDraft(): boolean {
  if (!activeDraft.name.trim()) {
    activeDraftError.value = "预设名称不能为空。";
    return false;
  }
  if (!activeDraft.url.trim()) {
    activeDraftError.value = "自定义 API 需要填写端点(基础URL)。";
    return false;
  }
  try {
    assertSafeHttpEndpoint_ACU(activeDraft.url.trim());
  } catch (e: any) {
    activeDraftError.value = String(e?.message || '端点地址不安全，请检查 URL。');
    return false;
  }
  if (!activeDraft.model.trim()) {
    activeDraftError.value = "自定义 API 需要填写模型。";
    return false;
  }
  activeDraftError.value = "";
  return true;
}

function saveActiveDraft(): void {
  if (!validateActiveDraft()) return;
  const preset = apiPresetFromDraft(activeDraft);
  const ok = store.savePreset(preset, activeDraftOriginalName.value);
  if (!ok) {
    activeDraftError.value = "预设保存失败。";
    return;
  }
  if (formMode.value === "create") {
    const activateOk = store.setActivePresetForCurrentChat(preset.name);
    if (!activateOk) {
      activeDraftError.value = "预设已保存，但切换为当前聊天预设失败。";
      return;
    }
  }
  store.refreshFromSettings();
  syncActiveDraft();
  activeDraftSavedAt.value = Date.now();
  toast.success("已保存当前 API 预设。");
}

async function loadModelsForActive(): Promise<void> {
  await store.loadModelsForConfig({
    url: activeDraft.url,
    apiKey: activeDraft.apiKey,
    // 探活必须带上接口协议：claude_messages / gemini_interactions 的模型列表
    // 与 OpenAI 兼容端点不同源，漏传会让 TT 按 openai_compat 探活、拿不到模型。
    customApiFormat: activeDraft.customApiFormat,
  });
}

watch(
  () => store.activePresetName,
  () => syncActiveDraft(),
  { flush: "sync" },
);
</script>

<style scoped>
.acu-api-config-panel__hint {
  color: var(--acu-text-3, #9e978e);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
}

.acu-api-config-panel__hint-danger {
  color: var(--acu-danger, #e5484d);
}

.acu-api-config-panel__select-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content max-content;
  gap: 6px;
  align-items: stretch;
}

.acu-api-config-panel__behavior {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
}

.acu-api-config-panel__editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.acu-api-config-panel__editor-section {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.acu-api-config-panel__inline-action {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.acu-api-config-panel__two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.acu-api-config-panel__muted {
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
}

.acu-api-config-panel__danger {
  color: var(--acu-danger);
  font-size: var(--acu-font-size-body, 12px);
}

.acu-api-config-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
