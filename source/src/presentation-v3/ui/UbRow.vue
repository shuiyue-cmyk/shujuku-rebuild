<template>
  <div class="ub-row" :class="{ 'ub-row--stack': stack, 'ub-row--flag': flagged }" :data-ub-row="label">
    <div v-if="label || $slots.label || hint || $slots.hint" class="ub-row__text">
      <div v-if="label || $slots.label" class="ub-row__label">
        <slot name="label">{{ label }}</slot>
      </div>
      <div v-if="hint || $slots.hint" class="ub-row__hint">
        <slot name="hint">{{ hint }}</slot>
      </div>
    </div>
    <div v-if="$slots.default" class="ub-row__control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置行：左侧标题＋说明，右侧控件；stack 时控件换到下方占满整行（长输入框、多行文本）。
 * flagged 用于"需要用户再确认一次"的高亮（如 API 预设被别处修改后的防呆提示）。
 */
withDefaults(defineProps<{
  label?: string;
  hint?: string;
  stack?: boolean;
  flagged?: boolean;
}>(), {
  label: undefined,
  hint: undefined,
  stack: false,
  flagged: false,
});
</script>

<style scoped>
.ub-row {
  display: flex;
  align-items: center;
  gap: var(--ub-s3) var(--ub-s4);
  min-width: 0;
  padding: var(--ub-s3) var(--ub-s4);
}

.ub-row + .ub-row {
  border-top: 1px solid var(--ub-line-soft);
}

.ub-row--stack {
  flex-direction: column;
  align-items: stretch;
}

.ub-row--flag {
  background: var(--ub-warn-soft);
  box-shadow: inset 3px 0 0 var(--ub-warn);
}

.ub-row__text {
  flex: 1 1 auto;
  min-width: 0;
}

.ub-row__label {
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  font-weight: 600;
  line-height: 1.35;
}

.ub-row__hint {
  margin-top: var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  line-height: 1.55;
}

.ub-row__control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--ub-s2);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 62%;
}

.ub-row--stack .ub-row__control {
  justify-content: stretch;
  max-width: none;
  width: 100%;
}

.ub-row--stack .ub-row__control > :deep(*) {
  flex: 1 1 auto;
}

@media (max-width: 560px) {
  .ub-row:not(.ub-row--stack) .ub-row__control {
    max-width: 55%;
  }
}
</style>
