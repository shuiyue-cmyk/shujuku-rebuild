<template>
  <div class="ub-picker" :class="{ 'is-disabled': disabled }">
    <button
      type="button"
      class="ub-picker__trigger"
      :disabled="disabled"
      :aria-haspopup="'dialog'"
      :aria-expanded="open ? 'true' : 'false'"
      @click="open = true"
    >
      <i v-if="modelValue && modelValue === defaultName && showDefaultAction" class="fa-solid fa-star ub-picker__star-mark" aria-hidden="true" title="全局默认"></i>
      <span class="ub-picker__value" :class="{ 'is-placeholder': !selectedItem }">{{ selectedLabel }}</span>
      <i class="fa-solid fa-chevron-down ub-picker__caret" aria-hidden="true"></i>
    </button>

    <Teleport defer to="#ub-portal">
      <div v-if="open" class="ub-picker-layer" data-tt-mobile-surface="backdrop" @click.self="open = false">
        <div class="ub-picker-panel" role="dialog" aria-modal="true" :aria-label="title">
          <header class="ub-picker-panel__head">
            <span class="ub-picker-panel__title">{{ title }}</span>
            <UbIconButton icon="fa-solid fa-xmark" size="sm" title="关闭" @click="open = false" />
          </header>
          <p v-if="showDefaultAction" class="ub-picker-panel__hint">点选切换；点星标设为全局默认（新聊天使用）。</p>
          <ul class="ub-picker-panel__list" role="listbox">
            <li
              v-for="item in items"
              :key="valueOf(item)"
              role="option"
              class="ub-picker-panel__item"
              :class="{ 'is-active': valueOf(item) === modelValue }"
              :aria-selected="valueOf(item) === modelValue ? 'true' : 'false'"
              @click="select(valueOf(item))"
            >
              <span class="ub-picker-panel__check" aria-hidden="true">
                <i v-if="valueOf(item) === modelValue" class="fa-solid fa-check"></i>
              </span>
              <span class="ub-picker-panel__main">
                <span class="ub-picker-panel__name">{{ labelOf(item) }}</span>
                <span v-if="item.meta" class="ub-picker-panel__meta">{{ item.meta }}</span>
              </span>
              <button
                v-if="showDefaultAction"
                type="button"
                class="ub-picker-panel__star"
                :class="{ 'is-default': valueOf(item) === defaultName }"
                :title="valueOf(item) === defaultName ? '全局默认' : '设为全局默认'"
                :aria-label="valueOf(item) === defaultName ? '全局默认' : '设为全局默认'"
                @click.stop="emit('set-default', valueOf(item))"
              >
                <i :class="valueOf(item) === defaultName ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
              </button>
            </li>
            <li v-if="!items.length" class="ub-picker-panel__empty">{{ emptyText }}</li>
          </ul>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
export interface UbPresetItem {
  name?: string;
  value?: string;
  label?: string;
  meta?: string;
}
</script>

<script setup lang="ts">
/**
 * 预设选择器：触发按钮＋弹出列表（Teleport 到门户层，避免被卡片裁切）。
 * 列表项可"设为全局默认"（星标），与经典界面的预设下拉语义一致。
 */
import { computed, ref } from 'vue';
import UbIconButton from './UbIconButton.vue';

const props = withDefaults(defineProps<{
  items: UbPresetItem[];
  modelValue: string;
  defaultName?: string;
  title?: string;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  showDefaultAction?: boolean;
}>(), {
  defaultName: '',
  title: '选择预设',
  placeholder: '未选择',
  emptyText: '暂无预设',
  disabled: false,
  showDefaultAction: true,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'set-default', value: string): void;
}>();

const open = ref(false);

function valueOf(item: UbPresetItem): string {
  return item.value ?? item.name ?? '';
}

function labelOf(item: UbPresetItem): string {
  return item.label ?? item.name ?? item.value ?? '';
}

const selectedItem = computed(() => props.items.find(item => valueOf(item) === props.modelValue) ?? null);
const selectedLabel = computed(() => (selectedItem.value ? labelOf(selectedItem.value) : props.placeholder));

function select(value: string): void {
  if (props.disabled) return;
  open.value = false;
  emit('update:modelValue', value);
}
</script>

<style scoped>
.ub-picker {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
}

.ub-picker__trigger {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  width: 100%;
  min-width: 0;
  height: var(--ub-control-h);
  padding: 0 var(--ub-s3);
  border: 1px solid var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.ub-picker__trigger:hover:not(:disabled) {
  border-color: var(--ub-line-strong);
}

.ub-picker__trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ub-picker__star-mark {
  color: var(--ub-warn);
  font-size: 0.85em;
}

.ub-picker__value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-picker__value.is-placeholder {
  color: var(--ub-text-3);
  font-weight: 500;
}

.ub-picker__caret {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-picker-layer {
  position: fixed;
  inset: 0;
  z-index: 9350;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(var(--ub-safe-top), 16px) 16px max(var(--ub-safe-bottom), 16px);
  background: var(--ub-scrim);
  animation: ub-fade-in 0.14s ease-out both;
}

.ub-picker-panel {
  display: flex;
  flex-direction: column;
  width: min(420px, 100%);
  max-height: min(560px, 100%);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--ub-overlay-shadow);
  overflow: hidden;
  animation: ub-pop-in 0.16s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.ub-picker-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s3) var(--ub-s2) var(--ub-s4);
}

.ub-picker-panel__title {
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  font-weight: 700;
}

.ub-picker-panel__hint {
  margin: 0;
  padding: 0 var(--ub-s4) var(--ub-s2);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-picker-panel__list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: var(--ub-s1) var(--ub-s2) var(--ub-s2);
  list-style: none;
  overflow-y: auto;
}

.ub-picker-panel__item {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  min-height: calc(var(--ub-control-h) + 6px);
  padding: var(--ub-s1) var(--ub-s2);
  border-radius: var(--ub-r-control);
  cursor: pointer;
}

.ub-picker-panel__item:hover {
  background: var(--ub-hover);
}

.ub-picker-panel__item.is-active {
  background: var(--ub-accent-soft);
}

.ub-picker-panel__check {
  display: inline-flex;
  justify-content: center;
  width: 1.2em;
  color: var(--ub-accent-ink);
  font-size: var(--ub-fs-sm);
}

.ub-picker-panel__main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.ub-picker-panel__name {
  overflow: hidden;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-picker-panel__meta {
  overflow: hidden;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ub-picker-panel__star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ub-control-h-sm);
  height: var(--ub-control-h-sm);
  border: 0;
  border-radius: var(--ub-r-control);
  background: transparent;
  color: var(--ub-text-3);
  cursor: pointer;
}

.ub-picker-panel__star:hover {
  background: var(--ub-hover-strong);
  color: var(--ub-warn);
}

.ub-picker-panel__star.is-default {
  color: var(--ub-warn);
}

.ub-picker-panel__empty {
  padding: var(--ub-s4);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  text-align: center;
}
</style>
