<template>
  <div class="ub-cchat">
    <div class="ub-cchat__status">
      <span class="ub-cchat__state" :class="`is-${statusTone}`">
        <span class="ub-cchat__dot" aria-hidden="true"></span>{{ statusText }}
      </span>
      <span>{{ stageText }}</span>
      <span>已完成 {{ completedTurns }} / {{ totalTurns }} 轮</span>
      <span v-if="revisionText">大纲 {{ revisionText }}</span>
      <span><i class="fa-regular fa-clock" aria-hidden="true"></i> {{ deadlineText }}</span>
    </div>
    <ContinuationSessionFeed :entries="entries" :running="running" />
    <p v-if="notice" class="ub-cchat__notice">{{ notice }}</p>
    <div class="ub-cchat__composer">
      <textarea
        class="ub-cchat__input"
        :value="draft"
        rows="3"
        :placeholder="placeholder"
        aria-label="给主 Agent 的消息"
        @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
        @keydown="onKeydown"
      ></textarea>
      <div class="ub-cchat__actions">
        <span class="ub-cchat__hint">{{ inFlight ? '进行中可点停止' : 'Ctrl / ⌘ + Enter 发送' }}</span>
        <UbButton v-if="inFlight" variant="danger" icon="fa-solid fa-stop" @click="emit('stop')">停止</UbButton>
        <UbButton v-else variant="primary" icon="fa-solid fa-paper-plane" :disabled="!draft.trim()" @click="send">发送</UbButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AgentSessionEntry_ACU } from '../../service/continuation/agent/agent-session-log';
import type { ContinuationTask_ACU } from '../../service/continuation/model';
import UbButton from '../ui/UbButton.vue';
import ContinuationSessionFeed from './ContinuationSessionFeed.vue';

const props = defineProps<{
  task: ContinuationTask_ACU | null;
  entries: AgentSessionEntry_ACU[];
  running: boolean;
  draft: string;
  sending: boolean;
  statusText: string;
  stageText: string;
  completedTurns: number;
  totalTurns: number;
  revisionText: string;
  deadlineText: string;
  awaitingHost: boolean;
}>();

const emit = defineEmits<{
  (event: 'send', text: string): void;
  (event: 'update:draft', value: string): void;
  (event: 'stop'): void;
}>();

/**
 * 发送与停止互斥：任一在途信号为真就切成停止。
 * sending 覆盖点发送后 running 尚未置位的空档；awaitingHost 覆盖酒馆正在生成正文。
 */
const inFlight = computed(() => props.sending || props.running || props.awaitingHost || props.task?.status === 'running');

const statusTone = computed(() => {
  if (!props.task) return 'idle';
  if (props.task.status === 'running' || props.awaitingHost) return 'running';
  if (props.task.lastError) return 'failed';
  return 'idle';
});

const placeholder = computed(() => {
  if (!props.task) return '描述你想要的续写方向，发送后主 Agent 会创建任务并开始规划...';
  if (props.awaitingHost) return '酒馆正在生成正文。点「停止」可打断；要接着做就打字再发送。';
  if (props.task.status === 'running' || props.running) return '主 Agent 正在工作。点「停止」可打断；要接着做就打字再发送。';
  return '继续和主 Agent 对话，写好后再发送...';
});

const notice = computed(() => {
  if (props.awaitingHost) return '酒馆正在生成正文。点「停止」会同时打断 Agent 和酒馆生成。';
  if (props.task?.stopReason && props.task.stopReason !== 'manual') {
    return `任务已停止：${props.task.stopReason}。输入新指令后发送即可继续。`;
  }
  if (props.task?.lastError) return `上一次失败：${props.task.lastError.message}`;
  return '';
});

function send(): void {
  const text = props.draft.trim();
  if (!text || inFlight.value) return;
  emit('send', text);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  send();
}
</script>

<style scoped>
.ub-cchat {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ub-cchat__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s1) var(--ub-s3);
  padding: var(--ub-s3) var(--ub-s4);
  border-bottom: 1px solid var(--ub-line-soft);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-variant-numeric: tabular-nums;
}

.ub-cchat__state {
  display: inline-flex;
  align-items: center;
  gap: var(--ub-s1);
  padding: 2px 10px 2px 8px;
  border-radius: 999px;
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-weight: 700;
}

.ub-cchat__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ub-text-3);
}

.ub-cchat__state.is-running {
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-cchat__state.is-running .ub-cchat__dot {
  background: var(--ub-accent);
  animation: ub-cchat-pulse 1.2s ease-in-out infinite;
}

.ub-cchat__state.is-failed {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-cchat__state.is-failed .ub-cchat__dot {
  background: var(--ub-danger);
}

.ub-cchat__notice {
  margin: 0 var(--ub-s4);
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-warn-soft);
  color: var(--ub-text);
  font-size: var(--ub-fs-xs);
}

.ub-cchat__composer {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  margin: var(--ub-s3) var(--ub-s4) var(--ub-s4);
  padding: var(--ub-s2);
  border: 1px solid var(--ub-line);
  border-radius: calc(var(--ub-r-control) + 4px);
  background: var(--ub-input-bg);
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.ub-cchat__composer:focus-within {
  border-color: var(--ub-accent);
  box-shadow: 0 0 0 3px var(--ub-accent-soft);
}

.ub-cchat__input {
  width: 100%;
  min-height: calc(var(--ub-u) * 64);
  padding: var(--ub-s1) var(--ub-s2);
  border: 0;
  background: transparent;
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.ub-cchat__input::placeholder {
  color: var(--ub-text-3);
}

.ub-cchat__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--ub-s2);
}

.ub-cchat__hint {
  margin-right: auto;
  padding-left: var(--ub-s2);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

@keyframes ub-cchat-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
