<template>
  <div ref="feedElement" class="ub-feed">
    <p v-if="!entries.length" class="ub-feed__empty">
      还没有运行记录。发送一条指令后，主 Agent 的思考、派工、大纲操作与交付过程会实时显示在这里。
    </p>
    <button v-if="hiddenCount > 0" type="button" class="ub-feed__fold" @click="expandOlder">
      已折叠 {{ hiddenCount }} 条更早消息 · 点击展开更早的 {{ nextExpandCount }} 条
    </button>
    <template v-for="entry in visibleEntries" :key="entry.id">
      <div v-if="entry.kind === 'run_started' || entry.kind === 'run_resumed'" class="ub-feed__divider">
        <span class="ub-feed__divider-badge">{{ entry.kind === 'run_resumed' ? '恢复运行' : '开始运行' }}</span>
        <span class="ub-feed__divider-title">{{ entry.title }}</span>
        <span class="ub-feed__time">{{ formatTime(entry.at) }}</span>
      </div>
      <div v-else-if="entry.kind === 'user_message'" class="ub-feed__user">
        <div class="ub-feed__bubble">
          <p>{{ entry.detail || entry.title }}</p>
          <span class="ub-feed__time">{{ formatTime(entry.at) }}</span>
        </div>
      </div>
      <div v-else-if="entry.kind === 'thought'" class="ub-feed__thought">
        <span class="ub-feed__thought-label"><i class="fa-regular fa-lightbulb" aria-hidden="true"></i> {{ entry.title }}</span>
        <p v-if="entry.detail">{{ entry.detail }}</p>
      </div>
      <div v-else class="ub-feed__card" :class="[`is-${entry.kind}`, `is-${entry.status}`]">
        <button type="button" class="ub-feed__card-head" @click="toggle(entry)">
          <span class="ub-feed__status" :class="`is-${entry.status}`">
            <i v-if="entry.status === 'running'" class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
            <i v-else-if="entry.status === 'failed'" class="fa-solid fa-xmark" aria-hidden="true"></i>
            <i v-else class="fa-solid fa-check" aria-hidden="true"></i>
          </span>
          <span class="ub-feed__kind">{{ kindLabel(entry) }}</span>
          <span class="ub-feed__title">{{ entry.title }}</span>
          <span class="ub-feed__time">{{ formatTime(entry.at) }}</span>
          <i v-if="entry.detail" class="fa-solid fa-chevron-down ub-feed__chevron" :class="{ 'is-open': isExpanded(entry) }" aria-hidden="true"></i>
        </button>
        <p v-if="entry.detail && !isExpanded(entry)" class="ub-feed__preview" @click="toggle(entry)">{{ entry.detail }}</p>
        <p v-if="entry.detail && isExpanded(entry)" class="ub-feed__detail">{{ entry.detail }}</p>
      </div>
    </template>
    <div v-if="running" class="ub-feed__running">
      <span class="ub-feed__pulse" aria-hidden="true"></span>主 Agent 正在工作…
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { AgentSessionEntry_ACU } from '../../service/continuation/agent/agent-session-log';

const props = defineProps<{
  entries: AgentSessionEntry_ACU[];
  running: boolean;
}>();

const FOLD_STEP = 40;
const KIND_LABELS: Record<AgentSessionEntry_ACU['kind'], string> = {
  run_started: '开始',
  run_resumed: '恢复',
  user_message: '你',
  thought: '思考',
  main_action: '主 Agent',
  protocol_retry: '重试',
  tool_read: '调阅',
  delegation: '子代理',
  outline_op: '大纲',
  handoff: '交接',
  finalize: '交付',
  block: '阻断',
  run_failed: '失败',
  run_completed: '完成',
};

const feedElement = ref<HTMLElement | null>(null);
/** 用户手动展开/收起的覆盖表；未覆盖时按条目类型取默认。 */
const expandedOverrides = ref<Record<number, boolean>>({});
const visibleLimit = ref(FOLD_STEP);

const hiddenCount = computed(() => Math.max(0, props.entries.length - visibleLimit.value));
const visibleEntries = computed(() => (hiddenCount.value > 0 ? props.entries.slice(hiddenCount.value) : props.entries));
const nextExpandCount = computed(() => Math.min(FOLD_STEP, hiddenCount.value));

/** 展开更早一批：内容插在顶部，用高度差补偿滚动位置，视口不跳。 */
async function expandOlder(): Promise<void> {
  const element = feedElement.value;
  const beforeHeight = element?.scrollHeight ?? 0;
  visibleLimit.value += FOLD_STEP;
  await nextTick();
  if (element) element.scrollTop += element.scrollHeight - beforeHeight;
}

function kindLabel(entry: AgentSessionEntry_ACU): string {
  if ((entry.kind === 'delegation' || entry.kind === 'outline_op') && entry.agentName) return entry.agentName;
  return KIND_LABELS[entry.kind];
}

/** 失败与终态条目默认展开，过程性条目默认折叠。 */
function defaultExpanded(entry: AgentSessionEntry_ACU): boolean {
  if (entry.status === 'failed') return true;
  return entry.kind === 'finalize' || entry.kind === 'run_completed' || entry.kind === 'run_failed' || entry.kind === 'block';
}

function isExpanded(entry: AgentSessionEntry_ACU): boolean {
  return expandedOverrides.value[entry.id] ?? defaultExpanded(entry);
}

function toggle(entry: AgentSessionEntry_ACU): void {
  if (!entry.detail) return;
  expandedOverrides.value = { ...expandedOverrides.value, [entry.id]: !isExpanded(entry) };
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}

watch(() => props.entries.length, async (length, previous) => {
  // 长度骤减＝会话被清空重灌（切聊天 / 一键清空），折叠窗口复位
  if (length < (previous ?? 0)) visibleLimit.value = FOLD_STEP;
  await nextTick();
  const element = feedElement.value;
  if (element) element.scrollTop = element.scrollHeight;
});
</script>

<style scoped>
.ub-feed {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  min-height: calc(var(--ub-u) * 220);
  max-height: min(calc(var(--tt-base-viewport-height, 100vh) * 0.62), calc(var(--ub-u) * 640));
  padding: var(--ub-s4);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ub-feed__empty {
  margin: auto;
  max-width: 360px;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  line-height: 1.7;
  text-align: center;
}

.ub-feed__fold {
  align-self: center;
  padding: var(--ub-s1) var(--ub-s3);
  border: 1px dashed var(--ub-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ub-text-3);
  font: inherit;
  font-size: var(--ub-fs-xs);
  cursor: pointer;
}

.ub-feed__divider {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  margin: var(--ub-s2) 0;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

.ub-feed__divider::before,
.ub-feed__divider::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--ub-line-soft);
}

.ub-feed__divider-badge {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
  font-weight: 700;
}

.ub-feed__divider-title {
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-feed__time {
  flex: 0 0 auto;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-variant-numeric: tabular-nums;
}

.ub-feed__user {
  display: flex;
  justify-content: flex-end;
}

.ub-feed__bubble {
  max-width: 82%;
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: 16px 16px 4px 16px;
  background: var(--ub-accent);
  color: var(--ub-on-accent);
}

.ub-feed__bubble p {
  font-size: var(--ub-fs-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ub-feed__bubble .ub-feed__time {
  display: block;
  margin-top: 2px;
  color: inherit;
  opacity: 0.7;
  text-align: right;
}

.ub-feed__thought {
  padding: var(--ub-s1) var(--ub-s3);
  border-left: 2px solid var(--ub-line);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-feed__thought-label {
  font-weight: 700;
}

.ub-feed__thought p {
  margin-top: 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ub-feed__card {
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-panel);
  overflow: hidden;
}

.ub-feed__card.is-failed {
  border-color: color-mix(in srgb, var(--ub-danger) 45%, var(--ub-line-soft));
}

.ub-feed__card-head {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  width: 100%;
  padding: var(--ub-s2) var(--ub-s3);
  border: 0;
  background: transparent;
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-xs);
  text-align: left;
  cursor: pointer;
}

.ub-feed__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--ub-ok-soft);
  color: var(--ub-ok);
  font-size: 10px;
}

.ub-feed__status.is-running {
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-feed__status.is-failed {
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-feed__kind {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-weight: 700;
}

.ub-feed__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-feed__chevron {
  color: var(--ub-text-3);
  font-size: 0.8em;
  transition: transform 0.14s ease;
}

.ub-feed__chevron.is-open {
  transform: rotate(180deg);
}

.ub-feed__preview,
.ub-feed__detail {
  padding: 0 var(--ub-s3) var(--ub-s2) calc(var(--ub-s3) + 26px);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ub-feed__preview {
  display: -webkit-box;
  overflow: hidden;
  cursor: pointer;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.ub-feed__running {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  color: var(--ub-accent-ink);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-feed__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ub-accent);
  animation: ub-feed-pulse 1.2s ease-in-out infinite;
}

@keyframes ub-feed-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.7); }
}
</style>
