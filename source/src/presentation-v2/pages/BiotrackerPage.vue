<template>
  <section class="acu-v2-biotracker-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <div class="acu-v2-biotracker-page__panel-stack">
      <!-- API 配置（复用数据库主 API 配置，只读） -->
      <AcuPanel
        id="biotracker-api-panel"
        :title="copy.apiTitle"
        :description="copy.apiDescription"
      >
        <p class="acu-v2-biotracker-page__api-readonly">
          生理追踪/注册使用数据库已配置的 API（在「API」页面配置）。
          当前：{{ apiUrl ? apiUrl : '未配置 URL' }} / {{ apiModel ? apiModel : '未配置模型' }}
        </p>
      </AcuPanel>

      <!-- 注册与自动注册 -->
      <AcuPanel
        id="biotracker-register-panel"
        :title="copy.registerTitle"
        :description="copy.registerDescription"
      >
        <AcuFormRow label="角色名">
          <input v-model="registerName" type="text" class="acu-input" placeholder="要注册的角色名" />
        </AcuFormRow>
        <AcuFormRow label="种族（手动模式选择，自动模式由 AI 判断）">
          <select v-model="registerRace" class="acu-input">
            <option value="">（由 AI 判断 / 手动留空）</option>
            <option v-for="race in registerRaceOptions" :key="race" :value="race">{{ race }}</option>
          </select>
        </AcuFormRow>
        <AcuFormRow label="补充设定（可选）">
          <textarea v-model="registerNotes" class="acu-input" rows="2" placeholder="种族生理/心理/描述补充"></textarea>
        </AcuFormRow>
        <div class="acu-v2-biotracker-page__actions">
          <AcuButton size="sm" :disabled="registering" @click="doRegister">
            {{ registering ? '注册中...' : '注册角色' }}
          </AcuButton>
          <AcuButton size="sm" :disabled="autoRunning" @click="runAutoRegister">
            {{ autoRunning ? '自动注册中...' : '立即自动注册' }}
          </AcuButton>
          <AcuButton size="sm" variant="secondary" @click="runTrackerNow">立即追踪分析</AcuButton>
        </div>
        <AcuFormRow label="自动注册">
          <label class="acu-v2-biotracker-page__toggle">
            <AcuCheckbox :model-value="autoRegister" @update:model-value="toggleAutoRegister" />
            <span>消息后由 AI 读取最新楼层，自动发现有价值的角色并注册（种族交 AI 判断）</span>
          </label>
        </AcuFormRow>
        <p v-if="status" class="acu-v2-biotracker-page__status" :data-error="statusIsError">
          {{ status }}
        </p>
      </AcuPanel>

      <!-- 已注册角色（只读） -->
      <AcuPanel
        id="biotracker-data-panel"
        :title="copy.dataTitle"
        :description="copy.dataDescription"
      >
        <div v-if="characters.length === 0" class="acu-v2-biotracker-page__empty">
          当前聊天尚未注册角色。请先注册，或开启自动注册后发送消息等待发现。
        </div>
        <table v-else class="acu-v2-biotracker-page__table">
          <thead>
            <tr>
              <th>角色名</th>
              <th>种族</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in characters" :key="c.name">
              <td>{{ c.name }}</td>
              <td>{{ c.race }}</td>
              <td>{{ c.summary }}</td>
            </tr>
          </tbody>
        </table>
      </AcuPanel>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AcuMobilePanelNav from '../components/_lib/AcuMobilePanelNav.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuCheckbox from '../components/_lib/AcuCheckbox.vue';
import { useBiotrackerPage } from '../composables/useBiotrackerPage';

const copy = {
  apiTitle: 'API 配置',
  apiDescription: '生理追踪/注册使用数据库已配置的 API（「API」页面）。需支持 OpenAI 兼容 /chat/completions 并能稳定输出 JSON。',
  registerTitle: '注册与自动注册',
  registerDescription: '手动注册：填写角色名并选择种族。自动注册：由 AI 读取最新楼层发现值得记录的角色并注册，种族由 AI 判断。',
  dataTitle: '已注册角色',
  dataDescription: '当前聊天的生理追踪数据（只读）。完整数据由异步追踪持续更新。',
};

const {
  apiUrl,
  apiKey,
  apiModel,
  registerName,
  registerRace,
  registerNotes,
  registerRaceOptions,
  registering,
  doRegister,
  autoRegister,
  toggleAutoRegister,
  autoRunning,
  runAutoRegister,
  runTrackerNow,
  characters,
  status,
  statusIsError,
} = useBiotrackerPage();

const panelNavItems = computed(() => [
  { id: 'biotracker-api-panel', label: copy.apiTitle },
  { id: 'biotracker-register-panel', label: copy.registerTitle },
  { id: 'biotracker-data-panel', label: copy.dataTitle },
]);
</script>

<style scoped>
.acu-v2-biotracker-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.acu-v2-biotracker-page__panel-stack {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.acu-v2-biotracker-page__api-readonly {
  color: var(--acu-text-2, inherit);
  margin: 0;
  line-height: 1.55;
}
.acu-v2-biotracker-page__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}
.acu-v2-biotracker-page__toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.acu-v2-biotracker-page__status {
  margin-top: 0.75rem;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  background: rgba(125, 73, 64, 0.12);
  color: var(--acu-text, inherit);
}
.acu-v2-biotracker-page__status[data-error='true'] {
  background: rgba(220, 60, 60, 0.15);
  color: #e06060;
}
.acu-v2-biotracker-page__empty {
  color: var(--acu-text-dim, #8a8075);
  padding: 0.5rem 0;
}
.acu-v2-biotracker-page__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}
.acu-v2-biotracker-page__table th,
.acu-v2-biotracker-page__table td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}
</style>
