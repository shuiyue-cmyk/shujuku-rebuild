<template>
  <div class="acu-v2-continuation-chat">
    <div class="acu-v2-continuation-chat__status">
      <span class="acu-v2-continuation-chat__badge" :class="`acu-v2-continuation-chat__badge--${statusTone}`">{{ statusText }}</span>
      <span class="acu-v2-continuation-chat__status-item">{{ stageText }}</span>
      <span class="acu-v2-continuation-chat__status-item">已完成 {{ completedTurns }} / {{ totalTurns }} 轮</span>
      <span v-if="revisionText" class="acu-v2-continuation-chat__status-item">大纲 {{ revisionText }}</span>
      <span class="acu-v2-continuation-chat__status-item">倒计时 {{ deadlineText }}</span>
    </div>

    <ContinuationSessionFeed :entries="entries" :running="running" />

    <p v-if="notice" class="acu-v2-continuation-chat__notice">{{ notice }}</p>

    <div class="acu-v2-continuation-chat__composer">
      <textarea
        class="acu-v2-continuation-chat__input"
        :value="draft"
        :rows="3"
        :placeholder="placeholder"
        @input="onInput"
        @keydown="onKeydown"
      />
      <div class="acu-v2-continuation-chat__composer-actions">
        <span class="acu-v2-continuation-chat__hint">Ctrl / ⌘ + Enter 发送</span>
        <AcuButton v-if="canStop" variant="danger" :loading="busy && !running" @click="emit('stop')">停止生成</AcuButton>
        <AcuButton v-if="canContinue" :loading="busy" @click="emit('continue')">继续当前轮次</AcuButton>
        <AcuButton v-if="canRetry" :loading="busy" @click="emit('retry')">重试当前轮次</AcuButton>
        <AcuButton variant="primary" :loading="sending" :disabled="!draft.trim() || sending" @click="send">发送</AcuButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import ContinuationSessionFeed from './ContinuationSessionFeed.vue';
import type { AgentSessionEntry_ACU } from '../../service/continuation/agent/agent-session-log'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { ContinuationTask_ACU } from '../../service/continuation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖

const props = defineProps<{
  task: ContinuationTask_ACU | null;
  entries: AgentSessionEntry_ACU[];
  running: boolean;
  draft: string;
  sending: boolean;
  busy: boolean;
  statusText: string;
  stageText: string;
  completedTurns: number;
  totalTurns: number;
  revisionText: string;
  deadlineText: string;
  awaitingHost: boolean;
  canContinue: boolean;
  canRetry: boolean;
}>();

const emit = defineEmits<{
  (event: 'send', text: string): void;
  (event: 'update:draft', value: string): void;
  (event: 'stop' | 'continue' | 'retry'): void;
}>();

/**
 * 只要「循环真在跑」就给停止。判定用两个信号取或：running 是会话流的实时运行标志
 * （循环自己维护，无刷新延迟）；task.status 在 UI 发起的循环期间可能是陈旧的 paused
 * （envelope 要等本次操作结束才刷新），只能作补充。等待宿主正文时停的是酒馆的生成，
 * 不属于这里的职责，保持隐藏。
 */
const canStop = computed(() => !props.awaitingHost && (props.running || props.task?.status === 'running'));

const statusTone = computed(() => {
  if (!props.task) return 'idle';
  if (props.task.status === 'running') return 'running';
  if (props.task.lastError) return 'failed';
  return 'idle';
});

const placeholder = computed(() => {
  if (!props.task) return '描述你想要的续写方向，发送后主 Agent 会创建任务并开始规划...';
  if (props.awaitingHost) return '酒馆正在生成正文；现在发送的消息会在下一轮开始时被读到...';
  if (props.task.status === 'running') return '主 Agent 正在工作；发送消息会打断当前迭代并带着你的话重新开始...';
  return '继续和主 Agent 对话，或直接给出下一步要求...';
});

const notice = computed(() => {
  if (props.awaitingHost) return '当前轮次正在等待酒馆的正文生成结束；现在发送的新消息会在当前正文完成后生效。';
  if (props.task?.stopReason && props.task.stopReason !== 'manual') {
    return props.canContinue
      ? `任务已停止：${props.task.stopReason}。可点击「继续」从当前轮次重试恢复。`
      : `任务已停止：${props.task.stopReason}。输入新指令可从当前进度开始新的运行窗口。`;
  }
  if (props.task?.lastError) return `上一次失败：${props.task.lastError.message}`;
  return '';
});

function onInput(event: Event): void {
  emit('update:draft', (event.target as HTMLTextAreaElement).value);
}

function send(): void {
  const text = props.draft.trim();
  if (!text || props.sending) return;
  emit('send', text);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  send();
}
</script>

<style scoped>
.acu-v2-continuation-chat { display: grid; gap: 10px; }
.acu-v2-continuation-chat__status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-continuation-chat__badge { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--acu-text-3) 18%, transparent); color: var(--acu-text-2); }
.acu-v2-continuation-chat__badge--running { background: color-mix(in srgb, var(--acu-primary, #5b8def) 20%, transparent); color: var(--acu-primary, #5b8def); }
.acu-v2-continuation-chat__badge--failed { background: color-mix(in srgb, var(--acu-danger, #d65b5b) 18%, transparent); color: var(--acu-danger, #d65b5b); }
.acu-v2-continuation-chat__status-item { color: var(--acu-text-3); }
.acu-v2-continuation-chat__notice { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-continuation-chat__composer { display: grid; gap: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 22%, transparent); border-radius: 8px; background: var(--acu-bg-2); }
.acu-v2-continuation-chat__input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 62px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 24%, transparent); border-radius: 6px; background: var(--acu-bg-1, var(--acu-bg-2)); color: var(--acu-text-1); font: inherit; font-size: var(--acu-font-size-body-lg, 13px); }
.acu-v2-continuation-chat__input:focus { outline: none; border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 60%, transparent); }
.acu-v2-continuation-chat__composer-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.acu-v2-continuation-chat__hint { margin-right: auto; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }

/* 手机窄屏：快捷键提示没有意义直接隐藏；按钮均分整行方便点按；
   输入框字号提到 16px，避免 iOS Safari 聚焦时自动放大页面。 */
@media (max-width: 640px) {
  .acu-v2-continuation-chat__hint { display: none; }
  .acu-v2-continuation-chat__composer-actions > * { flex: 1 1 auto; }
  .acu-v2-continuation-chat__input { font-size: 16px; min-height: 56px; }
  .acu-v2-continuation-chat__composer { padding: 8px; }
}
</style>
