<template>
  <div class="ub-jde" :class="{ 'is-open': open }">
    <button type="button" class="ub-jde__toggle" :aria-expanded="open ? 'true' : 'false'" @click="open = !open">
      <i class="fa-solid fa-code" aria-hidden="true"></i>
      {{ label }}
      <UbBadge v-if="dirty" variant="warning">未保存</UbBadge>
      <i class="fa-solid fa-chevron-down ub-jde__chevron" aria-hidden="true"></i>
    </button>
    <div v-if="open" class="ub-jde__body">
      <p v-if="hint" class="ub-jde__hint">{{ hint }}</p>
      <UbTextarea :model-value="draft" :rows="rows" mono :aria-label="label" @update:model-value="emit('update', $event)" />
      <p v-if="error" class="ub-jde__error" role="alert">{{ error }}</p>
      <div class="ub-jde__actions">
        <UbButton size="sm" variant="ghost" :disabled="!dirty" @click="emit('discard')">放弃修改</UbButton>
        <UbButton size="sm" variant="primary" icon="fa-solid fa-floppy-disk" :busy="saving" :disabled="!dirty" @click="emit('save')">{{ saveLabel }}</UbButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 原始 JSON 编辑块：默认收起，展开后可改草稿、放弃或保存（续写资料各模块共用）。 */
import { ref } from 'vue';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbTextarea from '../ui/UbTextarea.vue';

withDefaults(defineProps<{
  draft: string;
  dirty: boolean;
  saving?: boolean;
  error?: string;
  saveLabel: string;
  label?: string;
  hint?: string;
  rows?: number;
}>(), {
  saving: false,
  error: '',
  label: '编辑原始 JSON',
  hint: undefined,
  rows: 12,
});

const emit = defineEmits<{
  (e: 'update', value: string): void;
  (e: 'discard'): void;
  (e: 'save'): void;
}>();

const open = ref(false);
</script>

<style scoped>
.ub-jde {
  border: 1px dashed var(--ub-line);
  border-radius: var(--ub-r-control);
}

.ub-jde.is-open {
  border-style: solid;
}

.ub-jde__toggle {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  width: 100%;
  padding: var(--ub-s2) var(--ub-s3);
  border: 0;
  background: transparent;
  color: var(--ub-text-2);
  font: inherit;
  font-size: var(--ub-fs-xs);
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.ub-jde__chevron {
  margin-left: auto;
  transition: transform 0.14s ease;
}

.is-open .ub-jde__chevron {
  transform: rotate(180deg);
}

.ub-jde__body {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: 0 var(--ub-s3) var(--ub-s3);
}

.ub-jde__hint {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-jde__error {
  color: var(--ub-danger);
  font-size: var(--ub-fs-xs);
}

.ub-jde__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ub-s2);
}
</style>
