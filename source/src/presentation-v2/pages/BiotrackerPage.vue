<template>
  <section class="acu-v2-biotracker-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-biotracker-page__grid" collapse-at="lg">
      <!-- API 配置（独立配置） -->
      <AcuPanel
        id="biotracker-api-panel"
        :title="copy.apiTitle"
        :description="copy.apiDescription"
      >
        <AcuFormRow label="OpenAI 兼容 API Base URL" hint="例如 https://example.com/v1">
          <input v-model="apiUrl.value" type="text" class="acu-input" placeholder="https://example.com/v1" />
        </AcuFormRow>
        <AcuFormRow label="API Key">
          <input v-model="apiKey.value" type="password" class="acu-input" placeholder="sk-..." />
        </AcuFormRow>
        <AcuFormRow label="模型名称">
          <input v-model="apiModel.value" type="text" class="acu-input" placeholder="gpt-4.1-mini" />
        </AcuFormRow>
        <div class="acu-v2-biotracker-page__actions">
          <AcuButton size="sm" @click="saveApiConfig">保存 API 配置</AcuButton>
        </div>
      </AcuPanel>

      <!-- 注册与自动注册 -->
      <AcuPanel
        id="biotracker-register-panel"
        :title="copy.registerTitle"
        :description="copy.registerDescription"
      >
        <AcuFormRow label="角色名">
          <input v-model="registerName.value" type="text" class="acu-input" placeholder="要注册的角色名" />
        </AcuFormRow>
        <AcuFormRow label="种族（手动模式选择，自动模式由 AI 判断）">
          <select v-model="registerRace.value" class="acu-input">
            <option value="">（由 AI 判断 / 手动留空）</option>
            <option v-for="race in registerRaceOptions.value" :key="race" :value="race">{{ race }}</option>
          </select>
        </AcuFormRow>
        <AcuFormRow label="补充设定（可选）">
          <textarea v-model="registerNotes.value" class="acu-input" rows="2" placeholder="种族生理/心理/描述补充"></textarea>
        </AcuFormRow>
        <div class="acu-v2-biotracker-page__actions">
          <AcuButton size="sm" :disabled="registering.value" @click="doRegister">
            {{ registering.value ? '注册中...' : '注册角色' }}
          </AcuButton>
          <AcuButton size="sm" :disabled="autoRunning.value" @click="runAutoRegister">
            {{ autoRunning.value ? '自动注册中...' : '立即自动注册' }}
          </AcuButton>
          <AcuButton size="sm" variant="secondary" @click="runTrackerNow">立即追踪分析</AcuButton>
        </div>
        <AcuFormRow label="自动注册">
          <label class="acu-v2-biotracker-page__toggle">
            <AcuCheckbox :model-value="autoRegister.value" @update:model-value="toggleAutoRegister" />
            <span>消息后由 AI 读取最新楼层，自动发现有价值的角色并注册（种族交 AI 判断）</span>
          </label>
        </AcuFormRow>
        <p v-if="status.value" class="acu-v2-biotracker-page__status" :data-error="statusIsError.value">
          {{ status.value }}
        </p>
      </AcuPanel>

      <!-- 已注册角色（只读） -->
      <AcuPanel
        id="biotracker-data-panel"
        :title="copy.dataTitle"
        :description="copy.dataDescription"
      >
        <div v-if="characters.value.length === 0" class="acu-v2-biotracker-page__empty">
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
            <tr v-for="c in characters.value" :key="c.name">
              <td>{{ c.name }}</td>
              <td>{{ c.race }}</td>
              <td>{{ c.summary }}</td>
            </tr>
          </tbody>
        </table>
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AcuMobilePanelNav from '../components/_lib/AcuMobilePanelNav.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuCheckbox from '../components/_lib/AcuCheckbox.vue';
import { useBiotrackerPage } from '../composables/useBiotrackerPage';

const copy = {
  apiTitle: 'API 配置',
  apiDescription: '生理追踪/注册使用独立 API 配置，与数据库主 API 分离。需支持 OpenAI 兼容 /chat/completions 并能稳定输出 JSON。',
  registerTitle: '注册与自动注册',
  registerDescription: '手动注册：填写角色名并选择种族。自动注册：由 AI 读取最新楼层发现值得记录的角色并注册，种族由 AI 判断。',
  dataTitle: '已注册角色',
  dataDescription: '当前聊天的生理追踪数据（只读）。完整数据由异步追踪持续更新。',
};

const page = useBiotrackerPage();

const panelNavItems = computed(() => [
  { key: 'biotracker-api-panel', label: copy.apiTitle },
  { key: 'biotracker-register-panel', label: copy.registerTitle },
  { key: 'biotracker-data-panel', label: copy.dataTitle },
]);
</script>

<style scoped>
.acu-v2-biotracker-page__grid {
  gap: 1rem;
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
