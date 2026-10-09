<template>
  <dl ref="root" class="ub-stats" :class="{ 'ub-stats--mono': mono }">
    <div
      v-for="item in items"
      :key="item.key ?? item.label"
      class="ub-stats__item"
      :class="{ 'ub-stats__item--wide': item.wide && multiColumn }"
    >
      <dt>{{ item.label }}</dt>
      <dd>
        <slot :name="item.key ?? item.label" :item="item">{{ item.value ?? '—' }}</slot>
      </dd>
    </div>
  </dl>
</template>

<script lang="ts">
export interface UbStatsItem {
  label: string;
  value?: string | number | null;
  /** 具名插槽键，默认用 label。 */
  key?: string;
  /** 多列时占两格：内容较长的项，或用来让奇数项的网格整行排满。单列时自动退回一格。 */
  wide?: boolean;
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{ items: UbStatsItem[]; mono?: boolean }>(), { mono: false });

const root = ref<HTMLElement | null>(null);
/**
 * 网格当前是否多列。列数由 auto-fill 按宽度决定，CSS 无法据此切换 span：
 * 单列时 span 2 会凭空多出一条隐式列，后面的项被自动放进去。只在有宽项时才观察。
 */
const multiColumn = ref(false);
let observer: ResizeObserver | null = null;

function measureColumns(): void {
  const el = root.value;
  const view = el?.ownerDocument?.defaultView;
  if (!el || !view) return;
  const tracks = String(view.getComputedStyle(el).gridTemplateColumns || '').trim();
  multiColumn.value = tracks !== '' && tracks !== 'none' && tracks.split(/\s+/).length >= 2;
}

onMounted(() => {
  if (!props.items.some(item => item.wide)) return;
  measureColumns();
  const Observer = root.value?.ownerDocument?.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
  if (!Observer || !root.value) return;
  observer = new Observer(() => measureColumns());
  observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<style scoped>
/*
 * 分隔线由每格自己在右侧、下方各画 1px（外投影不占布局），网格外缘那一圈被 overflow 裁掉。
 * 不用「gap + 线色背景」：那样网格末行的空位会露出一整块线色底。
 * 各格不铺底色，否则后面的格子会盖住前一格画在外侧的分隔线。
 */
.ub-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(var(--ub-u) * 180)), 1fr));
  grid-auto-flow: row dense;
  margin: 0;
  overflow: hidden;
}

.ub-stats__item {
  min-width: 0;
  padding: var(--ub-s2) var(--ub-s4);
  box-shadow: 1px 0 0 var(--ub-line-soft), 0 1px 0 var(--ub-line-soft);
}

.ub-stats__item--wide {
  grid-column: span 2;
}

.ub-stats__item dt {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

.ub-stats__item dd {
  margin: 2px 0 0;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.ub-stats--mono .ub-stats__item dd {
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
}
</style>
