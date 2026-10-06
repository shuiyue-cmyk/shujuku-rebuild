<template>
  <div ref="rootRef" class="ub-vai" data-ub-viz-assistant>
    <div class="ub-vai__intro">
      <p class="ub-vai__lead">
        用一句话说想怎么改表，助手会生成改表草稿（可能涉及多张表或全局配置）。先看变更再应用，不满意就换个说法重来。
      </p>
      <div class="ub-vai__controls">
        <label class="ub-vai__preset">
          <span class="ub-vai__cap">API 预设</span>
          <UbSelect
            :model-value="assistant.tableApiPreset.value"
            :options="assistant.apiPresetOptions.value"
            :disabled="assistant.isRunning.value"
            aria-label="AI 改表助手 API 预设"
            @update:model-value="value => assistant.tableApiPreset.value = value"
          />
        </label>
        <UbButton icon="fa-solid fa-pen-to-square" :disabled="assistant.isRunning.value" @click="promptOpen = true">编辑提示词</UbButton>
      </div>
      <UbCallout v-if="assistant.errorMessage.value" kind="warning">{{ assistant.errorMessage.value }}</UbCallout>
    </div>

    <div class="ub-vai__feed">
      <p v-if="!assistant.turns.value.length && !assistant.isRunning.value" class="ub-vai__empty">
        <i class="fa-regular fa-comments" aria-hidden="true"></i>
        还没有对话。在下面输入需求，助手会返回摘要、警告、按表分组的改动，以及需要你确认的高风险项。
      </p>

      <article
        v-for="turn in assistant.turns.value"
        :key="turn.id"
        class="ub-vai__turn"
        :class="`ub-vai__turn--${turn.type}`"
      >
        <header class="ub-vai__turn-head">
          <span class="ub-vai__who">
            <i :class="turnIcon(turn.type)" aria-hidden="true"></i>
            {{ turnTitle(turn.type) }}
          </span>
          <UbBadge v-if="turn.type === 'final'" variant="accent">{{ assistant.getTurnSessionSummary(turn) }}</UbBadge>
          <UbBadge v-else-if="turn.type === 'error'" variant="warning">需要处理</UbBadge>
          <span class="ub-vai__spacer"></span>
          <UbIconButton
            v-if="turn.type === 'user'"
            icon="fa-solid fa-rotate-right"
            size="sm"
            title="从这条需求重新生成（会丢弃它之后的记录）"
            :disabled="assistant.isRunning.value"
            @click="assistant.regenerateFromUserTurn(turn)"
          />
          <UbIconButton
            icon="fa-solid fa-trash"
            size="sm"
            title="删除这条记录"
            :disabled="assistant.isRunning.value"
            @click="assistant.deleteTurn(turn.id)"
          />
        </header>

        <p class="ub-vai__text">{{ assistant.getTurnSummary(turn) }}</p>

        <UbCallout v-if="assistant.getTurnValidationError(turn)" kind="warning">
          校验失败：{{ assistant.getTurnValidationError(turn) }}
        </UbCallout>

        <UbCallout v-if="assistant.getTurnWarnings(turn).length" kind="warning">
          <ul class="ub-vai__list">
            <li v-for="warning in assistant.getTurnWarnings(turn)" :key="warning">{{ warning }}</li>
          </ul>
        </UbCallout>

        <div v-if="assistant.getTurnDiffGroups(turn).length" class="ub-vai__diffs">
          <section
            v-for="group in assistant.getTurnDiffGroups(turn)"
            :key="`${turn.id}-${group.key}`"
            class="ub-vai__diff"
            :class="{ 'is-warning': group.tone === 'warning' }"
          >
            <h4 class="ub-vai__diff-title">{{ group.title }}</h4>
            <ul class="ub-vai__list">
              <li v-for="item in group.items" :key="item">{{ item }}</li>
            </ul>
          </section>
        </div>

        <UbDisclosure
          v-if="assistant.getTurnRawText(turn)"
          label="查看 AI 原始输出"
          :expanded="rawOpen[turn.id] === true"
          :body-id="`ub-vai-raw-${turn.id}`"
          max-height="280px"
          flat
          @toggle="rawOpen = { ...rawOpen, [turn.id]: rawOpen[turn.id] !== true }"
        >
          <pre class="ub-vai__raw">{{ assistant.getTurnRawText(turn) }}</pre>
        </UbDisclosure>

        <div v-if="turn.type === 'round' || turn.type === 'final'" class="ub-vai__apply">
          <div v-if="assistant.getTurnHighRiskItems(turn).length" class="ub-vai__risks">
            <p class="ub-vai__risks-title"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> 高风险改动，逐项确认后才能应用</p>
            <UbCheck
              v-for="(item, index) in assistant.getTurnHighRiskItems(turn)"
              :key="`${turn.id}-${item.type}-${index}`"
              :model-value="assistant.riskConfirmations.value[`${turn.id}:${index}`] === true"
              @update:model-value="value => assistant.setRiskConfirmation(turn.id, index, value)"
            >
              {{ item.label }}
            </UbCheck>
          </div>
          <template v-if="assistant.getTurnApplyPayload(turn)">
            <UbButton
              variant="primary"
              icon="fa-solid fa-wand-magic-sparkles"
              :disabled="!assistant.canApplyTurn(turn)"
              :title="assistant.getTurnApplyBlockReason(turn)"
              @click="assistant.applyTurnDraft(turn)"
            >
              应用到编辑器草稿
            </UbButton>
            <p v-if="assistant.getTurnApplyBlockReason(turn)" class="ub-vai__reason">{{ assistant.getTurnApplyBlockReason(turn) }}</p>
          </template>
        </div>
      </article>

      <p v-if="assistant.isRunning.value" class="ub-vai__running">
        <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
        正在生成草稿…
      </p>
    </div>

    <div class="ub-vai__composer" data-ub-viz-composer>
      <UbTextarea
        :model-value="assistant.userRequest.value"
        :rows="2"
        :max-rows="8"
        auto-resize
        :disabled="assistant.isRunning.value"
        placeholder="例如：给角色状态表新增“短期目标”和“风险提示”两列。"
        aria-label="改表需求"
        @update:model-value="value => assistant.userRequest.value = value"
      />
      <UbButton v-if="assistant.isRunning.value" variant="danger" icon="fa-solid fa-stop" @click="assistant.cancel">停止</UbButton>
      <UbButton
        v-else
        variant="primary"
        icon="fa-solid fa-paper-plane"
        :disabled="!assistant.userRequest.value.trim()"
        @click="assistant.run"
      >
        发送
      </UbButton>
    </div>

    <PromptSegmentsSheet
      :is-open="promptOpen"
      title="AI 改表助手提示词"
      :segments="assistant.promptSegments.value"
      :dirty="assistant.promptDirty.value"
      :show-slot="false"
      @close="promptOpen = false"
      @save="assistant.savePrompt"
      @reset="assistant.resetPrompt"
      @import-file="assistant.importPromptFile($event)"
      @export="assistant.exportPrompt"
      @add="assistant.addPromptSegment($event)"
      @delete="assistant.deletePromptSegment($event)"
      @update="(index, patch) => assistant.updatePromptSegment(index, patch)"
    >
      <template #lead>
        <UbDisclosure
          label="可用占位符"
          :meta="String(placeholderDocs.length)"
          :expanded="docsOpen"
          body-id="ub-vai-placeholder-docs"
          @toggle="docsOpen = !docsOpen"
        >
          <p class="ub-vai__docs-note">
            提示词里出现任一数据占位符，就视为你自己接管数据注入，系统不再自动追加数据消息；真实历史上下文会插在最后一个
            <code>{{ userRequestToken }}</code> 之前。
          </p>
          <dl class="ub-vai__docs">
            <template v-for="doc in placeholderDocs" :key="doc.token">
              <dt><code>{{ doc.token }}</code> {{ doc.label }}</dt>
              <dd>{{ doc.description }}</dd>
            </template>
          </dl>
        </UbDisclosure>
      </template>
    </PromptSegmentsSheet>
  </div>
</template>

<script setup lang="ts">
/** AI 改表助手：对话流＋底部输入框；提示词在侧边面板里编辑。 */
import { nextTick, ref, watch } from 'vue';
import { useVisualizerAssistant } from '../../../presentation-v2/composables/visualizer/useVisualizerAssistant';
import {
  TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU,
  TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU,
} from '../../../service/template-assistant/service';
import PromptSegmentsSheet from '../../parts/PromptSegmentsSheet.vue';
import UbBadge from '../../ui/UbBadge.vue';
import UbButton from '../../ui/UbButton.vue';
import UbCallout from '../../ui/UbCallout.vue';
import UbCheck from '../../ui/UbCheck.vue';
import UbDisclosure from '../../ui/UbDisclosure.vue';
import UbIconButton from '../../ui/UbIconButton.vue';
import UbSelect from '../../ui/UbSelect.vue';
import UbTextarea from '../../ui/UbTextarea.vue';

const assistant = useVisualizerAssistant();
const rootRef = ref<HTMLElement | null>(null);
const promptOpen = ref(false);
const docsOpen = ref(false);
const rawOpen = ref<Record<string, boolean>>({});
const placeholderDocs = TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU;
const userRequestToken = TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU;

function turnTitle(type: string): string {
  if (type === 'user') return '你的需求';
  if (type === 'round') return 'AI 助手';
  if (type === 'final') return 'AI 助手 · 最终草稿';
  return '执行出错';
}

function turnIcon(type: string): string {
  if (type === 'user') return 'fa-solid fa-user';
  if (type === 'error') return 'fa-solid fa-circle-exclamation';
  return 'fa-solid fa-wand-magic-sparkles';
}

// 新消息到达时：用户本来就在底部附近才跟随滚动，不打断往上翻历史。
watch(() => [assistant.turns.value.length, assistant.isRunning.value], async () => {
  const scroller = rootRef.value?.closest<HTMLElement>('[data-ub-viz-scroll]');
  if (!scroller) return;
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  if (!nearBottom) return;
  await nextTick();
  scroller.scrollTop = scroller.scrollHeight;
});
</script>

<style scoped>
.ub-vai {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s4);
  min-width: 0;
  min-height: 100%;
}

.ub-vai__intro {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
}

.ub-vai__lead {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  line-height: 1.65;
}

.ub-vai__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--ub-s2) var(--ub-s3);
}

.ub-vai__preset {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  flex: 1 1 calc(var(--ub-u) * 240);
  min-width: 0;
  max-width: calc(var(--ub-u) * 360);
}

.ub-vai__cap {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

.ub-vai__feed {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  flex: 1 1 auto;
}

.ub-vai__empty,
.ub-vai__running {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
}

.ub-vai__empty {
  padding: var(--ub-s5) var(--ub-s4);
  border: 1px dashed var(--ub-line);
  border-radius: var(--ub-r-card);
}

.ub-vai__turn {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  min-width: 0;
  padding: var(--ub-s3) var(--ub-s4) var(--ub-s4);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
}

.ub-vai__turn--user {
  align-self: flex-end;
  max-width: min(100%, calc(var(--ub-u) * 560));
  border-color: transparent;
  background: var(--ub-accent-soft);
}

.ub-vai__turn--error {
  border-color: color-mix(in srgb, var(--ub-warn) 50%, var(--ub-line-soft));
}

.ub-vai__turn-head {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  min-width: 0;
}

.ub-vai__who {
  display: inline-flex;
  align-items: center;
  gap: var(--ub-s2);
  color: var(--ub-text);
  font-size: var(--ub-fs-xs);
  font-weight: 700;
}

.ub-vai__turn--user .ub-vai__who {
  color: var(--ub-accent-ink);
}

.ub-vai__spacer {
  flex: 1 1 auto;
}

.ub-vai__text {
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ub-vai__list {
  margin: 0;
  padding-left: 1.2em;
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-vai__diffs {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
}

.ub-vai__diff {
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
  color: var(--ub-text-2);
}

.ub-vai__diff.is-warning {
  box-shadow: inset 3px 0 0 var(--ub-warn);
}

.ub-vai__diff-title {
  margin-bottom: var(--ub-s1);
  color: var(--ub-text);
  font-size: var(--ub-fs-xs);
  font-weight: 700;
}

.ub-vai__raw {
  margin: 0;
  color: var(--ub-text-2);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-2xs);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ub-vai__apply {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ub-s2);
}

.ub-vai__risks {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  align-self: stretch;
  padding: var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-warn-soft);
}

.ub-vai__risks-title {
  color: var(--ub-text);
  font-size: var(--ub-fs-xs);
  font-weight: 700;
}

.ub-vai__reason {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

.ub-vai__composer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  gap: var(--ub-s2);
  margin: 0 calc(var(--ub-s2) * -1);
  padding: var(--ub-s3) var(--ub-s2);
  background: linear-gradient(to bottom, transparent, var(--ub-bg) 30%);
}

.ub-vai__composer > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}

.ub-vai__docs-note {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-vai__docs {
  display: grid;
  gap: var(--ub-s1) 0;
  margin: var(--ub-s2) 0 0;
  font-size: var(--ub-fs-xs);
}

.ub-vai__docs dt {
  color: var(--ub-text);
  font-weight: 650;
}

.ub-vai__docs dd {
  margin: 0 0 var(--ub-s2);
  color: var(--ub-text-3);
}

.ub-vai code {
  font-family: var(--ub-mono);
  font-size: 0.95em;
}
</style>
