<template>
  <div v-if="task" class="ub-pte">
    <UbSection title="基本字段" description="同一阶段号的任务并发执行，不同阶段按顺序串行。">
      <UbRow label="任务名称" stack>
        <UbInput :model-value="task.name" placeholder="例如：记忆召回任务" aria-label="任务名称" @change="patch({ name: String($event) })" />
      </UbRow>
      <UbRow label="启用任务">
        <UbSwitch :model-value="task.enabled" aria-label="启用任务" @update:model-value="patch({ enabled: $event })" />
      </UbRow>
      <UbRow label="阶段号" hint="同阶段并发，跨阶段串行">
        <UbInput type="number" :min="1" :step="1" :model-value="task.stage" aria-label="阶段号" @change="patch({ stage: Math.max(1, Math.round(Number($event))) })" />
      </UbRow>
      <UbRow label="最大重试">
        <UbInput type="number" :min="1" :step="1" :model-value="task.maxRetries" aria-label="最大重试" @change="patch({ maxRetries: Math.max(1, Math.round(Number($event))) })" />
      </UbRow>
      <UbRow label="最小回复长度" hint="少于此长度自动重试">
        <UbInput type="number" :min="0" :step="10" :model-value="task.minLength" aria-label="最小回复长度" @change="patch({ minLength: Math.max(0, Math.round(Number($event))) })" />
      </UbRow>
      <UbRow label="标签摘取" hint="例如 recall,supplement，仅作用于本任务" stack>
        <UbInput :model-value="task.extractTags" aria-label="标签摘取" @change="patch({ extractTags: String($event) })" />
      </UbRow>
      <UbRow label="提取写入标签" hint="优先级高于标签摘取；留空不追加" stack>
        <UbInput :model-value="task.extractInjectTags" aria-label="提取写入标签" @change="patch({ extractInjectTags: String($event) })" />
      </UbRow>
    </UbSection>

    <UbSection
      title="Agent 任务控制"
      description="描述与触发条件是 Agent 判断任务是否执行、是否串联及先后顺序的依据。全部留空且未启用 Agent 控制时，按启用状态、阶段号和顺序执行。"
    >
      <UbRow label="任务描述" hint="说明这个推进任务负责什么。留空时不参与 Agent Skill 判断。" stack>
        <UbTextarea
          :model-value="task.description"
          :rows="2"
          :max-rows="6"
          auto-resize
          placeholder="例如：从长期记忆中选择与当前剧情最相关的事件。"
          aria-label="任务描述"
          @update:model-value="patch({ description: $event })"
        />
      </UbRow>
      <UbRow label="触发条件" hint="说明什么情况下应执行该任务。留空时保持原逻辑。" stack>
        <UbTextarea
          :model-value="task.triggerWhen"
          :rows="2"
          :max-rows="6"
          auto-resize
          placeholder="例如：用户输入涉及旧事件、承诺、人物关系变化或未解决伏笔时触发。"
          aria-label="触发条件"
          @update:model-value="patch({ triggerWhen: $event })"
        />
      </UbRow>
      <UbRow :label="task.agentControl.enabled ? 'Agent 可控制此任务' : 'Agent 不控制此任务'">
        <UbSwitch :model-value="task.agentControl.enabled" aria-label="Agent 控制此任务" @update:model-value="patchAgentControl({ enabled: $event })" />
      </UbRow>
      <UbRow label="允许 Agent 选择/跳过">
        <UbSwitch :model-value="task.agentControl.selectable" aria-label="允许 Agent 选择/跳过" @update:model-value="patchAgentControl({ selectable: $event })" />
      </UbRow>
      <UbRow label="Agent 无决策时默认选中">
        <UbSwitch :model-value="task.agentControl.defaultSelected" aria-label="Agent 无决策时默认选中" @update:model-value="patchAgentControl({ defaultSelected: $event })" />
      </UbRow>
      <UbRow label="允许串联">
        <UbSwitch :model-value="task.agentControl.allowSequential" aria-label="允许串联" @update:model-value="patchAgentControl({ allowSequential: $event })" />
      </UbRow>
      <UbRow label="允许并行">
        <UbSwitch :model-value="task.agentControl.allowParallel" aria-label="允许并行" @update:model-value="patchAgentControl({ allowParallel: $event })" />
      </UbRow>
      <UbRow label="偏好阶段" hint="Agent 排序参考；留空则不指定。">
        <UbInput
          type="number"
          :min="1"
          :step="1"
          :model-value="task.agentControl.preferredStage ?? ''"
          aria-label="偏好阶段"
          @change="patchAgentControl({ preferredStage: parseOptionalInteger($event, 1) })"
        />
      </UbRow>
      <UbRow label="偏好顺序" hint="阶段内排序参考；留空则不指定。">
        <UbInput
          type="number"
          :min="0"
          :step="1"
          :model-value="task.agentControl.preferredOrder ?? ''"
          aria-label="偏好顺序"
          @change="patchAgentControl({ preferredOrder: parseOptionalInteger($event, 0) })"
        />
      </UbRow>
      <UbRow label="依赖任务 ID" hint="逗号分隔。Agent 排序时先执行这些任务；非法或循环依赖会在运行时校验。" stack>
        <UbInput
          :model-value="formatTaskIdList(task.agentControl.dependsOnTaskIds)"
          placeholder="例如：recallTask, summaryTask"
          aria-label="依赖任务 ID"
          @change="patchAgentControl({ dependsOnTaskIds: parseTaskIdList($event) })"
        />
      </UbRow>
      <UbRow label="阻塞任务 ID" hint="逗号分隔。提示 Agent 此任务与哪些任务不应同时执行。" stack>
        <UbInput
          :model-value="formatTaskIdList(task.agentControl.blocksTaskIds)"
          placeholder="例如：legacyRecallTask"
          aria-label="阻塞任务 ID"
          @change="patchAgentControl({ blocksTaskIds: parseTaskIdList($event) })"
        />
      </UbRow>
    </UbSection>

    <UbSection title="当前任务使用的 API">
      <UbRow label="API 预设" hint="单独为这个任务指定 API。优先级：任务 > 剧情推进页 > 活动 API。全局保存，不写入预设。" stack>
        <UbSelect
          :options="taskApiSelectOptions"
          :model-value="taskApiOverride"
          placeholder="继承剧情推进 API 预设"
          aria-label="当前任务 API 预设"
          @update:model-value="emit('task-api-override', $event)"
        />
      </UbRow>
    </UbSection>

    <UbSection title="提示词段" description="promptGroup：按顺序发送给规划 AI。">
      <div class="ub-pte__segs">
        <UbPromptSegments
          :segments="task.promptGroup"
          :show-slot="true"
          :allow-move="true"
          :rows="6"
          empty-text="当前任务还没有提示词段。点击按钮添加第一段。"
          @add="emit('segment-add', $event)"
          @delete="emit('segment-delete', $event)"
          @move="(index, delta) => emit('segment-move', index, delta)"
          @update="(index, p) => emit('segment-update', index, p)"
        />
      </div>
    </UbSection>
  </div>
  <p v-else class="ub-pte__empty">请先在上方选择一个任务。</p>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  PlotPromptSegment,
  PlotTaskAgentControlDraft,
  PlotTaskDraft,
} from '../../presentation-v2/composables/usePlotTaskEditing';
import UbInput from '../ui/UbInput.vue';
import UbPromptSegments from '../ui/UbPromptSegments.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect, { type UbSelectOption } from '../ui/UbSelect.vue';
import UbSwitch from '../ui/UbSwitch.vue';
import UbTextarea from '../ui/UbTextarea.vue';

const props = defineProps<{
  task: PlotTaskDraft | null;
  apiPresetOptions: Array<{ name: string }>;
  taskApiOverride: string;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Partial<PlotTaskDraft>): void;
  (e: 'task-api-override', value: string): void;
  (e: 'segment-add', position: 'top' | 'bottom'): void;
  (e: 'segment-delete', index: number): void;
  (e: 'segment-move', index: number, delta: -1 | 1): void;
  (e: 'segment-update', index: number, patch: Partial<PlotPromptSegment>): void;
}>();

const taskApiSelectOptions = computed<UbSelectOption[]>(() => [
  { value: '', label: '继承剧情推进 API 预设' },
  ...props.apiPresetOptions.map(o => ({ value: o.name, label: o.name })),
]);

function patch(value: Partial<PlotTaskDraft>): void {
  emit('patch', value);
}

function patchAgentControl(value: Partial<PlotTaskAgentControlDraft>): void {
  if (!props.task) return;
  patch({ agentControl: { ...props.task.agentControl, ...value } });
}

function parseTaskIdList(value: unknown): string[] {
  return String(value ?? '')
    .split(/[，,\n]/g)
    .map(item => item.trim())
    .filter((item, index, array) => item && array.indexOf(item) === index);
}

function formatTaskIdList(value: string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : '';
}

/** 空值＝不指定；低于下限视为不指定。 */
function parseOptionalInteger(value: unknown, min: number): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const normalized = Math.trunc(n);
  return normalized >= min ? normalized : undefined;
}
</script>

<style scoped>
.ub-pte {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s5);
}

.ub-pte__segs {
  padding: var(--ub-s3);
}

.ub-pte__empty {
  padding: var(--ub-s5);
  border: 1px dashed var(--ub-line);
  border-radius: var(--ub-r-card);
  color: var(--ub-text-3);
  text-align: center;
}
</style>
