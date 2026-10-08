<template>
  <div class="ub-viz" data-ub-viz>
    <aside class="ub-viz__rail">
      <div class="ub-viz__brand">
        <span class="ub-viz__mark" aria-hidden="true"><i class="fa-solid fa-database"></i></span>
        <span class="ub-viz__brand-text">
          <span class="ub-viz__brand-name">数据库编辑器</span>
          <span class="ub-viz__brand-tag">{{ visualizer.sheetItems.length }} 张表 · {{ visualizer.dirty ? '有未保存修改' : '已同步' }}</span>
        </span>
      </div>
      <div class="ub-viz__rail-nav">
        <VizTableNav
          :sheet-items="visualizer.sheetItems"
          :current-sheet-key="visualizer.currentSheetKey"
          :sheet-mode="sheetMode"
          @select-sheet="selectSheet"
          @select-manage="selectManage"
        />
      </div>
    </aside>

    <div class="ub-viz__main">
      <header class="ub-viz__head" data-ub-viz-head>
        <button
          type="button"
          class="ub-viz__switcher"
          :aria-expanded="navOpen ? 'true' : 'false'"
          title="切换表格"
          @click="navOpen = true"
        >
          <i :class="sheetMode ? 'fa-solid fa-table' : 'fa-solid fa-layer-group'" aria-hidden="true"></i>
          <span class="ub-viz__switcher-name">{{ headTitle }}</span>
          <i class="fa-solid fa-chevron-down ub-viz__switcher-chev" aria-hidden="true"></i>
        </button>
        <div class="ub-viz__titles">
          <h1 class="ub-viz__title">{{ headTitle }}</h1>
          <p class="ub-viz__sub">模板：{{ templateLabel }}<template v-if="sheetMode && currentItem"> · {{ currentItem.rowCount }} 行 · {{ currentItem.columnCount }} 列</template></p>
        </div>
        <UbBadge v-if="visualizer.externalRevisionChanged" variant="warning">外部数据已变化</UbBadge>
        <UbBadge v-else-if="visualizer.dirty" variant="warning">未保存</UbBadge>
        <UbSegmented
          v-if="sheetMode && visualizer.currentSheetKey"
          class="ub-viz__modes"
          data-ub-viz-modes
          size="sm"
          :options="modeOptions"
          :model-value="visualizer.mode"
          aria-label="编辑视图"
          @update:model-value="setMode"
        />
        <UbIconButton class="ub-viz__close" data-ub-viz-close icon="fa-solid fa-xmark" title="关闭数据库编辑器" @click="emit('close')" />
      </header>

      <div v-if="visualizer.externalRevisionChanged" class="ub-viz__conflict">
        <UbCallout kind="warning">
          编辑器打开后，当前聊天的数据在别处变了。重新载入会丢掉这里的草稿；保留草稿则继续编辑，下次保存以这里为准。
          <span class="ub-viz__conflict-actions">
            <UbButton size="sm" @click="data.forceReloadFromCurrentContext">重新载入外部数据</UbButton>
            <UbButton size="sm" variant="ghost" @click="visualizer.clearExternalRefreshConflict">保留当前草稿</UbButton>
          </span>
        </UbCallout>
      </div>

      <main class="ub-viz__scroll" data-ub-viz-scroll>
        <!-- R10B-15：保存进行中整页编辑控件禁用，避免输入被 store 拒绝后静默丢失 -->
        <fieldset class="ub-viz__page" :disabled="visualizer.isSaving">
          <p v-if="visualizer.isLoading" class="ub-viz__state">
            <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
            正在载入当前聊天的表格数据…
          </p>
          <div v-else-if="visualizer.loadError" class="ub-viz__state ub-viz__state--error">
            <UbCallout kind="error">
              <strong>无法载入数据库。</strong>
              编辑器需要先读到当前聊天（或隔离标签）下的表格数据，请先完成初始化或一次填表。<br>
              {{ visualizer.loadError }}
            </UbCallout>
            <UbButton icon="fa-solid fa-rotate" @click="data.forceReloadFromCurrentContext">重新载入</UbButton>
          </div>
          <VizManageView
            v-else-if="!sheetMode"
            :sheet-items="visualizer.sheetItems"
            @move-sheet="(key, direction) => visualizer.moveSheet(key, direction)"
            @open-sheet="selectSheet"
            @request-add-sheet="requestAddSheet"
            @request-delete-sheet="requestDeleteSheet"
          />
          <template v-else-if="visualizer.currentSheetKey">
            <VizDataView v-if="visualizer.mode === 'data'" />
            <VizConfigView
              v-else-if="visualizer.mode === 'config'"
              @request-add-column="requestAddColumn"
              @request-delete-column="requestDeleteColumn"
            />
            <VizAssistantView v-else />
          </template>
          <p v-else class="ub-viz__state">还没有表格。打开「数据库管理」新增一张。</p>
        </fieldset>
      </main>

      <footer class="ub-viz__footer" data-ub-viz-footer aria-label="保存">
        <span class="ub-viz__status" :class="{ 'is-dirty': visualizer.dirty }">
          <i :class="statusIcon" aria-hidden="true"></i>
          {{ footerStatus }}
        </span>
        <div class="ub-viz__save">
          <UbButton
            class="ub-viz__save-main"
            variant="primary"
            icon="fa-solid fa-floppy-disk"
            :disabled="saveDisabled"
            :busy="visualizer.isSaving"
            @click="save.saveDataToCurrentMessage"
          >
            保存数据到当前消息
          </UbButton>
          <UbButton :disabled="saveDisabled" :busy="visualizer.isSaving" @click="save.saveTemplateToCurrentChat">保存模板到当前聊天</UbButton>
          <UbButton :disabled="saveDisabled" :busy="visualizer.isSaving" @click="save.saveTemplateToGlobal">保存模板到全局</UbButton>
        </div>
      </footer>
    </div>

    <UbSheet :is-open="navOpen" title="选择表格" :subtitle="`${visualizer.sheetItems.length} 张表`" width="380px" @close="navOpen = false">
      <VizTableNav
        :sheet-items="visualizer.sheetItems"
        :current-sheet-key="visualizer.currentSheetKey"
        :sheet-mode="sheetMode"
        @select-sheet="selectSheet"
        @select-manage="selectManage"
      />
    </UbSheet>
  </div>
</template>

<script setup lang="ts">
/**
 * 新版数据库编辑器。
 * 草稿、锁、保存、AI 助手全部走 visualizer store 与 composable：
 * 桌面左栏列表＋右侧视图；手机顶栏表名点开切换，底部保存栏常驻。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useUiCloseGuard } from '../../presentation-v2/composables/useUiCloseGuard';
import { useVisualizerConfigEditing } from '../../presentation-v2/composables/visualizer/useVisualizerConfigEditing';
import { useVisualizerData } from '../../presentation-v2/composables/visualizer/useVisualizerData';
import { useVisualizerSave } from '../../presentation-v2/composables/visualizer/useVisualizerSave';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import { useVisualizerStore } from '../../presentation-v2/stores/visualizer-store';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbSegmented from '../ui/UbSegmented.vue';
import UbSheet from '../ui/UbSheet.vue';
import VizAssistantView from './visualizer/VizAssistantView.vue';
import VizConfigView from './visualizer/VizConfigView.vue';
import VizDataView from './visualizer/VizDataView.vue';
import VizManageView from './visualizer/VizManageView.vue';
import VizTableNav from './visualizer/VizTableNav.vue';

const emit = defineEmits<{ (e: 'close'): void }>();

const visualizer = useVisualizerStore();
const dialogStore = useDialogStore();
const toastStore = useToastStore();
const data = useVisualizerData();
const config = useVisualizerConfigEditing();
const navOpen = ref(false);

const modeOptions = [
  { value: 'data', label: '数据', icon: 'fa-solid fa-table-list' },
  { value: 'config', label: '结构', icon: 'fa-solid fa-sliders' },
  { value: 'assistant', label: 'AI 助手', icon: 'fa-solid fa-wand-magic-sparkles' },
];

const sheetMode = computed(() => visualizer.mode === 'data' || visualizer.mode === 'config' || visualizer.mode === 'assistant');
const currentItem = computed(() => visualizer.sheetItems.find(item => item.key === visualizer.currentSheetKey) || null);
const headTitle = computed(() => {
  if (!sheetMode.value) return '数据库管理';
  return String(visualizer.currentSheet?.name || visualizer.currentSheetKey || '未选择表格');
});
const templateLabel = computed(() => data.templatePresetLabel.value || '载入中');

const footerStatus = computed(() => {
  if (visualizer.isLoading) return '正在读取表格数据';
  if (visualizer.loadError) return '没有可保存的草稿';
  if (visualizer.isSaving) return '正在保存…';
  if (visualizer.dirty) return '有未保存的修改';
  if (visualizer.lastSavedAt) return '已保存';
  return '改动先进草稿，点保存才会写回';
});

const statusIcon = computed(() => {
  if (visualizer.isSaving || visualizer.isLoading) return 'fa-solid fa-circle-notch fa-spin';
  if (visualizer.dirty) return 'fa-solid fa-circle';
  return 'fa-solid fa-circle-check';
});

const saveDisabled = computed(() => visualizer.isLoading || !!visualizer.loadError || !visualizer.tempData);

function setMode(value: string): void {
  if (value === 'data' || value === 'config' || value === 'assistant') visualizer.setMode(value);
}

function selectSheet(key: string): void {
  visualizer.selectSheet(key);
  navOpen.value = false;
}

function selectManage(): void {
  visualizer.selectTableManagement();
  navOpen.value = false;
}

const save = useVisualizerSave({
  requestGlobalPresetName(defaultName) {
    return dialogStore.prompt({
      title: '保存模板到全局',
      message: '当前用的是默认模板，存到全局前要给它起个名字。取消不会写入任何东西，也不会清掉未保存状态。',
      label: '模板预设名称',
      defaultValue: defaultName,
      placeholder: '例如：当前角色专用模板',
      confirmLabel: '保存模板到全局',
    });
  },
  confirmOverwriteGlobalPreset(presetName) {
    return dialogStore.confirm({
      title: '覆盖全局模板',
      message: `这会用当前编辑结果覆盖全局预设「${presetName}」。不确定的话先取消，草稿会继续留在编辑器里。`,
      confirmLabel: '覆盖并保存',
      confirmVariant: 'primary',
    });
  },
  requestSchemaMigrationChoice(summary) {
    return dialogStore.choose({
      title: '确认历史列对应关系',
      message: `${summary.message}。可以保留历史列值做映射，或以当前编辑器里的整表为新起点。草稿一变就需要重新选择。`,
      actions: [
        ...summary.choices.map(choice => ({ value: choice.id, label: choice.label, variant: 'primary' as const })),
        { value: summary.rebaseChoiceId, label: '按当前表结构重建', variant: 'danger' as const },
      ],
      cancelLabel: '取消保存',
    });
  },
  confirmDestructiveSchemaChange(summary) {
    const details = summary.sheets.map(sheet => {
      const columns = sheet.droppedColumns.map(column => `「${column.displayHeader}」`).join('、');
      return `表「${sheet.tableName}」将删除 ${columns}（影响 ${sheet.affectedRowCount} 行历史数据）`;
    }).join('；');
    return dialogStore.confirm({
      title: '确认保存并永久删除列数据',
      message: `${details}。这些列在当前聊天里的历史值会被移除，不能直接恢复，只能靠保存前的备份或 checkpoint。这次确认只对当前草稿有效，草稿变了需要重新确认。`,
      confirmLabel: '确认删除并保存',
      confirmVariant: 'danger',
    });
  },
});

async function requestAddSheet(): Promise<void> {
  const name = await dialogStore.prompt({
    title: '新增表格',
    message: '新表格先放进编辑器草稿，点保存后才会写回聊天或全局模板。',
    label: '表格名称',
    defaultValue: '新建表格',
    placeholder: '例如：角色状态',
    confirmLabel: '新增表格',
  });
  if (name) data.addSheet(name);
}

async function requestDeleteSheet(key: string): Promise<void> {
  const name = String(visualizer.tempData?.[key]?.name || key);
  const confirmed = await dialogStore.confirm({
    title: '删除表格',
    message: `确定删除表格「${name}」吗？保存后，这张表的数据和模板配置都会被移除。`,
    confirmLabel: '删除表格',
    confirmVariant: 'danger',
  });
  if (confirmed) data.deleteSheet(key);
}

async function requestAddColumn(): Promise<void> {
  const name = await dialogStore.prompt({
    title: '新增列',
    message: '新列加在表头末尾，已有数据行会补一个空值。保存前只改动草稿。',
    label: '列名',
    defaultValue: '新列',
    placeholder: '例如：状态',
    confirmLabel: '新增列',
  });
  if (name) config.addColumn(name);
}

async function requestDeleteColumn(index: number): Promise<void> {
  const header = config.headers.value[index] || `第 ${index + 1} 列`;
  const confirmed = await dialogStore.confirm({
    title: '删除列',
    message: `确定删除「${header}」吗？所有数据行里这一列的值会一起删掉。`,
    confirmLabel: '删除列',
    confirmVariant: 'danger',
  });
  if (confirmed) config.deleteColumn(index);
}

useUiCloseGuard(async () => {
  // R10B-15：保存在途时不允许关闭（「丢弃」会复位保存状态，在途保存的收尾随后作用到已关闭的编辑器）
  if (visualizer.isActive && visualizer.isSaving) {
    toastStore.warning('正在保存，请等保存完成后再关闭数据库编辑器。', { muteable: false });
    return false;
  }
  if (!visualizer.isActive || !visualizer.dirty) return true;
  const action = await dialogStore.choose({
    title: '关闭数据库编辑器',
    message: '草稿还没保存。保存会先写入当前聊天再关闭；丢弃会关闭并清空这次草稿；取消关闭则回到编辑器。',
    badge: { label: '未保存', variant: 'warning' },
    cancelLabel: '取消关闭',
    actions: [
      { value: 'save', label: '保存数据到当前消息', variant: 'primary' },
      { value: 'discard', label: '丢弃草稿', variant: 'danger' },
    ],
  });
  if (action === 'save') return save.saveToChat();
  return action === 'discard';
});

onMounted(() => {
  void data.loadFromCurrentContext();
});

watch(() => visualizer.externalRefreshTick, () => {
  if (!visualizer.isActive || visualizer.dirty) return;
  void data.loadFromCurrentContext();
});

watchChatChanged_ACU(() => {
  if (!visualizer.isActive) return;
  if (visualizer.dirty) {
    visualizer.invalidateDraftContext();
    return;
  }
  void data.loadFromCurrentContext();
});
</script>

<style scoped>
.ub-viz {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.ub-viz__rail {
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--ub-rail-w);
  width: var(--ub-rail-w);
  min-height: 0;
  padding: var(--ub-s5) var(--ub-s3) var(--ub-s3);
  border-right: 1px solid var(--ub-line-soft);
  background: var(--ub-nav-bg);
}

.ub-viz__brand {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  min-width: 0;
  padding: 0 var(--ub-s2);
}

.ub-viz__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 36);
  height: calc(var(--ub-u) * 36);
  border-radius: 11px;
  background: linear-gradient(140deg, var(--ub-accent), color-mix(in srgb, var(--ub-accent) 55%, var(--ub-text)));
  color: var(--ub-on-accent);
  font-size: var(--ub-fs-sm);
}

.ub-viz__brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ub-viz__brand-name {
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  font-weight: 800;
}

.ub-viz__brand-tag {
  overflow: hidden;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-viz__rail-nav {
  flex: 1 1 auto;
  min-height: 0;
  margin: var(--ub-s5) calc(var(--ub-s1) * -1) 0;
  padding: 0 var(--ub-s1);
  overflow-y: auto;
}

.ub-viz__main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.ub-viz__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2) var(--ub-s3);
  flex: 0 0 auto;
  min-height: calc(var(--ub-u) * 64);
  padding: var(--ub-s2) var(--ub-s3) var(--ub-s2) var(--ub-page-pad);
}

.ub-viz__switcher {
  display: none;
}

.ub-viz__titles {
  flex: 1 1 auto;
  min-width: 0;
}

.ub-viz__title {
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-xl);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-viz__sub {
  overflow: hidden;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-viz__conflict {
  flex: 0 0 auto;
  padding: 0 var(--ub-page-pad) var(--ub-s3);
}

.ub-viz__conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s2);
  margin-top: var(--ub-s2);
}

.ub-viz__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.ub-viz__page {
  border: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 100%;
  max-width: calc(var(--ub-page-max) + var(--ub-page-pad) * 2);
  margin: 0 auto;
  padding: var(--ub-s2) var(--ub-page-pad) var(--ub-s8);
}

.ub-viz__state {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s6) 0;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
}

.ub-viz__state--error {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ub-s3);
}

.ub-viz__footer {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  flex: 0 0 auto;
  padding: var(--ub-s3) var(--ub-page-pad);
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-panel);
}

.ub-viz__status {
  display: inline-flex;
  align-items: center;
  gap: var(--ub-s2);
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-viz__status > i {
  font-size: 0.85em;
  color: var(--ub-ok);
}

.ub-viz__status.is-dirty {
  color: var(--ub-text);
}

.ub-viz__status.is-dirty > i {
  font-size: 0.6em;
  color: var(--ub-warn);
}

.ub-viz__save {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ub-s2);
}

@media (max-width: 760px) {
  .ub-viz__rail {
    display: none;
  }

  .ub-viz__head {
    min-height: 0;
    padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s3);
  }

  .ub-viz__titles {
    display: none;
  }

  .ub-viz__switcher {
    display: inline-flex;
    align-items: center;
    gap: var(--ub-s2);
    flex: 1 1 auto;
    min-width: 0;
    min-height: calc(var(--ub-u) * 40);
    padding: 0 var(--ub-s3);
    border: 1px solid var(--ub-line-soft);
    border-radius: var(--ub-r-control);
    background: var(--ub-panel);
    color: var(--ub-text);
    font: inherit;
    font-size: var(--ub-fs-md);
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }

  .ub-viz__switcher > i:first-child {
    color: var(--ub-accent-ink);
    font-size: var(--ub-fs-sm);
  }

  .ub-viz__switcher-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ub-viz__switcher-chev {
    color: var(--ub-text-3);
    font-size: var(--ub-fs-xs);
  }

  .ub-viz__modes {
    order: 10;
    flex: 1 1 100%;
  }

  .ub-viz__modes :deep(.ub-seg__item) {
    flex: 1 1 0;
  }

  .ub-viz__footer {
    flex-direction: column;
    align-items: stretch;
    gap: var(--ub-s2);
    padding: var(--ub-s2) var(--ub-s3);
  }

  .ub-viz__status {
    display: none;
  }

  .ub-viz__save {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ub-viz__save-main {
    grid-column: 1 / -1;
  }

  .ub-viz__save :deep(.ub-btn__label) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
