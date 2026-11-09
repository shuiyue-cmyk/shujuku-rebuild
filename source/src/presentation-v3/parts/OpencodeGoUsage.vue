<template>
  <UbRow v-if="queryKey" label="Go 用量" stack>
    <template #hint>
      <template v-if="error">查不到用量：{{ error }}</template>
      <template v-else-if="!usage">查询中…</template>
      <template v-else>OpenCode Go 订阅已用的比例，每轮填表结束后刷新。</template>
    </template>
    <!-- 上一行并排 5 小时 / 本周，下一行通栏本月总额度 -->
    <div v-if="usage" class="ub-go-usage">
      <div
        v-for="item in meters"
        :key="item.key"
        class="ub-go-usage__meter"
        :class="{ 'is-wide': item.wide, 'is-high': usage[item.key].percent >= 80, 'is-limited': usage[item.key].limited }"
      >
        <div class="ub-go-usage__head">
          <span class="ub-go-usage__label">{{ item.label }}</span>
          <span class="ub-go-usage__pct">{{ formatPercent(usage[item.key].percent) }}</span>
        </div>
        <div
          class="ub-go-usage__track"
          role="progressbar"
          :aria-label="`${item.label}已用`"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="usage[item.key].percent"
        >
          <div class="ub-go-usage__fill" :style="{ width: `${Math.min(100, Math.max(0, usage[item.key].percent))}%` }" />
        </div>
        <div class="ub-go-usage__reset">
          {{ usage[item.key].limited ? '已限流，' : '' }}{{ formatResetAt(usage[item.key].resetsAt) }} 重置
        </div>
      </div>
    </div>
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

const props = defineProps<{ url: string; apiKey: string }>();

const QUERY_DEBOUNCE_MS = 500;

const meters: Array<{ key: keyof OpencodeGoUsage_ACU; label: string; wide?: boolean }> = [
  { key: 'rolling', label: '5 小时' },
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月总额度', wide: true },
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
  // 短格式：手机宽度下半宽一格也放得下「已限流，11/16 08:00 重置」
  return `${at.getMonth() + 1}/${at.getDate()} ${hm}`;
}
</script>

<style scoped>
.ub-go-usage {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ub-s4);
}

.ub-go-usage__meter {
  min-width: 0;
}

.ub-go-usage__meter.is-wide {
  grid-column: 1 / -1;
}

.ub-go-usage__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--ub-s2);
}

.ub-go-usage__label {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-go-usage__pct {
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ub-go-usage__track {
  height: 6px;
  margin-top: var(--ub-s1);
  overflow: hidden;
  border-radius: 999px;
  background: var(--ub-sunken);
  box-shadow: inset 0 0 0 1px var(--ub-line-soft);
}

.ub-go-usage__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--ub-accent);
  transition: width 0.3s ease;
}

.ub-go-usage__reset {
  margin-top: var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

.ub-go-usage__meter.is-high .ub-go-usage__fill {
  background: var(--ub-warn);
}

.ub-go-usage__meter.is-limited .ub-go-usage__fill {
  background: var(--ub-danger);
}

.ub-go-usage__meter.is-limited .ub-go-usage__pct,
.ub-go-usage__meter.is-limited .ub-go-usage__reset {
  color: var(--ub-danger);
}
</style>
