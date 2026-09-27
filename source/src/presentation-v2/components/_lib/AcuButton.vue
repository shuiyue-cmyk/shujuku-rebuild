<template>
  <component
    :is="isLink ? 'a' : 'button'"
    :type="isLink ? undefined : nativeType"
    :href="isActiveLink ? href : undefined"
    :target="isActiveLink ? (target ?? '_blank') : undefined"
    :rel="isActiveLink ? (rel ?? 'noopener noreferrer') : undefined"
    :disabled="isLink ? undefined : (disabled || loading)"
    :aria-disabled="isLink && (disabled || loading) ? 'true' : undefined"
    :title="title"
    class="acu-btn"
    :class="[`acu-btn--${variant}`, sizeClass, { 'acu-btn--icon-only': iconOnly, 'acu-btn--loading': loading, 'acu-btn--block': block, 'acu-btn--disabled': isLink && (disabled || loading) }]"
    @click="$emit('click', $event)"
  >
    <i v-if="loading" class="fa-solid fa-spinner fa-spin acu-btn__spinner" />
    <slot v-if="!loading" />
    <slot v-else name="loading-text" />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type Variant = 'default' | 'primary' | 'danger';
type Size = 'sm' | 'md';

const props = withDefaults(defineProps<{
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  iconOnly?: boolean;
  block?: boolean;
  title?: string;
  nativeType?: 'button' | 'submit' | 'reset';
  /**
   * 给了 href 就渲染成 `<a>` 而不是 `<button>`：外链必须走真链接，宿主才会把它交给系统浏览器
   * （桌面 TauriTavern 的 on_new_window 对 http(s) 外链调 opener().open_url 并 Deny 新窗，
   * 移动端由 window.open 兼容层转 plugin:opener|open_url）。样式沿用同一套 .acu-btn，
   * 所以不在页面里裸写锚点（那些样式是本组件的 scoped style，别处拿不到）。
   */
  href?: string;
  /** 仅 href 模式生效；默认 `_blank`。 */
  target?: string;
  /** 仅 href 模式生效；默认 `noopener noreferrer`。 */
  rel?: string;
}>(), {
  variant: 'default',
  size: 'md',
  disabled: false,
  loading: false,
  iconOnly: false,
  block: false,
  title: undefined,
  nativeType: 'button',
  href: undefined,
  target: undefined,
  rel: undefined,
});

defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const sizeClass = computed(() => `acu-btn--${props.size}`);

/** href 模式：渲染成锚点。禁用/加载中的锚点不给 href（留着会让"看起来禁用"的链接照样能中键打开）。 */
const isLink = computed(() => !!props.href);
const isActiveLink = computed(() => isLink.value && !props.disabled && !props.loading);
</script>

<style scoped>
.acu-btn {
  font: inherit;
  border: 0;
  background: var(--acu-bg-2);
  color: var(--acu-text-1);
  border-radius: var(--acu-radius-sm);
  cursor: pointer;
  /* href 模式渲染成 <a>：锚点默认带下划线，不去掉就和同一排的按钮不成套。 */
  text-decoration: none;
  display: inline-flex; align-items: center; justify-content: center; gap: var(--acu-space-150, 6px);
  min-width: 0; max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.acu-btn--md { min-height: var(--acu-button-height-md, 32px); padding: var(--acu-control-padding-y-md, 6px) var(--acu-control-padding-x-md, 9px); font-size: var(--acu-font-size-body-lg, 13px); }
.acu-btn--sm { min-height: var(--acu-button-height-sm, 28px); padding: var(--acu-space-1, 4px) var(--acu-space-250, 10px); font-size: var(--acu-font-size-body, 12px); }
.acu-btn--block { width: 100%; min-width: 0; }
.acu-btn--icon-only { min-width: var(--acu-button-height-md, 32px); padding: var(--acu-control-padding-y-md, 6px) var(--acu-space-2, 8px); }
.acu-btn--icon-only.acu-btn--sm { min-width: var(--acu-button-height-sm, 28px); padding: var(--acu-space-1, 4px) var(--acu-space-2, 8px); }

.acu-btn:hover:not(:disabled) {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), var(--acu-bg-2);
}
.acu-btn:disabled { opacity: 0.5; cursor: not-allowed; }
/* 锚点没有 :disabled 伪类：href 模式的禁用态用类表达，视觉与 button:disabled 一致。 */
.acu-btn--disabled { opacity: 0.5; cursor: not-allowed; }
.acu-btn--disabled:hover { background: var(--acu-bg-2); }

.acu-btn--primary {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-weight: 500;
  box-shadow: none;
}
.acu-btn--primary:hover:not(:disabled) {
  background: var(--acu-accent-2);
  box-shadow: none;
}

.acu-btn--danger {
  background: color-mix(in srgb, var(--acu-danger) 10%, transparent);
  color: var(--acu-danger);
}
.acu-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--acu-danger) 18%, transparent);
}

.acu-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}

.acu-btn--loading { cursor: wait; }
.acu-btn__spinner { font-size: 0.85em; }
</style>
