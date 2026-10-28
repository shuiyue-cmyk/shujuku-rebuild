<template>
  <UbPage lead="发送前让决策模型给纪要打分，挑出与接下来剧情最相关的几条，连同最新几条按表号顺序带进本轮输入。" :sections="sections">
    <UbSection id="dr-mode" title="用法" description="总开关在仪表盘的进阶开关里；两种用法共用下面的模型与召回设置。" icon="fa-solid fa-toggle-on">
      <UbRow label="用法" :hint="modeHint">
        <UbSegmented :options="modeOptions" :model-value="store.settings.mode" aria-label="决策召回用法" @update:model-value="setMode" />
      </UbRow>
      <UbCallout v-if="store.settings.mode === 'plot_task'" :kind="store.replaceStatus.kind">
        {{ store.replaceStatus.text }}
        <UbButton
          v-if="store.plotTaskStatus.plotEnabled && !store.settings.replacePlotRecallTasks"
          size="sm"
          icon="fa-solid fa-route"
          @click="routerStore.setActivePage('plot')"
        >去剧情推进页</UbButton>
      </UbCallout>
    </UbSection>

    <UbSection id="dr-model" title="决策模型" description="与正文替换的「替换前判定」各自独立；默认自己填接口地址、Key 与模型，也可以选三家预设。各家的设置各存各的，切换不会丢掉另一家的设置。" icon="fa-solid fa-scale-balanced">
      <UbRow label="服务商" :hint="providerView.providerHint">
        <UbSelect :options="providerOptions" :model-value="store.settings.provider" aria-label="决策召回服务商" @update:model-value="setProvider" />
      </UbRow>
      <UbCallout v-if="store.endpoint.missing" kind="warning">
        还没填 {{ store.endpoint.label }} {{ store.endpoint.missing }}：纪要多到需要挑选时，只会带上最新 5 条纪要，其余的不带；纪要不多时照常全部带上。
      </UbCallout>
      <UbRow
        v-if="store.settings.provider === 'custom'"
        label="接口地址"
        hint="填完整的决策接口地址，请求格式同硅基流动 /v1/systemone、OpenRouter /api/alpha/decisions（例如中转站提供的地址）。"
        stack
      >
        <UbInput
          :model-value="store.settings.customUrl"
          placeholder="https://example.com/v1/systemone"
          autocomplete="off"
          aria-label="决策接口地址"
          @change="store.patch({ customUrl: String($event) })"
        />
      </UbRow>
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
      <UbRow label="决策模型" :hint="modelHint" stack>
        <UbInput
          :key="`model-${store.settings.provider}-${inputKey}`"
          :model-value="store.endpoint.model"
          :placeholder="modelPlaceholder"
          autocomplete="off"
          aria-label="决策模型名"
          @change="setModelText"
        />
        <div v-if="store.settings.provider !== 'custom'" class="ub-dr__picker">
          <UbSelect
            :options="modelOptions"
            :model-value="store.endpoint.model"
            placeholder="从常用模型里选"
            aria-label="常用决策模型"
            @update:model-value="setModel"
          />
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
      <UbRow label="每组条数" :hint="`每次请求里放几条纪要（1–${maxBatchSize}）。条数少，模型看得更仔细，但请求更多，前文每次都要重发一遍。`">
        <UbInput
          :key="`batchSize-${inputKey}`"
          :model-value="store.settings.batchSize"
          type="number"
          :min="1"
          :max="maxBatchSize"
          :step="1"
          aria-label="每组条数"
          @change="setNumber('batchSize', $event)"
        />
      </UbRow>
      <UbRow label="判定次数" :hint="`同一组让决策模型判定几次，每条纪要取平均分（1–${maxJudgeRuns}）。次数越多越稳，请求数也成倍增加；失败的那几次不计入平均。`">
        <UbInput
          :key="`judgeRuns-${inputKey}`"
          :model-value="store.settings.judgeRuns"
          type="number"
          :min="1"
          :max="maxJudgeRuns"
          :step="1"
          aria-label="判定次数"
          @change="setNumber('judgeRuns', $event)"
        />
      </UbRow>
      <UbRow label="并发数" :hint="`决策召回自己同时发出几个请求（1–${maxConcurrency}），与其它功能无关。硅基流动等按每分钟 token 数限流的服务商并发太高会被限流。`">
        <UbInput
          :key="`concurrency-${inputKey}`"
          :model-value="store.settings.concurrency"
          type="number"
          :min="1"
          :max="maxConcurrency"
          :step="1"
          aria-label="并发数"
          @change="setNumber('concurrency', $event)"
        />
      </UbRow>
      <UbRow label="打分时看什么" hint="只看概要更省、更快；加上纪要正文判断更准，但每组输入多好几倍。">
        <UbSegmented :options="scoringOptions" :model-value="store.settings.scoringContent" aria-label="打分时看什么" @update:model-value="store.patch({ scoringContent: $event })" />
      </UbRow>
      <UbRow label="失败重试次数" :hint="`一组打分失败后再试几次（0–${maxRetries}）；Key 无效、没余额、超时这类重试也没用的错误不重试。整次召回最多 ${totalSeconds} 秒，仍失败或到时没打完的组跳过，从其余纪要里选，不会停掉发送。`">
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

    <UbSection id="dr-directive" title="注入指令" description="只用于单独召回：选中的编码写进本轮输入时用这段文字包裹。替换剧情推进任务时用预设自己的最终注入指令。" icon="fa-solid fa-quote-left" padded>
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
import { useRouterStore } from '../../presentation-v2/stores/router-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import { DECISION_RECALL_PROVIDER_LABELS_ACU } from '../../service/decision-recall/decision-recall-settings';
import { resolveDecisionRecallTotalTimeoutMs_ACU } from '../../service/decision-recall/decision-recall-runtime';
import {
  DECISION_RECALL_CODES_PLACEHOLDER_ACU,
  DECISION_RECALL_MAX_BATCH_SIZE_ACU,
  DECISION_RECALL_MAX_CONCURRENCY_ACU,
  DECISION_RECALL_MAX_JUDGE_RUNS_ACU,
  DECISION_RECALL_FIXED_RECENT_COUNT_ACU,
  DECISION_RECALL_MAX_COUNT_ACU,
  DECISION_RECALL_MAX_RETRIES_LIMIT_ACU,
  DECISION_RECALL_MAX_TOTAL_ACU,
  DEFAULT_AIHUBMIX_DECISION_MODEL_ACU,
  DEFAULT_DECISION_RECALL_DIRECTIVE_ACU,
  type DecisionRecallProvider_ACU,
} from '../../shared/decision-recall-defaults';
import { DEFAULT_DECISION_MODEL_ACU, DEFAULT_SILICONFLOW_DECISION_MODEL_ACU } from '../../shared/decision-gate-defaults';
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
import UbTextarea from '../ui/UbTextarea.vue';

const store = useDecisionRecallStore();
const routerStore = useRouterStore();
const toastStore = useToastStore();

const sections = [
  { id: 'dr-mode', label: '用法' },
  { id: 'dr-model', label: '决策模型' },
  { id: 'dr-rule', label: '召回规则' },
  { id: 'dr-directive', label: '注入指令' },
  { id: 'dr-test', label: '测试' },
];

const fixedCount = DECISION_RECALL_FIXED_RECENT_COUNT_ACU;
const maxCount = DECISION_RECALL_MAX_COUNT_ACU;
const maxTotal = DECISION_RECALL_MAX_TOTAL_ACU;
const maxRetries = DECISION_RECALL_MAX_RETRIES_LIMIT_ACU;
const maxBatchSize = DECISION_RECALL_MAX_BATCH_SIZE_ACU;
const maxJudgeRuns = DECISION_RECALL_MAX_JUDGE_RUNS_ACU;
const maxConcurrency = DECISION_RECALL_MAX_CONCURRENCY_ACU;
/** 总时限按判定次数放宽。 */
const totalSeconds = computed(() => Math.round(resolveDecisionRecallTotalTimeoutMs_ACU(store.settings.judgeRuns) / 1000));
const codesPlaceholder = DECISION_RECALL_CODES_PLACEHOLDER_ACU;
const ruleDescription = computed(() => `每组 ${store.settings.batchSize} 条纪要发一次请求、每组判定 ${store.settings.judgeRuns} 次取平均、最多同时 ${store.settings.concurrency} 个请求；`
  + '参考最近两楼 AI 回复和用户最新输入，不带世界书；按与接下来剧情发展的相关性分五档打分。交火开着时只从交火筛过的纪要里选。');

const modeOptions = [
  { value: 'standalone', label: '单独召回' },
  { value: 'plot_task', label: '替换剧情推进的任务' },
];
const modeHint = computed(() => (store.settings.mode === 'standalone'
  ? '发送前由决策召回挑选纪要写进本轮输入，剧情推进暂停（剧情推进页灰掉，它自己的开关不变）。'
  : '剧情推进照常运行；在剧情推进页打开「由决策召回执行 recall 任务」后，多任务预设里「标签摘取」只有 recall 的任务改由这里执行，没开时照常由剧情推进调模型召回。'));

const providerOptions = (Object.keys(DECISION_RECALL_PROVIDER_LABELS_ACU) as DecisionRecallProvider_ACU[])
  .map(value => ({ value, label: DECISION_RECALL_PROVIDER_LABELS_ACU[value] }));

const PROVIDER_VIEW_ACU: Record<DecisionRecallProvider_ACU, { providerHint: string; keyHint: string; keyPlaceholder: string; modelHint: string }> = {
  custom: {
    providerHint: '像交火那样自己填接口地址、Key 与模型；接口要兼容决策模型的请求格式。',
    keyHint: '服务商或中转站给的 Key；本地或不需要鉴权的接口可以留空。',
    keyPlaceholder: 'sk-...',
    modelHint: '',
  },
  siliconflow: {
    providerHint: '大陆服务商；SemIf 响应快。截至 2026 年 10 月 12 日决策模型仍免费，但官方写的限时免费期已过、何时收费没有通知，请留意账户扣费。',
    keyHint: '在 cloud.siliconflow.cn 的 API 密钥页面创建。',
    keyPlaceholder: 'sk-...',
    modelHint: 'Kev-4B 较慢，一组 20 条可能超时。',
  },
  openrouter: {
    providerHint: '按输入计费、输出不收费；单次文本超过约 32KB 会变慢、变不准，打分内容选「概要 + 纪要正文」且前文很长时留意。',
    keyHint: '在 openrouter.ai 的 Keys 页面创建。',
    keyPlaceholder: 'sk-or-...',
    modelHint: '标「免费」的不扣费；点刷新按钮拉取最新列表。',
  },
  aihubmix: {
    providerHint: '按输入计费、输出不收费（Jev 标价每百万输入 token 0.0462 美元）；Mammoth 1、Elephant 1 与 Decision Model Preview（Qwen）免费。',
    keyHint: '在 aihubmix.com 的 API 密钥页面创建。',
    keyPlaceholder: 'sk-...',
    modelHint: 'Mammoth 1、Elephant 1 上下文只有约 16K token：打分内容选「概要 + 纪要正文」、每组条数又多时容易超长，建议只看概要或把每组条数调小。',
  },
};
const providerView = computed(() => PROVIDER_VIEW_ACU[store.settings.provider]);

const KEY_FIELD_ACU: Record<DecisionRecallProvider_ACU, 'customApiKey' | 'siliconflowApiKey' | 'openrouterApiKey' | 'aihubmixApiKey'> = {
  custom: 'customApiKey',
  siliconflow: 'siliconflowApiKey',
  openrouter: 'openrouterApiKey',
  aihubmix: 'aihubmixApiKey',
};
const MODEL_FIELD_ACU: Record<DecisionRecallProvider_ACU, 'customModel' | 'siliconflowModel' | 'openrouterModel' | 'aihubmixModel'> = {
  custom: 'customModel',
  siliconflow: 'siliconflowModel',
  openrouter: 'openrouterModel',
  aihubmix: 'aihubmixModel',
};

/** 常用模型列表：只用来快速填入；填的模型名不在列表里时下拉显示占位文字。 */
const modelOptions = computed(() => store.activeModels.map(model => ({ value: model.id, label: model.free ? `${model.name}（免费）` : model.name })));
const DEFAULT_MODEL_ACU: Record<DecisionRecallProvider_ACU, string> = {
  custom: '',
  siliconflow: DEFAULT_SILICONFLOW_DECISION_MODEL_ACU,
  openrouter: DEFAULT_DECISION_MODEL_ACU,
  aihubmix: DEFAULT_AIHUBMIX_DECISION_MODEL_ACU,
};
const defaultModel = computed(() => DEFAULT_MODEL_ACU[store.settings.provider]);
const modelPlaceholder = computed(() => defaultModel.value || '例如 SemIf、jev-latest');
const modelHint = computed(() => (store.settings.provider === 'custom'
  ? '填接口支持的决策模型名。'
  : `直接填模型名，也可以从下面的常用模型里选；留空回到默认 ${defaultModel.value}。${providerView.value.modelHint}`));

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
/** 清空时规整回默认模型，与原值相同时输入框不会自己刷新：换 key 重绘。 */
function setModelText(value: string | number): void {
  setModel(String(value));
  inputKey.value += 1;
}

/** 清空或填超范围时规整后的值可能与原值相同，输入框不会自己刷新：换个 key 让它按规整后的值重绘。 */
const inputKey = ref(0);
function setNumber(key: 'recallCount' | 'maxRetries' | 'batchSize' | 'judgeRuns' | 'concurrency', value: string | number): void {
  store.patch({ [key]: value });
  inputKey.value += 1;
}

function setMode(value: string): void {
  if (!store.patch({ mode: value })) return;
  // 剧情推进入口随用法灰显 / 恢复
  routerStore.syncFeatureGatesFromSettings();
  toastStore.info(value === 'standalone'
    ? '已改为单独召回：剧情推进暂停。'
    : '已改为替换剧情推进的任务：剧情推进恢复运行，到剧情推进页打开「由决策召回执行 recall 任务」后才替换。');
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
