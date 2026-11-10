<template>
  <UbPage lead="面向开发与排障的选项。默认关闭，不建议无经验用户开启。">
    <UbSection :title="copy.panels.gatedFields.title" :description="copy.panels.gatedFields.description" icon="fa-solid fa-flask">
      <UbRow label="剧情推进" hint="在编辑剧情推进预设时显示「匹配替换」字段。">
        <UbSwitch :model-value="devOptions.plotAdvanced.value" aria-label="剧情推进" @update:model-value="devOptions.setPlotAdvanced($event)" />
      </UbRow>
      <UbRow label="API二次确认" hint="打开时，API 预设在别处变化后，其他使用该预设的位置会标黄提醒；关闭后不再标黄。">
        <UbSwitch :model-value="devOptions.apiReconfirm.value" aria-label="API二次确认" @update:model-value="devOptions.setApiReconfirm($event)" />
      </UbRow>
      <UbRow
        label="WARN 日志"
        hint="常驻采集 WARN 级运行日志：开启后不点「开始 Debug」也会把 warn 写入运行日志与导出；关闭时（默认）只有 error。开始/停止 Debug 只影响临时那一路，不会动这里的常驻选择。"
      >
        <UbSwitch :model-value="devOptions.warnLogEnabled.value" aria-label="WARN 日志" @update:model-value="devOptions.setWarnLogEnabled($event)" />
      </UbRow>
      <UbRow
        label="执行边界提示词"
        hint="开启后，数据库发出的每一次 AI 请求（填表、剧情推进、Agent、续写等）都会额外附加一段约束提示词，要求模型只做指令要求的事、不编造、不越范围。适合 MiniMax M3.1 Flash 这类爱「顺便多做」的模型；默认关闭，关闭时请求与原来完全一致。"
      >
        <UbSwitch :model-value="devOptions.scopeGuardPrompt.value" aria-label="执行边界提示词" @update:model-value="devOptions.setScopeGuardPrompt($event)" />
      </UbRow>
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { useDevOptions } from '../../presentation-v2/composables/useDevOptions';
import { developerCopy as copy } from '../../presentation-v2/copy/developer-copy';
import UbPage from '../ui/UbPage.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSwitch from '../ui/UbSwitch.vue';

const devOptions = useDevOptions();
</script>
