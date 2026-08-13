<template>
  <section
    class="acu-dashboard-storage-mode"
    :aria-label="dashboardCopy.storage.sectionLabel"
  >
    <div class="acu-dashboard-storage-mode__head">
      <span class="acu-dashboard-storage-mode__label">{{
        dashboardCopy.storage.sectionLabel
      }}</span>
    </div>
    <p class="acu-dashboard-storage-mode__desc-main">
      {{ dashboardCopy.storage.fixedSqliteDescription }}
    </p>

    <div class="acu-dashboard-storage-mode__cards">
      <article
        v-for="option in decoratedOptions"
        :key="option.value"
        class="acu-dashboard-storage-mode__card acu-dashboard-storage-mode__card--active"
      >
        <span class="acu-dashboard-storage-mode__icon" aria-hidden="true">
          <i :class="option.iconClass"></i>
        </span>
        <span class="acu-dashboard-storage-mode__body">
          <span class="acu-dashboard-storage-mode__card-head">
            <span class="acu-dashboard-storage-mode__name">{{
              option.label
            }}</span>
            <span class="acu-dashboard-storage-mode__badge">{{
              option.badge
            }}</span>
          </span>
          <span class="acu-dashboard-storage-mode__desc">{{
            option.description
          }}</span>
        </span>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DashboardStorageOption } from "../composables/useDashboardPage";
import { dashboardCopy } from "../copy/dashboard-copy";

const props = defineProps<{
  options: DashboardStorageOption[];
  modelValue: string;
}>();

const decoratedOptions = computed(() =>
  props.options.map((option) => ({
    ...option,
    iconClass: "fa-solid fa-database",
    badge: dashboardCopy.storage.badge(option.value),
  })),
);
</script>

<style scoped>
.acu-dashboard-storage-mode {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.acu-dashboard-storage-mode__head {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.acu-dashboard-storage-mode__label {
  min-width: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 500;
}

.acu-dashboard-storage-mode__desc-main {
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
}

.acu-dashboard-storage-mode__switch {
  flex: 0 0 auto;
  width: 92px;
}

.acu-dashboard-storage-mode__cards {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.acu-dashboard-storage-mode__card {
  position: relative;
  min-width: 0;
  padding: 5px 0 5px 8px;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: transparent;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.acu-dashboard-storage-mode__card--active {
  background: color-mix(in srgb, var(--acu-accent) 8%, transparent);
  box-shadow:
    inset 0 0 0 1px
    color-mix(in srgb, var(--acu-accent) 30%, transparent);
}

.acu-dashboard-storage-mode__icon {
  width: 26px;
  height: 26px;
  border-radius: var(--acu-radius-sm);
  background: transparent;
  color: var(--acu-text-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.acu-dashboard-storage-mode__card--active .acu-dashboard-storage-mode__icon {
  color: var(--acu-accent);
  background: transparent;
}

.acu-dashboard-storage-mode__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acu-dashboard-storage-mode__card-head {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.acu-dashboard-storage-mode__name {
  min-width: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 600;
  line-height: 1.25;
}

.acu-dashboard-storage-mode__badge {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 1px 6px;
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-micro, 10px);
  line-height: 1.2;
  white-space: nowrap;
}

.acu-dashboard-storage-mode__card--active .acu-dashboard-storage-mode__badge {
  background: color-mix(in srgb, var(--acu-accent) 16%, transparent);
  color: var(--acu-accent);
}

.acu-dashboard-storage-mode__desc {
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
}

@media (max-width: 640px) {
  .acu-dashboard-storage-mode__head {
    align-items: center;
  }

  .acu-dashboard-storage-mode__switch {
    width: 88px;
  }

  .acu-dashboard-storage-mode__card {
    grid-template-columns: minmax(0, 1fr);
  }

  .acu-dashboard-storage-mode__icon {
    display: none;
  }
}
</style>
