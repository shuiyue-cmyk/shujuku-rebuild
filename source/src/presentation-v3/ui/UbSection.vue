<template>
  <section :id="id" class="ub-section" :data-ub-section="id">
    <header v-if="title || $slots.actions" class="ub-section__head">
      <div class="ub-section__titles">
        <h2 v-if="title" class="ub-section__title">
          <i v-if="icon" :class="[icon, 'ub-section__icon']" aria-hidden="true"></i>
          {{ title }}
        </h2>
        <p v-if="description" class="ub-section__desc">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="ub-section__actions"><slot name="actions" /></div>
    </header>
    <div v-if="$slots.lead" class="ub-section__lead"><slot name="lead" /></div>
    <div class="ub-section__card" :class="{ 'is-padded': padded, 'is-bare': bare }">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 页面分节：标题在卡片外，卡片里放设置行（UbRow）或自由内容（padded）。
 * bare 时不画卡片底色，用于本身就是卡片列表的内容。
 */
withDefaults(defineProps<{
  id?: string;
  title?: string;
  description?: string;
  icon?: string;
  padded?: boolean;
  bare?: boolean;
}>(), {
  id: undefined,
  title: undefined,
  description: undefined,
  icon: undefined,
  padded: false,
  bare: false,
});
</script>

<style scoped>
.ub-section {
  min-width: 0;
  scroll-margin-top: var(--ub-s5);
}

.ub-section__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--ub-s3);
  margin: 0 var(--ub-s1) var(--ub-s2);
}

.ub-section__titles {
  min-width: 0;
}

.ub-section__title {
  display: flex;
  align-items: center;
  gap: var(--ub-s2);
  margin: 0;
  color: var(--ub-text);
  font-size: var(--ub-fs-lg);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.ub-section__icon {
  color: var(--ub-accent-ink);
  font-size: 0.9em;
}

.ub-section__desc {
  margin: var(--ub-s1) 0 0;
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-section__actions {
  display: flex;
  align-items: center;
  gap: var(--ub-s1);
  flex: 0 0 auto;
}

.ub-section__lead {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  margin-bottom: var(--ub-s2);
}

.ub-section__card {
  min-width: 0;
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-card);
  background: var(--ub-panel);
  box-shadow: var(--ub-card-shadow);
  overflow: hidden;
}

.ub-section__card.is-padded {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
  overflow: visible;
}

.ub-section__card.is-bare {
  border: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}
</style>
