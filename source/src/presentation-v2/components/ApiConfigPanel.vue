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

      <AcuToggle
        v-model="activeDraft.streamingEnabled"
        label="流式输出"
        description="该预设开启后 AI 响应以流式方式输出（用于对话类调用）。每个 API 预设独立。"
      />
      <AcuFormRow label="思考强度" hint="reasoning_effort，随预设保存。每个 API 预设独立。偏小尺寸的模型拉高思考强度有助于保证输出内容正确性">
        <AcuSelect
          :options="reasoningEffortOptions"
          :model-value="activeDraft.reasoningEffort"
          placeholder="请选择"
          @update:model-value="activeDraft.reasoningEffort = $event"
        />
      </AcuFormRow>

      <AcuToggle
        v-model="activeDraft.nonPrefillSupport"
        label="非预填充支持"
        description="该预设开启后，所有使用本预设的调用（剧情推进/填表等）会把 assistant 消息改写为 user，并在首行加上「助手：」前缀。用于不支持 assistant 预填充的模型/接口。"
      />

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

// ─── 思考强度选项（每个 API 预设独立） ───
const reasoningEffortOptions: AcuSelectOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
  { value: "xhigh", label: "XHigh" },
];

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
  });
}

watch(
  () => store.activePresetName,
  () => syncActiveDraft(),
  { flush: "sync" },
);
</script>

<style scoped>
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
