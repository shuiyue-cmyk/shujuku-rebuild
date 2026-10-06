<template>
  <label class="ub-textarea" :class="{ 'ub-textarea--mono': mono }">
    <span v-if="label" class="ub-textarea__label">{{ label }}</span>
    <textarea
      ref="el"
      class="ub-textarea__input"
      :value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :disabled="disabled"
      :readonly="readonly"
      :aria-label="ariaLabel || label"
      @input="onInput"
      @focus="resize"
    ></textarea>
  </label>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
  autoResize?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  label?: string;
  ariaLabel?: string;
  mono?: boolean;
}>(), {
  placeholder: undefined,
  rows: 4,
  maxRows: undefined,
  autoResize: false,
  disabled: false,
  readonly: false,
  label: undefined,
  ariaLabel: undefined,
  mono: false,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();
const el = ref<HTMLTextAreaElement | null>(null);

function lineHeightOf(node: HTMLTextAreaElement): number {
  const style = (node.ownerDocument.defaultView ?? window).getComputedStyle(node);
  const lh = Number.parseFloat(style.lineHeight);
  if (lh > 0) return lh;
  const fs = Number.parseFloat(style.fontSize);
  return fs > 0 ? fs * 1.5 : 20;
}

/** 自动增高：最少 rows 行，最多 maxRows 行（未设则不封顶）。 */
function resize(): void {
  const node = el.value;
  if (!node || !props.autoResize) return;
  const line = lineHeightOf(node);
  node.style.height = 'auto';
  const min = line * props.rows + 16;
  const max = props.maxRows ? line * props.maxRows + 16 : Number.POSITIVE_INFINITY;
  const next = Math.min(Math.max(node.scrollHeight + 2, min), max);
  node.style.height = `${next}px`;
  node.style.overflowY = node.scrollHeight + 2 > max ? 'auto' : 'hidden';
}

function onInput(ev: Event): void {
  emit('update:modelValue', (ev.target as HTMLTextAreaElement | null)?.value ?? '');
  resize();
}

onMounted(() => void nextTick(resize));
watch(() => props.modelValue, () => void nextTick(resize));
</script>

<style scoped>
.ub-textarea {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  min-width: 0;
  width: 100%;
}

.ub-textarea__label {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-textarea__input {
  width: 100%;
  min-width: 0;
  padding: var(--ub-s2) var(--ub-s3);
  border: 1px solid var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-input-bg);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.ub-textarea--mono .ub-textarea__input {
  font-family: var(--ub-mono);
  font-size: var(--ub-fs-xs);
}

.ub-textarea__input:focus {
  border-color: var(--ub-accent);
  box-shadow: 0 0 0 3px var(--ub-accent-soft);
}

.ub-textarea__input::placeholder {
  color: var(--ub-text-3);
  opacity: 1;
}

.ub-textarea__input:disabled {
  opacity: 0.5;
}
</style>
