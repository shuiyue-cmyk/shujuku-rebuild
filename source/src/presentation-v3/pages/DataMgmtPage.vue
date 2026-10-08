<template>
  <UbPage :sections="sections">
    <UbCallout v-if="flow.message.value" :kind="flow.message.value.kind">{{ flow.message.value.text }}</UbCallout>

    <UbSection id="dm-checkpoint" title="备份与恢复" description="Checkpoint 用于完整备份 / 恢复当前聊天当前标识的表格、模板与指导表。表格数据按 AI 楼层共享：同一楼层的所有 swipe 分支共用同一份表格历史。" icon="fa-solid fa-shield-halved">
      <UbRow label="导出 Checkpoint" hint="导出当前隔离标识的表格、聊天模板和指导表。">
        <UbButton size="sm" icon="fa-solid fa-upload" :disabled="busy" @click="flow.exportTableCheckpoint">导出</UbButton>
      </UbRow>
      <UbRow label="导入 Checkpoint">
        <template #hint>
          导入会清空当前聊天全部 AI 楼层、所有隔离标识的本地表格数据，只在当前隔离键的最新 AI 楼层重建；当前聊天表格模板切换为文件模板。<strong class="ub-dm__strong">全局模板和聊天正文不变。</strong>
        </template>
        <UbFileButton size="sm" variant="danger" icon="fa-solid fa-download" accept=".json,application/json" :disabled="busy" @file="onImportTableCheckpoint">导入</UbFileButton>
      </UbRow>
    </UbSection>

    <UbSection v-if="flow.mixedStorageDecision.value" id="dm-mixed" title="混合存储决议" icon="fa-solid fa-code-merge" padded>
      <p class="ub-dm__text">
        当前聊天同时检测到 legacy-v1 与 V2 数据。决议：{{ flow.mixedStorageDecision.value.kind }}。
        <template v-if="flow.mixedStorageDecision.value.diagnosticCodes.length">诊断：{{ flow.mixedStorageDecision.value.diagnosticCodes.join('、') }}。</template>
        <template v-if="flow.mixedStorageDecision.value.anchorStatus || flow.mixedStorageDecision.value.replayStatus">
          锚点：{{ flow.mixedStorageDecision.value.anchorStatus }}；回放：{{ flow.mixedStorageDecision.value.replayStatus }}；静态表数：{{ flow.mixedStorageDecision.value.staticSheetKeyCount }}。
        </template>
        可先导出两份独立快照；提交动作只引用当前决议，不会从页面接收或覆盖表格数据。
      </p>
      <div class="ub-dm__buttons">
        <UbButton :disabled="runtimeDiagnostic.busy.value" :busy="flow.busyAction.value === 'export-mixed-storage-snapshots'" @click="flow.exportMixedStorageSnapshots">导出 legacy/V2 快照</UbButton>
        <UbButton
          v-if="flow.mixedStorageDecision.value.allowedActions.includes('keep_v2')"
          :disabled="runtimeDiagnostic.busy.value"
          :busy="flow.busyAction.value === 'commit-mixed-storage-keep_v2'"
          @click="onCommitMixedStorageDecision('keep_v2')"
        >
          保留 V2 并清理 legacy
        </UbButton>
        <UbButton
          v-if="flow.mixedStorageDecision.value.allowedActions.includes('commit_merge_candidate')"
          :disabled="runtimeDiagnostic.busy.value"
          :busy="flow.busyAction.value === 'commit-mixed-storage-commit_merge_candidate'"
          @click="onCommitMixedStorageDecision('commit_merge_candidate')"
        >
          提交受限合并候选
        </UbButton>
      </div>
    </UbSection>

    <UbSection v-if="flow.v2RecoverySummary.value" id="dm-recovery" title="V2 数据恢复诊断" icon="fa-solid fa-kit-medical" padded>
      <p class="ub-dm__text">{{ flow.v2RecoverySummary.value.message }} 恢复只使用服务端冻结候选，不会从页面读取或提交可编辑表格数据。</p>
      <div class="ub-dm__buttons">
        <UbButton :disabled="busy" @click="flow.exportV2RecoveryBackups">导出已保存的原始 frame 备份</UbButton>
        <UbButton
          v-if="RECOVERABLE_CHECKPOINT_STATUSES.includes(flow.v2RecoverySummary.value.status)"
          variant="danger"
          :disabled="runtimeDiagnostic.busy.value"
          :busy="flow.busyAction.value === 'commit-v2-recovery'"
          @click="onCommitV2Recovery(false)"
        >
          应用 Checkpoint 修复/收敛
        </UbButton>
        <UbButton
          v-if="flow.v2RecoverySummary.value.status === 'recoverable_orphan_data_replace'"
          variant="danger"
          :disabled="runtimeDiagnostic.busy.value"
          :busy="flow.busyAction.value === 'commit-v2-recovery'"
          @click="onCommitV2Recovery(true)"
        >
          确认无锚点 data_replace 恢复
        </UbButton>
      </div>
    </UbSection>

    <UbSection v-if="flow.v2IsolationDiagnostics.value.length" id="dm-isolation" title="V2 隔离域恢复诊断" icon="fa-solid fa-stethoscope">
      <UbRow v-for="diagnostic in flow.v2IsolationDiagnostics.value" :key="diagnostic.isolationKey" :label="diagnostic.isolationKey || '默认隔离域'">
        <template #hint>
          {{ diagnostic.message }}
          <span v-if="!diagnostic.isCurrentIsolation" class="ub-dm__block">请切换到该隔离域后重新诊断；当前恢复提交不会跨隔离域执行。</span>
          <span v-else-if="diagnostic.status.startsWith('recoverable_')" class="ub-dm__block">当前隔离域存在可恢复候选，请诊断 V2 数据恢复生成可提交计划。</span>
        </template>
      </UbRow>
    </UbSection>

    <DormantDataSection id="dm-dormant" />

    <UbSection id="dm-cleanup" :title="copy.panels.cleanup.title" :description="copy.panels.cleanup.description" icon="fa-solid fa-broom">
      <UbRow label="保留数据层数" hint="自动更新结束后，超出保留范围的旧楼层插件数据会被清理；不影响聊天正文。">
        <UbInput
          type="number"
          :min="0"
          :step="1"
          :disabled="runtimeDiagnostic.busy.value"
          :model-value="flow.retainRecentLayers.value"
          aria-label="保留数据层数"
          @change="flow.setRetainRecentLayers($event)"
        />
      </UbRow>
      <div class="ub-dm__group">
        手动删除 · 当前聊天 {{ flow.aiMessageCount.value }} 个 AI 楼层 · 将处理：{{ flow.rangeLabel.value }}
      </div>
      <UbRow label="起始楼层" hint="从第 N 个 AI 回复楼层开始，留空为第 1 层。">
        <UbInput :model-value="flow.deleteRange.startFloor" type="number" :min="1" :step="1" aria-label="起始楼层" @update:model-value="flow.deleteRange.startFloor = $event" />
      </UbRow>
      <UbRow label="终止楼层" hint="留空为最新楼层。">
        <UbInput :model-value="flow.deleteRange.endFloor" type="number" :min="1" :step="1" placeholder="到最后" aria-label="终止楼层" @update:model-value="flow.deleteRange.endFloor = $event" />
      </UbRow>
      <UbRow v-if="flow.deletableSheetOptions.value.length > 0" label="限定表格（可选）" stack>
        <template #hint>勾选后只删除所选表格在楼层范围内的数据（含 checkpoint 中这些表的部分），其它表格、模板与指导表不受影响；不勾选则按整楼层删除。</template>
        <div class="ub-dm__sheets" role="group" aria-label="限定表格">
          <UbCheck
            v-for="option in flow.deletableSheetOptions.value"
            :key="option.sheetKey"
            :model-value="flow.deleteSheetKeys.value.includes(option.sheetKey)"
            :label="option.name"
            :disabled="runtimeDiagnostic.busy.value"
            :data-sheet-key="option.sheetKey"
            @update:model-value="flow.toggleDeleteSheetKey(option.sheetKey, $event)"
          />
          <UbButton v-if="flow.hasDeleteSheetSelection.value" size="sm" variant="ghost" :disabled="runtimeDiagnostic.busy.value" @click="flow.clearDeleteSheetSelection">清除选择</UbButton>
        </div>
      </UbRow>
      <div class="ub-dm__danger">
        <p class="ub-dm__text">
          {{ flow.hasDeleteSheetSelection.value
            ? `当前已限定 ${flow.deleteSheetKeys.value.length} 张表：${flow.selectedDeleteSheetNames.value.join('、')}。按表删除不会硬清空，即便范围覆盖全部楼层。`
            : '楼层范围同时作用于删除按钮。「删除所有本地数据」在范围覆盖全部 AI 楼层时执行硬清空，范围为局部时只删除对应楼层的填表数据。' }}
        </p>
        <div class="ub-dm__buttons">
          <UbButton
            variant="danger"
            icon="fa-solid fa-trash-can"
            :disabled="runtimeDiagnostic.busy.value"
            :busy="flow.busyAction.value === 'purge-all-local' || flow.busyAction.value === 'delete-all-local'"
            @click="onDeleteLocalData"
          >
            {{ flow.hasDeleteSheetSelection.value ? `删除所选 ${flow.deleteSheetKeys.value.length} 张表的数据` : '删除所有本地数据' }}
          </UbButton>
          <UbButton
            icon="fa-solid fa-rotate-left"
            :disabled="runtimeDiagnostic.busy.value"
            :busy="flow.busyAction.value === 'reset-defaults'"
            @click="onResetAllDefaults"
          >
            恢复默认配置
          </UbButton>
        </div>
      </div>
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import {
  useDataManagement,
  type ResetDefaultsCleanupKey,
  type ResetDefaultsCleanupOptions,
} from '../../presentation-v2/composables/useDataManagement';
import { useSqliteRuntimeDiagnostic } from '../../presentation-v2/composables/useSqliteRuntimeDiagnostic';
import { dataMgmtCopy as copy } from '../../presentation-v2/copy/data-mgmt-copy';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import type { MixedStorageCommitAction_ACU } from '../../shared/models/mixed-storage-commit-action';
import DormantDataSection from '../parts/DormantDataSection.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbCheck from '../ui/UbCheck.vue';
import UbFileButton from '../ui/UbFileButton.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';

const RECOVERABLE_CHECKPOINT_STATUSES: string[] = [
  'recoverable_repaired_checkpoint',
  'recoverable_temporary_sheet_anchor',
  'recoverable_redundant_full_checkpoint',
  'recoverable_from_recovery_backup',
];

const RESET_DEFAULTS_OPTIONS: Array<{ value: ResetDefaultsCleanupKey; label: string; description: string; defaultChecked: boolean }> = [
  { value: 'restore-template-prompts', label: '默认表格模板与提示词', description: '恢复默认表格模板、填表提示词和合并总结提示词。', defaultChecked: true },
  { value: 'clear-template-snapshots', label: '当前聊天表格模板快照', description: '清理当前标识下由前端或角色卡导入的临时表格模板、预设快照和指导表。', defaultChecked: true },
  { value: 'clear-plot-snapshots', label: '当前聊天剧情推进预设快照', description: '清理当前聊天临时剧情推进覆盖，让它重新跟随全局设置。', defaultChecked: true },
  { value: 'clear-table-locks', label: '当前聊天表格锁', description: '清理当前聊天和当前标识下的表格行、列、单元格锁定状态。', defaultChecked: true },
  { value: 'clear-table-order', label: '表格顺序缓存', description: '清空旧的表格顺序缓存，后续按当前模板顺序重新显示。', defaultChecked: true },
];

const dialogStore = useDialogStore();
const toast = useToastStore();
const flow = useDataManagement();
const runtimeDiagnostic = useSqliteRuntimeDiagnostic();

const busy = computed(() => !!flow.busyAction.value || runtimeDiagnostic.busy.value);

const sections = computed(() => [
  { id: 'dm-checkpoint', label: '备份与恢复' },
  ...(flow.mixedStorageDecision.value ? [{ id: 'dm-mixed', label: '混合存储' }] : []),
  ...(flow.v2RecoverySummary.value ? [{ id: 'dm-recovery', label: '恢复诊断' }] : []),
  { id: 'dm-dormant', label: '休眠数据' },
  { id: 'dm-cleanup', label: '删除与清理' },
]);

/** 每次危险操作在确认框关闭后再查一次运行时忙碌，避免确认期间状态已变。 */
function runtimeBusy(): boolean {
  return runtimeDiagnostic.busy.value;
}

async function onImportTableCheckpoint(file: File): Promise<void> {
  if (runtimeBusy()) return;
  const scope = flow.captureActionScope();
  const checkpoint = await flow.parseTableCheckpoint(file);
  if (!checkpoint) return;
  const sourceStorageMode = checkpoint.source.storageMode;
  const targetStorageMode = flow.getCheckpointTargetStorageMode();
  const restoredUpToAiFloor = await dialogStore.prompt({
    title: '这份数据覆盖到第几楼',
    message:
      '可选。按 AI 楼层填写这份 Checkpoint 数据真正写到的最后一楼；留空表示按现有行为处理'
      + '（追平进度前沿取最新 AI 楼层，一键追平会显示已追平）。\n'
      + '填写后，恢复出来的表格会从「该楼层 + 1」开始被一键追平/自动填表规划；'
      + '填得比恢复帧所在楼层还晚时按恢复帧楼层处理（不会超过数据实际所在的位置）。',
    label: '覆盖到第几楼（AI 楼层，可留空）',
    placeholder: '例如 91；留空表示不声明',
    confirmLabel: '下一步',
    requireNonEmpty: false,
  });
  if (restoredUpToAiFloor === null) return;
  const trimmed = restoredUpToAiFloor.trim();
  let floorValue: number | undefined;
  if (trimmed) {
    // 只认十进制正整数：Number() 会把 "1e3"、"0x10" 也当成合法楼层
    const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.warning('覆盖楼层需要是正整数（AI 楼层）；本次未执行恢复。');
      return;
    }
    floorValue = parsed;
  }
  const floorNote = floorValue === undefined
    ? '未声明覆盖楼层：追平进度前沿按现有行为取最新 AI 楼层。'
    : `已声明数据只覆盖到第 ${floorValue} 楼：恢复后追平会从第 ${floorValue + 1} 楼开始规划。`;
  const confirmed = await dialogStore.confirm({
    title: '恢复当前聊天 Checkpoint',
    message: `导入将清空当前聊天全部 AI 楼层、所有隔离标识的本地表格数据。
仅在当前激活隔离键的最新 AI 楼层重建文件中的表格数据。
当前聊天表格模板会切换为文件模板，后续更新将使用该模板。
全局模板和聊天正文不变。来源模式：${sourceStorageMode}；目标模式：${targetStorageMode}。
${floorNote}确认继续？`,
    confirmLabel: '恢复 Checkpoint',
    confirmVariant: 'danger',
  });
  if (!confirmed || runtimeBusy()) return;
  void flow.restoreTableCheckpoint(checkpoint, { restoredUpToAiFloor: floorValue }, scope);
}

async function onDeleteLocalData(): Promise<void> {
  if (runtimeBusy()) return;
  // 删除路径与所属聊天在确认前冻结，执行时交给 composable/服务层核对（R10A-01）。
  const path = flow.resolveDeletionPath('all');
  const scope = flow.captureActionScope();
  if (flow.hasDeleteSheetSelection.value) {
    const names = flow.selectedDeleteSheetNames.value;
    const confirmed = await dialogStore.confirm({
      title: '删除所选表格数据',
      message:
        `删除当前聊天中 ${flow.rangeLabel.value} 内表「${names.join('」「')}」的数据？\n`
        + '包括该范围内 full checkpoint、单表 checkpoint 与填表日志里属于这些表的部分；\n'
        + '其它表格的数据、聊天级模板 scope 与 guide 容器一律保留，不会执行硬清空。\n'
        + '仅作用于当前隔离标识。此操作不可恢复。',
      confirmLabel: '删除所选表格数据',
      confirmVariant: 'danger',
    });
    if (!confirmed || runtimeBusy()) return;
    void flow.deleteLocalData('all', { expectedPath: path, scope });
    return;
  }
  if (path === 'range') {
    const confirmed = await dialogStore.confirm({
      title: '删除指定楼层本地数据',
      message:
        `删除当前聊天中 ${flow.rangeLabel.value} 所有标识的数据库数据？\n`
        + '仅清除该范围内楼层的填表数据；聊天级模板 scope 与 guide 容器保留，\n'
        + '未覆盖的楼层数据不受影响。此操作不可恢复。',
      confirmLabel: '删除数据',
      confirmVariant: 'danger',
    });
    if (!confirmed || runtimeBusy()) return;
    void flow.deleteLocalData('all', { expectedPath: path, scope });
    return;
  }
  // 范围覆盖全部 AI 楼层＝硬清空：两级确认
  const confirmed = await dialogStore.confirm({
    title: '删除所有本地数据',
    message:
      '当前删除范围覆盖全部 AI 楼层，将硬清空当前聊天的全部本地数据库状态：\n'
      + '· 清除所有隔离标识的本地数据（不只当前标识）；\n'
      + '· 含用户首条消息上的字段；\n'
      + '· 清除聊天级模板 scope 与 guide 容器（模板选择回到继承全局）；\n'
      + '· 不保留 init 锚点，重新填表时 sheetKey 会重新分配；\n'
      + '· 结果等价于全新会话，不可恢复。\n'
      + '若只想删除部分楼层，请先在上方设置起止楼层范围。\n'
      + '全局模板、提示词与聊天正文不受影响。确认继续？',
    confirmLabel: '删除所有本地数据',
    confirmVariant: 'danger',
  });
  if (!confirmed) return;
  const again = await dialogStore.confirm({
    title: '再次确认删除',
    message: '再次确认：将当前聊天恢复到从未填表的全新状态？此操作不可撤销。',
    confirmLabel: '确认硬清空',
    confirmVariant: 'danger',
  });
  if (!again || runtimeBusy()) return;
  void flow.deleteLocalData('all', { expectedPath: path, scope });
}

async function onCommitMixedStorageDecision(action: MixedStorageCommitAction_ACU): Promise<void> {
  if (runtimeBusy()) return;
  const isMerge = action === 'commit_merge_candidate';
  const confirmed = await dialogStore.confirm({
    title: isMerge ? '提交混合存储合并候选' : '保留 V2 数据并清理 legacy',
    message: isMerge
      ? '将只提交服务端冻结且已审计通过的合并候选。页面不会提交任何可编辑表格数据。确认继续？'
      : '将保留已验证的 V2 数据并清理冗余 legacy-v1 数据。确认继续？',
    confirmLabel: isMerge ? '继续提交候选' : '保留 V2',
    confirmVariant: 'danger',
  });
  if (!confirmed) return;
  if (isMerge) {
    const again = await dialogStore.confirm({
      title: '再次确认合并候选',
      message: '候选内容以服务端冻结决议为准；提交后不会用 legacy 数据覆盖 V2。确认提交？',
      confirmLabel: '确认提交候选',
      confirmVariant: 'danger',
    });
    if (!again) return;
  }
  if (runtimeBusy()) return;
  void flow.commitMixedStorageDecision(action);
}

async function onCommitV2Recovery(isOrphan: boolean): Promise<void> {
  if (runtimeBusy()) return;
  const confirmed = await dialogStore.confirm({
    title: isOrphan ? '确认无锚点 data_replace 恢复' : '应用 V2 Checkpoint 修复',
    message: isOrphan
      ? '将只提交服务端冻结的无锚点 data_replace 候选。原始 frame 会保留为隔离备份，页面不会提交任何可编辑表格数据。确认继续？'
      : '将只提交服务端冻结且已审计通过的 Checkpoint 修复候选。原始 frame 会保留为隔离备份。确认继续？',
    confirmLabel: isOrphan ? '继续恢复' : '应用修复',
    confirmVariant: 'danger',
  });
  if (!confirmed) return;
  if (isOrphan) {
    const again = await dialogStore.confirm({
      title: '再次确认无锚点恢复',
      message: '无锚点 data_replace 会被提升为新的 full checkpoint。恢复内容完全以服务端冻结候选为准。确认提交？',
      confirmLabel: '确认提交恢复',
      confirmVariant: 'danger',
    });
    if (!again) return;
  }
  if (runtimeBusy()) return;
  void flow.commitV2Recovery(isOrphan);
}

async function onResetAllDefaults(): Promise<void> {
  if (runtimeBusy()) return;
  const scope = flow.captureActionScope();
  const selected = await dialogStore.selectMany<ResetDefaultsCleanupKey>({
    title: '恢复默认配置',
    message: '选择本次要恢复或清理的项目。默认全选；取消某一项后会保留对应内容。不会删除聊天正文、本地楼层数据、API 配置或全局预设库。',
    options: RESET_DEFAULTS_OPTIONS,
    confirmLabel: '按所选项目恢复',
    confirmVariant: 'danger',
    requireNonEmpty: true,
  });
  if (!selected || runtimeBusy()) return;
  const picked = new Set(selected);
  const cleanup: ResetDefaultsCleanupOptions = {
    restoreTemplateAndPrompts: picked.has('restore-template-prompts'),
    clearTemplateSnapshots: picked.has('clear-template-snapshots'),
    clearPlotSnapshots: picked.has('clear-plot-snapshots'),
    clearTableLocks: picked.has('clear-table-locks'),
    clearTableOrder: picked.has('clear-table-order'),
  };
  void flow.resetAllDefaults(cleanup, scope);
}

function refreshAll(): void {
  flow.refresh();
  runtimeDiagnostic.refresh();
}

onMounted(refreshAll);
watchChatChanged_ACU(refreshAll);
</script>

<style scoped>
.ub-dm__text {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-dm__strong {
  color: var(--ub-text);
}

.ub-dm__block {
  display: block;
  margin-top: 2px;
}

.ub-dm__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s2);
}

.ub-dm__group {
  padding: var(--ub-s2) var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 700;
}

.ub-dm__sheets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2) var(--ub-s4);
}

.ub-dm__danger {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
  background: color-mix(in srgb, var(--ub-danger-soft) 40%, transparent);
}
</style>
