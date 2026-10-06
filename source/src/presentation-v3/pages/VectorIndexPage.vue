<template>
  <UbPage lead="向量召回增强记忆。发送前：关键词生成（可关）→ 用户输入与关键词合并向量化 → 向量与 BM25 混合召回 → 可选重排 → 按纪要原顺序写入索引条目。" :sections="sections">
    <UbSection id="vi-status" :title="copy.panels.status.title" :description="copy.panels.status.description" icon="fa-solid fa-signal">
      <template #actions>
        <UbBadge :variant="vector.statusVariant.value">{{ vector.statusLabel.value }}</UbBadge>
      </template>
      <UbStats :items="vector.statusStatsItems.value">
        <template #flushQueue>
          <span>{{ flushQueueText }}</span>
          <span v-if="flushQueueLastError" class="ub-vi__flush-error" :title="flushQueueLastError">{{ truncate(flushQueueLastError) }}</span>
        </template>
      </UbStats>
      <div class="ub-vi__actions">
        <UbButton
          variant="primary"
          icon="fa-solid fa-brain"
          :busy="vector.buildBusy.value"
          :disabled="vector.buildBusy.value || vector.maintenanceBusy.value"
          @click="vector.buildNow"
        >
          {{ vector.buildBusy.value ? '正在重建...' : '立即构建交火纪要索引' }}
        </UbButton>
        <UbButton :disabled="vector.maintenanceBusy.value || vector.buildBusy.value" icon="fa-solid fa-broom" @click="vector.clearIndexCache">清空临时缓存</UbButton>
        <UbButton variant="danger" :disabled="vector.maintenanceBusy.value || vector.buildBusy.value" icon="fa-solid fa-trash-can" @click="onDeleteCurrentIndex">删除当前索引</UbButton>
        <p class="ub-vi__note">检测到旧向量方案时会提示「向量方案已优化，需要重建」。链冲突与 checkpoint 指纹不匹配会自动修复，不弹确认。</p>
      </div>
    </UbSection>

    <UbSection id="vi-api" :title="copy.panels.api.title" :description="copy.panels.api.description" icon="fa-solid fa-server">
      <form id="ub-vector-api-form" @submit.prevent="saveVectorApiConfig">
        <div class="ub-vi__group">Embedding（必填）</div>
        <UbRow label="URL" stack>
          <UbInput v-model="vectorApiConfig.form.embeddingEndpoint" placeholder="https://example.com/embeddings" aria-label="Embedding URL" />
        </UbRow>
        <UbRow label="模型名" stack>
          <UbInput v-model="vectorApiConfig.form.embeddingModel" placeholder="text-embedding-3-large" aria-label="Embedding 模型名" />
        </UbRow>
        <UbRow label="API 密钥" stack>
          <UbInput v-model="vectorApiConfig.form.embeddingApiKey" type="password" autocomplete="off" aria-label="Embedding API 密钥" />
        </UbRow>
        <div class="ub-vi__group">Rerank（可选）</div>
        <UbRow label="URL" stack>
          <UbInput v-model="vectorApiConfig.form.rerankEndpoint" placeholder="https://example.com/rerank" aria-label="Rerank URL" />
        </UbRow>
        <UbRow label="模型名" stack>
          <UbInput v-model="vectorApiConfig.form.rerankModel" placeholder="bge-reranker-v2-m3" aria-label="Rerank 模型名" />
        </UbRow>
        <UbRow label="API 密钥" stack>
          <UbInput v-model="vectorApiConfig.form.rerankApiKey" type="password" autocomplete="off" aria-label="Rerank API 密钥" />
        </UbRow>
        <UbRow label="重排指令" hint="默认启用；清空后不向 Rerank 服务发送 instruction，可兼容不支持该字段的服务。" stack>
          <UbTextarea v-model="vectorApiConfig.form.rerankInstruction" :rows="3" placeholder="留空则不发送 instruction" aria-label="重排指令" />
        </UbRow>
        <UbRow
          label="每批条数"
          :hint="`候选超过该数时分批并行请求再合并分数。服务商单请求通常限 500 条以内，范围 ${RERANK_BATCH_SIZE_LIMITS.min}–${RERANK_BATCH_SIZE_LIMITS.max}，默认 ${RERANK_BATCH_SIZE_LIMITS.default}。`"
        >
          <UbInput
            :model-value="vectorApiConfig.form.rerankBatchSize"
            type="number"
            :min="RERANK_BATCH_SIZE_LIMITS.min"
            :max="RERANK_BATCH_SIZE_LIMITS.max"
            :step="10"
            aria-label="每批条数"
            @change="onRerankBatchSizeChange($event)"
          />
        </UbRow>
        <div class="ub-vi__save">
          <UbCallout v-if="vectorApiConfig.errors.value.length" kind="error">
            <p v-for="error in vectorApiConfig.errors.value" :key="error">{{ error }}</p>
          </UbCallout>
          <UbButton variant="primary" native-type="submit" icon="fa-solid fa-floppy-disk">保存向量服务</UbButton>
        </div>
      </form>
    </UbSection>

    <UbSection id="vi-keyword" :title="copy.panels.keyword.title" :description="copy.panels.keyword.description" icon="fa-solid fa-key">
      <UbRow label="AI 补充关键词" hint="开启时每次发送前多调用一次 AI 生成检索关键词；关闭后只用用户输入做召回，省一次往返。">
        <UbSwitch
          :model-value="vector.form.keywordGenerationEnabled"
          aria-label="发送前用 AI 补充检索关键词"
          @update:model-value="vector.setBooleanField('keywordGenerationEnabled', $event)"
        />
      </UbRow>
      <UbRow label="关键词 API 预设" hint="默认使用当前 API，仅用于发送前关键词生成。">
        <UbSelect
          :options="keywordApiOptions"
          :model-value="vector.form.keywordApiPreset"
          :placeholder="followActiveApiLabel"
          aria-label="关键词 API 预设"
          @update:model-value="vector.setApiField('keywordApiPreset', $event)"
        />
      </UbRow>
      <UbRow label="上下文读取层数" hint="关键词生成时读取的最近对话层数；1 层 = 1 条 AI 回复 + 其上方 1 条用户输入。">
        <UbInput :model-value="vector.form.keywordContextPairCount" type="number" :min="1" :step="1" aria-label="上下文读取层数" @change="vector.setNumberField('keywordContextPairCount', $event)" />
      </UbRow>
      <UbRow label="最大尝试次数" hint="关键词生成失败时回退到用户输入本身参与召回，不阻断发送。">
        <UbInput :model-value="vector.form.keywordGenerationMaxAttempts" type="number" :min="1" :step="1" aria-label="最大尝试次数" @change="vector.setNumberField('keywordGenerationMaxAttempts', $event)" />
      </UbRow>
      <UbRow :label="copy.panels.prompt.title" :hint="copy.panels.prompt.description">
        <template #label>
          {{ copy.panels.prompt.title }}
          <UbBadge :variant="vector.promptTemplateMode.value === 'default' ? 'neutral' : 'accent'">
            {{ vector.promptTemplateMode.value === 'default' ? '使用默认提示词' : '已自定义提示词' }}
          </UbBadge>
        </template>
        <UbButton size="sm" variant="soft" icon="fa-solid fa-pen-to-square" @click="promptSheetOpen = true">编辑提示词</UbButton>
      </UbRow>
      <div v-if="keywordPromptEmpty" class="ub-vi__pad">
        <UbCallout kind="warning">关键词生成提示词为空，发送前会直接用用户输入参与召回；建议载入默认提示词后保存。</UbCallout>
      </div>
    </UbSection>

    <UbSection id="vi-recall" :title="copy.panels.recall.title" :description="copy.panels.recall.description" icon="fa-solid fa-magnet">
      <UbRow label="混合召回" hint="开启后 BM25 稀疏召回与向量结果融合；关闭则只用向量召回。">
        <UbSwitch
          :model-value="vector.form.hybridRetrievalEnabled"
          aria-label="启用 BM25 混合召回"
          @update:model-value="vector.setBooleanField('hybridRetrievalEnabled', $event)"
        />
      </UbRow>
      <UbRow label="触发阈值" hint="纪要有效行数达标后，发送前生成关键词并召回分块；未达标则保留原索引流程。">
        <UbInput :model-value="vector.form.summaryIndexKeywordMinRows" type="number" :min="1" :step="1" aria-label="触发阈值" @change="vector.setNumberField('summaryIndexKeywordMinRows', $event)" />
      </UbRow>
      <UbRow label="TopK" hint="进入纪要索引目录的排序行数上限（固定注入的行另计）；候选不多于此数时跳过 Rerank。">
        <UbInput :model-value="vector.form.topK" type="number" :min="1" :step="1" aria-label="TopK" @change="vector.setNumberField('topK', $event)" />
      </UbRow>
      <UbRow label="预筛最低分" hint="Embedding 余弦分门槛，低于此分不进入候选池。默认 0.35。">
        <UbInput :model-value="vector.form.minScore" type="number" :min="0" :max="1" :step="0.01" aria-label="预筛最低分" @change="vector.setMinScore($event)" />
      </UbRow>
      <UbRow
        label="候选上限"
        :hint="vector.form.hybridRetrievalEnabled
          ? '向量与 BM25 各自保留的候选分片数，融合后的候选池上限；Rerank 会按每批条数自动分批。不能小于 TopK。'
          : '向量召回保留的候选分片数；混合召回已关闭。不能小于 TopK。'"
      >
        <UbInput :model-value="vector.form.recallCandidateLimit" type="number" :min="1" :step="1" aria-label="候选上限" @change="vector.setNumberField('recallCandidateLimit', $event)" />
      </UbRow>
      <UbRow label="固定写入" hint="最近 N 条纪要固定写入，不参与排序；计入触发阈值，不计入 TopK。">
        <UbInput
          :model-value="vector.form.recentFixedInjectCount"
          type="number"
          :min="1"
          :step="1"
          aria-label="固定写入"
          @update:model-value="vector.previewRecentFixedInjectCount($event)"
          @change="vector.setNumberField('recentFixedInjectCount', $event)"
        />
      </UbRow>
      <UbRow label="命名空间" hint="区分不同聊天的索引缓存，会拼接当前聊天标识。">
        <UbInput :model-value="vector.form.vectorNamespace" placeholder="chat" aria-label="命名空间" @change="vector.setApiField('vectorNamespace', $event)" />
      </UbRow>
    </UbSection>

    <UbSection id="vi-archive" :title="copy.panels.archive.title" :description="copy.panels.archive.description" icon="fa-solid fa-boxes-stacked">
      <UbRow label="按句切分纪要正文" hint="默认关闭：每行一个向量。开启后按句数切分，召回更细但分片成倍增加；改动后需重建索引。">
        <UbSwitch
          :model-value="vector.form.summaryIndexChunkChronicleBySentence"
          aria-label="切分纪要正文为多个分片"
          @update:model-value="vector.setBooleanField('summaryIndexChunkChronicleBySentence', $event)"
        />
      </UbRow>
      <UbRow label="分块句数" hint="仅在开启按句切分时生效：每个分片包含的句数。">
        <UbInput
          :model-value="vector.form.summaryChunkSentenceCount"
          type="number"
          :min="1"
          :step="1"
          :disabled="!vector.form.summaryIndexChunkChronicleBySentence"
          aria-label="分块句数"
          @change="vector.setNumberField('summaryChunkSentenceCount', $event)"
        />
      </UbRow>
      <UbRow label="单请求最多行数" hint="单个 embedding 请求最多覆盖的纪要行数；与字符预算共同限制请求大小。">
        <UbInput :model-value="vector.form.summaryIndexArchiveMaxConcurrency" type="number" :min="1" :step="1" aria-label="单请求最多行数" @change="vector.setNumberField('summaryIndexArchiveMaxConcurrency', $event)" />
      </UbRow>
      <UbRow label="单请求字符预算" hint="单个 embedding 请求的本地输入字符上限，不等同于服务商 token 限制。">
        <UbInput :model-value="vector.form.summaryIndexArchiveMaxInputChars" type="number" :min="1" :step="1" aria-label="单请求字符预算" @change="vector.setNumberField('summaryIndexArchiveMaxInputChars', $event)" />
      </UbRow>
      <UbRow label="同时请求数" hint="最多同时进行的 embedding 请求；设为 1 即串行。">
        <UbInput :model-value="vector.form.summaryIndexArchiveEmbeddingConcurrency" type="number" :min="1" :step="1" aria-label="同时请求数" @change="vector.setNumberField('summaryIndexArchiveEmbeddingConcurrency', $event)" />
      </UbRow>
    </UbSection>

    <PromptSegmentsSheet
      :is-open="promptSheetOpen"
      title="编辑关键词生成提示词"
      :segments="promptSegmentsForView"
      :dirty="vector.promptDirty.value"
      :message="vector.message.value"
      :show-slot="false"
      :allow-import-export="false"
      :role-options="ROLE_OPTIONS"
      dirty-confirm-message="你有未保存的关键词生成提示词修改，确定要关闭吗？"
      @close="promptSheetOpen = false"
      @save="vector.savePromptGroup"
      @reset="vector.resetPromptGroup"
      @add="vector.addPromptSegment($event)"
      @delete="vector.deletePromptSegment($event)"
      @update="onPromptUpdate"
    />
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApiPresetSelectOptions } from '../../presentation-v2/composables/useApiPresetSelectOptions';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useUiCloseGuard } from '../../presentation-v2/composables/useUiCloseGuard';
import { RERANK_BATCH_SIZE_LIMITS, useVectorApiConfig } from '../../presentation-v2/composables/useVectorApiConfig';
import { useVectorIndexConfig } from '../../presentation-v2/composables/useVectorIndexConfig';
import { vectorIndexCopy as copy } from '../../presentation-v2/copy/vector-index-copy';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import PromptSegmentsSheet from '../parts/PromptSegmentsSheet.vue';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import type { UbPromptSegment } from '../ui/UbPromptSegments.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect, { type UbSelectOption } from '../ui/UbSelect.vue';
import UbStats from '../ui/UbStats.vue';
import UbSwitch from '../ui/UbSwitch.vue';
import UbTextarea from '../ui/UbTextarea.vue';

const ROLE_OPTIONS: UbSelectOption[] = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];
const FLUSH_ERROR_MAX_CHARS = 60;

const dialogStore = useDialogStore();
const vector = useVectorIndexConfig();
const vectorApiConfig = useVectorApiConfig();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: keywordApiOptions } = useApiPresetSelectOptions();
const promptSheetOpen = ref(false);

const sections = [
  { id: 'vi-status', label: copy.nav.status },
  { id: 'vi-api', label: copy.nav.api },
  { id: 'vi-keyword', label: copy.nav.keyword },
  { id: 'vi-recall', label: copy.nav.recall },
  { id: 'vi-archive', label: copy.nav.archive },
];

const flushQueueText = computed(() => {
  const s = vector.indexStats.value;
  const waiting = (s?.flushTaskDirtyCount || 0) + (s?.flushTaskQueuedCount || 0) + (s?.flushTaskFlushingCount || 0);
  return `${waiting} 等待 / ${s?.flushTaskFailedCount || 0} 失败`;
});
const flushQueueLastError = computed(() => String(vector.indexStats.value?.flushTaskLastError || '').trim());

const promptSegmentsForView = computed<UbPromptSegment[]>(() =>
  vector.promptSegments.value.map(seg => ({ role: seg.role, content: seg.content, deletable: seg.deletable })),
);
const keywordPromptEmpty = computed(() => vector.promptSegments.value.every(seg => !String(seg.content || '').trim()));

function truncate(text: string): string {
  return text.length > FLUSH_ERROR_MAX_CHARS ? `${text.slice(0, FLUSH_ERROR_MAX_CHARS)}…` : text;
}

function onPromptUpdate(index: number, patch: Partial<UbPromptSegment>): void {
  vector.updatePromptSegment(index, {
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
  });
}

function saveVectorApiConfig(): void {
  if (vectorApiConfig.save()) vector.refresh();
}

function onRerankBatchSizeChange(raw: string | number): void {
  const value = Math.floor(Number(raw));
  vectorApiConfig.form.rerankBatchSize = Number.isFinite(value) && value > 0
    ? Math.min(RERANK_BATCH_SIZE_LIMITS.max, Math.max(RERANK_BATCH_SIZE_LIMITS.min, value))
    : RERANK_BATCH_SIZE_LIMITS.default;
}

async function onDeleteCurrentIndex(): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: '删除当前索引',
    message: '删除当前聊天的交火索引？这会移除索引引用并清理可回收外置资产，之后需要重新构建。',
    confirmLabel: '删除索引',
    confirmVariant: 'danger',
  });
  if (confirmed) void vector.deleteCurrentIndex();
}

function refreshAll(): void {
  vector.refresh();
  vectorApiConfig.refresh();
  void vector.refreshIndexStatus(false);
  apiStore.refreshFromSettings();
}

onMounted(refreshAll);
watchChatChanged_ACU(refreshAll);
useUiCloseGuard(() => {
  if (!promptSheetOpen.value || !vector.promptDirty.value) return true;
  return dialogStore.confirm({
    title: '关闭 UnbirthDB',
    message: '你有未保存的关键词生成提示词修改，确定要关闭吗？',
    confirmLabel: '仍然关闭',
    confirmVariant: 'danger',
  });
});
</script>

<style scoped>
.ub-vi__flush-error {
  display: block;
  color: var(--ub-danger);
  font-size: var(--ub-fs-2xs);
}

.ub-vi__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s2);
  padding: var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
}

.ub-vi__note {
  flex-basis: 100%;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-vi__group {
  padding: var(--ub-s3) var(--ub-s4) var(--ub-s1);
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-2xs);
  font-weight: 800;
  letter-spacing: 0.06em;
}

.ub-vi__group:first-child {
  border-top: 0;
}

.ub-vi__save {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4) var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
}

.ub-vi__save > :first-child:not(:last-child) {
  align-self: stretch;
}

.ub-vi__pad {
  padding: 0 var(--ub-s4) var(--ub-s3);
}
</style>
