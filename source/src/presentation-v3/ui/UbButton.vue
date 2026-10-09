<template>
  <a
    v-if="href"
    class="ub-btn"
    :class="[`ub-btn--${variant}`, `ub-btn--${size}`, { 'ub-btn--block': block }]"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :title="title"
  >
    <i v-if="icon" :class="[icon, 'ub-btn__icon']" aria-hidden="true"></i>
    <span v-if="$slots.default" class="ub-btn__label"><slot /></span>
  </a>
  <button
    v-else
    :type="nativeType"
    class="ub-btn"
    :class="[`ub-btn--${variant}`, `ub-btn--${size}`, { 'ub-btn--block': block, 'ub-btn--busy': busy }]"
    :disabled="disabled || busy"
    :title="title"
    :aria-busy="busy ? 'true' : undefined"
  >
    <i v-if="busy" class="fa-solid fa-circle-notch fa-spin ub-btn__icon" aria-hidden="true"></i>
    <i v-else-if="icon" :class="[icon, 'ub-btn__icon']" aria-hidden="true"></i>
    <span v-if="$slots.default" class="ub-btn__label"><slot /></span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'default' | 'primary' | 'soft' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: string;
  disabled?: boolean;
  busy?: boolean;
  block?: boolean;
  title?: string;
  nativeType?: 'button' | 'submit';
  /** 外链：渲染为新标签页打开的 <a>。 */
  href?: string;
}>(), {
  variant: 'default',
  size: 'md',
  icon: undefined,
  disabled: false,
  busy: false,
  block: false,
  title: undefined,
  nativeType: 'button',
  href: undefined,
});
</script>

<style scoped>
.ub-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ub-s2);
  /* 不参与 flex 收缩：与输入框（width:100%）或长说明并排时，按比例收缩会把文字挤成「加…」甚至只剩图标 */
  flex-shrink: 0;
  min-width: 0;
  height: var(--ub-control-h);
  padding: 0 var(--ub-s4);
  border: 1px solid var(--ub-line);
  border-radius: var(--ub-r-control);
  background: var(--ub-panel);
  color: var(--ub-text);
  font: inherit;
  font-size: var(--ub-fs-sm);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease, transform 0.08s ease;
}

.ub-btn:hover:not(:disabled) {
  background: var(--ub-hover-strong);
}

.ub-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.ub-btn:focus-visible {
  outline: 2px solid var(--ub-accent);
  outline-offset: 2px;
}

.ub-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ub-btn--busy:disabled {
  opacity: 0.8;
  cursor: progress;
}

.ub-btn--sm {
  height: var(--ub-control-h-sm);
  padding: 0 var(--ub-s3);
  font-size: var(--ub-fs-xs);
}

.ub-btn--block {
  display: flex;
  flex-shrink: 1;
  width: 100%;
}

.ub-btn--primary {
  border-color: transparent;
  background: var(--ub-accent);
  color: var(--ub-on-accent);
}

.ub-btn--primary:hover:not(:disabled) {
  background: var(--ub-accent-2);
}

.ub-btn--soft {
  border-color: transparent;
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
}

.ub-btn--soft:hover:not(:disabled) {
  background: var(--ub-accent-soft-2);
}

.ub-btn--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--ub-text-2);
}

.ub-btn--ghost:hover:not(:disabled) {
  background: var(--ub-hover);
  color: var(--ub-text);
}

.ub-btn--danger {
  border-color: transparent;
  background: var(--ub-danger-soft);
  color: var(--ub-danger);
}

.ub-btn--danger:hover:not(:disabled) {
  background: var(--ub-danger);
  color: var(--ub-on-accent);
}

.ub-btn__icon {
  flex: 0 0 auto;
  font-size: 0.95em;
}

.ub-btn__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
