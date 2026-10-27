<template>
  <UbPage lead="发送前让决策模型给纪要打分，挑出与接下来剧情最相关的几条，连同最新几条按表号顺序带进本轮输入。" :sections="sections">
    <UbSection id="dr-mode" title="使用方式" description="两种用法共用下面的模型与召回设置。" icon="fa-solid fa-toggle-on">
      <UbRow label="单独开启" :hint="enableHint">
        <UbSwitch :model-value="store.settings.enabled" aria-label="单独开启决策召回" @update:model-value="setEnabled" />
      </UbRow>
      <UbCallout kind="info">
        也可以不单独开启：在剧情推进的多任务预设里，把「标签摘取」恰好是 recall 的任务设为「改由决策召回执行」，其余任务照常由模型执行。
      </UbCallout>
    </UbSection>

    <UbSection id="dr-model" title="决策模型" description="与正文替换的「替换前判定」各自独立；三家的 Key 与模型各存各的，切换服务商不会丢掉另一家的设置。" icon="fa-solid fa-scale-balanced">
      <UbRow label="服务商" :hint="providerView.providerHint">
        <UbSelect :options="providerOptions" :model-value="store.settings.provider" aria-label="决策召回服务商" @update:model-value="setProvider" />
      </UbRow>
      <UbCallout v-if="!store.endpoint.apiKey" kind="warning">
        还没填 {{ store.endpoint.label }} Key：纪要多于召回条数时不会打分，只带上最新 5 条纪要。
      </UbCallout>
      <UbRow :key="store.settings.provider" :label="`${store.endpoint.label} Key`" :hint="providerView.keyHint" stack>
        <UbInput
          :model-value="store.endpoint.apiKey"
          type="password"
          :placeholder="providerView.keyPlaceholder"
          autocomplete="off"
          :aria-label="`${store.endpoint.label} Key`"
          @change="setKey"
        />
      </UbRow>
      <UbRow label="决策模型" :hint="providerView.modelHint">
        <div class="ub-dr__picker">
          <UbSelect :options="modelOptions" :model-value="store.endpoint.model" aria-label="决策模型" @update:model-value="setModel" />
          <UbIconButton
            v-if="store.settings.provider === 'openrouter'"
            icon="fa-solid fa-rotate"
            title="刷新模型列表"
            :disabled="store.modelsLoading"
            @click="store.loadModels"
          />
        </div>
      </UbRow>
    </UbSection>

    <UbSection id="dr-rule" title="召回规则" :description="ruleDescription" icon="fa-solid fa-list-ol">
      <UbRow label="召回条数" :hint="`打分后挑选几条（1–${maxCount}），另外固定带上最新 ${fixedCount} 条，合计最多 ${maxTotal} 条。相关的不够时用分数低的补满。`">
        <UbInput
          :key="`count-${inputKey}`"
          :model-value="store.settings.recallCount"
          type="number"
          :min="1"
          :max="maxCount"
          :step="1"
          aria-label="召回条数"
          @change="setNumber('recallCount', $event)"
        />
      </UbRow>
      <UbRow label="打分时看什么" hint="只看概要更省、更快；加上纪要正文判断更准，但每组输入多好几倍。">
        <UbSegmented :options="scoringOptions" :model-value="store.settings.scoringContent" aria-label="打分时看什么" @update:model-value="store.patch({ scoringContent: $event })" />
      </UbRow>
      <UbRow label="失败重试次数" :hint="`一组打分失败后再试几次（0–${maxRetries}）；用完仍失败就跳过这一组，从其余纪要里选，不会停掉发送。`">
        <UbInput
          :key="`retry-${inputKey}`"
          :model-value="store.settings.maxRetries"
          type="number"
          :min="0"
          :max="maxRetries"
          :step="1"
          aria-label="失败重试次数"
          @change="setNumber('maxRetries', $event)"
        />
      </UbRow>
    </UbSection>

    <UbSection id="dr-directive" title="注入指令" description="只用于单独开启：选中的编码写进本轮输入时用这段文字包裹。替换剧情推进任务时用预设自己的最终注入指令。" icon="fa-solid fa-quote-left" padded>
      <template #actions>
        <UbBadge v-if="directiveDirty" variant="accent">未保存</UbBadge>
      </template>
      <UbTextarea
        :model-value="directiveDraft"
        :rows="7"
        :max-rows="16"
        auto-resize
        mono
        aria-label="注入指令"
        @update:model-value="directiveDraft = $event"
      />
      <p class="ub-dr__meta">$8 换成用户本轮输入；{{ codesPlaceholder }} 换成召回编码块（没写就追加在末尾）。</p>
      <div class="ub-dr__actions">
        <UbButton size="sm" icon="fa-solid fa-rotate-left" @click="resetDirective">恢复默认</UbButton>
        <UbButton size="sm" variant="primary" icon="fa-solid fa-floppy-disk" :disabled="!directiveDirty" @click="saveDirective">保存指令</UbButton>
      </div>
    </UbSection>

    <UbSection id="dr-test" title="测试召回" description="用下面这句输入和当前聊天最近两楼 AI 回复跑一次完整打分，只显示结果，不写进聊天。会按所选服务商实际计费。" icon="fa-solid fa-flask-vial" padded>
      <UbTextarea
        :model-value="store.testInput"
        :rows="3"
        label="模拟的用户输入"
        placeholder="例如：我回到旧宅，想起那天的约定。"
        @update:model-value="store.setTestInput"
      />
      <div class="ub-dr__actions">
        <UbButton variant="primary" icon="fa-solid fa-play" :busy="store.testBusy" @click="store.runTest">测试召回</UbButton>
      </div>
      <pre v-if="store.testOutput" class="ub-dr__output">{{ store.testOutput }}</pre>
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDecisionRecallStore } from '../../presentation-v2/stores/decision-recall-store';
import { usePlotPresetStore } from '../../presentation-v2/stores/plot-preset-store';
import { useRouterStore } from '../../presentation-v2/stores/router-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import { DECISION_RECALL_PROVIDER_LABELS_ACU } from '../../service/decision-recall/decision-recall-settings';
import {
  DECISION_RECALL_BATCH_SIZE_ACU,
  DECISION_RECALL_CODES_PLACEHOLDER_ACU,
  DECISION_RECALL_CONCURRENCY_ACU,
  DECISION_RECALL_FIXED_RECENT_COUNT_ACU,
  DECISION_RECALL_MAX_COUNT_ACU,
  DECISION_RECALL_MAX_RETRIES_LIMIT_ACU,
  DECISION_RECALL_MAX_TOTAL_ACU,
  DEFAULT_DECISION_RECALL_DIRECTIVE_ACU,
  type DecisionRecallProvider_ACU,
} from '../../shared/decision-recall-defaults';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSegmented from '../ui/UbSegmented.vue';
import UbSelect from '../ui/UbSelect.vue';
import UbSwitch from '../ui/UbSwitch.vue';
import UbTextarea from '../ui/UbTextarea.vue';

const store = useDecisionRecallStore();
const plotStore = usePlotPresetStore();
const routerStore = useRouterStore();
const toastStore = useToastStore();

const sections = [
  { id: 'dr-mode', label: '使用方式' },
  { id: 'dr-model', label: '决策模型' },
  { id: 'dr-rule', label: '召回规则' },
  { id: 'dr-directive', label: '注入指令' },
  { id: 'dr-test', label: '测试' },
];

const fixedCount = DECISION_RECALL_FIXED_RECENT_COUNT_ACU;
const maxCount = DECISION_RECALL_MAX_COUNT_ACU;
const maxTotal = DECISION_RECALL_MAX_TOTAL_ACU;
const maxRetries = DECISION_RECALL_MAX_RETRIES_LIMIT_ACU;
const codesPlaceholder = DECISION_RECALL_CODES_PLACEHOLDER_ACU;
const ruleDescription = `每组 ${DECISION_RECALL_BATCH_SIZE_ACU} 条纪要发一次请求、最多同时 ${DECISION_RECALL_CONCURRENCY_ACU} 组；`
  + '参考最近两楼 AI 回复和用户最新输入，不带世界书；按与接下来剧情发展的相关性分五档打分。交火开着时只从交火筛过的纪要里选。';

const enableHint = computed(() => (plotStore.enabled
  ? '与剧情推进互斥：开启后会关闭剧情推进。'
  : '与剧情推进互斥：开启后，剧情推进的开关会被关闭；之后再开剧情推进会关闭这里。'));

const providerOptions = (Object.keys(DECISION_RECALL_PROVIDER_LABELS_ACU) as DecisionRecallProvider_ACU[])
  .map(value => ({ value, label: DECISION_RECALL_PROVIDER_LABELS_ACU[value] }));

const PROVIDER_VIEW_ACU: Record<DecisionRecallProvider_ACU, { providerHint: string; keyHint: string; keyPlaceholder: string; modelHint: string }> = {
  siliconflow: {
    providerHint: '大陆服务商；SemIf 响应快。截至 2026 年 10 月 12 日决策模型仍免费，但官方写的限时免费期已过、何时收费没有通知，请留意账户扣费。',
    keyHint: '在 cloud.siliconflow.cn 的 API 密钥页面创建。',
    keyPlaceholder: 'sk-...',
    modelHint: '默认 SemIf；Kev-4B 较慢，一组 20 条可能超时。',
  },
  openrouter: {
    providerHint: '按输入计费、输出不收费；单次文本超过约 32KB 会变慢、变不准，打分内容选「概要 + 纪要正文」且前文很长时留意。',
    keyHint: '在 openrouter.ai 的 Keys 页面创建。',
    keyPlaceholder: 'sk-or-...',
    modelHint: '默认 Jev 最新版；标「免费」的不扣费。',
  },
  aihubmix: {
    providerHint: '按输入计费、输出不收费（Jev 最新版标价每百万输入 token 0.0462 美元）。',
    keyHint: '在 aihubmix.com 的 API 密钥页面创建。',
    keyPlaceholder: 'sk-...',
    modelHint: '默认 Jev 最新版。',
  },
};
const providerView = computed(() => PROVIDER_VIEW_ACU[store.settings.provider]);

const KEY_FIELD_ACU: Record<DecisionRecallProvider_ACU, 'siliconflowApiKey' | 'openrouterApiKey' | 'aihubmixApiKey'> = {
  siliconflow: 'siliconflowApiKey',
  openrouter: 'openrouterApiKey',
  aihubmix: 'aihubmixApiKey',
};
const MODEL_FIELD_ACU: Record<DecisionRecallProvider_ACU, 'siliconflowModel' | 'openrouterModel' | 'aihubmixModel'> = {
  siliconflow: 'siliconflowModel',
  openrouter: 'openrouterModel',
  aihubmix: 'aihubmixModel',
};

/** 列表还没拉到（或拉取失败）时，当前所选模型仍要能显示。 */
const modelOptions = computed(() => {
  const options = store.activeModels.map(model => ({ value: model.id, label: model.free ? `${model.name}（免费）` : model.name }));
  if (!options.some(option => option.value === store.endpoint.model)) {
    options.unshift({ value: store.endpoint.model, label: store.endpoint.model });
  }
  return options;
});

const scoringOptions = [
  { value: 'summary', label: '只看概要' },
  { value: 'full', label: '概要 + 纪要正文' },
];

function setProvider(value: string): void {
  store.patch({ provider: value });
  if (value === 'openrouter' && !store.openrouterModels.length) void store.loadModels();
}
function setKey(value: string | number): void {
  store.patch({ [KEY_FIELD_ACU[store.settings.provider]]: String(value) });
}
function setModel(value: string): void {
  store.patch({ [MODEL_FIELD_ACU[store.settings.provider]]: value });
}

/** 清空或填超范围时规整后的值可能与原值相同，输入框不会自己刷新：换个 key 让它按规整后的值重绘。 */
const inputKey = ref(0);
function setNumber(key: 'recallCount' | 'maxRetries', value: string | number): void {
  store.patch({ [key]: value });
  inputKey.value += 1;
}

function setEnabled(value: boolean): void {
  const { saved, plotDisabled } = store.setEnabled(value);
  plotStore.refreshFromSettings();
  // 剧情推进被互斥关掉时，侧栏的剧情推进入口要跟着收起
  routerStore.syncFeatureGatesFromSettings();
  if (saved && plotDisabled) toastStore.info('已关闭剧情推进：单独开启决策召回时与剧情推进互斥。');
}

const directiveDraft = ref(store.settings.directive);
const directiveDirty = computed(() => directiveDraft.value !== store.settings.directive);
watch(() => store.settings.directive, value => { directiveDraft.value = value; });
function saveDirective(): void {
  if (store.patch({ directive: directiveDraft.value })) toastStore.success('注入指令已保存。');
}
function resetDirective(): void {
  directiveDraft.value = DEFAULT_DECISION_RECALL_DIRECTIVE_ACU;
}

function refresh(): void {
  store.refreshFromSettings();
  plotStore.refreshFromSettings();
  directiveDraft.value = store.settings.directive;
}

onMounted(() => {
  refresh();
  if (store.settings.provider === 'openrouter' && !store.openrouterModels.length) void store.loadModels();
});
watchChatChanged_ACU(() => refresh());
</script>

<style scoped>
.ub-dr__picker {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
}

.ub-dr__meta {
  margin: 0;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-dr__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ub-s2);
}

.ub-dr__output {
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
</style>
