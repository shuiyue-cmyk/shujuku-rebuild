<template>
  <span class="ub-file" :class="{ 'ub-file--block': block }">
    <UbIconButton
      v-if="iconOnly"
      :icon="icon || 'fa-solid fa-file-import'"
      :title="title"
      :disabled="disabled"
      @click="pick"
    />
    <UbButton
      v-else
      :variant="variant"
      :size="size"
      :icon="icon"
      :disabled="disabled"
      :title="title"
      :block="block"
      @click="pick"
    >
      <slot />
    </UbButton>
    <input ref="input" type="file" class="ub-file__input" :accept="accept" tabindex="-1" @change="onChange">
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import UbButton from './UbButton.vue';
import UbIconButton from './UbIconButton.vue';

withDefaults(defineProps<{
  accept?: string;
  icon?: string;
  title?: string;
  variant?: 'default' | 'primary' | 'soft' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  iconOnly?: boolean;
  block?: boolean;
}>(), {
  accept: undefined,
  icon: undefined,
  title: undefined,
  variant: 'default',
  size: 'md',
  disabled: false,
  iconOnly: false,
  block: false,
});

const emit = defineEmits<{ (e: 'file', file: File): void }>();
const input = ref<HTMLInputElement | null>(null);

function pick(): void {
  input.value?.click();
}

function onChange(ev: Event): void {
  const el = ev.target as HTMLInputElement;
  const file = el.files?.[0];
  // 清空以便重复选择同一个文件也能触发 change
  el.value = '';
  if (file) emit('file', file);
}
</script>

<style scoped>
.ub-file {
  display: inline-flex;
  min-width: 0;
}

.ub-file--block {
  display: flex;
  width: 100%;
}

.ub-file__input {
  display: none;
}
</style>
