<template>
  <UbPage lead="正文生成后自动检查并润色 AI 回复。下面从上到下依次是：调用参数、替换方式、提示词、标签筛选与手动测试。" :sections="sections">
    <UbCallout v-if="store.message" :kind="store.message.kind">{{ store.message.text }}</UbCallout>

    <UbSection id="cr-basic" :title="copy.panels.basic.title" :description="copy.panels.basic.description" icon="fa-solid fa-sliders">
      <UbRow label="API 预设" hint="默认使用当前 API；选择后只影响正文替换。" :flagged="contentReplaceStale">
        <UbSelect
          :options="apiOptions"
          :model-value="store.apiPreset"
          :placeholder="followActiveApiLabel"
          aria-label="正文替换 API 预设"
          @update:model-value="setApiPreset"
        />
      </UbRow>
      <UbRow label="最小正文长度" hint="低于此值跳过优化。">
        <UbInput :model-value="store.minLength" type="number" :min="0" :step="10" aria-label="最小正文长度" @change="store.setNumber('minLength', $event)" />
      </UbRow>
      <UbRow label="最大替换项数" hint="单次最多接受的建议条数。">
        <UbInput :model-value="store.maxOptimizations" type="number" :min="1" :max="100" :step="1" aria-label="最大替换项数" @change="store.setNumber('maxOptimizations', $event)" />
      </UbRow>
      <UbRow label="循环优化次数" hint="再次检查优化结果，过高会增加等待时间。">
        <UbInput :model-value="store.loopCount" type="number" :min="1" :max="10" :step="1" aria-label="循环优化次数" @change="store.setNumber('loopCount', $event)" />
      </UbRow>
      <UbRow label="自动重试次数" hint="失败时重试次数上限。">
        <UbInput :model-value="store.retryCount" type="number" :min="1" :max="10" :step="1" aria-label="自动重试次数" @change="store.setNumber('retryCount', $event)" />
      </UbRow>
    </UbSection>

    <UbSection id="cr-mode" :title="copy.panels.mode.title" :description="copy.panels.mode.description" icon="fa-solid fa-shuffle">
      <UbRow v-for="item in modeToggles" :key="item.key" :label="item.label" :hint="item.hint">
        <UbSwitch :model-value="store[item.key]" :aria-label="item.label" @update:model-value="store.setBoolean(item.key, $event)" />
      </UbRow>
      <UbRow label="最近可重新优化" :hint="store.lastOptimizedLabel">
        <UbButton
          size="sm"
          icon="fa-solid fa-rotate-right"
          :busy="store.busyAction === 'reoptimize'"
          :disabled="store.lastOptimizedMessageIndex < 0"
          @click="store.reoptimizeLatest"
        >
          重新优化最近一次
        </UbButton>
      </UbRow>
    </UbSection>

    <UbSection id="cr-decision" :title="copy.panels.decision.title" :description="copy.panels.decision.description" icon="fa-solid fa-scale-balanced">
      <UbRow label="启用替换前判定" hint="只影响自动替换；手动「重新优化」和测试不经过判定。">
        <UbSwitch :model-value="store.decisionGate.enabled" aria-label="启用替换前判定" @update:model-value="setDecisionEnabled" />
      </UbRow>
      <UbCallout v-if="store.decisionGate.enabled && !store.decisionGate.apiKey" kind="warning">
        还没填 OpenRouter Key，判定暂不生效，正文照常替换。
      </UbCallout>
      <UbRow label="OpenRouter Key" hint="在 openrouter.ai 的 Keys 页面创建，只用于决策判定。" stack>
        <UbInput
          :model-value="store.decisionGate.apiKey"
          type="password"
          placeholder="sk-or-..."
          autocomplete="off"
          aria-label="OpenRouter Key"
          @change="store.setDecisionGate({ apiKey: String($event) })"
        />
      </UbRow>
      <UbRow label="决策模型" hint="默认 Jev 最新版；标「免费」的不扣费。">
        <div class="ub-cr__picker">
          <UbSelect
            :options="decisionModelOptions"
            :model-value="store.decisionGate.model"
            aria-label="决策模型"
            @update:model-value="store.setDecisionGate({ model: $event })"
          />
          <UbIconButton
            icon="fa-solid fa-rotate"
            title="刷新模型列表"
            :disabled="store.decisionModelsLoading"
            @click="store.loadDecisionModels"
          />
        </div>
      </UbRow>
      <UbRow label="判定门槛（%）" hint="「好」的概率达到这个值才替换；50 即按模型的选择。调高则更少替换。">
        <UbInput
          :model-value="store.decisionGate.threshold"
          type="number"
          :min="0"
          :max="100"
          :step="5"
          aria-label="判定门槛"
          @change="store.setDecisionGate({ threshold: $event })"
        />
      </UbRow>
    </UbSection>

    <UbSection id="cr-preset" :title="copy.panels.preset.title" description="下拉切换当前提示词预设。内置默认预设不能直接修改，请用「从默认新建」。" icon="fa-solid fa-scroll">
      <template #actions>
        <UbBadge :variant="store.promptTemplateMode === 'default' ? 'neutral' : 'accent'">
          {{ store.promptTemplateMode === 'default' ? '使用默认提示词' : '已自定义提示词' }}
        </UbBadge>
      </template>
      <div class="ub-cr__preset">
        <p class="ub-cr__meta">当前提示词：<strong>{{ store.activePresetLabel }}</strong> · {{ store.promptSegmentCount }} 段</p>
        <div class="ub-cr__picker">
          <UbPresetPicker
            title="选择正文替换预设"
            :items="presetItems"
            :model-value="store.selectedPresetName"
            empty-text="暂无正文替换预设"
            placeholder="自定义提示词"
            :show-default-action="false"
            @update:model-value="onSelectPreset($event)"
          />
          <UbIconButton
            icon="fa-solid fa-pen"
            variant="solid"
            :title="canEditCurrentPrompt ? '编辑当前提示词' : '默认预设不能直接编辑，请从默认新建后修改'"
            :disabled="!canEditCurrentPrompt"
            @click="openPromptSheetForCurrent"
          />
          <UbFileButton icon-only icon="fa-solid fa-download" title="导入预设 JSON" accept="application/json,.json" :disabled="!!store.busyAction" @file="store.importPresets" />
          <UbIconButton icon="fa-solid fa-gear" title="管理预设" @click="presetSheetOpen = true" />
        </div>
        <UbCallout v-if="promptGroupMissingContent" kind="warning">
          正文替换提示词缺少 $CONTENT 占位符，运行时无法知道要检查哪段正文；请打开编辑器载入默认提示词或补回占位符。
        </UbCallout>
      </div>
    </UbSection>

    <UbSection id="cr-filter" :title="copy.panels.filter.title" :description="copy.panels.filter.description" icon="fa-solid fa-filter">
      <UbRow label="提取标签" hint="多个标签逗号分隔，留空不提取。" stack>
        <UbInput :model-value="store.extractTags" placeholder="例如: content,正文" aria-label="提取标签" @update:model-value="store.setString('extractTags', String($event))" />
      </UbRow>
      <UbRow label="排除标签" hint="多个标签逗号分隔，留空不排除。" stack>
        <UbInput :model-value="store.excludeTags" placeholder="例如: think,thinking" aria-label="排除标签" @update:model-value="store.setString('excludeTags', String($event))" />
      </UbRow>
      <UbRow stack>
        <UbRulePairs
          label="正文标签提取规则"
          :model-value="store.extractRules"
          start-placeholder="开始词（例如：<content>）"
          end-placeholder="结束词（例如：</content>）"
          add-label="添加提取规则"
          @update:model-value="store.setExtractRules"
        />
      </UbRow>
      <UbRow stack>
        <UbRulePairs
          label="标签排除规则"
          :model-value="store.excludeRules"
          start-placeholder="开始词（例如：<think>）"
          end-placeholder="结束词（例如：</think>）"
          add-label="添加排除规则"
          @update:model-value="store.setExcludeRules"
        />
      </UbRow>
    </UbSection>

    <UbSection id="cr-test" :title="copy.panels.test.title" :description="copy.panels.test.description" icon="fa-solid fa-flask-vial" padded>
      <UbTextarea
        :model-value="store.testInput"
        :rows="5"
        label="测试文本"
        placeholder="输入一段模拟 AI 正文，验证提示词与返回格式。"
        @update:model-value="store.setString('testInput', $event)"
      />
      <div class="ub-cr__test-actions">
        <UbButton icon="fa-solid fa-scale-balanced" :busy="store.busyAction === 'decision-test'" @click="store.runDecisionTest">测试决策判定</UbButton>
        <UbButton variant="primary" icon="fa-solid fa-play" :busy="store.busyAction === 'test'" @click="store.runTest">执行优化测试</UbButton>
      </div>
      <pre v-if="store.testOutput" class="ub-cr__output">{{ store.testOutput }}</pre>
    </UbSection>

    <UbSheet :is-open="presetSheetOpen" title="管理正文替换预设" width="560px" @close="presetSheetOpen = false">
      <UbCallout v-if="store.message" :kind="store.message.kind">{{ store.message.text }}</UbCallout>
      <UbButton variant="primary" icon="fa-solid fa-plus" @click="store.createPresetFromDefault">从默认新建</UbButton>
      <ul v-if="store.promptPresets.length" class="ub-cr__list">
        <li v-for="preset in store.promptPresets" :key="preset.name" class="ub-cr__list-item">
          <div class="ub-cr__list-info">
            <span class="ub-cr__list-name">{{ preset.name }}</span>
            <span class="ub-cr__list-meta">{{ preset.promptGroup.length }} 段提示词</span>
          </div>
          <UbIconButton icon="fa-solid fa-upload" title="导出 JSON" @click="store.exportPresetByName(preset.name)" />
          <UbIconButton icon="fa-solid fa-i-cursor" title="重命名" @click="onRenamePreset(preset.name)" />
          <UbIconButton icon="fa-solid fa-pen" title="编辑提示词" @click="onEditPreset(preset.name)" />
          <UbIconButton icon="fa-solid fa-trash-can" variant="danger" title="删除" @click="onDeletePreset(preset.name)" />
        </li>
      </ul>
      <p v-else class="ub-cr__meta">暂无预设。点上方「从默认新建」，或在预设卡片里导入。</p>
      <UbCallout kind="info">点「编辑提示词」会先把该预设载入为当前提示词，再打开编辑器；保存后同步更新这个预设。</UbCallout>
    </UbSheet>

    <PromptSegmentsSheet
      :is-open="promptSheetOpen"
      title="编辑正文替换提示词"
      :segments="promptSegmentsForView"
      :dirty="store.promptDirty"
      :message="store.message"
      :allow-import-export="false"
      dirty-confirm-message="你有未保存的正文替换提示词修改，确定要关闭吗？"
      @close="closePromptSheet"
      @save="onSavePromptGroup"
      @reset="onResetPromptGroup"
      @add="store.addPromptSegment($event)"
      @delete="store.deletePromptSegment($event)"
      @update="onPromptUpdate"
    >
      <template #lead>
        <div class="ub-cr__placeholders">
          <span>可用占位符</span>
          <code v-for="token in PLACEHOLDERS" :key="token">{{ token }}</code>
        </div>
      </template>
    </PromptSegmentsSheet>
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApiPresetSelectOptions } from '../../presentation-v2/composables/useApiPresetSelectOptions';
import { useApiPresetStaleness } from '../../presentation-v2/composables/useApiPresetStaleness';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useUiCloseGuard } from '../../presentation-v2/composables/useUiCloseGuard';
import { contentReplaceCopy as copy } from '../../presentation-v2/copy/content-replace-copy';
import {
  CUSTOM_CONTENT_REPLACE_PRESET_VALUE,
  useContentReplaceStore,
  type ContentReplacePromptSegment,
} from '../../presentation-v2/stores/content-replace-store';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import PromptSegmentsSheet from '../parts/PromptSegmentsSheet.vue';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbFileButton from '../ui/UbFileButton.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import UbPresetPicker from '../ui/UbPresetPicker.vue';
import type { UbPromptSegment } from '../ui/UbPromptSegments.vue';
import UbRow from '../ui/UbRow.vue';
import UbRulePairs from '../ui/UbRulePairs.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect from '../ui/UbSelect.vue';
import UbSheet from '../ui/UbSheet.vue';
import UbSwitch from '../ui/UbSwitch.vue';
import UbTextarea from '../ui/UbTextarea.vue';

type ModeKey = 'seamlessMode' | 'autoApply' | 'showDiff' | 'parallelMode' | 'ignoreMvuUpdate';

const PLACEHOLDERS = ['$CONTENT', '$1', '$5', '$6', '$7', '$8', '$U', '$C'];

const store = useContentReplaceStore();
const dialogStore = useDialogStore();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: apiOptions } = useApiPresetSelectOptions();
// 防呆：API 预设在别处被改过时标黄，手动重选一次即确认
const { isStale: contentReplaceStale, markConfirmed: markContentReplaceConfirmed } = useApiPresetStaleness('content-replace');

const presetSheetOpen = ref(false);
const promptSheetOpen = ref(false);
const editingPresetName = ref('');

const sections = [
  { id: 'cr-basic', label: copy.nav.basic },
  { id: 'cr-mode', label: copy.nav.mode },
  { id: 'cr-decision', label: copy.nav.decision },
  { id: 'cr-preset', label: copy.nav.preset },
  { id: 'cr-filter', label: copy.nav.filter },
  { id: 'cr-test', label: copy.nav.test },
];

const modeToggles: Array<{ key: ModeKey; label: string; hint?: string }> = [
  { key: 'seamlessMode', label: '无感替换模式', hint: '尽量把优化结果直接写回聊天；关闭则需要手动确认。' },
  { key: 'autoApply', label: '自动应用替换结果' },
  { key: 'showDiff', label: '显示优化对比', hint: '无感模式下完成提示里可点「查看对比」，否则直接弹出对比；开启静默提示框时也会显示。' },
  { key: 'parallelMode', label: '填表与正文替换并行执行' },
  {
    key: 'ignoreMvuUpdate',
    label: '忽略MVU更新',
    hint: '开启后不等 MVU 变量解析就开始替换，少等一会儿；MVU 随后追加到正文末尾的变量块会原样保留。关闭则等解析完成再替换。',
  },
];

const presetItems = computed(() => {
  const base = [
    { value: '', label: '默认预设', meta: `${store.defaultPromptSegmentCount} 段提示词` },
    ...store.promptPresets.map(preset => ({
      value: preset.name,
      label: preset.name,
      meta: `${preset.promptGroup.length} 段提示词`,
    })),
  ];
  return store.selectedPresetName === CUSTOM_CONTENT_REPLACE_PRESET_VALUE
    ? [{ value: CUSTOM_CONTENT_REPLACE_PRESET_VALUE, label: '自定义提示词', meta: '未保存为预设' }, ...base]
    : base;
});

const promptSegmentsForView = computed<UbPromptSegment[]>(() =>
  store.promptGroup.map(segment => ({
    role: segment.role,
    content: segment.content,
    deletable: segment.deletable,
    mainSlot: segment.mainSlot,
    isMain: segment.isMain,
    isMain2: segment.isMain2,
  })),
);

/** 列表还没拉到（或拉取失败）时，当前所选模型仍要能显示。 */
const decisionModelOptions = computed(() => {
  const options = store.decisionModels.map(model => ({
    value: model.id,
    label: model.free ? `${model.name}（免费）` : model.name,
  }));
  if (!options.some(option => option.value === store.decisionGate.model)) {
    options.unshift({ value: store.decisionGate.model, label: store.decisionGate.model });
  }
  return options;
});

function setDecisionEnabled(value: boolean): void {
  store.setDecisionGate({ enabled: value });
  if (value && !store.decisionModels.length) void store.loadDecisionModels();
}

const promptGroupMissingContent = computed(() => !store.promptGroup.some(s => String(s.content || '').includes('$CONTENT')));
const canEditCurrentPrompt = computed(() => store.selectedPresetName !== '');

function setApiPreset(value: string): void {
  store.setString('apiPreset', value);
  markContentReplaceConfirmed();
}

async function onDeletePreset(name: string): Promise<void> {
  if (!name) return;
  const confirmed = await dialogStore.confirm({
    title: '删除正文替换预设',
    message: `删除正文替换预设"${name}"？`,
    confirmLabel: '删除预设',
    confirmVariant: 'danger',
  });
  if (confirmed) store.deletePresetByName(name);
}

async function onRenamePreset(name: string): Promise<void> {
  const next = await dialogStore.prompt({
    title: '重命名正文替换预设',
    message: `将正文替换预设"${name}"重命名为：`,
    label: '预设名称',
    defaultValue: name,
    confirmLabel: '重命名',
  });
  if (next) store.renamePreset(name, next);
}

/** R10B-13：从未存为预设的自定义提示词切走前确认，它切走后无法找回。 */
async function confirmLeaveCustomPrompt(nextName: string): Promise<boolean> {
  if (!store.hasUnsavedCustomPrompt || nextName === store.selectedPresetName) return true;
  return dialogStore.confirm({
    title: '切换正文替换提示词',
    message: '当前是未存为预设的自定义提示词，切换后会被覆盖且无法找回。如需保留，请先取消并「另存为预设」。确定切换吗？',
    confirmLabel: '切换',
    confirmVariant: 'danger',
  });
}

async function onSelectPreset(name: string): Promise<void> {
  if (!(await confirmLeaveCustomPrompt(name))) return;
  store.selectPreset(name);
}

async function onEditPreset(name: string): Promise<void> {
  if (!(await confirmLeaveCustomPrompt(name))) return;
  store.selectPreset(name);
  editingPresetName.value = name;
  presetSheetOpen.value = false;
  promptSheetOpen.value = true;
}

function openPromptSheetForCurrent(): void {
  editingPresetName.value = store.hasSelectedPreset ? store.selectedPresetName : '';
  promptSheetOpen.value = true;
}

function closePromptSheet(): void {
  // 面板只在无改动或用户确认放弃后才 emit close：丢掉草稿，避免之后被别的保存顺带写入（R10B-03）
  store.discardPromptDraft();
  promptSheetOpen.value = false;
  editingPresetName.value = '';
}

function onSavePromptGroup(): void {
  if (editingPresetName.value) store.savePromptGroupToPreset(editingPresetName.value);
  else store.savePromptGroup();
}

async function onResetPromptGroup(): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: '载入默认提示词组',
    message: '载入默认正文替换提示词组？这会覆盖编辑器里的提示词内容，保存后才会生效。',
    confirmLabel: '载入默认',
    confirmVariant: 'danger',
  });
  if (confirmed) store.resetPromptGroup();
}

function onPromptUpdate(index: number, patch: Partial<UbPromptSegment>): void {
  store.updatePromptSegment(index, patch as Partial<ContentReplacePromptSegment>);
}

function refreshAll(): void {
  store.refreshFromSettings();
  apiStore.refreshFromSettings();
}

onMounted(() => {
  refreshAll();
  if (store.decisionGate.enabled && !store.decisionModels.length) void store.loadDecisionModels();
});
watchChatChanged_ACU(refreshAll);
useUiCloseGuard(() => {
  if (!promptSheetOpen.value || !store.promptDirty) return true;
  return dialogStore.confirm({
    title: '关闭 UnbirthDB',
    message: '你有未保存的正文替换提示词修改，确定要关闭吗？',
    confirmLabel: '仍然关闭',
    confirmVariant: 'danger',
  });
});
</script>

<style scoped>
.ub-cr__preset {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
}

.ub-cr__meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-cr__meta strong {
  color: var(--ub-text);
}

.ub-cr__picker {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
}

.ub-cr__test-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ub-s2);
}

.ub-cr__output {
  max-height: calc(var(--ub-u) * 360);
  margin: 0;
  padding: var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
  color: var(--ub-text);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow: auto;
}

.ub-cr__list {
  margin: 0;
  padding: 0;
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  list-style: none;
  overflow: hidden;
}

.ub-cr__list-item {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s4);
}

.ub-cr__list-item + .ub-cr__list-item {
  border-top: 1px solid var(--ub-line-soft);
}

.ub-cr__list-info {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.ub-cr__list-name {
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-cr__list-meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-cr__placeholders {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-cr__placeholders code {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--ub-sunken);
  color: var(--ub-accent-ink);
  font-family: var(--ub-mono);
}
</style>
