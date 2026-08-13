<template>
  <section class="acu-v2-api-page">
    <AcuPanelGrid class="acu-v2-api-page__grid">
      <ApiConfigPanel />
      <div class="acu-v2-api-page__spacer" aria-hidden="true"></div>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import ApiConfigPanel from '../components/ApiConfigPanel.vue';
</script>

<style scoped>
.acu-v2-api-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-api-page__spacer {
  min-width: 0;
}

@media (max-width: 860px) {
  .acu-v2-api-page {
    padding: 14px;
  }

  .acu-v2-api-page__spacer {
    display: none;
  }
}
</style>
