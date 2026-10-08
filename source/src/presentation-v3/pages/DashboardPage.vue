<template>
  <UbPage :lead="dashboardCopy.panels.healthDescription">
    <section class="ub-dash-health" aria-label="运行概览">
      <article
        v-for="item in healthCards"
        :key="item.key"
        class="ub-health"
        :class="`is-${item.kind}`"
        :data-health-key="item.key"
      >
        <span class="ub-health__icon" aria-hidden="true"><i :class="item.iconClass"></i></span>
        <div class="ub-health__body">
          <div class="ub-health__head">
            <strong class="ub-health__title">{{ item.title }}</strong>
            <UbBadge :variant="item.badgeVariant">{{ item.badge }}</UbBadge>
          </div>
          <p class="ub-health__summary">{{ item.summary }}</p>
          <button
            v-if="item.action"
            type="button"
            class="ub-health__action"
            @click="routerStore.setActivePage(item.action.pageId)"
          >
            {{ item.action.label }}
            <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
      </article>
    </section>

    <UbSection
      id="dash-basic-toggles"
      title="常用开关"
      description="当前聊天里可以随时开关的功能。"
      icon="fa-solid fa-toggle-on"
    >
      <UbRow
        v-for="item in dashboard.basicToggles.value"
        :key="item.key"
        :label="item.label"
        :hint="item.description"
      >
        <UbSwitch
          :model-value="item.value"
          :aria-label="item.label"
          :data-acu-toggle-key="item.key"
          :disabled="item.disabled === true"
          @update:model-value="handleToggleChange(item.key, $event)"
        />
      </UbRow>
    </UbSection>

    <UbSection
      id="dash-advanced-toggles"
      title="功能与进阶"
      description="配置好后基本不用再动；改动可能影响数据库运行，请谨慎。"
      icon="fa-solid fa-layer-group"
    >
      <UbRow
        v-for="item in dashboard.advancedToggles.value"
        :key="item.key"
        :label="item.label"
        :hint="item.description"
      >
        <UbSwitch
          :model-value="item.value"
          :aria-label="item.label"
          :data-acu-toggle-key="item.key"
          :disabled="item.disabled === true"
          @update:model-value="handleToggleChange(item.key, $event)"
        />
      </UbRow>
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { captureChatActionScope_ACU } from '../../presentation-v2/composables/chat-action-scope';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useDashboardPage } from '../../presentation-v2/composables/useDashboardPage';
import { useTemplateRuntimeChangeTick } from '../../presentation-v2/composables/useTemplateRuntimeChangeListener';
import { dashboardCopy } from '../../presentation-v2/copy/dashboard-copy';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { usePlotPresetStore } from '../../presentation-v2/stores/plot-preset-store';
import { useRouterStore } from '../../presentation-v2/stores/router-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import { logError_ACU } from '../../shared/utils';
import { syncFeaturePageGates_UB } from '../composables/feature-gates';
import UbBadge from '../ui/UbBadge.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSwitch from '../ui/UbSwitch.vue';

const dashboard = useDashboardPage();
const plotStore = usePlotPresetStore();
const routerStore = useRouterStore();
const dialogStore = useDialogStore();
const toastStore = useToastStore();

const healthCards = computed(() => [...dashboard.healthItems.value, dashboard.logHealthItem.value]);

function syncGates(): void {
  syncFeaturePageGates_UB(routerStore, dashboard.contentReplaceGateEnabled.value, plotStore.enabled === true);
}

async function refreshAll(): Promise<void> {
  try {
    plotStore.refreshFromSettings();
    await dashboard.refresh();
    syncGates();
  } catch (error) {
    logError_ACU('[UB-V3] dashboard refreshAll 异常:', error);
  }
}

/** 飞行模式关闭会永久删除大总结表：必须二次确认；模板被改过时再确认一次覆盖。 */
let flightModeToggleBusy = false;

async function toggleFlightMode(value: boolean): Promise<void> {
  // R10A-04：确认框排队期间连点会排出第二个确认；整段流程只允许一个在途。
  if (flightModeToggleBusy) return;
  flightModeToggleBusy = true;
  try {
    await runFlightModeToggle(value);
  } finally {
    flightModeToggleBusy = false;
  }
}

async function runFlightModeToggle(value: boolean): Promise<void> {
  const copy = dashboardCopy.toggles.flightMode;
  // 确认框写的是「当前聊天」的大总结表；确认后聊天已切换就不执行。
  const scope = captureChatActionScope_ACU();
  if (!value) {
    const confirmed = await dialogStore.confirm({
      title: copy.disableTitle,
      message: copy.disableMessage,
      dangerMessage: copy.disableDanger,
      confirmLabel: copy.confirmDisable,
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
  }
  const result = await dashboard.setFlightMode(value, { scope });
  if (result.ok) {
    toastStore.success(value ? copy.enabled : copy.disabled, { muteable: false });
    return;
  }
  if (result.reason === 'template_scope_changed') {
    const confirmed = await dialogStore.confirm({
      title: copy.templateScopeChangedTitle,
      message: copy.templateScopeChangedMessage,
      dangerMessage: copy.templateScopeChangedDanger,
      confirmLabel: copy.confirmDisableLabel,
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    const confirmedResult = await dashboard.setFlightMode(false, { confirmTemplateScopeChange: true, scope });
    if (confirmedResult.ok) toastStore.success(copy.disabled, { muteable: false });
    else toastStore.error(confirmedResult.error || copy.disableFailed, { muteable: false });
    return;
  }
  if (result.reason === 'too_many_visible_chronicle_rows') {
    toastStore.error(`飞行模式未开启：当前有 ${result.visibleChronicleRowCount ?? 0} 条可见纪要，最多允许 15 条。`, { muteable: false });
    return;
  }
  toastStore.error(result.error || (value ? copy.enableFailed : copy.disableFailed), { muteable: false });
}

async function handleToggleChange(key: string, value: boolean): Promise<void> {
  if (key === 'flightMode') {
    await toggleFlightMode(value);
    return;
  }
  dashboard.setToggle(key, value);
  if (key === 'plotEnabled') plotStore.refreshFromSettings();
  syncGates();
}

onMounted(() => void refreshAll());
watchChatChanged_ACU(() => void refreshAll());
watch(useTemplateRuntimeChangeTick(), () => void refreshAll());
</script>

<style scoped>
.ub-dash-health {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(var(--ub-u) * 340)), 1fr));
  gap: var(--ub-s3);
}

.ub-health {
  --ub-health-tone: var(--ub-text-3);
  display: flex;
  gap: var(--ub-s3);
  min-width: 0;
  padding: var(--ub-s4);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--ub-card-shadow);
}

.ub-health.is-ok {
  --ub-health-tone: var(--ub-ok);
}

.ub-health.is-info {
  --ub-health-tone: var(--ub-accent-ink);
}

.ub-health.is-warning {
  --ub-health-tone: var(--ub-warn);
}

.ub-health.is-error {
  --ub-health-tone: var(--ub-danger);
  border-color: color-mix(in srgb, var(--ub-danger) 40%, var(--ub-line-soft));
}

.ub-health__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 36);
  height: calc(var(--ub-u) * 36);
  border-radius: 11px;
  background: color-mix(in srgb, var(--ub-health-tone) 15%, transparent);
  color: var(--ub-health-tone);
}

.ub-health__body {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  flex: 1 1 auto;
  min-width: 0;
}

.ub-health__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ub-s2);
}

.ub-health__title {
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
}

.ub-health__summary {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-health__action {
  display: inline-flex;
  align-items: center;
  gap: var(--ub-s1);
  align-self: flex-start;
  margin-top: var(--ub-s1);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ub-accent-ink);
  font: inherit;
  font-size: var(--ub-fs-xs);
  font-weight: 700;
  cursor: pointer;
}

.ub-health__action:hover {
  text-decoration: underline;
}
</style>
