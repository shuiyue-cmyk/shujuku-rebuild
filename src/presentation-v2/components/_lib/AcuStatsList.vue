<template>
  <dl class="acu-stats" :class="{ 'acu-stats--mono': mono }">
    <div v-for="item in items" :key="item.label" class="acu-stats__item">
      <dt>{{ item.label }}</dt>
      <dd>
        <slot :name="item.key ?? item.label" :item="item">
          <code v-if="mono">{{ item.value ?? '—' }}</code>
          <template v-else>{{ item.value ?? '—' }}</template>
        </slot>
      </dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
export interface AcuStatsItem {
  label: string;
  value?: string | number | null;
  /** Optional key for scoped slot override. Defaults to label. */
  key?: string;
}

withDefaults(defineProps<{
  items: AcuStatsItem[];
  mono?: boolean;
}>(), {
  mono: false,
});
</script>

<style scoped>
.acu-stats {
  margin: 0;
  padding: 2px 0 0;
  background: transparent;
  border-radius: 0;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 16px;
}

.acu-stats__item {
  min-width: 0;
  padding: 8px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
}

.acu-stats dt {
  margin: 0 0 2px; font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3);
}
.acu-stats dd {
  margin: 0; font-size: var(--acu-font-size-body, 12px); color: var(--acu-text-1); word-break: break-all;
}

.acu-stats--mono code {
  display: inline-block; max-width: 100%;
  font-family: var(--acu-font-mono); font-size: var(--acu-font-size-body, 12px);
  background: transparent; color: var(--acu-text-1);
  padding: 0; border-radius: 0;
}

@media (max-width: 720px) {
  .acu-stats { grid-template-columns: 1fr; }
}
</style>
