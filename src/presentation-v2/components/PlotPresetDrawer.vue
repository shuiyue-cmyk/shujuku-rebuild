<template>
  <AcuDrawer
    :is-open="isOpen"
    :title="title"
    :show-back="view === 'create' || view === 'edit'"
    :before-close="beforeClose"
    width="720px"
    @close="$emit('close')"
    @back="$emit('back')"
  >
    <!-- MANAGE -->
    <template v-if="view === 'manage'">
      <AcuButton
        variant="primary"
        class="acu-v2-plot-drawer__create-btn"
        @click="$emit('open-create')"
      >
        <i class="fa-solid fa-plus"></i> 从默认新建
      </AcuButton>

      <ul v-if="presetMeta.length" class="acu-v2-manage-list">
        <li
          v-for="meta in presetMeta"
          :key="meta.name"
          class="acu-v2-manage-item"
        >
          <div class="acu-v2-manage-item__info">
            <AcuText
              as="span"
              variant="list-title"
              class="acu-v2-manage-item__name"
              >{{ meta.name }}</AcuText
            >
            <AcuText
              as="span"
              variant="caption"
              class="acu-v2-manage-item__meta"
            >
              共 {{ meta.taskCount }} 个任务
              <template v-if="meta.name === defaultPresetName">
                · 全局默认</template
              >
            </AcuText>
          </div>
          <div class="acu-v2-manage-item__actions">
            <AcuIconButton
              :icon="
                meta.name === defaultPresetName
                  ? 'fa-solid fa-star'
                  : 'fa-regular fa-star'
              "
              title="设为全局默认"
              :variant="meta.name === defaultPresetName ? 'accent' : 'default'"
              @click="$emit('set-default', meta.name)"
            />
            <AcuIconButton
              icon="fa-solid fa-upload"
              title="导出 JSON"
              @click="$emit('export', meta.name)"
            />
            <AcuIconButton
              icon="fa-solid fa-pen"
              title="编辑"
              @click="$emit('open-edit', meta.name)"
            />
            <AcuIconButton
              icon="fa-solid fa-trash-can"
              variant="danger"
              title="删除"
              @click="$emit('delete', meta.name)"
            />
          </div>
        </li>
      </ul>
      <AcuText v-else variant="empty" class="acu-v2-plot-drawer__empty"
        >暂无预设，点击上方按钮从默认新建或导入。</AcuText
      >
    </template>

    <!-- CREATE / EDIT -->
    <form v-else class="acu-v2-form" @submit.prevent="$emit('save')">
      <fieldset class="acu-v2-form__section">
        <legend>基础信息</legend>
        <AcuFormRow label="预设名称">
          <AcuInput
            type="text"
            :model-value="draftMeta.name"
            autocomplete="off"
            @update:model-value="$emit('update-name', String($event))"
          />
        </AcuFormRow>
      </fieldset>

      <fieldset class="acu-v2-form__section">
        <legend>标签筛选</legend>
        <AcuText variant="hint" class="acu-v2-form__hint">
          专属于当前预设，随预设保存。按标签提取内容，提升推进准确性。提取仅保留指定范围，排除移除指定范围。
        </AcuText>
        <div class="acu-v2-plot-drawer__rules">
          <AcuRulePairList
            label="提取规则"
            :model-value="contextRules.extractRules"
            start-placeholder="提取开始边界"
            end-placeholder="提取结束边界"
            add-label="添加提取规则"
            @update:model-value="$emit('update-context-extract-rules', $event)"
          />
          <AcuRulePairList
            label="排除规则"
            :model-value="contextRules.excludeRules"
            start-placeholder="排除开始边界"
            end-placeholder="排除结束边界"
            add-label="添加排除规则"
            @update:model-value="$emit('update-context-exclude-rules', $event)"
          />
        </div>
      </fieldset>

      <PlotMatchReplaceFields
        v-if="showAdvancedRates"
        :rate-main="rates.rateMain"
        :rate-personal="rates.ratePersonal"
        :rate-erotic="rates.rateErotic"
        :rate-cuckold="rates.rateCuckold"
        :recall-count="rates.recallCount"
        @update-rate="(field, value) => $emit('update-rate', field, value)"
      />

      <PlotTaskList
        :tasks="taskEditing.tasks.value"
        :current-task-id="taskEditing.currentTaskId.value"
        @add="taskEditing.addTask"
        @select="taskEditing.selectTask($event)"
        @move="taskEditing.moveCurrent($event)"
        @delete="taskEditing.deleteCurrentTask"
      />

      <PlotTaskEditor
        :task="taskEditing.currentTask.value"
        :api-preset-options="apiPresetOptions"
        :task-api-override="currentTaskApiOverride"
        @patch="taskEditing.patchCurrent($event)"
        @task-api-override="onTaskApiOverride"
        @segment-add="taskEditing.addSegment($event)"
        @segment-delete="taskEditing.deleteSegment($event)"
        @segment-move="(index, delta) => taskEditing.moveSegment(index, delta)"
        @segment-update="(index, p) => taskEditing.updateSegment(index, p)"
      />

      <fieldset class="acu-v2-form__section">
        <legend>最终注入指令</legend>
        <AcuTextarea
          :model-value="taskEditing.finalDirective.value"
          :rows="3"
          placeholder="该指令不会发给规划 AI；只在主 AI 生成时注入"
          @update:model-value="taskEditing.finalDirective.value = $event"
        />
      </fieldset>

      <AcuText v-if="error" variant="error" class="acu-v2-error" role="alert">{{
        error
      }}</AcuText>

      <footer class="acu-v2-plot-drawer__actions">
        <AcuButton @click="$emit('back')">关闭</AcuButton>
        <AcuButton variant="primary" native-type="submit">保存预设</AcuButton>
      </footer>
    </form>
  </AcuDrawer>
</template>

<script setup lang="ts">
import type {
  PlotContextRulePair,
  PlotDrawerView,
  PlotRateField,
} from "../composables/usePlotPresetManagement";
import AcuButton from "./_lib/AcuButton.vue";
import AcuDrawer from "./_lib/AcuDrawer.vue";
import AcuFormRow from "./_lib/AcuFormRow.vue";
import AcuIconButton from "./_lib/AcuIconButton.vue";
import AcuInput from "./_lib/AcuInput.vue";
import AcuRulePairList from "./_lib/AcuRulePairList.vue";
import AcuText from "./_lib/AcuText.vue";
import AcuTextarea from "./_lib/AcuTextarea.vue";
import PlotMatchReplaceFields from "./PlotMatchReplaceFields.vue";
import PlotTaskEditor from "./PlotTaskEditor.vue";
import PlotTaskList from "./PlotTaskList.vue";

const props = defineProps<{
  isOpen: boolean;
  view: PlotDrawerView;
  title: string;
  error: string;
  draftMeta: { name: string; taskApiPreset: string };
  contextRules: {
    extractRules: PlotContextRulePair[];
    excludeRules: PlotContextRulePair[];
  };
  presetMeta: Array<{ name: string; taskCount: number }>;
  defaultPresetName: string;
  apiPresetOptions: Array<{ name: string }>;
  taskEditing: any;
  currentTaskApiOverride: string;
  showAdvancedRates: boolean;
  rates: {
    rateMain: number;
    ratePersonal: number;
    rateErotic: number;
    rateCuckold: number;
    recallCount: number;
  };
  beforeClose?: () => boolean | Promise<boolean>;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "back"): void;
  (e: "open-create"): void;
  (e: "open-edit", name: string): void;
  (e: "set-default", name: string): void;
  (e: "delete", name: string): void;
  (e: "export", name: string): void;
  (e: "save"): void;
  (e: "update-name", name: string): void;
  (e: "update-context-extract-rules", rules: PlotContextRulePair[]): void;
  (e: "update-context-exclude-rules", rules: PlotContextRulePair[]): void;
  (e: "update-task-api-override", value: string): void;
  (e: "update-rate", field: PlotRateField, value: number): void;
}>();

function onTaskApiOverride(value: string): void {
  emit("update-task-api-override", value);
}
</script>

<style scoped>
.acu-v2-plot-drawer__create-btn {
  width: 100%;
}
.acu-v2-plot-drawer__empty {
  margin-top: 20px;
}
.acu-v2-plot-drawer__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 12px;
  margin-top: 12px;
}

/* manage list */
.acu-v2-manage-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.acu-v2-manage-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: 0;
  background: transparent;
}
.acu-v2-manage-item:last-child {
  border-bottom: 0;
}
.acu-v2-manage-item__info {
  flex: 1;
  min-width: 0;
}
.acu-v2-manage-item__name {
  display: block;
  font-size: var(--acu-font-size-list-title, 13px);
  line-height: var(--acu-line-height-body, 1.45);
  font-weight: 500;
  color: var(--acu-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acu-v2-manage-item__meta {
  display: block;
  margin-top: 2px;
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
  color: var(--acu-text-3);
}
.acu-v2-manage-item__actions {
  display: flex;
  gap: 4px;
}

/* form */
.acu-v2-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.acu-v2-form__section {
  min-width: 0;
  margin: 0;
  padding: 0 0 14px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  border-radius: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.acu-v2-form__section:last-of-type {
  padding-bottom: 0;
  border-bottom: 0;
}
.acu-v2-form__section legend {
  padding: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-section-title, 12px);
  font-weight: 600;
}
.acu-v2-plot-drawer__rules {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.acu-v2-error {
  padding: 8px 10px;
  background: color-mix(in srgb, var(--acu-danger) 10%, transparent);
  border: 0;
  border-radius: var(--acu-radius-sm);
}
</style>
