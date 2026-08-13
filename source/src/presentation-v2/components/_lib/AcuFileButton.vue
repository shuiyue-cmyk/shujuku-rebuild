<template>
  <span class="acu-file-button" :class="{ 'acu-file-button--block': block }">
    <AcuButton
      v-bind="buttonProps"
      class="acu-file-button__button"
      :class="buttonClass"
      @click="trigger"
    >
      <slot />
    </AcuButton>
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      class="acu-file-button__input"
      @change="onChange"
    >
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuButton from './AcuButton.vue';

type Variant = 'default' | 'primary' | 'danger';
type Size = 'sm' | 'md';

const props = withDefaults(defineProps<{
  accept?: string;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  iconOnly?: boolean;
  block?: boolean;
  title?: string;
}>(), {
  accept: undefined,
  variant: 'default',
  size: 'md',
  disabled: false,
  iconOnly: false,
  block: false,
  title: undefined,
});

const emit = defineEmits<{
  (e: 'file', file: File): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

const buttonProps = computed(() => ({
  variant: props.variant,
  size: props.size,
  disabled: props.disabled,
  iconOnly: props.iconOnly,
  block: props.block,
  title: props.title,
}));

const buttonClass = computed(() => ({
  'acu-file-button__button--icon-only-default': props.iconOnly && props.variant === 'default',
  [`acu-file-button__button--${props.size}`]: true,
}));

function trigger(): void {
  inputRef.value?.click();
}

function onChange(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) emit('file', file);
  input.value = '';
}
</script>

<style scoped>
.acu-file-button { display: inline-flex; }
.acu-file-button--block { width: 100%; min-width: 0; }
.acu-file-button__input { display: none; }
.acu-file-button__button--icon-only-default {
  background: transparent;
  color: var(--acu-text-2);
}
.acu-file-button__button--icon-only-default:hover:not(:disabled) {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), var(--acu-bg-2);
  color: var(--acu-text-1);
}
.acu-file-button__button--icon-only-default.acu-file-button__button--md {
  width: var(--acu-icon-button-size-md, 32px);
  min-width: var(--acu-icon-button-size-md, 32px);
}
.acu-file-button__button--icon-only-default.acu-file-button__button--sm {
  width: var(--acu-icon-button-size-sm, 22px);
  min-width: var(--acu-icon-button-size-sm, 22px);
  min-height: var(--acu-icon-button-size-sm, 22px);
  padding: var(--acu-space-1, 4px);
  font-size: var(--acu-font-size-micro, 10px);
}
</style>
