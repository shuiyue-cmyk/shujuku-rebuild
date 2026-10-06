<template>
  <dl class="ub-stats" :class="{ 'ub-stats--mono': mono }">
    <div v-for="item in items" :key="item.key ?? item.label" class="ub-stats__item">
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
}
</script>

<script setup lang="ts">
withDefaults(defineProps<{ items: UbStatsItem[]; mono?: boolean }>(), { mono: false });
</script>

<style scoped>
.ub-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(var(--ub-u) * 180)), 1fr));
  gap: 1px;
  margin: 0;
  background: var(--ub-line-soft);
}

.ub-stats__item {
  min-width: 0;
  padding: var(--ub-s2) var(--ub-s4);
  background: var(--ub-panel);
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
