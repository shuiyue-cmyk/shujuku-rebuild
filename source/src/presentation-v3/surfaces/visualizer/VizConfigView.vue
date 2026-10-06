<template>
  <div class="ub-vconf" data-ub-viz-config>
    <UbSection title="基本信息" description="AI 按表名和列名理解字段；填表找错字段时先检查这里。">
      <UbRow label="表格名称">
        <UbInput
          :model-value="config.currentSheet.value?.name || ''"
          aria-label="表格名称"
          @update:model-value="value => config.renameSheet(String(value))"
        />
      </UbRow>
      <UbRow label="表级 API 预设" hint="只给这张表单独指定填表用的 API。">
        <UbSelect
          :model-value="config.currentTableApiPreset.value"
          :options="config.apiPresetOptions.value"
          aria-label="表级 API 预设"
          @update:model-value="config.setTableApiPreset"
        />
      </UbRow>
    </UbSection>

    <UbSection title="列定义" description="新增列时，已有数据行会自动补一个空值；删除列会连同所有行里的值一起删掉。">
      <template #actions>
        <UbButton size="sm" variant="soft" icon="fa-solid fa-plus" @click="emit('request-add-column')">新增列</UbButton>
      </template>
      <ol v-if="config.visibleColumnEntries.value.length" class="ub-vconf__cols">
        <li v-for="column in config.visibleColumnEntries.value" :key="`col-${column.columnIndex}`" class="ub-vconf__col">
          <span class="ub-vconf__col-no">{{ column.columnIndex + 1 }}</span>
          <UbInput
            :model-value="column.header"
            :aria-label="`第 ${column.columnIndex + 1} 列名称`"
            @update:model-value="value => config.updateHeader(column.columnIndex, String(value))"
          />
          <UbIconButton icon="fa-solid fa-trash" size="sm" variant="danger" title="删除列" @click="emit('request-delete-column', column.columnIndex)" />
        </li>
      </ol>
      <p v-else class="ub-vconf__empty">这张表还没有可编辑的列。</p>
    </UbSection>

    <UbSection title="自动更新参数" description="只影响这张表。填 -1 表示跟随全局设置；想让这张表不再自动更新，把更新频率设为 0。">
      <UbRow v-for="item in updateFields" :key="item.key" :label="item.label" :hint="item.hint">
        <span class="ub-vconf__num">
          <UbInput
            type="number"
            :model-value="updateConfig[item.key]"
            :min="-1"
            :step="1"
            :aria-label="item.label"
            @update:model-value="value => config.updateUpdateConfig(item.key, value)"
          />
        </span>
      </UbRow>
      <UbRow
        v-if="config.isSQLite.value"
        label="填表发送数据模板"
        hint="高级：只替换发给填表 AI 的“当前数据”部分。建议 SELECT row_id 和需要的字段，多列结果会展开成“字段: 值”。留空则按“发送最新行数”。"
        stack
      >
        <UbTextarea
          :model-value="updateConfig.sendRowsSqlTemplate"
          :rows="5"
          auto-resize
          mono
          :placeholder="sendRowsSqlPlaceholder"
          aria-label="填表发送数据模板"
          @update:model-value="value => config.updateUpdateConfig('sendRowsSqlTemplate', value)"
        />
      </UbRow>
    </UbSection>

    <UbSection title="AI 触发提示词" description="写给 AI 的表格说明和增删改时机。AI 不按预期新增、更新或删除时，先看这些文字是否清楚。">
      <UbRow v-for="item in promptFields" :key="item.key" :label="item.label" stack>
        <UbTextarea
          :model-value="sourceData[item.key]"
          :rows="item.rows"
          auto-resize
          :aria-label="item.label"
          @update:model-value="value => config.updateSourceData(item.key, value)"
        />
      </UbRow>
    </UbSection>

    <UbSection v-if="config.isSQLite.value" title="建表语句（DDL）" description="表头和 CREATE TABLE 不一致时，SQL 可能报错或写错列。">
      <UbRow stack>
        <UbTextarea
          :model-value="sourceData.ddl"
          :rows="7"
          auto-resize
          mono
          aria-label="CREATE TABLE 语句"
          @update:model-value="value => config.updateSourceData('ddl', value)"
        />
      </UbRow>
      <UbRow>
        <template #label>
          <UbBadge v-if="ddlValidation" :variant="ddlValidation.valid ? 'success' : 'warning'">{{ ddlValidation.message }}</UbBadge>
          <span v-else class="ub-vconf__muted">修改后建议校验一次</span>
        </template>
        <UbButton size="sm" icon="fa-solid fa-circle-check" @click="ddlValidation = config.validateDDL()">校验 DDL</UbButton>
      </UbRow>
    </UbSection>

    <UbSection title="世界书注入" description="控制这张表是否写进世界书、写成哪些条目、放在哪里。世界书内容缺失、重复或位置不对时检查这里。">
      <UbRow label="注入到世界书条目">
        <UbSwitch
          :model-value="exportConfig.injectIntoWorldbook !== false"
          aria-label="注入到世界书条目"
          @update:model-value="value => config.updateExportConfig('injectIntoWorldbook', value)"
        />
      </UbRow>
      <UbRow label="启用独立导出" hint="把这张表单独写成自己的世界书条目。">
        <UbSwitch
          :model-value="exportConfig.enabled === true"
          aria-label="启用独立导出"
          @update:model-value="value => config.updateExportConfig('enabled', value)"
        />
      </UbRow>
      <UbRow v-if="config.isSQLite.value" label="SQL 注入模板" stack>
        <UbTextarea
          :model-value="exportConfig.sqlInjectionTemplate || ''"
          :rows="4"
          auto-resize
          mono
          :placeholder="sqlInjectionPlaceholder"
          aria-label="SQL 注入模板"
          @update:model-value="value => config.updateExportConfig('sqlInjectionTemplate', value)"
        />
      </UbRow>

      <template v-if="exportConfig.enabled === true">
        <UbRow label="按行拆分成独立条目">
          <UbSwitch
            :model-value="exportConfig.splitByRow === true"
            aria-label="按行拆分成独立条目"
            @update:model-value="value => config.updateExportConfig('splitByRow', value)"
          />
        </UbRow>
        <UbRow label="防止递归触发">
          <UbSwitch
            :model-value="exportConfig.preventRecursion !== false"
            aria-label="防止递归触发"
            @update:model-value="value => config.updateExportConfig('preventRecursion', value)"
          />
        </UbRow>
        <UbRow label="条目名称">
          <UbInput
            :model-value="exportConfig.entryName || ''"
            aria-label="条目名称"
            @update:model-value="value => config.updateExportConfig('entryName', value)"
          />
        </UbRow>
        <UbRow label="条目类型">
          <UbSelect
            :model-value="exportConfig.entryType || 'constant'"
            :options="config.entryTypeOptions"
            aria-label="条目类型"
            @update:model-value="value => config.updateExportConfig('entryType', value)"
          />
        </UbRow>
        <UbRow label="关键词">
          <UbInput
            :model-value="exportConfig.keywords || ''"
            aria-label="关键词"
            @update:model-value="value => config.updateExportConfig('keywords', value)"
          />
        </UbRow>
        <UbRow label="自定义注入模板" stack>
          <UbTextarea
            :model-value="exportConfig.injectionTemplate || ''"
            :rows="3"
            auto-resize
            aria-label="自定义注入模板"
            @update:model-value="value => config.updateExportConfig('injectionTemplate', value)"
          />
        </UbRow>
        <VizPlacement
          title="主条目位置"
          :placement="config.getPlacement('entryPlacement')"
          :options="config.placementOptions"
          :update-field="(field, value) => config.updatePlacement('entryPlacement', field, value)"
        />
        <UbRow label="额外增加索引条目">
          <UbSwitch
            :model-value="exportConfig.extraIndexEnabled === true"
            aria-label="额外增加索引条目"
            @update:model-value="value => config.updateExportConfig('extraIndexEnabled', value)"
          />
        </UbRow>
        <template v-if="exportConfig.extraIndexEnabled">
          <UbRow label="索引条目名称">
            <UbInput
              :model-value="exportConfig.extraIndexEntryName || ''"
              aria-label="索引条目名称"
              @update:model-value="value => config.updateExportConfig('extraIndexEntryName', value)"
            />
          </UbRow>
          <UbRow label="索引条目模板" stack>
            <UbTextarea
              :model-value="exportConfig.extraIndexInjectionTemplate || ''"
              :rows="3"
              auto-resize
              aria-label="索引条目模板"
              @update:model-value="value => config.updateExportConfig('extraIndexInjectionTemplate', value)"
            />
          </UbRow>
          <UbRow label="索引包含的列" hint="勾选要写进索引的列，并选择它只进索引还是两边都写。" stack>
            <div class="ub-vconf__modes">
              <div v-for="column in config.visibleColumnEntries.value" :key="`xi-${column.columnIndex}`" class="ub-vconf__mode">
                <UbCheck
                  :model-value="extraIndexColumns.includes(column.header)"
                  :label="column.header"
                  @update:model-value="value => config.setExtraIndexColumn(column.header, value)"
                />
                <UbSelect
                  size="sm"
                  :disabled="!extraIndexColumns.includes(column.header)"
                  :model-value="extraIndexColumnModes[column.header] === 'index_only' ? 'index_only' : 'both'"
                  :options="config.extraIndexModeOptions"
                  :aria-label="`${column.header} 的索引方式`"
                  @update:model-value="value => config.setExtraIndexColumnMode(column.header, value === 'index_only' ? 'index_only' : 'both')"
                />
              </div>
            </div>
          </UbRow>
          <VizPlacement
            title="索引条目位置"
            :placement="config.getPlacement('extraIndexPlacement')"
            :options="config.placementOptions"
            :update-field="(field, value) => config.updatePlacement('extraIndexPlacement', field, value)"
          />
        </template>
      </template>
    </UbSection>

    <UbSection
      v-if="config.fixedConfigEnabled.value"
      title="固定条目位置"
      description="总结表、总体大纲、重要人物表等固定条目的位置。固定条目重复或顺序不对时检查这里。"
    >
      <VizPlacement
        title="固定主条目位置"
        :placement="config.getPlacement('fixedEntryPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updatePlacement('fixedEntryPlacement', field, value)"
      />
      <VizPlacement
        v-if="config.importantPersonsFixedIndexEnabled.value"
        title="固定索引条目位置"
        :placement="config.getPlacement('fixedIndexPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updatePlacement('fixedIndexPlacement', field, value)"
      />
    </UbSection>

    <UbSection
      v-if="config.specialIndex.value.enabled"
      title="编码自动编号"
      description="维护总结表、总体大纲里 AM0001 这类编码。打开后会自动重排；关闭后需要你自己保证唯一和顺序。"
    >
      <UbRow label="保存和 AI 更新时自动重排编码" :hint="specialIndexLabel">
        <UbSwitch
          :model-value="config.specialIndex.value.locked"
          aria-label="保存和 AI 更新时自动重排编码"
          @update:model-value="config.setSpecialIndexLock"
        />
      </UbRow>
    </UbSection>
  </div>
</template>

<script setup lang="ts">
/** 结构视图：表名、列、自动更新参数、AI 触发提示词、DDL、世界书注入、固定条目、编码编号。 */
import { computed, ref } from 'vue';
import { parseDDLColumnNames } from '../../../shared/ddl-utils';
import { useVisualizerConfigEditing } from '../../../presentation-v2/composables/visualizer/useVisualizerConfigEditing';
import UbBadge from '../../ui/UbBadge.vue';
import UbButton from '../../ui/UbButton.vue';
import UbCheck from '../../ui/UbCheck.vue';
import UbIconButton from '../../ui/UbIconButton.vue';
import UbInput from '../../ui/UbInput.vue';
import UbRow from '../../ui/UbRow.vue';
import UbSection from '../../ui/UbSection.vue';
import UbSelect from '../../ui/UbSelect.vue';
import UbSwitch from '../../ui/UbSwitch.vue';
import UbTextarea from '../../ui/UbTextarea.vue';
import VizPlacement from './VizPlacement.vue';

const emit = defineEmits<{
  (e: 'request-add-column'): void;
  (e: 'request-delete-column', index: number): void;
}>();

const config = useVisualizerConfigEditing();
const ddlValidation = ref<{ valid: boolean; message: string } | null>(null);
const sqlInjectionPlaceholder = '留空则使用默认表格内容。支持 {[sql "SELECT ..."]} / {[db.表名.where(...).get(...)]}，会原样写入世界书并在发送前展开。';

type UpdateKey = 'contextDepth' | 'updateFrequency' | 'batchSize' | 'groupId' | 'skipFloors' | 'sendLatestRows';
const updateFields: Array<{ key: UpdateKey; label: string; hint: string }> = [
  { key: 'contextDepth', label: '上下文层数', hint: '-1 跟随全局。' },
  { key: 'updateFrequency', label: '更新频率', hint: '每隔几层更新一次；-1 跟随全局，0 不自动更新这张表。' },
  { key: 'batchSize', label: '批处理大小', hint: '-1 跟随全局。' },
  { key: 'groupId', label: '分组编号', hint: '-1 不分组。' },
  { key: 'skipFloors', label: '跳过楼层', hint: '-1 跟随全局。' },
  { key: 'sendLatestRows', label: '发送最新行数', hint: '只把最新几行发给 AI；-1 全部发送。' },
];

type SourceKey = 'note' | 'initNode' | 'insertNode' | 'updateNode' | 'deleteNode';
const promptFields: Array<{ key: SourceKey; label: string; rows: number }> = [
  { key: 'note', label: '表格说明', rows: 3 },
  { key: 'initNode', label: '初始化触发', rows: 2 },
  { key: 'insertNode', label: '新增触发', rows: 2 },
  { key: 'updateNode', label: '更新触发', rows: 2 },
  { key: 'deleteNode', label: '删除触发', rows: 2 },
];

const updateConfig = computed(() => {
  const raw = config.currentSheet.value?.updateConfig || {};
  const num = (value: unknown) => (Number.isFinite(value) ? (value as number) : -1);
  return {
    contextDepth: num(raw.contextDepth),
    updateFrequency: num(raw.updateFrequency),
    batchSize: num(raw.batchSize),
    groupId: num(raw.groupId),
    skipFloors: num(raw.skipFloors),
    sendLatestRows: num(raw.sendLatestRows),
    sendRowsSqlTemplate: String(raw.sendRowsSqlTemplate || ''),
  };
});

const sourceData = computed(() => {
  const raw = config.currentSheet.value?.sourceData || {};
  return {
    note: String(raw.note || ''),
    initNode: String(raw.initNode || ''),
    insertNode: String(raw.insertNode || ''),
    updateNode: String(raw.updateNode || ''),
    deleteNode: String(raw.deleteNode || ''),
    ddl: String(raw.ddl || ''),
  };
});

const sendRowsSqlPlaceholder = computed(() => {
  const ddlColumns = parseDDLColumnNames(sourceData.value.ddl);
  const headers = ddlColumns.length > 0
    ? ddlColumns
    : (config.headers.value.length > 0 ? ['row_id', ...config.headers.value] : ['row_id']);
  const tableName = String(sourceData.value.ddl || '').match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i)?.[1] || 'your_table';
  return [
    `建议查询列：${headers.join(', ')}`,
    `展开格式示例：row_id: 1, ${headers.slice(1).map((header, index) => `${header}: 值${index + 1}`).join(', ')}`,
    '',
    '示例模板：',
    `{[sql "SELECT ${headers.join(', ')} FROM ${tableName} ORDER BY row_id ASC LIMIT 10"]}`,
  ].join('\n');
});

const exportConfig = computed<any>(() => config.exportConfig.value || {});
const extraIndexColumns = computed<string[]>(() =>
  (Array.isArray(exportConfig.value.extraIndexColumns) ? exportConfig.value.extraIndexColumns : []));
const extraIndexColumnModes = computed<Record<string, string>>(() =>
  (exportConfig.value.extraIndexColumnModes && typeof exportConfig.value.extraIndexColumnModes === 'object'
    ? exportConfig.value.extraIndexColumnModes
    : {}));

const specialIndexLabel = computed(() => {
  const info = config.specialIndex.value;
  if (info.index < 0) return '没有识别到编码列，将按默认方式处理。';
  return `识别到的编码列：第 ${info.index + 1} 列「${info.header || '未命名列'}」`;
});
</script>

<style scoped>
.ub-vconf {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s6);
  min-width: 0;
}

.ub-vconf__cols {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ub-vconf__col {
  display: flex;
  align-items: center;
  gap: var(--ub-s3);
  padding: var(--ub-s2) var(--ub-s3) var(--ub-s2) var(--ub-s4);
}

.ub-vconf__col + .ub-vconf__col {
  border-top: 1px solid var(--ub-line-soft);
}

.ub-vconf__col > :deep(.ub-field) {
  flex: 1 1 auto;
}

.ub-vconf__col-no {
  flex: 0 0 auto;
  min-width: 1.6em;
  color: var(--ub-text-3);
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
  text-align: right;
}

.ub-vconf__empty,
.ub-vconf__muted {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-vconf__empty {
  padding: var(--ub-s4);
}

.ub-vconf__num {
  display: block;
  width: calc(var(--ub-u) * 110);
}

.ub-vconf__modes {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
}

.ub-vconf__mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ub-s2) var(--ub-s3);
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
}

.ub-vconf__mode > :deep(.ub-select) {
  flex: 0 1 calc(var(--ub-u) * 220);
}
</style>
