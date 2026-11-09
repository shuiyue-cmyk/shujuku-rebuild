<template>
  <UbRow v-if="queryKey" label="Go 用量" stack>
    <template #hint>
      <template v-if="error">查不到用量：{{ error }}</template>
      <template v-else-if="!usage">查询中…</template>
      <template v-else>OpenCode Go 订阅已用的比例，每轮填表结束后刷新。</template>
    </template>
    <UbStats v-if="usage" class="ub-go-usage" :items="statsItems">
      <template v-for="item in statsItems" :key="item.key" #[item.key]>
        <span class="ub-go-usage__pct" :class="{ 'is-limited': usage[item.key].limited }">{{ formatPercent(usage[item.key].percent) }}</span>
        <span class="ub-go-usage__reset" :class="{ 'is-limited': usage[item.key].limited }">
          {{ usage[item.key].limited ? '已限流，' : '' }}{{ formatResetAt(usage[item.key].resetsAt) }} 重置
        </span>
      </template>
    </UbStats>
  </UbRow>
</template>

<script setup lang="ts">
/**
 * OpenCode Go 用量：端点是 Go 且填了密钥时显示 5 小时 / 本周 / 本月三个周期。
 * 地址或密钥改动后停手片刻再查（逐字输入密钥不连发请求）；一轮填表结束时刷新一次。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  fetchOpencodeGoUsage_ACU,
  opencodeGoUsageUrl_ACU,
  type OpencodeGoUsage_ACU,
} from '../../service/ai/opencode-go-usage';
import { onTableFillRunEnded_ACU } from '../../service/runtime/state-manager';
import UbRow from '../ui/UbRow.vue';
import UbStats, { type UbStatsItem } from '../ui/UbStats.vue';

const props = defineProps<{ url: string; apiKey: string }>();

const QUERY_DEBOUNCE_MS = 500;

const statsItems: Array<UbStatsItem & { key: keyof OpencodeGoUsage_ACU }> = [
  { key: 'rolling', label: '5 小时' },
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月' },
];

const usage = ref<OpencodeGoUsage_ACU | null>(null);
const error = ref('');

/** 查询对象（用量地址 + 密钥）；非 Go 端点或没填密钥时为空，不显示也不查。 */
const queryKey = computed(() => {
  const usageUrl = opencodeGoUsageUrl_ACU(props.url.trim());
  const key = props.apiKey.trim();
  return usageUrl && key ? `${usageUrl}\n${key}` : '';
});

// 每次发起查询换一代：迟到的旧结果（旧密钥、已卸载）不再落到界面上
let generation = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function refresh(): Promise<void> {
  const current = ++generation;
  if (!queryKey.value) return;
  try {
    const result = await fetchOpencodeGoUsage_ACU(props.url.trim(), props.apiKey.trim());
    if (current !== generation) return;
    usage.value = result;
    error.value = '';
  } catch (e: any) {
    if (current !== generation) return;
    usage.value = null;
    error.value = String(e?.message || e || '未知错误');
  }
}

watch(queryKey, () => {
  generation += 1;
  usage.value = null;
  error.value = '';
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = queryKey.value ? setTimeout(() => { debounceTimer = null; void refresh(); }, QUERY_DEBOUNCE_MS) : null;
}, { immediate: true });

const offFillRunEnded = onTableFillRunEnded_ACU(() => { void refresh(); });

onBeforeUnmount(() => {
  offFillRunEnded();
  if (debounceTimer) clearTimeout(debounceTimer);
  generation += 1;
});

function formatPercent(percent: number): string {
  return `${Math.round(percent * 10) / 10}%`;
}

function formatResetAt(ms: number): string {
  const at = new Date(ms);
  const now = new Date();
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const dayDiff = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
      - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000,
  );
  if (dayDiff === 0) return `今天 ${hm}`;
  if (dayDiff === 1) return `明天 ${hm}`;
  return `${at.getMonth() + 1}月${at.getDate()}日 ${hm}`;
}
</script>

<style scoped>
.ub-go-usage {
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
}

.ub-go-usage__pct {
  font-size: var(--ub-fs-md);
  font-weight: 700;
}

.ub-go-usage__reset {
  display: block;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

.ub-go-usage__pct.is-limited,
.ub-go-usage__reset.is-limited {
  color: var(--ub-danger);
}
</style>
