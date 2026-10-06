<template>
  <UbSheet
    :is-open="isOpen"
    :title="title"
    :show-back="view === 'create' || view === 'edit'"
    :before-close="beforeClose"
    width="780px"
    @close="emit('close')"
    @back="emit('back')"
  >
    <template v-if="view === 'manage'">
      <UbButton variant="primary" icon="fa-solid fa-plus" @click="emit('open-create')">从默认新建</UbButton>
      <ul v-if="presetMeta.length" class="ub-pps-list">
        <li v-for="meta in presetMeta" :key="meta.name" class="ub-pps-list__item">
          <div class="ub-pps-list__info">
            <span class="ub-pps-list__name">
              <i v-if="meta.name === defaultPresetName" class="fa-solid fa-star ub-pps-list__star" aria-hidden="true"></i>
              {{ meta.name }}
            </span>
            <span class="ub-pps-list__meta">共 {{ meta.taskCount }} 个任务<template v-if="meta.name === defaultPresetName"> · 全局默认</template></span>
          </div>
          <div class="ub-pps-list__actions">
            <UbIconButton
              :icon="meta.name === defaultPresetName ? 'fa-solid fa-star' : 'fa-regular fa-star'"
              title="设为全局默认"
              :variant="meta.name === defaultPresetName ? 'accent' : 'default'"
              @click="emit('set-default', meta.name)"
            />
            <UbIconButton icon="fa-solid fa-upload" title="导出 JSON" @click="emit('export', meta.name)" />
            <UbIconButton icon="fa-solid fa-pen" title="编辑" @click="emit('open-edit', meta.name)" />
            <UbIconButton icon="fa-solid fa-trash-can" variant="danger" title="删除" @click="emit('delete', meta.name)" />
          </div>
        </li>
      </ul>
      <p v-else class="ub-pps-empty">暂无预设，点上方按钮从默认新建，或在预设卡片里导入。</p>
    </template>

    <form v-else id="ub-plot-preset-form" class="ub-pps-form" @submit.prevent="emit('save')">
      <UbSection title="基础信息">
        <UbRow label="预设名称" stack>
          <UbInput :model-value="draftMeta.name" autocomplete="off" aria-label="预设名称" @update:model-value="emit('update-name', String($event))" />
        </UbRow>
      </UbSection>

      <UbSection title="标签筛选" description="专属于当前预设，随预设保存。提取仅保留指定范围，排除移除指定范围。">
        <UbRow stack>
          <UbRulePairs
            label="提取规则"
            :model-value="contextRules.extractRules"
            start-placeholder="提取开始边界"
            end-placeholder="提取结束边界"
            add-label="添加提取规则"
            @update:model-value="emit('update-context-extract-rules', $event)"
          />
        </UbRow>
        <UbRow stack>
          <UbRulePairs
            label="排除规则"
            :model-value="contextRules.excludeRules"
            start-placeholder="排除开始边界"
            end-placeholder="排除结束边界"
            add-label="添加排除规则"
            @update:model-value="emit('update-context-exclude-rules', $event)"
          />
        </UbRow>
      </UbSection>

      <UbSection
        v-if="showAdvancedRates"
        title="匹配替换（进阶）"
        description="替换提示词占位符（sulv1~4、zhaohui），随当前预设保存；导出 JSON 时默认值会自动省略。"
      >
        <UbRow v-for="field in rateFields" :key="field.key" :label="field.label">
          <UbInput
            type="number"
            :step="field.step"
            :min="field.min"
            :model-value="rates[field.key]"
            :aria-label="field.label"
            @change="emit('update-rate', field.key, field.key === 'recallCount' ? Math.round(Number($event)) : Number($event))"
          />
        </UbRow>
      </UbSection>

      <UbSection title="剧情任务" description="点选任务进行编辑；同阶段并发，跨阶段串行。">
        <template #actions>
          <UbIconButton icon="fa-solid fa-arrow-left" size="sm" :disabled="!canMove(-1)" title="左移" @click="taskEditing.moveCurrent(-1)" />
          <UbIconButton icon="fa-solid fa-arrow-right" size="sm" :disabled="!canMove(1)" title="右移" @click="taskEditing.moveCurrent(1)" />
          <UbIconButton icon="fa-solid fa-trash-can" size="sm" variant="danger" :disabled="tasks.length <= 1" title="删除当前任务" @click="taskEditing.deleteCurrentTask" />
          <UbIconButton icon="fa-solid fa-plus" size="sm" variant="accent" title="新增任务" @click="taskEditing.addTask" />
        </template>
        <div class="ub-pps-tasks">
          <button
            v-for="task in tasks"
            :key="task.id"
            type="button"
            class="ub-pps-task"
            :class="{ 'is-active': task.id === taskEditing.currentTaskId.value, 'is-off': !task.enabled }"
            @click="taskEditing.selectTask(task.id)"
          >
            <span class="ub-pps-task__name">{{ task.name }}</span>
            <span class="ub-pps-task__meta">
              <span title="阶段号 — 同阶段并发，跨阶段串行">阶段 {{ task.stage }}</span>
              · {{ task.promptGroup.length }} 段
              <template v-if="!task.enabled"> · 已禁用</template>
            </span>
          </button>
          <p v-if="!tasks.length" class="ub-pps-empty">暂无任务，点右上 + 新增。</p>
        </div>
      </UbSection>

      <PlotTaskEditor
        :task="taskEditing.currentTask.value"
        :api-preset-options="apiPresetOptions"
        :task-api-override="currentTaskApiOverride"
        @patch="taskEditing.patchCurrent($event)"
        @task-api-override="emit('update-task-api-override', $event)"
        @segment-add="taskEditing.addSegment($event)"
        @segment-delete="taskEditing.deleteSegment($event)"
        @segment-move="(index, delta) => taskEditing.moveSegment(index, delta)"
        @segment-update="(index, p) => taskEditing.updateSegment(index, p)"
      />

      <UbSection title="最终注入指令" description="不会发给规划 AI；只在主 AI 生成时注入。">
        <UbRow stack>
          <UbTextarea
            :model-value="taskEditing.finalDirective.value"
            :rows="3"
            placeholder="该指令不会发给规划 AI；只在主 AI 生成时注入"
            aria-label="最终注入指令"
            @update:model-value="taskEditing.finalDirective.value = $event"
          />
        </UbRow>
      </UbSection>

      <UbCallout v-if="error" kind="error">{{ error }}</UbCallout>
    </form>

    <template v-if="view !== 'manage'" #footer>
      <UbButton variant="ghost" @click="emit('back')">关闭</UbButton>
      <UbButton variant="primary" native-type="submit" form="ub-plot-preset-form" icon="fa-solid fa-floppy-disk">保存预设</UbButton>
    </template>
  </UbSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  PlotContextRulePair,
  PlotDrawerView,
  PlotRateField,
} from '../../presentation-v2/composables/usePlotPresetManagement';
import type { PlotTaskDraft } from '../../presentation-v2/composables/usePlotTaskEditing';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbInput from '../ui/UbInput.vue';
import UbRow from '../ui/UbRow.vue';
import UbRulePairs from '../ui/UbRulePairs.vue';
import UbSection from '../ui/UbSection.vue';
import UbSheet from '../ui/UbSheet.vue';
import UbTextarea from '../ui/UbTextarea.vue';
import PlotTaskEditor from './PlotTaskEditor.vue';

type Rates = Record<'rateMain' | 'ratePersonal' | 'rateErotic' | 'rateCuckold' | 'recallCount', number>;

const props = defineProps<{
  isOpen: boolean;
  view: PlotDrawerView;
  title: string;
  error: string;
  draftMeta: { name: string; taskApiPreset: string };
  contextRules: { extractRules: PlotContextRulePair[]; excludeRules: PlotContextRulePair[] };
  presetMeta: Array<{ name: string; taskCount: number }>;
  defaultPresetName: string;
  apiPresetOptions: Array<{ name: string }>;
  taskEditing: any;
  currentTaskApiOverride: string;
  showAdvancedRates: boolean;
  rates: Rates;
  beforeClose?: () => boolean | Promise<boolean>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'back'): void;
  (e: 'open-create'): void;
  (e: 'open-edit', name: string): void;
  (e: 'set-default', name: string): void;
  (e: 'delete', name: string): void;
  (e: 'export', name: string): void;
  (e: 'save'): void;
  (e: 'update-name', name: string): void;
  (e: 'update-context-extract-rules', rules: PlotContextRulePair[]): void;
  (e: 'update-context-exclude-rules', rules: PlotContextRulePair[]): void;
  (e: 'update-task-api-override', value: string): void;
  (e: 'update-rate', field: PlotRateField, value: number): void;
}>();

const rateFields: Array<{ key: keyof Rates & PlotRateField; label: string; step: number; min?: number }> = [
  { key: 'rateMain', label: 'sulv1', step: 0.05 },
  { key: 'ratePersonal', label: 'sulv2', step: 0.05 },
  { key: 'rateErotic', label: 'sulv3', step: 0.05 },
  { key: 'rateCuckold', label: 'sulv4', step: 0.05 },
  { key: 'recallCount', label: 'zhaohui', step: 1, min: 1 },
];

const tasks = computed<PlotTaskDraft[]>(() => props.taskEditing?.tasks?.value ?? []);

function canMove(delta: -1 | 1): boolean {
  const idx = tasks.value.findIndex(t => t.id === props.taskEditing.currentTaskId.value);
  if (idx < 0) return false;
  const target = idx + delta;
  return target >= 0 && target < tasks.value.length;
}
</script>

<style scoped>
.ub-pps-form {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s5);
}

.ub-pps-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  list-style: none;
  overflow: hidden;
}

.ub-pps-list__item {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s4);
}

.ub-pps-list__item + .ub-pps-list__item {
  border-top: 1px solid var(--ub-line-soft);
}

.ub-pps-list__info {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.ub-pps-list__name {
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-pps-list__star {
  color: var(--ub-warn);
  font-size: 0.85em;
}

.ub-pps-list__meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-pps-list__actions {
  display: flex;
  gap: 2px;
}

.ub-pps-empty {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
}

.ub-pps-tasks {
  display: flex;
  gap: var(--ub-s2);
  padding: var(--ub-s3);
  overflow-x: auto;
}

.ub-pps-task {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 0 0 auto;
  min-width: calc(var(--ub-u) * 130);
  max-width: calc(var(--ub-u) * 220);
  padding: var(--ub-s2) var(--ub-s3);
  border: 1.5px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  color: var(--ub-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ub-pps-task.is-active {
  border-color: var(--ub-accent);
  background: var(--ub-accent-soft);
}

.ub-pps-task.is-off {
  opacity: 0.55;
}

.ub-pps-task__name {
  max-width: 100%;
  overflow: hidden;
  font-size: var(--ub-fs-sm);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-pps-task__meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}
</style>
