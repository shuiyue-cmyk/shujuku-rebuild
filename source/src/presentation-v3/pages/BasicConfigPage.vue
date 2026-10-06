<template>
  <UbPage lead="上手只需要这一页。按顺序配好 API、更新节奏、表格模板与剧情推进就能开始；需要更多功能时切到「高手模式」。" :sections="sections">
    <ApiPresetEditor id-prefix="basic-api" />
    <UpdateSettingsSection id="basic-update" :show-advanced="false" />
    <TableTemplateSection id="basic-table" />
    <PlotPresetSection id="basic-plot" />
  </UbPage>
</template>

<script setup lang="ts">
import { basicConfigCopy } from '../../presentation-v2/copy/basic-config-copy';
import ApiPresetEditor from '../parts/ApiPresetEditor.vue';
import PlotPresetSection from '../parts/PlotPresetSection.vue';
import TableTemplateSection from '../parts/TableTemplateSection.vue';
import UpdateSettingsSection from '../parts/UpdateSettingsSection.vue';
import UbPage from '../ui/UbPage.vue';

const sections = [
  { id: 'basic-api-preset', label: basicConfigCopy.nav.api },
  { id: 'basic-update', label: basicConfigCopy.nav.update },
  { id: 'basic-table', label: basicConfigCopy.nav.table },
  { id: 'basic-plot', label: basicConfigCopy.nav.plot },
];
</script>

