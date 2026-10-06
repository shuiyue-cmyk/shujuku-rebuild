<template>
  <UbSection
    :id="id"
    title="休眠数据"
    description="切换模板时未被新模板包含的表和列会进入休眠：数据保留在聊天历史并跟随 checkpoint 迁移，但不参与填表。可以在这里查看并唤醒。"
    icon="fa-solid fa-moon"
  >
    <template #actions>
      <UbButton size="sm" variant="ghost" icon="fa-solid fa-rotate" :disabled="!!dormant.busyAction.value" @click="dormant.refresh">刷新休眠清单</UbButton>
    </template>
    <div v-if="dormant.listError.value || dormant.integrityIssues.value.length" class="ub-dormant__notes">
      <UbCallout v-if="dormant.listError.value" kind="error">{{ dormant.listError.value }}</UbCallout>
      <UbCallout v-if="dormant.integrityIssues.value.length" kind="warning">
        休眠完整性自检发现 {{ dormant.integrityIssues.value.length }} 项问题：
        <ul class="ub-dormant__issues">
          <li v-for="issue in dormant.integrityIssues.value" :key="`${issue.sheetKey}:${issue.kind}`">{{ issue.message }}</li>
        </ul>
      </UbCallout>
    </div>
    <p v-if="dormant.loaded.value && !dormant.listError.value && dormant.isEmpty.value" class="ub-dormant__empty">
      <i class="fa-regular fa-face-smile" aria-hidden="true"></i> 当前没有休眠数据。
    </p>

    <template v-if="dormant.dormantTables.value.length">
      <div class="ub-dormant__group">休眠表（{{ dormant.dormantTables.value.length }}）</div>
      <UbRow v-for="entry in dormant.dormantTables.value" :key="entry.sheetKey" :label="entry.name">
        <template #hint>
          {{ entry.rowCount }} 行 · {{ entry.columnCount }} 列 · {{ formatHiddenAt(entry) }} · 来源模板：{{ entry.sourcePresetName || '未记录' }}
          <span v-if="!entry.canWake && entry.wakeBlockedReason" class="ub-dormant__blocked">{{ entry.wakeBlockedReason }}</span>
        </template>
        <UbButton
          size="sm"
          variant="soft"
          :disabled="!entry.canWake || !!dormant.busyAction.value"
          :busy="dormant.busyAction.value === `wake:${entry.sheetKey}`"
          @click="dormant.wakeTable(entry)"
        >
          唤醒
        </UbButton>
      </UbRow>
    </template>

    <template v-if="dormant.dormantColumns.value.length">
      <div class="ub-dormant__group">休眠列（{{ dormant.dormantColumns.value.length }}）</div>
      <UbRow
        v-for="entry in dormant.dormantColumns.value"
        :key="`${entry.sheetKey}:${entry.hiddenName}`"
        :label="entry.header"
        :hint="`所属表：${entry.sheetName}`"
      >
        <UbButton
          size="sm"
          variant="soft"
          :disabled="!!dormant.busyAction.value"
          :busy="dormant.busyAction.value === `wake:${entry.sheetKey}:${entry.hiddenName}`"
          @click="dormant.wakeColumn(entry)"
        >
          唤醒
        </UbButton>
      </UbRow>
    </template>
  </UbSection>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useDormantData } from '../../presentation-v2/composables/useDormantData';
import type { DormantTableEntry_ACU } from '../../service/template/dormant-data-service';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';

withDefaults(defineProps<{ id?: string }>(), { id: undefined });

const dormant = useDormantData();

function formatHiddenAt(entry: DormantTableEntry_ACU): string {
  if (typeof entry.hiddenAtTime === 'number' && Number.isFinite(entry.hiddenAtTime)) {
    const d = new Date(entry.hiddenAtTime);
    const pad = (v: number) => String(v).padStart(2, '0');
    return `休眠于 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (typeof entry.hiddenAtMessageIndex === 'number') return `休眠于第 ${entry.hiddenAtMessageIndex} 楼`;
  return '休眠时间未记录';
}

onMounted(() => dormant.refresh());
watchChatChanged_ACU(() => dormant.refresh());
</script>

<style scoped>
.ub-dormant__notes {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4) 0;
}

.ub-dormant__issues {
  margin: var(--ub-s1) 0 0;
  padding-left: 1.2em;
}

.ub-dormant__empty {
  padding: var(--ub-s5) var(--ub-s4);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  text-align: center;
}

.ub-dormant__group {
  padding: var(--ub-s2) var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-2xs);
  font-weight: 800;
}

.ub-dormant__group:first-child {
  border-top: 0;
}

.ub-dormant__blocked {
  display: block;
  color: var(--ub-warn);
}
</style>
