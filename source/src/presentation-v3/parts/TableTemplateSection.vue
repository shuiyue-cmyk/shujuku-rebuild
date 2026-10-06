<template>
  <UbSection
    :id="id"
    :title="tableCopy.panels.templatePreset.title"
    description="下拉切换当前聊天使用的表格模板，星标设为全局默认。内置默认预设不能直接修改，请用「从默认新建」。"
    icon="fa-solid fa-table-cells"
  >
    <template #actions>
      <UbBadge :variant="templates.isChatOverridden.value ? 'accent' : 'neutral'">
        {{ templates.isChatOverridden.value ? '已覆盖全局' : '跟随全局' }}
      </UbBadge>
    </template>

    <div class="ub-tpl">
      <UbCallout v-if="templates.message.value" :kind="templates.message.value.kind">{{ templates.message.value.text }}</UbCallout>
      <UbCallout v-if="management.message.value" :kind="management.message.value.kind">{{ management.message.value.text }}</UbCallout>

      <dl class="ub-tpl__facts">
        <div>
          <dt>当前聊天</dt>
          <dd>{{ templates.selectedChatPresetLabel.value }}</dd>
        </div>
        <div>
          <dt>全局默认</dt>
          <dd>{{ templates.selectedGlobalPreset.value || '默认预设' }}</dd>
        </div>
      </dl>

      <UbPresetPicker
        title="选择表格模板"
        :items="templates.chatPresetItems.value"
        :model-value="templates.selectedChatPreset.value"
        :default-name="templates.selectedGlobalPresetValue.value"
        :disabled="busy"
        placeholder="默认预设"
        @update:model-value="templates.selectChatPreset($event)"
        @set-default="templates.selectGlobalPreset($event)"
      />

      <div class="ub-tpl__tools">
        <UbFileButton
          size="sm"
          variant="ghost"
          icon="fa-solid fa-download"
          title="导入模板 JSON"
          accept="application/json,.json"
          :disabled="busy"
          @file="templates.importPresetForCurrentChat($event)"
        >
          导入
        </UbFileButton>
        <UbButton
          size="sm"
          variant="ghost"
          icon="fa-solid fa-upload"
          title="导出当前生效模板"
          :disabled="busy || !templates.runtimeTemplateAvailable.value"
          @click="templates.exportTemplate('runtime')"
        >
          导出
        </UbButton>
        <UbButton
          size="sm"
          variant="ghost"
          icon="fa-solid fa-clock-rotate-left"
          title="恢复历史模板归档"
          :disabled="busy || templates.chatArchiveItems.value.length === 0"
          @click="templates.restoreArchivedChatTemplate"
        >
          恢复归档
        </UbButton>
        <UbButton
          v-if="templates.isChatOverridden.value"
          size="sm"
          variant="ghost"
          icon="fa-solid fa-link-slash"
          title="跟随全局（清除聊天覆盖）"
          :disabled="busy"
          @click="templates.followGlobalTemplate"
        >
          跟随全局
        </UbButton>
        <UbButton
          size="sm"
          variant="ghost"
          icon="fa-solid fa-gear"
          title="管理表格模板预设"
          :disabled="management.busy.value"
          @click="management.openManage"
        >
          管理预设
        </UbButton>
      </div>

      <UbButton
        variant="primary"
        icon="fa-solid fa-table-columns"
        title="打开可视化表格编辑器"
        block
        :disabled="busy"
        @click="management.openVisualizer"
      >
        打开可视化表格编辑器
      </UbButton>
    </div>

    <TablePresetSheet
      :is-open="management.isDrawerOpen.value"
      :title="management.title.value"
      :busy="management.busy.value"
      :message="management.message.value"
      :preset-meta="management.presetMeta.value"
      :default-preset-name="management.defaultPresetName.value"
      @close="management.closeDrawer"
      @create-blank="management.createBlankPreset"
      @set-default="management.setAsDefault($event)"
      @export="management.exportPreset($event)"
      @rename="management.renamePreset($event)"
      @edit="management.editPreset($event)"
      @delete="management.deletePreset($event)"
    />
  </UbSection>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useTablePresetManagement } from '../../presentation-v2/composables/useTablePresetManagement';
import { useTableTemplatePresets } from '../../presentation-v2/composables/useTableTemplatePresets';
import { useTemplateRuntimeChangeTick } from '../../presentation-v2/composables/useTemplateRuntimeChangeListener';
import { tableCopy } from '../../presentation-v2/copy/table-copy';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbFileButton from '../ui/UbFileButton.vue';
import UbPresetPicker from '../ui/UbPresetPicker.vue';
import UbSection from '../ui/UbSection.vue';
import TablePresetSheet from './TablePresetSheet.vue';

withDefaults(defineProps<{ id?: string }>(), { id: undefined });

const templates = useTableTemplatePresets();
const management = useTablePresetManagement();
const busy = computed(() => templates.busy.value || management.busy.value);

function refreshAll(): void {
  templates.refresh();
  management.refresh();
}

onMounted(refreshAll);
watchChatChanged_ACU(refreshAll);
watch(useTemplateRuntimeChangeTick(), refreshAll);
</script>

<style scoped>
.ub-tpl {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
}

.ub-tpl__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ub-s2);
  margin: 0;
}

.ub-tpl__facts > div {
  min-width: 0;
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
}

.ub-tpl__facts dt {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 700;
}

.ub-tpl__facts dd {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-tpl__tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s1);
  margin: 0 calc(var(--ub-s2) * -1);
}
</style>
