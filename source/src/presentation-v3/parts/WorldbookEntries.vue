<template>
  <div class="ub-wbe">
    <div class="ub-wbe__toolbar">
      <UbInput
        class="ub-wbe__search"
        :model-value="filter"
        icon="fa-solid fa-magnifying-glass"
        placeholder="搜索条目..."
        aria-label="搜索条目"
        @update:model-value="emit('update:filter', String($event))"
      />
      <div class="ub-wbe__actions">
        <template v-if="showEntryToggle">
          <UbButton size="sm" variant="ghost" @click="emit('select-all', filterScope())">全选</UbButton>
          <UbButton size="sm" variant="ghost" @click="emit('deselect-all', filterScope())">全不选</UbButton>
        </template>
        <template v-if="showSkillifyControls">
          <UbButton size="sm" variant="ghost" @click="emit('skillify-select-all', filterScope())">Skill 全选</UbButton>
          <UbButton size="sm" variant="ghost" @click="emit('skillify-deselect-all', filterScope())">Skill 全不选</UbButton>
          <UbButton size="sm" variant="soft" icon="fa-solid fa-wand-sparkles" @click="emit('skillify-selected')">对所选 Skill 化</UbButton>
        </template>
      </div>
    </div>

    <p v-if="loading" class="ub-wbe__status">正在加载条目...</p>
    <p v-else-if="status === 'error'" class="ub-wbe__status is-error" role="alert">{{ error || '加载条目失败' }}</p>
    <p v-else-if="groups.length === 0" class="ub-wbe__status">{{ emptyText }}</p>
    <div v-else class="ub-wbe__groups">
      <UbDisclosure
        v-for="(group, index) in filteredGroups"
        :key="group.bookName"
        :label="group.bookName"
        :meta="groupMeta(group)"
        :expanded="group.expanded"
        :body-id="`${idPrefix}-wb-group-${index}`"
        max-height="320px"
        @toggle="emit('toggle-group', group.bookName)"
      >
        <div
          v-for="entry in visibleEntriesOf(group)"
          :key="`${group.bookName}-${entry.uid}`"
          class="ub-wbe__entry"
          :class="{ 'is-disabled': entry.disabled }"
        >
          <div class="ub-wbe__entry-main">
            <UbCheck
              v-if="showEntryToggle"
              :model-value="entry.checked"
              :label="entry.label"
              :title="entry.label"
              :disabled="entry.disabled"
              @update:model-value="emit('toggle', entry.bookName, entry.uid, $event)"
            />
            <span v-else class="ub-wbe__label" :title="entry.label">{{ entry.label }}</span>
            <span class="ub-wbe__tags">
              <UbBadge v-if="showSkillifyControls && entry.skillMeta" variant="accent">Skill</UbBadge>
              <UbBadge v-if="entry.isConstant">常量</UbBadge>
              <UbBadge v-if="showAgentTakeoverState && takeoverLabel(entry)" :variant="takeoverVariant(entry)">{{ takeoverLabel(entry) }}</UbBadge>
            </span>
          </div>
          <div v-if="showSkillifyControls" class="ub-wbe__skill-row">
            <UbCheck
              :model-value="entry.skillifySelected"
              label="Skill 化"
              :disabled="entry.disabled || !entry.skillifySelectable"
              @update:model-value="emit('toggle-skillify', entry.bookName, entry.uid, $event)"
            />
            <UbButton v-if="showSkillEditor" size="sm" variant="ghost" @click="toggleSkillEditor(entry)">
              {{ isSkillEditorOpen(entry) ? '收起 Skill' : '编辑 Skill' }}
            </UbButton>
          </div>
          <div v-if="showSkillEditor && isSkillEditorOpen(entry)" class="ub-wbe__skill">
            <UbTextarea
              :model-value="getSkillDraft(entry).description"
              label="Skill 描述"
              placeholder="描述该世界书条目的用途，留空则不写入 Skill 元数据。"
              :rows="2"
              :max-rows="6"
              auto-resize
              @update:model-value="patchSkillDraft(entry, { description: $event })"
            />
            <UbTextarea
              :model-value="getSkillDraft(entry).triggerWhen"
              label="触发时机"
              placeholder="说明 Agent 何时应选择该条目，留空则不写入 Skill 元数据。"
              :rows="2"
              :max-rows="6"
              auto-resize
              @update:model-value="patchSkillDraft(entry, { triggerWhen: $event })"
            />
            <div class="ub-wbe__skill-actions">
              <UbButton size="sm" variant="danger" @click="emit('delete-skill', entry.bookName, entry.uid)">删除 Skill</UbButton>
              <UbButton size="sm" variant="primary" @click="saveSkill(entry)">保存 Skill</UbButton>
            </div>
          </div>
        </div>
        <UbButton v-if="hiddenCountOf(group) > 0" size="sm" variant="ghost" @click="showMore(group.bookName)">
          加载更多（剩余 {{ hiddenCountOf(group) }} 条）
        </UbButton>
      </UbDisclosure>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 世界书条目列表（填表 / 剧情推进 / Agent 三页共用）。
 * 大分组分页：一次只渲染 200 条，按需加载更多；只有筛选词变化才重置分页。
 */
import { computed, reactive, watch } from 'vue';
import type {
  WorldbookEntryDisplayGroup_ACU,
  WorldbookEntryDisplayItem_ACU,
} from '../../presentation-v2/composables/worldbook-entry-display';
import UbBadge, { type UbBadgeVariant } from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCheck from '../ui/UbCheck.vue';
import UbDisclosure from '../ui/UbDisclosure.vue';
import UbInput from '../ui/UbInput.vue';
import UbTextarea from '../ui/UbTextarea.vue';
import type { WorldbookEntryScope_ACU } from '../../presentation-v2/composables/worldbook-entry-scope';

interface SkillDraft {
  description: string;
  triggerWhen: string;
}

const props = withDefaults(defineProps<{
  groups: WorldbookEntryDisplayGroup_ACU[];
  filter: string;
  loading: boolean;
  status?: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  emptyText?: string;
  idPrefix?: string;
  showEntryToggle?: boolean;
  showSkillifyControls?: boolean;
  showAgentTakeoverState?: boolean;
  showSkillEditor?: boolean;
}>(), {
  status: 'success',
  error: '',
  emptyText: '所选世界书中无可显示的条目。',
  idPrefix: 'ub',
  showEntryToggle: true,
  showSkillifyControls: false,
  showAgentTakeoverState: false,
  showSkillEditor: false,
});

const emit = defineEmits<{
  (e: 'update:filter', value: string): void;
  (e: 'select-all', scope: WorldbookEntryScope_ACU): void;
  (e: 'deselect-all', scope: WorldbookEntryScope_ACU): void;
  (e: 'skillify-select-all', scope: WorldbookEntryScope_ACU): void;
  (e: 'skillify-deselect-all', scope: WorldbookEntryScope_ACU): void;
  (e: 'skillify-selected'): void;
  (e: 'toggle', bookName: string, uid: number, checked: boolean): void;
  (e: 'toggle-skillify', bookName: string, uid: number, checked: boolean): void;
  (e: 'toggle-group', bookName: string): void;
  (e: 'save-skill', bookName: string, uid: number, draft: SkillDraft): void;
  (e: 'delete-skill', bookName: string, uid: number): void;
}>();

const PAGE_SIZE = 200;
const visibleCount = reactive<Record<string, number>>({});
const skillEditorOpen = reactive<Record<string, boolean>>({});
const skillDrafts = reactive<Record<string, SkillDraft>>({});

watch(() => props.filter, () => {
  for (const key of Object.keys(visibleCount)) delete visibleCount[key];
});

watch(() => props.groups, (groups) => {
  const live = new Set((groups || []).map(g => g.bookName));
  for (const key of Object.keys(visibleCount)) if (!live.has(key)) delete visibleCount[key];
});

const filteredGroups = computed(() => {
  const q = props.filter.trim().toLowerCase();
  if (!q) return props.groups;
  return props.groups
    .map((g) => {
      if (g.bookName.toLowerCase().includes(q)) return g;
      const entries = g.entries.filter(e => e.label.toLowerCase().includes(q) || e.bookName.toLowerCase().includes(q));
      return entries.length ? { ...g, entries, expanded: true } : null;
    })
    .filter((g): g is WorldbookEntryDisplayGroup_ACU => g !== null);
});

/** R10B-05：有搜索词时批量按钮只作用于筛选结果；无搜索词时返回 null 表示全部。 */
function filterScope(): WorldbookEntryScope_ACU {
  if (!props.filter.trim()) return null;
  return filteredGroups.value.flatMap(group => group.entries.map(entry => ({ bookName: group.bookName, uid: entry.uid })));
}

function visibleEntriesOf(group: WorldbookEntryDisplayGroup_ACU): WorldbookEntryDisplayItem_ACU[] {
  return group.entries.slice(0, visibleCount[group.bookName] ?? PAGE_SIZE);
}

function hiddenCountOf(group: WorldbookEntryDisplayGroup_ACU): number {
  return Math.max(0, group.entries.length - (visibleCount[group.bookName] ?? PAGE_SIZE));
}

function showMore(bookName: string): void {
  visibleCount[bookName] = (visibleCount[bookName] ?? PAGE_SIZE) + PAGE_SIZE;
}

function groupMeta(group: WorldbookEntryDisplayGroup_ACU): string {
  let checked = 0;
  let skills = 0;
  let controlled = 0;
  for (const entry of group.entries) {
    if (props.showEntryToggle && entry.checked) checked += 1;
    if (entry.hasSkill) skills += 1;
    if (entry.agentTakeoverState === 'taken_over' || entry.agentTakeoverState === 'final_greenlight') controlled += 1;
  }
  const prefix = props.showEntryToggle ? `${checked}/${group.entries.length} 条` : `${group.entries.length} 条`;
  const suffix = [
    props.showSkillifyControls && skills > 0 ? `Skill ${skills}` : '',
    props.showAgentTakeoverState && controlled > 0 ? `接管 ${controlled}` : '',
  ].filter(Boolean).join(' · ');
  return suffix ? `${prefix} · ${suffix}` : prefix;
}

function takeoverLabel(entry: WorldbookEntryDisplayItem_ACU): string {
  const state = entry.agentTakeoverState;
  if (state === 'initial_disabled') return '原本关闭';
  if (entry.isConstant && state === 'native') return '';
  if (state === 'native') return '原生逻辑';
  if (state === 'skill_ready') return '可接管';
  if (state === 'taken_over') return 'Agent 接管';
  if (state === 'final_greenlight') return '正文放行';
  return '';
}

function takeoverVariant(entry: WorldbookEntryDisplayItem_ACU): UbBadgeVariant {
  const state = entry.agentTakeoverState;
  if (state === 'taken_over') return 'accent';
  if (state === 'final_greenlight') return 'success';
  if (state === 'skill_ready') return 'warning';
  return 'neutral';
}

function entryKey(entry: WorldbookEntryDisplayItem_ACU): string {
  return `${entry.bookName}::${entry.uid}`;
}

function buildSkillDraft(entry: WorldbookEntryDisplayItem_ACU): SkillDraft {
  return { description: entry.skillMeta?.description ?? '', triggerWhen: entry.skillMeta?.triggerWhen ?? '' };
}

function getSkillDraft(entry: WorldbookEntryDisplayItem_ACU): SkillDraft {
  const key = entryKey(entry);
  if (!skillDrafts[key]) skillDrafts[key] = buildSkillDraft(entry);
  return skillDrafts[key];
}

function patchSkillDraft(entry: WorldbookEntryDisplayItem_ACU, patch: Partial<SkillDraft>): void {
  skillDrafts[entryKey(entry)] = { ...getSkillDraft(entry), ...patch };
}

function isSkillEditorOpen(entry: WorldbookEntryDisplayItem_ACU): boolean {
  return !!skillEditorOpen[entryKey(entry)];
}

function toggleSkillEditor(entry: WorldbookEntryDisplayItem_ACU): void {
  const key = entryKey(entry);
  skillEditorOpen[key] = !skillEditorOpen[key];
  if (skillEditorOpen[key]) skillDrafts[key] = buildSkillDraft(entry);
}

function saveSkill(entry: WorldbookEntryDisplayItem_ACU): void {
  emit('save-skill', entry.bookName, entry.uid, { ...getSkillDraft(entry) });
}
</script>

<style scoped>
.ub-wbe {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  min-width: 0;
}

.ub-wbe__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2);
}

.ub-wbe__search {
  flex: 1 1 calc(var(--ub-u) * 200);
}

.ub-wbe__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s1);
}

.ub-wbe__status {
  padding: var(--ub-s4);
  border: 1px dashed var(--ub-line);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  text-align: center;
}

.ub-wbe__status.is-error {
  border-color: var(--ub-danger);
  color: var(--ub-danger);
}

.ub-wbe__groups {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
}

.ub-wbe__entry {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  padding: var(--ub-s1) 0;
}

.ub-wbe__entry + .ub-wbe__entry {
  border-top: 1px dashed var(--ub-line-soft);
  padding-top: var(--ub-s2);
}

.ub-wbe__entry.is-disabled {
  opacity: 0.6;
}

.ub-wbe__entry-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ub-s2);
}

.ub-wbe__label {
  min-width: 0;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  overflow-wrap: anywhere;
}

.ub-wbe__tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ub-s1);
  flex: 0 0 auto;
}

.ub-wbe__skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ub-s2);
  padding-left: calc(var(--ub-u) * 26);
}

.ub-wbe__skill {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  margin-left: calc(var(--ub-u) * 26);
  padding: var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
}

.ub-wbe__skill-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ub-s2);
}
</style>
