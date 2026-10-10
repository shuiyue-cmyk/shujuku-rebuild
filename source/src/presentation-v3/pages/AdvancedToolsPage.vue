<template>
  <UbPage :sections="sections" wide>
    <UbSection id="at-sql" :title="copy.panels.sql.title" :description="copy.panels.sql.description" icon="fa-solid fa-terminal">
      <template #actions>
        <UbBadge :variant="sqlFlow.isSqliteAvailable.value ? 'success' : 'warning'">
          {{ sqlFlow.isSqliteAvailable.value ? 'SQLite 模式' : 'SQL 不可用' }}
        </UbBadge>
      </template>
      <div class="ub-at__sql">
        <div class="ub-at__row">
          <UbButton size="sm" variant="ghost" icon="fa-solid fa-list" :disabled="!!sqlFlow.busyAction.value" @click="sqlFlow.showTables">查看所有表</UbButton>
          <UbButton size="sm" variant="ghost" icon="fa-solid fa-sitemap" :disabled="!!sqlFlow.busyAction.value" @click="sqlFlow.showSchema">查看表结构</UbButton>
        </div>
        <div class="ub-at__editor" @keydown="onSqlEditorKeydown">
          <UbTextarea
            :model-value="sqlFlow.sqlText.value"
            :rows="8"
            mono
            placeholder="SELECT * FROM 表名;&#10;&#10;UPDATE 表名 SET 列名 = '新值' WHERE row_id = 1;"
            aria-label="SQL 语句"
            @update:model-value="sqlFlow.sqlText.value = $event"
          />
        </div>
        <div class="ub-at__row">
          <UbButton variant="primary" icon="fa-solid fa-play" :busy="sqlFlow.busyAction.value === 'execute'" :disabled="!sqlFlow.hasSqlText.value" @click="sqlFlow.executeCurrent">执行</UbButton>
          <UbButton variant="ghost" icon="fa-solid fa-eraser" :disabled="!sqlFlow.hasSqlText.value || !!sqlFlow.busyAction.value" @click="sqlFlow.clearSql">清空</UbButton>
          <span class="ub-at__hint">Ctrl / ⌘ + Enter 执行</span>
          <span class="ub-at__status" :class="`is-${sqlFlow.statusKind.value}`">{{ sqlFlow.statusLabel.value }}</span>
        </div>

        <div class="ub-at__result" aria-label="SQL 执行结果">
          <p v-if="sqlFlow.result.value.kind === 'idle'" class="ub-at__empty">执行 SQL 后结果会显示在这里</p>
          <UbCallout v-else-if="sqlFlow.result.value.kind === 'mutation'" kind="success">
            执行成功，{{ sqlFlow.result.value.changes }} 行受影响，耗时 {{ sqlFlow.result.value.elapsedMs }}ms。
          </UbCallout>
          <pre v-else-if="sqlFlow.result.value.kind === 'error'" class="ub-at__error">{{ sqlFlow.result.value.error }}</pre>
          <template v-else>
            <div class="ub-at__table-wrap">
              <table class="ub-at__table">
                <thead>
                  <tr><th v-for="column in sqlFlow.result.value.columns" :key="column">{{ column }}</th></tr>
                </thead>
                <tbody>
                  <tr v-if="!sqlFlow.result.value.values.length">
                    <td :colspan="Math.max(sqlFlow.result.value.columns.length, 1)" class="ub-at__empty">查询成功，没有返回行</td>
                  </tr>
                  <tr v-for="(row, rowIndex) in sqlFlow.result.value.values" :key="rowIndex">
                    <td v-for="(cell, cellIndex) in row" :key="cellIndex" :class="{ 'is-null': cell === null }">{{ formatSqlCell(cell) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="ub-at__meta">{{ sqlFlow.result.value.rowCount }} 行 · {{ sqlFlow.result.value.elapsedMs }}ms</p>
          </template>
        </div>

        <UbDisclosure label="执行历史" :meta="`${sqlFlow.history.value.length} 条`" :expanded="historyOpen" max-height="260px" @toggle="historyOpen = !historyOpen">
          <p v-if="!sqlFlow.history.value.length" class="ub-at__empty">暂无执行历史</p>
          <button
            v-for="(item, index) in sqlFlow.history.value"
            :key="`${item.timestamp}-${index}`"
            type="button"
            class="ub-at__history"
            :class="item.success ? 'is-ok' : 'is-fail'"
            title="填入编辑器"
            @click="sqlFlow.useHistoryItem(item)"
          >
            <span class="ub-at__history-meta">
              <span>{{ formatTime(item.timestamp) }}</span>
              <UbBadge :variant="item.success ? 'success' : 'danger'">{{ item.success ? '成功' : '失败' }}</UbBadge>
            </span>
            <code>{{ item.sql }}</code>
          </button>
        </UbDisclosure>
      </div>
    </UbSection>

    <UbSection id="at-logs" :title="copy.panels.logs.title" :description="copy.panels.logs.description" icon="fa-solid fa-scroll">
      <template #actions>
        <UbBadge :variant="logFlow.paused.value ? 'warning' : 'success'">{{ logFlow.statusLabel.value }}</UbBadge>
        <UbBadge :variant="logFlow.debugLogEnabled.value ? 'accent' : 'neutral'">{{ logFlow.debugLabel.value }}</UbBadge>
      </template>
      <div class="ub-at__logs">
        <div class="ub-at__filters">
          <UbSelect :options="logFlow.levelOptions" :model-value="logFlow.levelFilter.value" aria-label="日志级别" @update:model-value="logFlow.levelFilter.value = $event as LogLevelFilter" />
          <UbSelect :options="logFlow.tagOptions.value" :model-value="logFlow.tagFilter.value" aria-label="日志模块" @update:model-value="logFlow.tagFilter.value = $event" />
          <UbInput :model-value="logFlow.keyword.value" icon="fa-solid fa-magnifying-glass" placeholder="搜索日志内容" aria-label="搜索日志内容" @update:model-value="logFlow.keyword.value = String($event)" />
        </div>
        <div class="ub-at__row">
          <UbButton size="sm" :variant="logFlow.paused.value ? 'primary' : 'default'" :icon="logFlow.paused.value ? 'fa-solid fa-play' : 'fa-solid fa-pause'" @click="logFlow.setPaused(!logFlow.paused.value)">
            {{ logFlow.paused.value ? '继续' : '暂停' }}
          </UbButton>
          <UbButton size="sm" icon="fa-solid fa-upload" :disabled="!logFlow.totalCount.value" @click="logFlow.exportFiltered">导出</UbButton>
          <UbButton size="sm" variant="danger" icon="fa-solid fa-trash" :disabled="!logFlow.totalCount.value" @click="logFlow.clearAll">清空</UbButton>
          <span class="ub-at__spacer"></span>
          <label class="ub-at__switch">
            自动滚动
            <UbSwitch :model-value="logFlow.autoScroll.value" aria-label="自动滚动" @update:model-value="logFlow.autoScroll.value = $event" />
          </label>
        </div>
        <p class="ub-at__hint">
          最多保留最近 50000 条；列表只渲染最近 {{ logFlow.windowSizeLimit }} 条（{{ logFlow.hiddenByWindow.value ? `已折叠较早的 ${logFlow.hiddenByWindow.value} 条，` : '' }}当前显示 {{ logFlow.filteredCount.value }} / {{ logFlow.totalCount.value }} 条，导出仍取全部）。{{ logFlow.pendingCount.value ? `${logFlow.pendingCount.value} 条暂停期间新增日志等待显示。` : '' }}
        </p>
        <div ref="logListRef" class="ub-at__loglist" role="log" aria-live="polite">
          <p v-if="!logFlow.visibleLogs.value.length" class="ub-at__empty">暂无匹配日志</p>
          <div v-for="entry in logFlow.visibleLogs.value" :key="entry.id" class="ub-at__log" :class="`is-${entry.level}`">
            <div class="ub-at__log-meta">
              <span>{{ formatTime(entry.timestamp) }}</span>
              <UbBadge :variant="logLevelVariant(entry.level)">{{ entry.level.toUpperCase() }}</UbBadge>
              <span class="ub-at__log-tag">{{ entry.tag }}</span>
            </div>
            <code class="ub-at__log-msg">{{ entry.message }}</code>
            <details v-if="hintFor(entry)" class="ub-at__log-hint" :data-hint-id="hintFor(entry)!.id">
              <summary>
                <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
                <span>{{ hintFor(entry)!.summary }}</span>
                <span class="ub-at__log-hint-toggle">怎么处理</span>
              </summary>
              <ol>
                <li v-for="(step, stepIndex) in hintFor(entry)!.steps" :key="stepIndex">{{ step }}</li>
              </ol>
            </details>
          </div>
        </div>
      </div>
    </UbSection>

    <UbSection id="at-debug" :title="copy.panels.debug.title" :description="copy.panels.debug.description" icon="fa-solid fa-bug" padded>
      <template #actions>
        <UbBadge :variant="debugFlow.active.value ? 'danger' : 'neutral'">{{ debugFlow.statusLabel.value }}</UbBadge>
        <UbBadge v-if="debugFlow.active.value" variant="accent">已采集 {{ debugFlow.entryCount.value }} 条</UbBadge>
      </template>
      <ol class="ub-at__steps">
        <li>点「开始 Debug」（补开 debug / warn 采集，之前攒下的报错会一起保留导出）</li>
        <li>复现问题</li>
        <li>点「导出 Debug 数据」生成 .json 文件</li>
        <li>点「前往 GitHub 提交 issue」把文件作为附件提交；附件传不上时，先把文件传到你常用的网盘，再把分享链接（含提取码）贴进 issue。排查完记得「停止 Debug」。</li>
      </ol>
      <div class="ub-at__row">
        <UbButton :variant="debugFlow.active.value ? 'danger' : 'primary'" :icon="debugFlow.active.value ? 'fa-solid fa-stop' : 'fa-solid fa-bug'" @click="debugFlow.toggleDebug">
          {{ debugFlow.active.value ? '停止 Debug' : '开始 Debug' }}
        </UbButton>
        <UbButton icon="fa-solid fa-download" :disabled="!debugFlow.active.value" @click="debugFlow.exportDebugData">导出 Debug 数据</UbButton>
        <UbButton
          icon="fa-brands fa-github"
          :href="debugIssueUrl"
          title="在新标签页打开本插件的 GitHub issue 页面（已预填插件版本与上报清单，请附上导出的 Debug JSON）"
        >
          前往 GitHub 提交 issue
        </UbButton>
      </div>
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { buildDebugIssueUrl_ACU } from '../../presentation-v2/composables/debug-issue-link';
import { resolveLogErrorHint, type LogErrorHint } from '../../presentation-v2/composables/log-error-hints';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useDebugPanel } from '../../presentation-v2/composables/useDebugPanel';
import { useLogViewer, type LogLevelFilter } from '../../presentation-v2/composables/useLogViewer';
import { useSqlConsole } from '../../presentation-v2/composables/useSqlConsole';
import { advancedToolsCopy as copy } from '../../presentation-v2/copy/advanced-tools-copy';
import type { LogEntry, LogLevel } from '../../shared/log-buffer';
import UbBadge, { type UbBadgeVariant } from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbDisclosure from '../ui/UbDisclosure.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect from '../ui/UbSelect.vue';
import UbSwitch from '../ui/UbSwitch.vue';
import UbTextarea from '../ui/UbTextarea.vue';

const sqlFlow = useSqlConsole();
const logFlow = useLogViewer();
const debugFlow = useDebugPanel();
/** 版本号是构建期常量，链接只需算一次。 */
const debugIssueUrl = buildDebugIssueUrl_ACU();
const logListRef = ref<HTMLElement | null>(null);
const historyOpen = ref(false);

const sections = [
  { id: 'at-sql', label: copy.nav.sql },
  { id: 'at-logs', label: copy.nav.logs },
  { id: 'at-debug', label: copy.nav.debug },
];

/** 日志条目不可变：按 id 缓存处理建议，避免每次刷新对全部条目重跑规则。 */
const hintCache = new Map<number, LogErrorHint | null>();
function hintFor(entry: LogEntry): LogErrorHint | null {
  if (entry.level !== 'error') return null;
  let hint = hintCache.get(entry.id);
  if (hint === undefined) {
    hint = resolveLogErrorHint(entry);
    if (hintCache.size > 100_000) hintCache.clear();
    hintCache.set(entry.id, hint);
  }
  return hint;
}

function onSqlEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    sqlFlow.executeCurrent();
  }
}

function formatTime(timestamp: number): string {
  const time = new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${time}.${String(timestamp % 1000).padStart(3, '0')}`;
}

function formatSqlCell(value: string | number | Uint8Array | null): string {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) return `BLOB(${value.byteLength})`;
  return String(value);
}

function logLevelVariant(level: LogLevel): UbBadgeVariant {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  return 'accent';
}

async function scrollLogListToTop(): Promise<void> {
  if (!logFlow.autoScroll.value) return;
  await nextTick();
  if (logListRef.value) logListRef.value.scrollTop = 0;
}

onMounted(sqlFlow.refresh);
// 换聊天即清空上次结果与历史：旧行属于切换前的聊天，照着点历史会把数据写进新聊天
watchChatChanged_ACU(() => {
  sqlFlow.clearResult();
  sqlFlow.clearHistory();
});
watch(() => logFlow.visibleLogs.value.length, scrollLogListToTop, { flush: 'post' });
</script>

<style scoped>
.ub-at__sql,
.ub-at__logs {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
}

.ub-at__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2);
}

.ub-at__spacer {
  flex: 1 1 auto;
}

.ub-at__hint {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-at__status {
  margin-left: auto;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-at__status.is-success {
  color: var(--ub-ok);
}

.ub-at__status.is-error {
  color: var(--ub-danger);
}

.ub-at__result {
  min-width: 0;
}

.ub-at__empty {
  padding: var(--ub-s4);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  text-align: center;
}

.ub-at__error {
  margin: 0;
  padding: var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
  white-space: pre-wrap;
}

.ub-at__table-wrap {
  max-height: calc(var(--ub-u) * 420);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  overflow: auto;
}

.ub-at__table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
}

.ub-at__table th,
.ub-at__table td {
  max-width: 320px;
  padding: var(--ub-s1) var(--ub-s2);
  border-bottom: 1px solid var(--ub-line-soft);
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}

.ub-at__table th {
  position: sticky;
  top: 0;
  background: var(--ub-sunken);
  color: var(--ub-text-2);
  font-weight: 700;
}

.ub-at__table td.is-null {
  color: var(--ub-text-3);
  font-style: italic;
}

.ub-at__meta {
  margin-top: var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-at__history {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: var(--ub-s2);
  border: 0;
  border-left: 3px solid var(--ub-ok);
  border-radius: 6px;
  background: var(--ub-sunken);
  color: var(--ub-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ub-at__history.is-fail {
  border-left-color: var(--ub-danger);
}

.ub-at__history-meta {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-2xs);
}

.ub-at__history code {
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
  white-space: pre-wrap;
  word-break: break-all;
}

.ub-at__filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--ub-s2);
}

.ub-at__switch {
  display: inline-flex;
  align-items: center;
  gap: var(--ub-s2);
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-at__loglist {
  display: flex;
  flex-direction: column;
  max-height: calc(var(--ub-u) * 520);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  overflow-y: auto;
}

.ub-at__log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ub-s2) var(--ub-s3);
  border-bottom: 1px solid var(--ub-line-soft);
  border-left: 3px solid transparent;
}

.ub-at__log.is-error {
  border-left-color: var(--ub-danger);
}

.ub-at__log.is-warn {
  border-left-color: var(--ub-warn);
}

.ub-at__log-meta {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  color: var(--ub-text-3);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-2xs);
}

.ub-at__log-tag {
  color: var(--ub-text-2);
  font-weight: 700;
}

.ub-at__log-msg {
  color: var(--ub-text);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.ub-at__log-hint {
  margin-top: var(--ub-s1);
  padding: var(--ub-s2);
  border-radius: 6px;
  background: var(--ub-warn-soft);
  font-size: var(--ub-fs-xs);
}

.ub-at__log-hint summary {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  cursor: pointer;
  list-style: none;
}

.ub-at__log-hint summary i {
  color: var(--ub-warn);
}

.ub-at__log-hint-toggle {
  margin-left: auto;
  color: var(--ub-accent-ink);
  font-weight: 700;
}

.ub-at__log-hint ol {
  margin: var(--ub-s2) 0 0;
  padding-left: 1.4em;
}

.ub-at__steps {
  margin: 0;
  padding-left: 1.4em;
  color: var(--ub-text-2);
  font-size: var(--ub-fs-sm);
  line-height: 1.8;
}

@media (max-width: 640px) {
  .ub-at__filters {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .ub-at__filters > :last-child {
    grid-column: 1 / -1;
  }
}
</style>
