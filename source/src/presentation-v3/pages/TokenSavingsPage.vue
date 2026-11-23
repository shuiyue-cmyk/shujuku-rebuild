<template>
  <UbPage :sections="sections">
    <template #lead>
      <div class="compression-intro">
        <p class="compression-intro__source">
          本功能参考论文
          <a href="https://arxiv.org/abs/2606.19857v1" target="_blank" rel="noopener noreferrer">《Large Language Models Do Not Always Need Readable Language》</a>
          中的 BabelTele 思路，让模型先将原文改写得更简短，再对照原文核验。
        </p>
        <UbCallout kind="warning">
          <strong>这是有损压缩。</strong> 即使通过模型核验，仍可能遗漏细节或改变原意。
        </UbCallout>
      </div>
    </template>
    <UbCallout v-if="settingsError" kind="error">{{ settingsError }}</UbCallout>
    <UbSection id="token-savings-settings" title="压缩设置" icon="fa-solid fa-sliders">
      <UbRow label="压缩 API 预设" hint="生成候选压缩文本时使用。">
        <UbSelect
          :options="presetOptions" :model-value="preferences.compressionPreset" aria-label="压缩 API 预设"
          @update:model-value="savePreferences({ compressionPreset: $event })"
        />
      </UbRow>
      <UbRow label="核验 API 预设" hint="对照原文核验候选文本时使用。">
        <UbSelect
          :options="presetOptions" :model-value="preferences.auditPreset" aria-label="核验 API 预设"
          @update:model-value="savePreferences({ auditPreset: $event })"
        />
      </UbRow>
      <UbRow
        label="自动压缩纪要表"
        hint="填表保存后，自动压缩本次新写入或改写的纪要。通过复核后会直接替换原文。切换聊天会取消尚未写入的压缩，保留原纪要。"
      >
        <UbSwitch
          :model-value="preferences.autoChronicle"
          aria-label="自动压缩纪要表"
          :disabled="changingAuto"
          @update:model-value="toggleAuto"
        />
      </UbRow>
      <UbRow label="压缩并发数" hint="手动或自动压缩时，每批最多同时处理的条目数。默认 2 条。">
        <UbInput
          v-model="concurrencyInput"
          type="number" :min="1" :step="1"
          aria-label="压缩并发数"
          @change="saveConcurrency"
        />
      </UbRow>
    </UbSection>

    <UbSection id="token-savings-manual" title="手动压缩" icon="fa-solid fa-compress" padded>
      <div class="manual">
        <UbCallout v-if="error" kind="error">{{ error }}</UbCallout>
        <template v-if="!previews">
          <UbSegmented v-model="source" :options="sources" aria-label="压缩内容来源" :disabled="busy" block />
          <UbRow v-if="source === 'worldbook'" label="酒馆世界书" stack>
            <UbSelect v-model="book" :options="bookOptions" aria-label="酒馆世界书" placeholder="选择一本世界书" :disabled="busy" />
          </UbRow>
          <UbCallout v-if="busy && progress" aria-live="polite">{{ progress }}</UbCallout>
          <UbCallout v-if="loading">正在读取内容…</UbCallout>
          <template v-else-if="items.length">
            <UbRow label="查找条目" stack>
              <UbInput v-model="query" aria-label="查找条目" placeholder="输入名称或原文片段" :disabled="busy" />
            </UbRow>
            <div class="selection">
              <span aria-live="polite">已选 {{ selected.size }} 条</span>
              <UbButton size="sm" :disabled="busy || !visibleSelectable.length" @click="toggleVisible">
                {{ visibleAllSelected ? '取消筛选内的勾选' : '勾选筛选结果' }}
              </UbButton>
              <UbButton size="sm" variant="ghost" :disabled="busy || !selected.size" @click="selected = new Set()">
                清空选择
              </UbButton>
            </div>
            <div v-if="visibleItems.length" class="item-list">
              <UbCheck
                v-for="item in visibleItems" :key="item.id"
                :model-value="selected.has(item.id)" :disabled="busy || !!item.blocked"
                @update:model-value="setSelected(item.id, $event)"
              >
                {{ item.label }} <span v-if="item.blocked" class="hint">· {{ item.blocked }}</span>
              </UbCheck>
            </div>
            <p v-else class="hint">没有匹配的条目。</p>
          </template>
          <UbCallout v-else-if="!error && (source === 'chronicle' || book)">
            {{ source === 'chronicle' ? '当前聊天没有可选的纪要。' : '这本世界书没有可选的条目。' }}
          </UbCallout>
          <UbCallout v-else-if="!error && !bookOptions.length">酒馆里没有可选的世界书。</UbCallout>
        </template>

        <template v-else>
          <UbCallout :kind="accepted.length ? 'info' : 'warning'">
            {{ accepted.length ? '已生成预览。勾选要替换的条目，展开查看前后对比。' : '这批没有可替换的结果，已保留原文。' }}
            <span v-if="includedTotals.before">
              已勾选 {{ included.size }} 条，{{ includedTotals.estimated ? '估算' : '按酒馆分词' }}
              {{ includedTotals.before }} → {{ includedTotals.after }} Token，节省 {{ savingsPercent(includedTotals.before, includedTotals.after) }}%。
            </span>
          </UbCallout>
          <div v-for="(preview, index) in previews" :key="preview.item.id" class="result">
            <UbCheck
              v-if="preview.candidate"
              :model-value="included.has(preview.item.id)" :label="'替换 ' + preview.item.label" :disabled="busy"
              @update:model-value="setIncluded(preview.item.id, $event)"
            />
            <details :open="index === 0 && !!preview.candidate">
              <summary>
                {{ preview.item.label }}
                <span class="hint">
                  {{ preview.candidate ? tokenLabel(preview.candidate) : '保留原文 · ' + preview.skipped }}
                </span>
              </summary>
              <div class="comparison">
                <section><h4>原文</h4><pre>{{ preview.item.original }}</pre></section>
                <section v-if="preview.candidate"><h4>压缩后</h4><pre>{{ preview.candidate.text }}</pre></section>
              </div>
            </details>
          </div>
        </template>

        <div class="actions">
          <UbButton v-if="controller" @click="controller.abort()">停止压缩</UbButton>
          <UbButton v-if="previews" :disabled="busy" @click="refreshSource">返回选择</UbButton>
          <UbButton v-if="previews" variant="danger" :disabled="busy || !included.size" @click="replace">
            确认替换压缩
          </UbButton>
          <UbButton v-else variant="primary" :disabled="busy || loading || !selected.size" @click="compress">
            压缩并预览
          </UbButton>
        </div>
      </div>
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { listWorldbookNamesLive_ACU, loadWorldbookFile_ACU, replaceWorldbookContentsIfUnchanged_ACU } from '../../data/gateways/worldbook-file-gateway';
import {
  listChronicleCompressionItems_ACU,
  replaceChronicleContentsIfUnchanged_ACU,
} from '../../presentation/bootstrap/api-groups/table-crud-api';
import { captureChatActionScope_ACU, isChatActionScopeCurrent_ACU } from '../../presentation-v2/composables/chat-action-scope';
import { useApiPresetSelectOptions } from '../../presentation-v2/composables/useApiPresetSelectOptions';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import {
  getWorldbookCompressionBlock_ACU,
  previewTokenSavingsBatch_ACU,
  resolveTokenSavingsPresets_ACU,
  type TokenSavingsCandidate_ACU,
  type TokenSavingsItem_ACU,
  type TokenSavingsPreview_ACU,
} from '../../service/optimization/token-savings';
import { readTokenSavingsSettings_ACU, type TokenSavingsSettings_ACU } from '../../service/optimization/token-savings-settings';
import {
  isDatabaseGeneratedLorebookEntry_ACU,
  parseExternalCustomTableExportMarker_ACU,
} from '../../service/worldbook/worldbook-placeholder-classification';
import { updateTokenSavingsSettings_UB } from '../composables/token-savings-settings';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbCheck from '../ui/UbCheck.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSegmented from '../ui/UbSegmented.vue';
import UbSelect from '../ui/UbSelect.vue';
import UbSwitch from '../ui/UbSwitch.vue';

const dialog = useDialogStore();
const toast = useToastStore();
const { apiStore, apiPresetSelectOptions, followActiveApiLabel } = useApiPresetSelectOptions();
const sections = [{ id: 'token-savings-settings', label: '压缩设置' }, { id: 'token-savings-manual', label: '手动压缩' }];
const preferences = shallowRef(readTokenSavingsSettings_ACU());
const concurrencyInput = ref<number | string>(preferences.value.concurrency);
const changingAuto = ref(false);
const settingsError = ref('');
const presetOptions = computed(() => {
  const available = apiPresetSelectOptions.value;
  const selectedNames = new Set([preferences.value.compressionPreset, preferences.value.auditPreset]);
  const missing = [...selectedNames].filter(name => name && !available.some(option => option.value === name));
  return [...available, ...missing.map(name => ({ value: name, label: name + '（已失效）' }))];
});
const sources = [{ value: 'chronicle', label: '当前纪要' }, { value: 'worldbook', label: '世界书' }];
const source = ref('chronicle');
const book = ref('');
const bookOptions = ref<{ value: string; label: string }[]>([]);
const items = shallowRef<TokenSavingsItem_ACU[]>([]);
const chronicle = shallowRef<ReturnType<typeof listChronicleCompressionItems_ACU>>(null);
const selected = shallowRef(new Set<string>());
const previews = shallowRef<TokenSavingsPreview_ACU[] | null>(null);
const included = shallowRef(new Set<string>());
const controller = shallowRef<AbortController | null>(null);
const query = ref('');
const loading = ref(false);
const busy = ref(false);
const progress = ref('');
const error = ref('');
let loadVersion = 0;

const visibleItems = computed(() => {
  const term = query.value.trim().toLowerCase();
  return term ? items.value.filter(item => (item.label + '\n' + item.original).toLowerCase().includes(term)) : items.value;
});
const visibleSelectable = computed(() => visibleItems.value.filter(item => !item.blocked));
const visibleAllSelected = computed(() => visibleSelectable.value.length > 0
  && visibleSelectable.value.every(item => selected.value.has(item.id)));
const accepted = computed(() => (previews.value ?? []).filter(result => result.candidate));
const includedTotals = computed(() => accepted.value.reduce((total, { item, candidate }) => {
  if (candidate && included.value.has(item.id)) {
    total.before += candidate.before;
    total.after += candidate.after;
    total.estimated ||= candidate.estimated;
  }
  return total;
}, { before: 0, after: 0, estimated: false }));

function setSelected(id: string, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) next.add(id);
  else next.delete(id);
  selected.value = next;
}

function setIncluded(id: string, checked: boolean): void {
  const next = new Set(included.value);
  if (checked) next.add(id);
  else next.delete(id);
  included.value = next;
}

function toggleVisible(): void {
  const next = new Set(selected.value);
  const remove = visibleAllSelected.value;
  for (const item of visibleSelectable.value) {
    if (remove) next.delete(item.id);
    else next.add(item.id);
  }
  selected.value = next;
}

async function readBookItems(name: string): Promise<TokenSavingsItem_ACU[]> {
  const data = await loadWorldbookFile_ACU(name);
  if (!data?.entries) throw new Error('世界书当前无法读取。');
  return Object.entries(data.entries).flatMap(([id, raw]): TokenSavingsItem_ACU[] => {
    const entry = raw as { uid?: number | string; content?: string; comment?: string; automationId?: string } | null;
    if (!entry || String(entry.uid) !== id || typeof entry.content !== 'string' || !entry.content.trim()) return [];
    const label = String(entry.comment || '').trim() || '条目 #' + id;
    const managed = isDatabaseGeneratedLorebookEntry_ACU(entry)
      || parseExternalCustomTableExportMarker_ACU(entry.comment)
      || label.startsWith('TavernDB-ACU-AgentGreenlight');
    const blocked = managed ? '数据库自动维护，已保护' : getWorldbookCompressionBlock_ACU(label, entry.content, entry.automationId);
    return [{ id, label, original: entry.content, blocked }];
  });
}

function assertOriginalsCurrent(
  selectedItems: readonly { id: string; original: string }[], current: TokenSavingsItem_ACU[],
): void {
  const byId = new Map(current.map(item => [item.id, item]));
  if (selectedItems.some(item => byId.get(item.id)?.original !== item.original || byId.get(item.id)?.blocked)) {
    throw new Error('所选原文或保护状态已变更，请重新读取后再试。');
  }
}

async function refreshSource(): Promise<void> {
  const version = ++loadVersion;
  previews.value = null;
  selected.value = new Set();
  included.value = new Set();
  query.value = '';
  error.value = '';
  items.value = [];
  chronicle.value = null;
  loading.value = true;
  try {
    if (source.value === 'chronicle') {
      chronicle.value = listChronicleCompressionItems_ACU();
      items.value = chronicle.value?.items ?? [];
      return;
    }
    const name = book.value;
    if (!name) {
      const names = await listWorldbookNamesLive_ACU();
      if (version === loadVersion) bookOptions.value = [...new Set(names)].map(value => ({ value, label: value }));
    } else {
      const entries = await readBookItems(name);
      if (version === loadVersion) items.value = entries;
    }
  } catch {
    if (version === loadVersion) error.value = '无法读取当前内容，请关闭后重新打开再试。';
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

watch([source, book], () => void refreshSource(), { immediate: true });
onMounted(() => apiStore.refreshFromSettings());
watchChatChanged_ACU(() => {
  apiStore.refreshFromSettings();
  preferences.value = readTokenSavingsSettings_ACU();
  concurrencyInput.value = preferences.value.concurrency;
  if (source.value !== 'chronicle') return;
  controller.value?.abort();
  void refreshSource();
});
onBeforeUnmount(() => {
  ++loadVersion;
  controller.value?.abort();
});

function savePreferences(patch: Partial<TokenSavingsSettings_ACU>): void {
  const result = updateTokenSavingsSettings_UB(patch);
  settingsError.value = result.ok ? '' : (result.message || '压缩设置保存失败。');
  preferences.value = readTokenSavingsSettings_ACU();
  concurrencyInput.value = preferences.value.concurrency;
}

async function toggleAuto(autoChronicle: boolean): Promise<void> {
  if (changingAuto.value) return;
  if (!autoChronicle) {
    savePreferences({ autoChronicle });
    return;
  }
  const version = loadVersion;
  changingAuto.value = true;
  try {
    const confirmed = await dialog.confirm({
      title: '启用纪要自动压缩',
      message: '各聊天后续填表保存的新增或改写纪要会交给「'
        + (preferences.value.compressionPreset || followActiveApiLabel.value) + '」压缩，并交给「'
        + (preferences.value.auditPreset || followActiveApiLabel.value) + '」核验。通过后会自动替换纪要原文。',
      dangerMessage: '自动替换后无法撤销。关闭开关可以停止后续压缩和替换。',
      confirmLabel: '启用自动压缩',
      confirmVariant: 'danger',
    });
    if (confirmed && version === loadVersion && readTokenSavingsSettings_ACU().enabled) {
      savePreferences({ autoChronicle });
    }
  } finally {
    changingAuto.value = false;
  }
}

function saveConcurrency(value: string | number): void {
  const concurrency = Number(value);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    settingsError.value = '并发数请输入大于等于 1 的整数。';
    concurrencyInput.value = preferences.value.concurrency;
    return;
  }
  savePreferences({ concurrency });
}

function savingsPercent(before: number, after: number): string {
  return ((1 - after / before) * 100).toFixed(1);
}

function tokenLabel(candidate: TokenSavingsCandidate_ACU): string {
  const { before, after, estimated } = candidate;
  return (estimated ? '约 ' : '') + before + ' → ' + after + ' Token';
}

async function compress(): Promise<void> {
  if (busy.value || loading.value) return;
  const chosen = items.value.filter(item => selected.value.has(item.id) && !item.blocked);
  if (!chosen.length) return;
  const target = source.value === 'worldbook' ? 'worldbook' : 'chronicle';
  const bookName = book.value;
  const scope = captureChatActionScope_ACU();
  const tableScope = chronicle.value?.scope;
  const version = loadVersion;
  busy.value = true;
  error.value = '';
  let signal: AbortSignal | undefined;
  try {
    const presets = resolveTokenSavingsPresets_ACU();
    const confirmed = await dialog.confirm({
      title: '生成压缩预览',
      message: '将把 ' + chosen.length + ' 条原文交给「' + (presets.compression.presetName || presets.compression.apiConfig.model)
        + '」压缩，并交给「' + (presets.audit.presetName || presets.audit.apiConfig.model)
        + '」核验。请在生成预览到确认替换期间保持原文不变。',
      dangerMessage: '现在只生成预览。之后一旦确认替换，原文无法通过此功能恢复。',
      confirmLabel: '开始压缩',
    });
    if (!confirmed || version !== loadVersion) return;
    const latestTable = target === 'chronicle' ? listChronicleCompressionItems_ACU() : null;
    if (target === 'chronicle' && (!isChatActionScopeCurrent_ACU(scope)
      || !latestTable || latestTable.scope.sheetKey !== tableScope?.sheetKey || latestTable.scope.column !== tableScope?.column)) {
      throw new Error('当前聊天或纪要表已变更，请重新打开此面板。');
    }
    const current = target === 'worldbook' ? await readBookItems(bookName) : latestTable?.items ?? [];
    assertOriginalsCurrent(chosen, current);
    if (version !== loadVersion) return;
    controller.value = new AbortController();
    signal = controller.value.signal;
    const results = await previewTokenSavingsBatch_ACU(
      chosen, target, presets, signal, readTokenSavingsSettings_ACU().concurrency,
      (completed, total) => { progress.value = '已完成 ' + completed + ' / ' + total + ' 条'; },
    );
    if (version !== loadVersion || signal.aborted) return;
    previews.value = results;
    included.value = new Set(results.filter(row => row.candidate).map(row => row.item.id));
  } catch (cause) {
    if (version === loadVersion && !signal?.aborted) {
      error.value = cause instanceof Error ? cause.message : '生成压缩预览失败。';
    }
  } finally {
    controller.value = null;
    progress.value = '';
    busy.value = false;
  }
}

async function replace(): Promise<void> {
  if (busy.value || !included.value.size) return;
  const changes = accepted.value.flatMap(({ item, candidate }) => candidate && included.value.has(item.id)
    ? [{ id: item.id, original: item.original, replacement: candidate.text }] : []);
  if (!changes.length) return;
  const scope = chronicle.value?.scope;
  const bookName = book.value;
  const isWorldbook = source.value === 'worldbook';
  const version = loadVersion;
  busy.value = true;
  error.value = '';
  try {
    const confirmed = await dialog.confirm({
      title: '确认替换原文',
      message: '将替换' + (isWorldbook ? '《' + bookName + '》' : '当前聊天的') + ' ' + changes.length + ' 条内容。',
      dangerMessage: '替换后无法撤销。请确认你已核对压缩结果，且生成预览后没有改过原文。',
      confirmLabel: '永久替换',
      confirmVariant: 'danger',
    });
    if (!confirmed || version !== loadVersion) return;
    if (isWorldbook) {
      assertOriginalsCurrent(changes, await readBookItems(bookName));
      if (version !== loadVersion) return;
      await replaceWorldbookContentsIfUnchanged_ACU(bookName, changes.map(({ id, ...change }) => ({ uid: id, ...change })));
    } else if (scope) {
      await replaceChronicleContentsIfUnchanged_ACU(scope, changes);
    } else {
      throw new Error('当前纪要表已变更，请重新生成预览。');
    }
    toast.success('已替换 ' + changes.length + ' 条压缩内容。', { muteable: false });
    if (version === loadVersion) await refreshSource();
  } catch (cause) {
    if (version === loadVersion) error.value = cause instanceof Error ? cause.message : '写入失败，请重新核对原文。';
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.compression-intro {
  display: grid;
  gap: var(--ub-s2);
}
.compression-intro__source {
  margin: 0;
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  line-height: 1.65;
}
.compression-intro__source a {
  color: var(--ub-accent-ink);
  text-decoration: underline;
}
.manual {
  display: grid;
  gap: var(--ub-s3);
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--ub-s2);
}
.selection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2);
}
.item-list {
  display: grid;
  gap: var(--ub-s3);
  max-height: min(calc(var(--tt-base-viewport-height, 100vh) * 0.48), calc(var(--ub-u) * 460));
  overflow-y: auto;
  padding: var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
}
.hint {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}
.result {
  display: grid;
  gap: var(--ub-s2);
  padding: var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
}
.result summary {
  cursor: pointer;
  overflow-wrap: anywhere;
}
.result summary .hint {
  margin-inline-start: var(--ub-s2);
}
.comparison {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ub-s3);
  margin-top: var(--ub-s2);
}
.comparison h4 {
  margin: 0 0 var(--ub-s1);
  font-size: var(--ub-fs-xs);
}
.comparison pre {
  max-height: 320px;
  margin: 0;
  padding: var(--ub-s2);
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--ub-sunken);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
}
@media (max-width: 650px) {
  .comparison {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
